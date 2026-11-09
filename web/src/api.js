// Thin client for the hub API. In mock mode (VITE_MOCK=1) the same calls are answered by ./mock.js.
let mock = null;
if (import.meta.env.VITE_MOCK) mock = await import('./mock.js');

async function request(path, opts = {}) {
  if (mock) return mock.handle(path, opts);
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export const api = {
  me: () => request('/api/me'),
  clusters: () => request('/api/clusters'),
  queues: (id) => request(`/api/clusters/${encodeURIComponent(id)}/queues`),
  shovels: (id) => request(`/api/clusters/${encodeURIComponent(id)}/shovels`),
  across: (name) => request(`/api/queue-across?name=${encodeURIComponent(name)}`),
  peek: (id, body) => request(`/api/clusters/${encodeURIComponent(id)}/peek`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  purge: (id, body) => request(`/api/clusters/${encodeURIComponent(id)}/purge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
};
export const isMock = !!mock;
