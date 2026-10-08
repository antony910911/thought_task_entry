// 把待辦事項 POST 到你自己的專案管理工具（Webhook）。格式見 README「待辦事項 Webhook 格式」。

export function isConfigured(settings) {
  return Boolean(settings.todo.webhookUrl);
}

export function payloadFor(todo) {
  return {
    type: 'todo.created',
    id: todo.id,
    title: todo.title,
    note: todo.note || '',
    due: todo.due || null,
    priority: todo.priority || 'normal',
    tags: todo.tags || [],
    createdAt: todo.createdAt,
    source: 'beamup',
  };
}

async function post(settings, payload) {
  const { webhookUrl, token } = settings.todo;
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

export async function sendTodo(todo, settings) {
  const res = await post(settings, payloadFor(todo));
  // 若伺服器回傳 {"id": "..."}，記下遠端 id
  try {
    const body = await res.json();
    return body && body.id ? String(body.id) : null;
  } catch {
    return null;
  }
}
