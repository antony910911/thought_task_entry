// 配色組合。每組都有淺色、深色兩套；accent 是按鈕與連結色，todo / note / event 是三個功能的代表色，bg 是底色。

export const THEMES = [
  {
    id: 'classic',
    name: '經典',
    desc: 'iOS 原生配色',
    light: { accent: '#007AFF', todo: '#34C759', note: '#FF9500', event: '#FF3B30', bg: '#F2F2F7' },
    dark: { accent: '#0A84FF', todo: '#30D158', note: '#FF9F0A', event: '#FF453A', bg: '#000000' },
  },
  {
    id: 'morandi',
    name: '莫蘭迪',
    desc: '低飽和、霧面質感',
    light: { accent: '#6F8496', todo: '#869E84', note: '#C29B74', event: '#B57676', bg: '#F3F0EB' },
    dark: { accent: '#9DB0C0', todo: '#A5BCA3', note: '#D6B48F', event: '#CC9393', bg: '#141312' },
  },
  {
    id: 'ocean',
    name: '海洋',
    desc: '清透藍綠',
    light: { accent: '#0071BC', todo: '#00A3A3', note: '#3D85C6', event: '#5E5CE6', bg: '#EEF4F8' },
    dark: { accent: '#4DB2FF', todo: '#2CD0D0', note: '#6BB0F0', event: '#7D7AFF', bg: '#03080D' },
  },
  {
    id: 'forest',
    name: '森林',
    desc: '沉穩綠意與木質',
    light: { accent: '#2D6A4F', todo: '#40916C', note: '#B08968', event: '#BC4749', bg: '#F1F4EF' },
    dark: { accent: '#5DBB8A', todo: '#6FCF97', note: '#D4A373', event: '#E5676A', bg: '#090D0A' },
  },
  {
    id: 'sunset',
    name: '日落',
    desc: '溫暖橘紅',
    light: { accent: '#E8590C', todo: '#2A9D8F', note: '#E09F3E', event: '#E63946', bg: '#FBF3EE' },
    dark: { accent: '#FF8A3D', todo: '#3CC2B1', note: '#F4B860', event: '#FF5C69', bg: '#110A06' },
  },
  {
    id: 'lavender',
    name: '薰衣草',
    desc: '柔和紫粉',
    light: { accent: '#7B61C9', todo: '#4E9F98', note: '#B67BBE', event: '#DB6E86', bg: '#F4F2FA' },
    dark: { accent: '#A78BFA', todo: '#6CC6C0', note: '#D69DDE', event: '#F59AAD', bg: '#0C0A12' },
  },
  {
    id: 'sakura',
    name: '櫻花',
    desc: '淡雅粉嫩',
    light: { accent: '#D14D72', todo: '#6FAF7A', note: '#E3955E', event: '#B85CA8', bg: '#FBF1F4' },
    dark: { accent: '#FF7FA6', todo: '#8FD19A', note: '#F5B386', event: '#E08AD2', bg: '#120A0D' },
  },
  {
    id: 'graphite',
    name: '石墨',
    desc: '黑白極簡',
    light: { accent: '#1C1C1E', todo: '#48484A', note: '#6E6E73', event: '#8E8E93', bg: '#F2F2F7' },
    dark: { accent: '#E5E5EA', todo: '#636366', note: '#7C7C80', event: '#98989D', bg: '#000000' },
  },
];

export const MODES = [
  { id: 'auto', name: '自動' },
  { id: 'light', name: '淺色' },
  { id: 'dark', name: '深色' },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

function channel(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 色塊上的文字／圖示顏色：iOS 習慣用白色，只有很淺的底色才改用黑色 */
export function onColor(hex) {
  return contrast(hex, '#FFFFFF') >= 1.8 ? '#FFFFFF' : '#000000';
}

/** 轉成 CSS 變數：--accent-l / --accent-d / --on-accent-l … */
export function themeVars(theme) {
  const vars = {};
  for (const [suffix, set] of [['l', theme.light], ['d', theme.dark]]) {
    for (const key of ['accent', 'todo', 'note', 'event']) {
      vars[`--${key}-${suffix}`] = set[key];
      vars[`--on-${key}-${suffix}`] = onColor(set[key]);
    }
    vars[`--bg-${suffix}`] = set.bg;
  }
  return vars;
}

export function effectiveMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 套用到頁面，並快取一份讓 index.html 在載入前就先上色（避免閃白） */
export function applyTheme(appearance) {
  const theme = themeById(appearance.theme);
  const mode = appearance.mode || 'auto';
  const vars = themeVars(theme);
  const root = document.documentElement;
  root.dataset.mode = mode;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  try {
    localStorage.setItem('tte.theme', JSON.stringify({ mode, vars }));
  } catch {}
  document.querySelectorAll('meta[name=theme-color]').forEach((meta) => {
    const scheme = mode === 'auto' ? (meta.media.includes('dark') ? 'dark' : 'light') : mode;
    meta.content = theme[scheme].bg;
  });
}
