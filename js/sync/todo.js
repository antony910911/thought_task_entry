// 把待辦事項 POST 到你自己的專案管理工具（Webhook）。格式見 README「待辦事項 Webhook 格式」。
// 「網址」欄也可以貼 Mothership 的連接碼（pm1. 開頭），待辦會直接進 Mothership 上方的「待辦」清單。

export function isConfigured(settings) {
  return Boolean(settings.todo.webhookUrl);
}

/**
 * @param {'todo.created'|'todo.updated'|'todo.deleted'} type
 *   created：第一次送出；updated：改內容或勾選完成；deleted：在 App 裡刪掉
 */
export function payloadFor(todo, type = 'todo.created') {
  return {
    type,
    id: todo.id,
    remoteId: (todo.sync && todo.sync.remoteId) || null,
    title: todo.title,
    note: todo.note || '',
    due: todo.due || null,
    priority: todo.priority || 'normal',
    tags: todo.tags || [],
    done: Boolean(todo.done),
    doneAt: todo.doneAt || null,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt || todo.createdAt,
    source: 'beamup',
  };
}

/**
 * Mothership 連接碼："pm1." + base64url(JSON {u: Supabase 網址, k: 公開金鑰, s: 你的私密碼})。
 * 不是連接碼就回傳 null。
 */
export function parseConnectionCode(text) {
  const m = /^pm1\.([A-Za-z0-9_-]+)$/.exec(String(text || '').trim());
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && /^https:\/\//.test(v.u) && v.k && v.s ? { url: v.u, key: v.k, secret: v.s } : null;
  } catch {
    return null;
  }
}

/** 送到 Mothership（Supabase 的 inbox_push 函式，見 Mothership 的 supabase/inbox.sql） */
async function postToProjectManager(pm, payload) {
  let res;
  try {
    res = await fetch(`${pm.url}/rest/v1/rpc/inbox_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: pm.key, Authorization: `Bearer ${pm.key}` },
      body: JSON.stringify({ p_key: pm.secret, p_item: payload }),
    });
  } catch {
    throw new Error('連不到 Mothership（離線？）');
  }
  if (res.ok) return res;
  let msg = '';
  try {
    msg = (await res.json()).message || '';
  } catch {
    // 沒有內容
  }
  if (/invalid connection code/.test(msg)) throw new Error('連接碼已失效，請到 Mothership 重新複製');
  if (res.status === 404) throw new Error('Mothership 還沒設定好（要先在 Supabase 執行 inbox.sql）');
  throw new Error(`Mothership 回應 ${res.status}${msg ? '：' + msg : ''}`);
}

async function post(settings, payload) {
  const { webhookUrl, token } = settings.todo;
  const pm = parseConnectionCode(webhookUrl);
  if (pm) return postToProjectManager(pm, payload);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch {
    throw new Error('連不到伺服器（離線，或伺服器沒開 CORS）');
  }
  if (!res.ok) throw new Error(`伺服器回應 ${res.status}`);
  return res;
}

/** 行程模式選「Mothership」時需要設定好連接碼 */
export function mothershipReady(settings) {
  return Boolean(parseConnectionCode(settings.todo.webhookUrl));
}

/**
 * 把行程送到 Mothership：變成「行事曆」清單的卡片，再由 Mothership 寫進它連接的行事曆（iCloud／Google／Outlook）。
 * @param {'event.created'|'event.updated'|'event.deleted'} type
 */
export async function sendEvent(record, type, settings) {
  const pm = parseConnectionCode(settings.todo.webhookUrl);
  if (!pm) throw new Error('請先在設定貼上 Mothership 連接碼');
  const notes = [record.location ? '@' + record.location : '', record.notes, (record.tags || []).map((t) => '#' + t).join(' ')]
    .filter(Boolean)
    .join('\n');
  await postToProjectManager(pm, {
    type,
    id: record.id,
    title: record.title,
    notes,
    allDay: Boolean(record.allDay),
    start: new Date(record.start).toISOString(),
    end: new Date(record.end).toISOString(),
    source: 'beamup',
  });
}

/** 測試連線：送出 {"type":"ping"}，伺服器回 2xx 即成功 */
export async function ping(settings) {
  await post(settings, { type: 'ping', source: 'beamup', sentAt: new Date().toISOString() });
}

export async function sendTodo(todo, settings, type = 'todo.created') {
  const res = await post(settings, payloadFor(todo, type));
  // 若伺服器回傳 {"id": "..."}，記下遠端 id
  try {
    const body = await res.json();
    return body && body.id ? String(body.id) : null;
  } catch {
    return null;
  }
}

// ---------- Mothership → Beamup：在 Mothership 刪除、完成、改名、改日期，Beamup 也跟著 ----------

/** 拿 Mothership 上「從 Beamup 來的卡片」現況（Supabase 的 beamup_pull，見 Mothership supabase/inbox.sql） */
export async function pullFromMothership(settings) {
  const pm = parseConnectionCode(settings.todo.webhookUrl);
  if (!pm) return null;
  let res;
  try {
    res = await fetch(`${pm.url}/rest/v1/rpc/beamup_pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: pm.key, Authorization: `Bearer ${pm.key}` },
      body: JSON.stringify({ p_key: pm.secret }),
    });
  } catch {
    return null; // 離線：下次再拿
  }
  // 404：Mothership 那邊還沒重跑 inbox.sql，先不跟
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && Array.isArray(body.cards) ? body : null;
}

/** YYYY-MM-DD + HH:MM，當地時間 */
const at = (day, time = '00:00') => new Date(`${day}T${time}`);

/** 卡片上的日期／時段換回行程的開始、結束（全天行程的結束是最後一天的隔天 0 點） */
export function eventTimes(card) {
  const last = card.dueDate;
  if (!last) return null;
  const first = card.startDate || last;
  const m = /^(\d\d:\d\d)\D+(\d\d:\d\d)$/.exec(card.time || '');
  if (m) {
    const start = at(first, m[1]);
    let end = at(last, m[2]);
    if (end < start) end = new Date(end.getTime() + 86400000);
    return { allDay: false, start, end };
  }
  const end = at(last);
  end.setDate(end.getDate() + 1);
  return { allDay: true, start: at(first), end };
}

const fingerprint = (c) => JSON.stringify([c.title, c.startDate, c.dueDate, c.time || null, Boolean(c.completed)]);
const busy = (x, now) =>
  (x.sync && ['pending', 'error'].includes(x.sync.status)) || (x.updatedAt && now - Date.parse(x.updatedAt) < 2 * 60_000);

/**
 * 把 Mothership 的變更套到 Beamup 的待辦與行程（只動送去 Mothership 的那些）。回傳 { changed, deleted, touched }。
 * - 在 Mothership 刪掉（在它的垃圾桶裡）→ Beamup 也刪掉，不再通知 Mothership。
 * - 完成、改標題、改日期／時間 → Beamup 跟著改。行程的完成不管。
 * - Beamup 這邊剛改、還沒送到的，以 Beamup 為準。
 * 每筆記著上次看到的卡片（remote），只有卡片真的變了才套用，避免把 Beamup 剛送出、Mothership 還沒收的修改改回去。
 */
export function applyMothership(data, remote, now = Date.now()) {
  const cards = new Map(remote.cards.map((c) => [c.sourceId, c]));
  const deleted = new Set(remote.deleted || []);
  const pending = new Set(remote.pending || []);
  // touched：有記下新的卡片狀態（要存檔），changed／deleted：真的改到或刪掉幾筆
  const result = { changed: 0, deleted: 0, touched: false };
  const stamp = new Date(now).toISOString();

  const follow = (item, key, apply) => {
    if (pending.has(item.id)) return 'keep';
    const card = cards.get(key);
    if (!card) return deleted.has(key) && !busy(item, now) ? 'delete' : 'keep';
    const fp = fingerprint(card);
    const seen = item.remote && item.remote.fp;
    if (seen === fp || busy(item, now)) return 'keep';
    item.remote = { fp };
    result.touched = true;
    if (apply(card)) {
      item.updatedAt = stamp;
      result.changed++;
    }
    return 'keep';
  };

  data.todos = data.todos.filter((t) => {
    if (!t.sync || !t.sync.at) return true; // 沒送過 Mothership
    const verdict = follow(t, t.id, (c) => {
      const due = typeof c.dueDate === 'string' ? c.dueDate : null;
      const done = Boolean(c.completed);
      if (t.title === c.title && (t.due || null) === due && Boolean(t.done) === done) return false;
      t.title = c.title;
      t.due = due;
      if (Boolean(t.done) !== done) {
        t.done = done;
        t.doneAt = done ? stamp : null;
      }
      return true;
    });
    if (verdict === 'delete') result.deleted++;
    return verdict !== 'delete';
  });
  if (result.deleted) result.touched = true;

  data.events = data.events.filter((r) => {
    if (!r.sync || r.sync.via !== 'mothership') return true;
    const verdict = follow(r, 'ev:' + r.id, (c) => {
      const t = eventTimes(c);
      if (!t) return false;
      const same =
        r.title === c.title &&
        Boolean(r.allDay) === t.allDay &&
        Date.parse(r.start) === t.start.getTime() &&
        Date.parse(r.end) === t.end.getTime();
      if (same) return false;
      r.title = c.title;
      r.allDay = t.allDay;
      r.start = t.start.toISOString();
      r.end = t.end.toISOString();
      return true;
    });
    if (verdict === 'delete') result.deleted++;
    return verdict !== 'delete';
  });
  if (result.deleted) result.touched = true;
  return result;
}
