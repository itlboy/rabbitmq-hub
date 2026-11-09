// Example data for `npm run dev:mock` / `npm run build:mock` — no real cluster involved.
const MB = 1048576, GB = 1073741824;
const node = (name, used, limit, free, o = {}) => ({ name, running: true, mem_used: used * MB, mem_limit: limit * MB, mem_alarm: false, disk_free: free * GB, disk_alarm: false, partitions: [], ...o });
const clusters = [
  { id: 'main', name: 'Main', role: 'central broker · workers read here', version: '4.3.6', ok: true, problems: [], allow_purge: true,
    messages: { messages: 20418 }, rates: { publish: 55.2, deliver: 88.4 }, totals: { queues: 41, connections: 386 }, shovels: null, nodes: [node('broker-1', 612, 900, 18.2)] },
  { id: 'edge-us', forwards_to: 'main', name: 'Edge US', role: '3 nodes · shovels to Main', version: '4.3.6', ok: true, problems: [], allow_purge: true,
    messages: { messages: 3 }, rates: { publish: 21.7, deliver: 21.6 }, totals: { queues: 18, connections: 64 }, shovels: { total: 18, running: 18, bad: [] },
    nodes: [node('rabbitmq-0', 214, 2457, 512), node('rabbitmq-1', 198, 2457, 1580), node('rabbitmq-2', 203, 2457, 188)] },
  { id: 'edge-eu', forwards_to: 'main', name: 'Edge EU', role: '3 nodes · shovels to Main', version: '4.3.6', ok: false, allow_purge: true,
    problems: ['rabbitmq-2 not running', 'only 2/3 nodes running', '1 shovel(s) not running'],
    messages: { messages: 1240 }, rates: { publish: 6.3, deliver: 2.1 }, totals: { queues: 12, connections: 22 }, shovels: { total: 12, running: 11, bad: ['to-main--order-events=starting'] },
    nodes: [node('rabbitmq-0', 188, 2457, 157), node('rabbitmq-1', 176, 2457, 71), node('rabbitmq-2', 0, 2457, 0, { running: false })] },
  { id: 'legacy', name: 'Legacy', role: 'being retired · read-only', version: '3.13.7', ok: true, problems: [], allow_purge: false,
    messages: { messages: 19300 }, rates: { publish: 19.2, deliver: 13.0 }, totals: { queues: 72, connections: 389 }, shovels: null, nodes: [node('legacy-01', 410, 820, 3.4)] },
];
const q = (name, messages, consumers, publish, deliver, o = {}) => ({ name, vhost: '/', type: 'classic', state: 'running', messages, ready: messages, unacked: 0, consumers, publish, deliver, minor: /\.delay\./.test(name), ...o });
const Q = {
  main: [q('clear-cache', 19250, 12, 19.2, 13.0), q('logs', 18, 6, 5.8, 4.8), q('check-copyright', 148, 2, 2.6, 0.2), q('notify-chat', 0, 4, 2.6, 2.6), q('bulk-campaign', 7, 5, 2.4, 3.8),
    q('order-events', 1, 3, 0.6, 0.6), q('order', 0, 8, 0.2, 0.2, { unacked: 2 }), q('sync-product', 1, 4, 0.2, 0.2), q('crawl-tracking', 16, 3, 0, 4.0),
    q('low-priority.delay.30000', 63, 0, 2.6, 0), q('crawl-tracking.delay.360000', 373, 0, 2.0, 0), q('system-email', 0, 2, 0.1, 0.1), q('render-mockup', 0, 10, 0.3, 0.3), q('import-campaign', 0, 2, 0, 0)],
  'edge-us': [q('clear-cache', 0, 0, 12.1, 12.1, { type: 'quorum' }), q('logs', 2, 0, 3.9, 3.9, { type: 'quorum' }), q('order-events', 0, 0, 0.4, 0.4, { type: 'quorum' }),
    q('order', 1, 0, 0.2, 0.2, { type: 'quorum' }), q('low-priority.delay.30000', 41, 0, 1.7, 0, { type: 'quorum' })],
  'edge-eu': [q('clear-cache', 0, 0, 3.1, 3.1, { type: 'quorum' }), q('order-events', 1240, 0, 2.0, 0, { type: 'quorum' }), q('logs', 0, 0, 1.2, 1.2, { type: 'quorum' })],
  legacy: [q('clear-cache', 19250, 0, 19.2, 13.0), q('logs', 18, 0, 5.8, 4.8), q('check-copyright', 148, 0, 2.6, 0.2), q('order', 0, 0, 0.2, 0.2)],
};
const clone = (x) => JSON.parse(JSON.stringify(x));

export async function handle(path, opts = {}) {
  await new Promise((r) => setTimeout(r, 120));
  if (path === '/api/me') return { email: 'alice@example.com', role: 'admin', title: 'RabbitMQ Hub' };
  if (path === '/api/clusters') return clone(clusters);
  let m = path.match(/\/api\/clusters\/([^/]+)\/queues/);
  if (m) return clone(Q[decodeURIComponent(m[1])] || []);
  m = path.match(/\/api\/clusters\/([^/]+)\/purge/);
  if (m) {
    const id = decodeURIComponent(m[1]); const b = JSON.parse(opts.body);
    const item = (Q[id] || []).find((x) => x.name === b.queue); const n = item ? item.messages : 0;
    if (item) { item.messages = 0; item.ready = 0; }
    const c = clusters.find((x) => x.id === id); c.messages.messages = Math.max(0, c.messages.messages - n);
    return { ok: true, purged: n };
  }
  throw new Error('not found');
}
