let token = localStorage.getItem('nelmora_token') || '';

export function setToken(t) {
  token = t || '';
  if (t) localStorage.setItem('nelmora_token', t);
  else localStorage.removeItem('nelmora_token');
}
export const hasToken = () => !!token;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('nelmora-unauth'));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function downloadBackup() {
  const res = await fetch('/api/backup', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!res.ok) throw new Error('Backup failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nelmora-backup-${new Date().toLocaleDateString('en-CA')}.db`;
  a.click();
  URL.revokeObjectURL(a.href);
}
