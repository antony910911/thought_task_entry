// 所有資料都存在手機本機（localStorage），不會上傳到任何地方，除非你按下同步。

const KEY = 'tte.data.v1';

const DEFAULTS = {
  todos: [],
  notes: [],
  events: [],
  settings: {
    todo: { webhookUrl: '', token: '' },
    microsoft: { clientId: '', tenant: 'organizations' },
    onenote: { sectionId: '', sectionName: '' },
    calendar: { mode: 'shortcut', shortcutName: '加入行程', defaultDuration: 60 },
  },
};

function merge(base, value) {
  if (Array.isArray(base)) return Array.isArray(value) ? value : base;
  if (base && typeof base === 'object') {
    const out = {};
    for (const k of Object.keys(base)) out[k] = merge(base[k], value ? value[k] : undefined);
    return out;
  }
  return value === undefined ? base : value;
}

let state = load();

function load() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return merge(DEFAULTS, {});
  }
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function db() {
  return state;
}

export function replaceAll(data) {
  state = merge(DEFAULTS, data);
  save();
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
