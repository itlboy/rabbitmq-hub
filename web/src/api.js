// Thin client for the hub API. In mock mode (VITE_MOCK=1) the same calls are answered by ./mock.js.
let mock = null;
if (import.meta.env.VITE_MOCK) mock = await import('./mock.js');

async function request(path, opts = {}) {
  if (mock) return mock.handle(path, opts);
  const r = await fetch(path, { ...opts, redirect: 'manual' });
  // Cloudflare Access session expired: requests come back 401 / invalid_token, or as an opaque redirect to the
  // login page. Reload once so Access signs the user in again (guarded so a real outage cannot loop).
  if (r.type === 'opaqueredirect' || r.status === 401) {
    const last = Number(sessionStorage.getItem('hub.relogin') || 0);
    if (Date.now() - last > 60_000) { sessionStorage.setItem('hub.relogin', String(Date.now())); location.reload(); }
    throw new Error('session expired — reloading');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export const api = {
  me: () => request('/api/me'),
  clusters: (range = '1h') => request(`/api/clusters?range=${range}`),
  queues: (id, range = '1h') => request(`/api/clusters/${encodeURIComponent(id)}/queues?range=${range}`),
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
