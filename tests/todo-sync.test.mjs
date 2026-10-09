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
