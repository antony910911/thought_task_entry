import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMothership, eventTimes, pullFromMothership } from '../js/sync/todo.js';

process.env.TZ = 'Asia/Taipei';
const NOW = Date.parse('2026-10-11T03:00:00Z');
const sent = { status: 'ok', at: '2026-10-10T00:00:00Z' };
const todo = (id, extra = {}) => ({ id, title: id, due: null, done: false, sync: { ...sent }, createdAt: '2026-10-10T00:00:00Z', ...extra });
const card = (sourceId, extra = {}) => ({ sourceId, title: sourceId, startDate: null, dueDate: null, time: null, completed: false, archived: false, ...extra });
const data = (todos = [], events = []) => ({ todos, events });

test('在 Mothership 刪掉（進垃圾桶）→ Beamup 也刪掉', () => {
  const d = data([todo('a'), todo('b')]);
  const r = applyMothership(d, { cards: [card('b')], deleted: ['a'], pending: [] }, NOW);
  assert.deepEqual(d.todos.map((t) => t.id), ['b']);
  assert.equal(r.deleted, 1);
});

test('卡片暫時找不到（還在路上、或還沒收進 Mothership）不刪', () => {
  const d = data([todo('a'), todo('b')]);
  applyMothership(d, { cards: [], deleted: [], pending: ['b'] }, NOW);
  assert.deepEqual(d.todos.map((t) => t.id), ['a', 'b']);
});

test('完成、改標題、改到期日 → Beamup 跟著改', () => {
  const d = data([todo('a', { title: '舊', due: '2026-10-12' })]);
  const r = applyMothership(d, { cards: [card('a', { title: '新標題', dueDate: '2026-10-20', completed: true })], deleted: [], pending: [] }, NOW);
  assert.equal(r.changed, 1);
  assert.deepEqual([d.todos[0].title, d.todos[0].due, d.todos[0].done], ['新標題', '2026-10-20', true]);
  assert.ok(d.todos[0].doneAt);
  // 卡片沒再變，就不再動 Beamup（例如 Beamup 之後自己改了標題，還沒送到）
  d.todos[0].title = 'Beamup 改的';
  d.todos[0].updatedAt = '2026-10-10T00:00:00Z';
  const again = applyMothership(d, { cards: [card('a', { title: '新標題', dueDate: '2026-10-20', completed: true })], deleted: [], pending: [] }, NOW);
  assert.equal(again.changed, 0);
  assert.equal(again.touched, false);
  assert.equal(d.todos[0].title, 'Beamup 改的');
});

test('Beamup 剛改、還沒送到 Mothership 的，以 Beamup 為準', () => {
  const d = data([
    todo('a', { title: 'Beamup 新', sync: { ...sent, status: 'pending' } }),
    todo('b', { title: 'Beamup 新', updatedAt: new Date(NOW - 30_000).toISOString() }),
  ]);
  applyMothership(d, { cards: [card('a', { title: '舊' }), card('b', { title: '舊' })], deleted: ['x'], pending: [] }, NOW);
  assert.deepEqual(d.todos.map((t) => t.title), ['Beamup 新', 'Beamup 新']);
});

test('沒送過 Mothership 的待辦不動', () => {
  const d = data([{ id: 'local', title: '只在 Beamup', done: false }]);
  applyMothership(d, { cards: [], deleted: ['local'], pending: [] }, NOW);
  assert.equal(d.todos.length, 1);
});

const event = (id, extra = {}) => ({
  id,
  title: id,
  allDay: false,
  start: '2026-10-12T01:00:00.000Z', // 台北 09:00
  end: '2026-10-12T02:00:00.000Z',
  sync: { status: 'ok', at: 'x', via: 'mothership' },
  ...extra,
});

test('卡片的日期與時段換回行程時間（當地時間）', () => {
  assert.deepEqual(eventTimes(card('x', { dueDate: '2026-10-12', time: '09:00–10:30' })), {
    allDay: false,
    start: new Date('2026-10-12T01:00:00Z'),
    end: new Date('2026-10-12T02:30:00Z'),
  });
  const allDay = eventTimes(card('x', { startDate: '2026-10-20', dueDate: '2026-10-22' }));
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start.toISOString(), '2026-10-19T16:00:00.000Z');
  assert.equal(allDay.end.toISOString(), '2026-10-22T16:00:00.000Z'); // 最後一天的隔天 0 點
});

test('行程：在行事曆或 Mothership 改時間、改名、刪除 → Beamup 跟著', () => {
  const d = data([], [event('e1'), event('e2'), event('e3'), event('other', { sync: { status: 'ok', via: 'outlook' } })]);
  const r = applyMothership(
    d,
    {
      cards: [
        card('ev:e1', { title: '改到下午', dueDate: '2026-10-12', time: '14:00–15:00' }),
        card('ev:e2', { title: 'e2', dueDate: '2026-10-12', time: '09:00–10:00' }), // 沒變
      ],
      deleted: ['ev:e3', 'ev:other'],
      pending: [],
    },
    NOW,
  );
  assert.deepEqual(d.events.map((e) => e.id), ['e1', 'e2', 'other']);
  assert.deepEqual([d.events[0].title, d.events[0].start, d.events[0].end], ['改到下午', '2026-10-12T06:00:00.000Z', '2026-10-12T07:00:00.000Z']);
  assert.equal(r.changed, 1);
  assert.equal(r.deleted, 1);
});

test('向 Supabase 的 beamup_pull 拿資料；還沒設定好或離線就略過', async () => {
  const code = 'pm1.' + Buffer.from(JSON.stringify({ u: 'https://abc.supabase.co', k: 'anon', s: 'sec' })).toString('base64url');
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ cards: [], deleted: [], pending: [] }), { status: 200 });
  };
  assert.deepEqual(await pullFromMothership({ todo: { webhookUrl: code } }), { cards: [], deleted: [], pending: [] });
  assert.equal(call.url, 'https://abc.supabase.co/rest/v1/rpc/beamup_pull');
  assert.equal(JSON.parse(call.init.body).p_key, 'sec');
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  assert.equal(await pullFromMothership({ todo: { webhookUrl: code } }), null);
  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  assert.equal(await pullFromMothership({ todo: { webhookUrl: code } }), null);
  assert.equal(await pullFromMothership({ todo: { webhookUrl: 'https://example.com/hook' } }), null);
});
