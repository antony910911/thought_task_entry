// 跨裝置同步：手機、電腦上的 Beamup 共用同一份待辦、筆記、行程、標籤、外星人和設定。
//
// 資料放在 Folio 的同步伺服器（你已經設定好的那個），紀錄的 key 都以「bu:」開頭，
// Folio App 看到不認得的 key 會直接略過，所以不會影響 Folio。
//
// 做法：每台裝置記得「上次同步時每筆資料長什麼樣子」（shadow）。
// - 拿變更（pull）：別台改過、這台沒動過的 → 套用；兩邊都改過 → 留這台的，等一下送出去蓋掉。
// - 送變更（push）：跟 shadow 不一樣的就送，shadow 有、現在沒有的就送「已刪除」。
// - 第一次同步、兩邊都有同一筆時：外星人取經驗值高的、標籤取聯集，其他用雲端的；雲端已刪掉的跟著刪。

import { baseUrl, isConfigured } from './folio.js';

const STATE_KEY = 'tte.cloud.v1';
export const PREFIX = 'bu:';
const COLLECTIONS = { todo: 'todos', note: 'notes', event: 'events' };

// ---------- 純邏輯（可測試） ----------

/** 目前資料切成一筆一筆的紀錄：key → JSON 字串 */
export function snapshot(data) {
  const out = new Map();
  for (const [kind, field] of Object.entries(COLLECTIONS))
    for (const item of data[field] || []) if (item && item.id) out.set(`${PREFIX}${kind}:${item.id}`, JSON.stringify(item));
  out.set(`${PREFIX}tags`, JSON.stringify(data.tagLibrary || []));
  out.set(`${PREFIX}pet`, JSON.stringify(data.pet || {}));
  out.set(`${PREFIX}settings`, JSON.stringify(data.settings || {}));
  return out;
}

/** 把一筆紀錄寫進資料（value 為 undefined 代表刪除） */
export function applyRecord(data, key, value) {
  const rest = key.slice(PREFIX.length);
  const i = rest.indexOf(':');
  const kind = i < 0 ? rest : rest.slice(0, i);
  const field = COLLECTIONS[kind];
  if (field) {
    const id = rest.slice(i + 1);
    const list = data[field] || (data[field] = []);
    const at = list.findIndex((x) => x && x.id === id);
    if (value === undefined) {
      if (at >= 0) list.splice(at, 1);
    } else if (at >= 0) list[at] = value;
    else list.push(value);
    return;
  }
  if (value === undefined) return; // 單一紀錄不會被刪除
  if (kind === 'tags') data.tagLibrary = Array.isArray(value) ? value : [];
  else if (kind === 'pet') data.pet = { ...data.pet, ...value };
  else if (kind === 'settings') {
    // 逐區合併，新版多出來的設定欄位不會被舊裝置的資料吃掉
    const s = data.settings || (data.settings = {});
    for (const [k, v] of Object.entries(value || {})) s[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...s[k], ...v } : v;
  }
}

/** 第一次同步時，兩邊都有同一筆：決定要用哪個 */
export function resolveFirst(key, local, remote) {
  if (key === `${PREFIX}pet`) return (Number(local && local.xp) || 0) > (Number(remote && remote.xp) || 0) ? local : remote;
  if (key === `${PREFIX}tags`) return [...new Set([...(remote || []), ...(local || [])])];
  return remote;
}

/**
 * 套用一批別台送來的紀錄。
 * shadow：key → { rev, json }（json 為 undefined 代表已刪除）。回傳是否有改到資料。
 */
export function mergeRemote(data, shadow, records) {
  let changed = false;
  const now = snapshot(data);
  for (const r of records) {
    if (!r || typeof r.key !== 'string' || !r.key.startsWith(PREFIX)) continue;
    const sh = shadow[r.key];
    if (sh && sh.rev >= r.rev) continue; // 自己送的，或是舊的
    const remoteJson = r.deleted ? undefined : JSON.stringify(r.data);
    const localJson = now.get(r.key);
    const dirty = sh ? localJson !== sh.json : localJson !== undefined;
    if (!dirty || localJson === remoteJson) {
      if (localJson !== remoteJson) {
        applyRecord(data, r.key, r.deleted ? undefined : r.data);
        changed = true;
      }
      shadow[r.key] = { rev: r.rev, json: remoteJson };
    } else if (!sh) {
      // 第一次遇到這筆，兩邊內容不同。雲端已經刪掉的：這台的是舊資料，跟著刪
      const value = r.deleted ? undefined : resolveFirst(r.key, JSON.parse(localJson), r.data);
      const json = value === undefined ? undefined : JSON.stringify(value);
      if (json !== localJson) {
        applyRecord(data, r.key, value);
        changed = true;
      }
      shadow[r.key] = { rev: r.rev, json: remoteJson };
    } else {
      // 這台在上次同步後也改過：留這台的（shadow 內容不動，送出時會用更新的版本號蓋過去）
      shadow[r.key] = { rev: r.rev, json: sh.json };
    }
  }
  return changed;
}

/** 算出要送出去的紀錄 */
export function outgoing(data, shadow, makeRev) {
  const out = [];
  const now = snapshot(data);
  for (const [key, json] of now) {
    const sh = shadow[key];
    if (!sh || sh.json !== json) out.push({ key, rev: makeRev(), deleted: 0, data: JSON.parse(json), json });
  }
  for (const [key, sh] of Object.entries(shadow)) {
    if (sh.json !== undefined && !now.has(key) && key.slice(PREFIX.length).includes(':'))
      out.push({ key, rev: makeRev(), deleted: 1, data: null, json: undefined });
  }
  return out;
}

/** 版本號（格式跟 Folio 一樣）；看過別台更新的版本號就跟上，手機時間不準也不會被擋 */
export function createClock(device) {
  let last = 0;
  let counter = 0;
  return {
    next(ms = Date.now()) {
      ms = Math.floor(ms);
      if (ms > last) {
        last = ms;
        counter = 0;
      } else counter += 1;
      return `${last.toString(36).padStart(10, '0')}.${counter.toString(36).padStart(4, '0')}.${device}`;
    },
    observe(rev) {
      const [a, b] = String(rev).split('.');
      const ms = parseInt(a, 36);
      const c = parseInt(b, 36) || 0;
      if (ms > last || (ms === last && c > counter)) {
        last = ms;
        counter = c;
      }
    },
  };
}

// ---------- 執行（瀏覽器） ----------

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (s && s.device) return { enabled: false, server: '', seq: 0, shadow: {}, lastAt: '', error: '', ...s };
  } catch {}
  const device = 'bu' + Math.random().toString(36).slice(2, 8);
  return { enabled: false, device, server: '', seq: 0, shadow: {}, lastAt: '', error: '' };
}

let state = loadState();
const clock = createClock(state.device);
for (const sh of Object.values(state.shadow)) clock.observe(sh.rev);

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

export function status() {
  return { enabled: state.enabled, lastAt: state.lastAt, error: state.error, busy: running };
}

let hooks = { getData: null, save: null, onChange: null, getSettings: null };
let running = null;
let again = false;
let timer = null;

/** App 啟動時呼叫一次 */
export function init(h) {
  hooks = h;
}

export function setEnabled(on) {
  state.enabled = on;
  state.error = '';
  saveState();
  if (on) return syncNow();
}

/** 資料有變動：稍等一下再送（連續打字只送一次） */
export function schedule(delay = 1500) {
  if (!state.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), delay);
}

async function api(settings, path, body) {
  const res = await fetch(`${baseUrl(settings)}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${settings.folio.token.trim()}`,
      'X-Folio-Device': state.device,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('Folio 同步密碼不對');
  if (!res.ok) throw new Error(`同步伺服器回應 ${res.status}`);
  return res.json();
}

/** 馬上同步一次（同時只跑一個；跑的時候又有變動就再跑一輪） */
export function syncNow() {
  if (!state.enabled) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
      state.error = '';
      state.lastAt = new Date().toISOString();
    } catch (e) {
      state.error = navigator.onLine === false ? '離線中，連上網路後會自動同步' : e.message || '同步失敗';
      throw e;
    } finally {
      saveState();
      running = null;
    }
  })();
  return running;
}

async function runOnce() {
  const settings = hooks.getSettings();
  if (!isConfigured(settings)) throw new Error('要先在「設定 › 筆記」填好 Folio 網址和同步密碼');
  const server = baseUrl(settings);
  if (state.server !== server) {
    // 換了同步伺服器：從頭來
    Object.assign(state, { server, seq: 0, shadow: {} });
  }

  // 1. 拿別台的變更
  let changed = false;
  for (;;) {
    const res = await api(settings, `/changes?since=${state.seq}`);
    for (const r of res.records) clock.observe(r.rev);
    if (mergeRemote(hooks.getData(), state.shadow, res.records)) changed = true;
    state.seq = res.seq;
    saveState();
    if (!res.more) break;
  }
  if (changed) {
    hooks.save({ fromSync: true });
    hooks.onChange?.();
  }

  // 2. 送出這台的變更
  const list = outgoing(hooks.getData(), state.shadow, () => clock.next());
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const res = await api(settings, '/changes', { records: part.map(({ json, ...r }) => r) });
    for (const r of part) state.shadow[r.key] = { rev: r.rev, json: r.json };
    // 中間沒有別台送東西的話，就不用再把自己剛送的拿回來
    if (res.seq === state.seq + res.accepted) state.seq = res.seq;
    saveState();
  }
}
