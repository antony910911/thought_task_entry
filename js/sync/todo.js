// 把待辦事項 POST 到你自己的專案管理工具（Webhook）。格式見 README「待辦事項 Webhook 格式」。
// 「網址」欄也可以貼 Project Manager 的連接碼（pm1. 開頭），待辦會直接進 Project Manager 上方的「待辦」清單。

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
 * Project Manager 連接碼："pm1." + base64url(JSON {u: Supabase 網址, k: 公開金鑰, s: 你的私密碼})。
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

/** 送到 Project Manager（Supabase 的 inbox_push 函式，見 Project Manager 的 supabase/inbox.sql） */
async function postToProjectManager(pm, payload) {
  let res;
  try {
    res = await fetch(`${pm.url}/rest/v1/rpc/inbox_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: pm.key, Authorization: `Bearer ${pm.key}` },
      body: JSON.stringify({ p_key: pm.secret, p_item: payload }),
    });
  } catch {
    throw new Error('連不到 Project Manager（離線？）');
  }
  if (res.ok) return res;
  let msg = '';
  try {
    msg = (await res.json()).message || '';
  } catch {
    // 沒有內容
  }
  if (/invalid connection code/.test(msg)) throw new Error('連接碼已失效，請到 Project Manager 重新複製');
  if (res.status === 404) throw new Error('Project Manager 還沒設定好（要先在 Supabase 執行 inbox.sql）');
  throw new Error(`Project Manager 回應 ${res.status}${msg ? '：' + msg : ''}`);
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
