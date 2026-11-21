// Font choices for Settings → Appearance. All are free Google Fonts.
export const FONTS = [
  { name: 'Inter', note: 'The most common choice for business software. Neutral and very readable.' },
  { name: 'Plus Jakarta Sans', note: 'Modern and friendly, with rounder letters.' },
  { name: 'Manrope', note: 'Geometric and stylish. Suits a fragrance brand.' },
  { name: 'DM Sans', note: 'Soft and clean, with a slightly boutique feel.' },
  { name: 'Figtree', note: 'Light and approachable, easy on the eyes.' },
  { name: 'Outfit', note: 'Rounded and contemporary. Strong, bold headings.' },
  { name: 'Poppins', note: 'Round and confident. Widely used by Malaysian brands.' },
  { name: 'Montserrat', note: 'Wide and elegant. A classic premium-brand look.' },
  { name: 'IBM Plex Sans', note: 'Corporate and precise, like a bank or enterprise system.' },
];
export const DEFAULT_FONT = 'Inter';
const KEY = 'nelmora_font_v2'; // bumped when the default changes, so old picks reset

const loaded = new Set();
export function loadFont(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

export function getFont() {
  try {
    const saved = localStorage.getItem(KEY);
    if (FONTS.some((f) => f.name === saved)) return saved;
  } catch { /* storage blocked */ }
  return DEFAULT_FONT;
}

export function applyFont(name) {
  loadFont(name);
  document.documentElement.style.setProperty('--font', `'${name}'`);
  try { localStorage.setItem(KEY, name); } catch { /* storage blocked */ }
}
