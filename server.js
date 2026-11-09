// RabbitMQ Hub — one dashboard for several RabbitMQ clusters.
// Plain Node.js 26, no runtime dependencies, no database: everything comes from config.json + environment.
//
// Auth: meant to sit behind Cloudflare Access. Every request must carry the `Cf-Access-Jwt-Assertion`
// JWT; the server verifies its signature (team JWKS), audience and expiry, then reads the email.
// Roles come from config.json: admins can view + purge queues, viewers can only view. Anyone else → 403.
// Purge: admin only, the queue name must be typed again, and the cluster must have allow_purge=true.
// Every purge is logged and optionally sent to a webhook (Discord/Slack-compatible JSON `content`).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = import.meta.dirname;

const CONFIG_PATH = process.env.HUB_CONFIG || path.join(__dirname, 'config.json');
const PORT = Number(process.env.PORT || 8088);
const BIND = process.env.BIND || '127.0.0.1';
const RMQ_USER = process.env.RABBITMQ_USER || process.env.RABBITMQ_DEFAULT_USER;
const RMQ_PASS = process.env.RABBITMQ_PASS || process.env.RABBITMQ_DEFAULT_PASS;
const AUDIT_WEBHOOK = process.env.AUDIT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';
const DEV_EMAIL = process.env.HUB_DEV_EMAIL || ''; // local testing only — skips JWT verification. NEVER set in production.
const TZ = process.env.HUB_TIMEZONE || 'UTC';

let config = loadConfig();
fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => {
  try { config = loadConfig(); log('config reloaded'); } catch (e) { log('config error, keeping previous: ' + e.message); }
});
function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }

// ---------------- Cloudflare Access JWT ----------------
let jwks = { keys: [], fetchedAt: 0 };
async function getKeys() {
  if (Date.now() - jwks.fetchedAt < 3600e3 && jwks.keys.length) return jwks.keys;
  const r = await fetch(`https://${config.access.team_domain}/cdn-cgi/access/certs`);
  const j = await r.json();
  jwks = { keys: j.keys || [], fetchedAt: Date.now() };
  return jwks.keys;
}
const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyAccess(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('missing Access JWT');
  const header = JSON.parse(b64u(parts[0]));
  const payload = JSON.parse(b64u(parts[1]));
  let jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { jwks.fetchedAt = 0; jwk = (await getKeys()).find((k) => k.kid === header.kid); }
  if (!jwk || header.alg !== 'RS256') throw new Error('unknown JWT key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64u(parts[2]));
  if (!ok) throw new Error('bad JWT signature');
  const now = Date.now() / 1000;
  if (payload.exp && payload.exp < now - 30) throw new Error('JWT expired');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.access.aud)) throw new Error('JWT audience mismatch');
  if (!payload.email) throw new Error('JWT has no email');
  return String(payload.email).toLowerCase();
}
function matchEmail(email, patterns) {
  return (patterns || []).some((p) => {
    p = String(p).toLowerCase();
    return p.startsWith('*@') ? email.endsWith(p.slice(1)) : email === p;
  });
}
function roleOf(email) {
  if (matchEmail(email, config.users.admins)) return 'admin';
  if (matchEmail(email, config.users.peekers)) return 'peeker';
  if (matchEmail(email, config.users.viewers)) return 'viewer';
  return null;
}
// Reading message bodies may expose customer data: admins + users.peekers only.
const canPeek = (role) => role === 'admin' || role === 'peeker';
const PEEK_MAX = () => Math.min(50, Math.max(1, Number(config.peek_max || 10)));
// Short history for sparklines: last 10 minutes, one sample every 30 s (from the management API, no storage).
const HIST = 'lengths_age=600&lengths_incr=30&msg_rates_age=600&msg_rates_incr=30';
const series = (d) => (d?.samples || []).slice().reverse().map((x) => x.sample);
const rateSeries = (d) => {
  const s = (d?.samples || []).slice().reverse();
  return s.slice(1).map((x, i) => Math.max(0, (x.sample - s[i].sample) / ((x.timestamp - s[i].timestamp) / 1000 || 1)));
};

// ---------------- RabbitMQ management API ----------------
function clusterById(id) { return (config.clusters || []).find((c) => c.id === id); }
async function rmq(cluster, method, p, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(cluster.api.replace(/\/$/, '') + p, {
      method, signal: ctl.signal,
      headers: { Authorization: 'Basic ' + Buffer.from(`${RMQ_USER}:${RMQ_PASS}`).toString('base64') },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(t); }
}
const enc = encodeURIComponent;

async function clusterSummary(c) {
  const out = { id: c.id, name: c.name, role: c.role || '', allow_purge: !!c.allow_purge, allow_peek: c.allow_peek !== false, forwards_to: c.forwards_to || null, ok: false, problems: [] };
  try {
    const [ov, nodes] = await Promise.all([rmq(c, 'GET', `/overview?${HIST}`), rmq(c, 'GET', '/nodes')]);
    out.version = ov.rabbitmq_version;
    out.totals = ov.object_totals;
    out.messages = ov.queue_totals || {};
    out.rates = {
      publish: ov.message_stats?.publish_details?.rate || 0,
      deliver: ov.message_stats?.deliver_get_details?.rate || 0,
    };
    out.history = {
      messages: series(ov.queue_totals?.messages_details),
      publish: rateSeries(ov.message_stats?.publish_details),
      deliver: rateSeries(ov.message_stats?.deliver_get_details),
    };
    out.nodes = nodes.map((n) => ({
      name: n.name.split('@')[1]?.split('.')[0] || n.name, running: n.running,
      mem_used: n.mem_used, mem_limit: n.mem_limit, mem_alarm: n.mem_alarm,
      disk_free: n.disk_free, disk_free_limit: n.disk_free_limit, disk_alarm: n.disk_free_alarm,
      partitions: n.partitions || [], uptime: n.uptime,
    }));
    for (const n of out.nodes) {
      if (!n.running) out.problems.push(`${n.name} not running`);
      if (n.mem_alarm) out.problems.push(`${n.name} memory alarm`);
      if (n.disk_alarm) out.problems.push(`${n.name} disk alarm`);
      if (n.partitions.length) out.problems.push(`${n.name} network partition`);
    }
    const running = out.nodes.filter((n) => n.running).length;
    if (c.expected_nodes && running < c.expected_nodes) out.problems.push(`only ${running}/${c.expected_nodes} nodes running`);
    try {
      const sh = await rmq(c, 'GET', '/shovels');
      out.shovels = { total: sh.length, running: sh.filter((s) => s.state === 'running').length,
        bad: sh.filter((s) => s.state !== 'running').map((s) => `${s.name}=${s.state}`) };
      if (out.shovels.bad.length) out.problems.push(...out.shovels.bad.slice(0, 3).map((b) => `shovel ${b}`));
    } catch { out.shovels = null; }
    out.ok = out.problems.length === 0;
  } catch (e) {
    out.problems.push('management API unreachable: ' + e.message);
  }
  return out;
}

async function clusterQueues(c) {
  const cols = 'name,vhost,type,state,messages,messages_ready,messages_unacknowledged,consumers,messages_details,message_stats';
  const qs = await rmq(c, 'GET', `/queues?columns=${cols}&${HIST}`, 15000);
  const hidden = c.hide_queue_pattern ? new RegExp(c.hide_queue_pattern) : null;
  return qs.map((q) => ({
    name: q.name, vhost: q.vhost, type: q.type, state: q.state, messages: q.messages || 0,
    ready: q.messages_ready || 0, unacked: q.messages_unacknowledged || 0, consumers: q.consumers || 0,
    publish: q.message_stats?.publish_details?.rate || 0, deliver: q.message_stats?.deliver_get_details?.rate || 0,
    minor: hidden ? hidden.test(q.name) : false,
    hot: (c.warn_threshold?.[q.name] ?? c.warn_messages ?? 1000) < (q.messages || 0),
    history: series(q.messages_details),
  }));
}

async function clusterShovels(c) {
  const sh = await rmq(c, 'GET', '/shovels');
  return sh.map((s) => ({
    name: s.name, vhost: s.vhost, state: s.state, type: s.type,
    node: s.node?.split('@')[1]?.split('.')[0] || s.node,
    src: s.src_queue || s.src_exchange || '', dest: s.dest_queue || s.dest_exchange || '',
    dest_uri: String(s.dest_uri || '').replace(/\/\/[^@/]*@/, '//***@'),   // never leak credentials
    reason: s.reason ? String(s.reason).slice(0, 300) : (s.blocked_status && s.blocked_status !== 'running' ? s.blocked_status : null),
    last_changed: s.timestamp || null,
  }));
}

// One queue name across every cluster — shows where messages pile up on the way edge → hub.
async function queueAcross(name) {
  return Promise.all((config.clusters || []).map(async (c) => {
    try {
      // The management API's name= filter only applies together with pagination, so match the exact name here.
      const qs = (await rmq(c, 'GET', '/queues?columns=name,vhost,type,messages,consumers,message_stats', 15000)).filter((x) => x.name === name);
      let shovel = null;
      try {
        const sh = await rmq(c, 'GET', '/shovels');
        const s = sh.find((x) => x.src_queue === name);
        if (s) shovel = s.state;
      } catch { /* no shovel plugin */ }
      const q = qs[0];
      return { id: c.id, name: c.name, forwards_to: c.forwards_to || null, found: !!q, vhost: q?.vhost, type: q?.type,
        messages: q?.messages || 0, consumers: q?.consumers || 0,
        publish: q?.message_stats?.publish_details?.rate || 0, deliver: q?.message_stats?.deliver_get_details?.rate || 0, shovel };
    } catch (e) { return { id: c.id, name: c.name, error: e.message }; }
  }));
}

// Peek: get N messages and put them straight back (ack_requeue_true). Side effects: the messages are marked
// redelivered, order may change, and on quorum queues the delivery count goes up (delivery-limit!).
async function peek(c, vhost, queue, count) {
  const r = await fetch(c.api.replace(/\/$/, '') + `/queues/${enc(vhost)}/${enc(queue)}/get`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${RMQ_USER}:${RMQ_PASS}`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ count, ackmode: 'ack_requeue_true', encoding: 'auto', truncate: 65536 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).map((m) => ({
    payload: m.payload, encoding: m.payload_encoding, bytes: m.payload_bytes, redelivered: m.redelivered,
    exchange: m.exchange, routing_key: m.routing_key, properties: m.properties || {},
  }));
}

async function audit(text) {
  log('AUDIT ' + text);
  if (!AUDIT_WEBHOOK) return;
  try {
    await fetch(AUDIT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text, allowed_mentions: { parse: [] } }) });
  } catch (e) { log('audit webhook error: ' + e.message); }
}

// ---------------- HTTP ----------------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
// Built frontend (npm run build → dist/). Served only to authenticated users, like the API.
const DIST = path.resolve(process.env.HUB_DIST || path.join(__dirname, 'dist'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(res, pathname) {
  let file = path.resolve(DIST, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(DIST + path.sep) && file !== DIST) return send(res, 404, { error: 'not found' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (pathname.startsWith('/assets/')) return send(res, 404, { error: 'not found' });
    file = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(file)) return send(res, 503, { error: 'frontend not built — run npm run build' });
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  let email;
  try {
    email = DEV_EMAIL || await verifyAccess(req.headers['cf-access-jwt-assertion']);
  } catch (e) { return send(res, 401, { error: 'Not signed in via Cloudflare Access: ' + e.message }); }
  const role = roleOf(email);
  if (!role) return send(res, 403, { error: `${email} has no access — ask an admin to add you to config.json` });

  try {
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { email, role, can_peek: canPeek(role), peek_max: PEEK_MAX(), title: config.title || 'RabbitMQ Hub' });
    if (req.method === 'GET' && url.pathname === '/api/clusters')
      return send(res, 200, await Promise.all((config.clusters || []).map(clusterSummary)));
    let m = url.pathname.match(/^\/api\/clusters\/([\w-]+)\/queues$/);
    if (req.method === 'GET' && m) {
      const c = clusterById(m[1]); if (!c) return send(res, 404, { error: 'unknown cluster' });
      return send(res, 200, await clusterQueues(c));
    }
    m = url.pathname.match(/^\/api\/clusters\/([\w-]+)\/shovels$/);
    if (req.method === 'GET' && m) {
      const c = clusterById(m[1]); if (!c) return send(res, 404, { error: 'unknown cluster' });
      return send(res, 200, await clusterShovels(c));
    }
    if (req.method === 'GET' && url.pathname === '/api/queue-across') {
      const name = url.searchParams.get('name') || '';
      if (!name || name.length > 255) return send(res, 400, { error: 'name required' });
      return send(res, 200, await queueAcross(name));
    }
    m = url.pathname.match(/^\/api\/clusters\/([\w-]+)\/peek$/);
    if (req.method === 'POST' && m) {
      if (!String(req.headers['content-type'] || '').startsWith('application/json') ||
          (req.headers.origin && config.public_origin && req.headers.origin !== config.public_origin))
        return send(res, 400, { error: 'invalid request' });
      if (!canPeek(role)) return send(res, 403, { error: 'reading message bodies needs admin or peeker access' });
      const c = clusterById(m[1]); if (!c) return send(res, 404, { error: 'unknown cluster' });
      if (c.allow_peek === false) return send(res, 403, { error: `peek is disabled for ${c.name} (allow_peek=false)` });
      const b = await readBody(req);
      if (!b.vhost || !b.queue) return send(res, 400, { error: 'vhost and queue required' });
      const count = Math.min(PEEK_MAX(), Math.max(1, Number(b.count) || 5));
      const msgs = await peek(c, b.vhost, b.queue, count);
      await audit(`🔎 **RabbitMQ Hub — peek** ${msgs.length} message(s) from \`${b.queue}\` (vhost \`${b.vhost}\`) on **${c.name}** (requeued)\n**By:** ${email}\n**At:** ${new Date().toLocaleString('en-GB', { timeZone: TZ })} (${TZ})`);
      return send(res, 200, msgs);
    }
    m = url.pathname.match(/^\/api\/clusters\/([\w-]+)\/purge$/);
    if (req.method === 'POST' && m) {
      // CSRF guard: JSON only, and same origin when the browser sends one
      if (!String(req.headers['content-type'] || '').startsWith('application/json') ||
          (req.headers.origin && config.public_origin && req.headers.origin !== config.public_origin))
        return send(res, 400, { error: 'invalid request' });
      if (role !== 'admin') return send(res, 403, { error: 'only admins can purge' });
      const c = clusterById(m[1]); if (!c) return send(res, 404, { error: 'unknown cluster' });
      if (!c.allow_purge) return send(res, 403, { error: `purge is disabled for ${c.name} (allow_purge=false)` });
      const b = await readBody(req);
      if (!b.vhost || !b.queue || b.confirm !== b.queue) return send(res, 400, { error: 'type the exact queue name to confirm' });
      const before = await rmq(c, 'GET', `/queues/${enc(b.vhost)}/${enc(b.queue)}?columns=messages`);
      await rmq(c, 'DELETE', `/queues/${enc(b.vhost)}/${enc(b.queue)}/contents`);
      await audit(`🟠 **RabbitMQ Hub — purge** queue \`${b.queue}\` (vhost \`${b.vhost}\`) on **${c.name}** — ~${before?.messages ?? '?'} messages removed\n**By:** ${email}\n**At:** ${new Date().toLocaleString('en-GB', { timeZone: TZ })} (${TZ})`);
      return send(res, 200, { ok: true, purged: before?.messages ?? null });
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log(`error ${req.method} ${url.pathname}: ${e.message}`);
    return send(res, 502, { error: e.message });
  }
}).listen(PORT, BIND, () => log(`RabbitMQ Hub listening on ${BIND}:${PORT}, ${config.clusters.length} cluster(s)`));
