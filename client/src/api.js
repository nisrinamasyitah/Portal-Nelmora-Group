let token = localStorage.getItem('nelmora_token') || '';

// Short-term memory of loaded data, so pages you've already opened show instantly while they refresh.
// Cleared on any change (POST/PUT/DELETE) and on sign-out, so it never shows stale or another person's data.
export const dataCache = new Map();

export function setToken(t) {
  if (!t) dataCache.clear();
  token = t || '';
  if (t) localStorage.setItem('nelmora_token', t);
  else localStorage.removeItem('nelmora_token');
}
export const hasToken = () => !!token;

// The server sends a fresh login token with every reply while the portal is in use.
const keepToken = (res) => { const t = res.headers.get('x-new-token'); if (t && token) setToken(t); };

export async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET') dataCache.clear();
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  keepToken(res);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('nelmora-unauth'));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Replace ALL data with a backup file (.db from "Download backup").
export async function restoreBackup(file) {
  dataCache.clear();
  const res = await fetch('/api/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: file,
  });
  keepToken(res);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event('nelmora-unauth'));
  if (!res.ok) throw new Error(data.error || 'Restore failed');
  return data;
}

export async function downloadBackup() {
  const res = await fetch('/api/backup', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  keepToken(res);
  if (res.status === 401) window.dispatchEvent(new Event('nelmora-unauth'));
  if (!res.ok) throw new Error('Backup failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nelmora-backup-${new Date().toLocaleDateString('en-CA')}.db`;
  a.click();
  URL.revokeObjectURL(a.href);
}
