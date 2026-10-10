import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionCode, sendTodo, ping } from '../js/sync/todo.js';

// 跟 Mothership src/inbox.ts 的 connectionCode() 同樣的編碼
const code = (v) => 'pm1.' + Buffer.from(JSON.stringify(v)).toString('base64url');
const pmCode = code({ u: 'https://abc.supabase.co', k: 'anon-key', s: 'secret-123' });

test('解析 Mothership 連接碼', () => {
  assert.deepEqual(parseConnectionCode(pmCode), { url: 'https://abc.supabase.co', key: 'anon-key', secret: 'secret-123' });
  assert.deepEqual(parseConnectionCode('  ' + pmCode + '\n').secret, 'secret-123');
  assert.equal(parseConnectionCode('https://example.com/api/todos'), null);
  assert.equal(parseConnectionCode('pm1.壞掉'), null);
  assert.equal(parseConnectionCode(code({ u: 'http://abc', k: 'x', s: 'y' })), null);
});

const todo = { id: 't1', title: '寫報告', note: '', due: '2026-11-12', priority: 'high', tags: ['A'], done: false, createdAt: 'x' };

test('連接碼：送到 Supabase 的 inbox_push', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 't1' }), { status: 200 });
  };
  const id = await sendTodo(todo, { todo: { webhookUrl: pmCode, token: '' } });
  assert.equal(id, 't1');
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/inbox_push');
  assert.equal(calls[0].init.headers.apikey, 'anon-key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.p_key, 'secret-123');
  assert.equal(body.p_item.type, 'todo.created');
  assert.equal(body.p_item.title, '寫報告');
  await ping({ todo: { webhookUrl: pmCode, token: '' } });
  assert.equal(JSON.parse(calls[1].init.body).p_item.type, 'ping');
});

test('連接碼失效時顯示看得懂的訊息', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'invalid connection code' }), { status: 401 });
  await assert.rejects(sendTodo(todo, { todo: { webhookUrl: pmCode, token: '' } }), /連接碼已失效/);
});

test('一般 Webhook 照舊', async () => {
  let seen;
  globalThis.fetch = async (url, init) => ((seen = { url, init }), new Response(null, { status: 204 }));
  await sendTodo(todo, { todo: { webhookUrl: 'https://example.com/hook', token: 'tk' } });
  assert.equal(seen.url, 'https://example.com/hook');
  assert.equal(seen.init.headers.Authorization, 'Bearer tk');
});

test('行程送到 Mothership：時間、地點、標籤都帶上', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => (calls.push({ url, init }), new Response('{}', { status: 200 }));
  const { sendEvent, mothershipReady } = await import('../js/sync/todo.js');
  const settings = { todo: { webhookUrl: pmCode, token: '' } };
  assert.equal(mothershipReady(settings), true);
  assert.equal(mothershipReady({ todo: { webhookUrl: 'https://x', token: '' } }), false);
  await sendEvent(
    { id: 'e1', title: '跟廠商開會', location: '會議室', notes: '帶樣品', tags: ['專案A'], allDay: false, start: '2026-11-12T06:00:00.000Z', end: '2026-11-12T07:00:00.000Z' },
    'event.created',
    settings
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/inbox_push');
  assert.deepEqual(
    { ...body.p_item },
    { type: 'event.created', id: 'e1', title: '跟廠商開會', notes: '@會議室\n帶樣品\n#專案A', allDay: false, start: '2026-11-12T06:00:00.000Z', end: '2026-11-12T07:00:00.000Z', source: 'beamup' }
  );
  await assert.rejects(sendEvent({ id: 'x', title: 't', start: 0, end: 0 }, 'event.created', { todo: { webhookUrl: '', token: '' } }), /連接碼/);
});
