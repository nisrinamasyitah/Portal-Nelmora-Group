export const rm = (n) =>
  (n < 0 ? '-' : '') +
  'RM ' + Math.abs(Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rm0 = (n) =>
  (n < 0 ? '-' : '') + 'RM ' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-MY');

export const today = () => new Date().toLocaleDateString('en-CA');

export const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const monthLabel = (m) =>
  new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

export const monthShort = (m) =>
  new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

export const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

// Chart palette: ink = primary series (burgundy), grey = secondary (rose), silver = tertiary (champagne)
export const COLORS = { ink: '#6b1a2e', grey: '#b9707f', silver: '#d9bf94', line: '#ece3df', pos: '#2f6b4f', neg: '#a8243b' };

export function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
