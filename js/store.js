// 所有資料都存在手機本機（localStorage），不會上傳到任何地方，除非你按下同步。

const KEY = 'tte.data.v1';

const DEFAULTS = {
  todos: [],
  notes: [],
  events: [],
  tagLibrary: [],
  // 外星人養成（規則見 pet.js）
  pet: {
    xp: 0,
    energy: 70,
    energyAt: '',
    streak: 0,
    best: 0,
    lastDay: null,
    days: [],
    stats: { todosDone: 0, todosAdded: 0, notes: 0, events: 0 },
    unlocked: [],
    equipped: null,
  },
  settings: {
    todo: { webhookUrl: '', token: '' },
    microsoft: { clientId: '', tenant: 'organizations' },
    onenote: { sectionId: '', sectionName: '' },
    folio: { url: '', token: '' },
    calendar: { mode: 'shortcut', shortcutName: '加入行程', defaultDuration: 60 },
    appearance: { theme: 'classic', mode: 'auto', alien: 'blip' },
    reminders: { enabled: false, shortcutName: '加入提醒', time: '09:00' },
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
