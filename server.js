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
  // People sign in with Google → email. Machines (AI agents, monitors) use an Access service token → common_name.
  if (payload.email) return String(payload.email).toLowerCase();
  if (payload.common_name) return 'service:' + String(payload.common_name);
  throw new Error('JWT has no email or service token');
}
function matchEmail(email, patterns) {
  return (patterns || []).some((p) => {
    p = String(p).toLowerCase();
    return p.startsWith('*@') ? email.endsWith(p.slice(1)) : email === p;
  });
}
function roleOf(email) {
  if (email.startsWith('service:')) {
    const r = (config.service_tokens || {})[email.slice(8)];
    return ['admin', 'peeker', 'viewer'].includes(r) ? r : null;
  }
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
      // No CPU % in the management API: cores + Erlang run queue (processes waiting for a scheduler) is the load signal.
      processors: n.processors ?? null, run_queue: n.run_queue ?? null,
      fd_used: n.fd_used ?? null, fd_total: n.fd_total ?? null, sockets_used: n.sockets_used ?? null, sockets_total: n.sockets_total ?? null,
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

// Short cache so dashboards, health checks and AI agents polling together don't hammer the brokers.
const CACHE_MS = 5000;
let summaryCache = { at: 0, data: null, pending: null };
async function allSummaries() {
  if (summaryCache.data && Date.now() - summaryCache.at < CACHE_MS) return summaryCache.data;
  if (!summaryCache.pending) {
    summaryCache.pending = Promise.all((config.clusters || []).map(clusterSummary))
      .then((d) => { summaryCache = { at: Date.now(), data: d, pending: null }; return d; })
      .catch((e) => { summaryCache.pending = null; throw e; });
  }
  return summaryCache.pending;
}

// Whole-system verdict: down = a hub (cluster others forward to) or every cluster is unreachable/broken; degraded = any problem.
async function systemHealth() {
  const cl = await allSummaries();
  const hubs = new Set(cl.map((c) => c.forwards_to).filter(Boolean));
  const broken = cl.filter((c) => !c.ok);
  const unreachable = cl.filter((c) => c.problems.some((p) => p.startsWith('management API unreachable')));
  const hubDown = cl.some((c) => hubs.has(c.id) && !c.ok);
  const status = !broken.length ? 'ok' : (hubDown || unreachable.length === cl.length) ? 'down' : 'degraded';
  return {
    status, checked_at: new Date().toISOString(),
    summary: `${cl.length - broken.length}/${cl.length} clusters healthy`,
    clusters: cl.map((c) => ({
      id: c.id, name: c.name, ok: c.ok, problems: c.problems, version: c.version || null,
      role: hubs.has(c.id) ? 'hub' : c.forwards_to ? `edge → ${c.forwards_to}` : 'standalone',
      messages: c.messages?.messages ?? 0, publish_rate: c.rates?.publish ?? 0, deliver_rate: c.rates?.deliver ?? 0,
      connections: c.totals?.connections ?? 0, queues: c.totals?.queues ?? 0,
      nodes: (c.nodes || []).map((n) => ({ name: n.name, running: n.running, mem_used: n.mem_used, mem_limit: n.mem_limit, mem_alarm: n.mem_alarm,
        disk_free: n.disk_free, disk_free_limit: n.disk_free_limit, disk_alarm: n.disk_alarm, processors: n.processors, run_queue: n.run_queue })),
      shovels: c.shovels,
    })),
  };
}

async function peekLogged(c, vhost, queue, count, who) {
  const n = Math.min(PEEK_MAX(), Math.max(1, Number(count) || 5));
  const msgs = await peek(c, vhost, queue, n);
  await audit(`🔎 **RabbitMQ Hub — peek** ${msgs.length} message(s) from \`${queue}\` (vhost \`${vhost}\`) on **${c.name}** (requeued)\n**By:** ${who}\n**At:** ${new Date().toLocaleString('en-GB', { timeZone: TZ })} (${TZ})`);
  return msgs;
}

async function audit(text) {
  log('AUDIT ' + text);
  if (!AUDIT_WEBHOOK) return;
  try {
    await fetch(AUDIT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text, allowed_mentions: { parse: [] } }) });
  } catch (e) { log('audit webhook error: ' + e.message); }
}

// ---------------- API index + MCP (for AI agents) ----------------
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { return 'dev'; } })();
const API_INDEX = {
  name: 'rabbitmq-hub', version: VERSION,
  auth: 'Cloudflare Access: a signed-in user, or a service token (CF-Access-Client-Id / CF-Access-Client-Secret headers) mapped in config.service_tokens',
  endpoints: [
    { method: 'GET', path: '/api/health', desc: 'Whole-system status: ok | degraded | down. HTTP 200 when ok, 503 otherwise.' },
    { method: 'GET', path: '/api/clusters', desc: 'Every cluster: nodes, alarms, messages, rates, shovels, 10-min history' },
    { method: 'GET', path: '/api/clusters/:id/queues', desc: 'Queues of one cluster with depth, consumers, rates, history' },
    { method: 'GET', path: '/api/clusters/:id/shovels', desc: 'Shovels with state, node, source/destination, last error' },
    { method: 'GET', path: '/api/queue-across?name=', desc: 'One queue name on every cluster (edge → hub path)' },
    { method: 'POST', path: '/api/clusters/:id/peek', desc: 'Read up to peek_max messages (requeued, logged). admin/peeker' },
    { method: 'POST', path: '/api/clusters/:id/purge', desc: 'Empty a queue. admin only, browser UI flow (typed confirmation)' },
    { method: 'POST', path: '/mcp', desc: 'MCP server (Streamable HTTP, JSON responses). Read-only tools; no purge.' },
  ],
};

const MCP_TOOLS = [
  { name: 'system_health', title: 'System health',
    description: 'Overall RabbitMQ status across all clusters (ok | degraded | down) with the problems of each cluster. Start here.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_clusters', title: 'List clusters',
    description: 'All clusters with nodes (RAM, disk, alarms), queued messages, publish/deliver rates, connections, shovel counts and a 10-minute message history.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_queues', title: 'List queues',
    description: 'Queues of one cluster, sorted by depth. Use filter to match part of a name.',
    inputSchema: { type: 'object', required: ['cluster'], properties: {
      cluster: { type: 'string', description: 'cluster id from list_clusters' },
      filter: { type: 'string', description: 'substring of the queue name' },
      only_with_messages: { type: 'boolean' },
      include_minor: { type: 'boolean', description: 'include queues matching hide_queue_pattern (e.g. delay queues)' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } } } },
  { name: 'queue_across', title: 'Queue across clusters',
    description: 'One queue name on every cluster: depth, consumers, rates and shovel state — shows where messages pile up between edges and the hub.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  { name: 'list_shovels', title: 'List shovels',
    description: 'Shovels of one cluster with state, node, source/destination (credentials masked) and last error.',
    inputSchema: { type: 'object', required: ['cluster'], properties: { cluster: { type: 'string' } } } },
  { name: 'read_messages', title: 'Read messages',
    description: 'Read the first N messages of a queue and put them straight back (marked redelivered; on quorum queues counts as a delivery attempt). Logged. Needs admin/peeker and allow_peek on the cluster.',
    inputSchema: { type: 'object', required: ['cluster', 'queue'], properties: {
      cluster: { type: 'string' }, queue: { type: 'string' }, vhost: { type: 'string', description: 'defaults to the queue\'s vhost' },
      count: { type: 'integer', minimum: 1, maximum: 50, default: 3 } } } },
];

async function mcpTool(name, args, who, role) {
  const need = (id) => { const c = clusterById(id); if (!c) throw new Error(`unknown cluster "${id}" — call list_clusters`); return c; };
  switch (name) {
    case 'system_health': return systemHealth();
    case 'list_clusters': return allSummaries();
    case 'list_queues': {
      const c = need(args.cluster);
      const f = String(args.filter || '').toLowerCase();
      let qs = await clusterQueues(c);
      qs = qs.filter((q) => (!f || q.name.toLowerCase().includes(f)) && (args.include_minor || !q.minor) && (!args.only_with_messages || q.messages > 0));
      qs.sort((a, b) => b.messages - a.messages);
      const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
      return { cluster: c.id, total: qs.length, queues: qs.slice(0, limit) };
    }
    case 'queue_across': if (!args.name) throw new Error('name required'); return queueAcross(String(args.name));
    case 'list_shovels': return clusterShovels(need(args.cluster));
    case 'read_messages': {
      if (!canPeek(role)) throw new Error('reading message bodies needs admin or peeker access');
      const c = need(args.cluster);
      if (c.allow_peek === false) throw new Error(`reading messages is disabled for ${c.name}`);
      let vhost = args.vhost;
      if (!vhost) { const q = (await clusterQueues(c)).find((x) => x.name === args.queue); if (!q) throw new Error('queue not found'); vhost = q.vhost; }
      return peekLogged(c, vhost, String(args.queue), args.count || 3, `${who} (via MCP)`);
    }
    default: throw new Error(`unknown tool "${name}"`);
  }
}

async function handleMcp(req, res, who, role) {
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  const one = async (m) => {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'invalid request' } };
    if (m.id === undefined || m.id === null) return null;   // notification (e.g. notifications/initialized)
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    switch (m.method) {
      case 'initialize': return ok({
        protocolVersion: m.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rabbitmq-hub', title: config.title || 'RabbitMQ Hub', version: VERSION },
        instructions: 'Read-only view of several RabbitMQ clusters. Start with system_health; drill down with list_queues / queue_across / list_shovels. read_messages requeues messages and is logged. Purging is not available over MCP.',
      });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: MCP_TOOLS.map((t) => ({ ...t, annotations: { readOnlyHint: t.name !== 'read_messages', openWorldHint: false } })) });
      case 'tools/call': {
        try {
          const data = await mcpTool(m.params?.name, m.params?.arguments || {}, who, role);
          return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], structuredContent: Array.isArray(data) ? { items: data } : data });
        } catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }); }
      }
      default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
    }
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(one))).filter(Boolean);
    return out.length ? send(res, 200, out) : (res.writeHead(202), res.end());
  }
  const r = await one(body);
  if (!r) { res.writeHead(202); return res.end(); }
  return send(res, 200, r);
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
    if (req.method === 'GET' && (url.pathname === '/api' || url.pathname === '/api/')) return send(res, 200, API_INDEX);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const h = await systemHealth();
      return send(res, h.status === 'ok' ? 200 : 503, h);
    }
    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') return send(res, 405, { error: 'MCP endpoint accepts POST (JSON-RPC 2.0)' });
      return handleMcp(req, res, email, role);
    }
    if (req.method === 'GET' && url.pathname === '/api/clusters')
      return send(res, 200, await allSummaries());
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
      return send(res, 200, await peekLogged(c, b.vhost, b.queue, b.count, email));
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
