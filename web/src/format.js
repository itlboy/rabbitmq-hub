export const fmt = (n) => (n ?? 0).toLocaleString('en-US');
export const rate = (n) => { n = n || 0; return n === 0 ? '0' : n >= 10 ? String(Math.round(n)) : n.toFixed(1); };
export const bytes = (b) => {
  if (!b) return '—';
  const u = ['B', 'K', 'M', 'G', 'T']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (b >= 100 || i < 2 ? Math.round(b) : b.toFixed(1)) + u[i];
};
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
