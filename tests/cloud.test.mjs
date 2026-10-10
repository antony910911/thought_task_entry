import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, mergeRemote, outgoing, createClock, PREFIX } from '../js/sync/cloud.js';

const base = () => ({
  todos: [{ id: 't1', title: '買牛奶' }],
  notes: [],
  events: [],
  tagLibrary: ['工作'],
  pet: { xp: 10 },
  settings: { appearance: { theme: 'classic' } },
});
let n = 0;
const clock = () => {
  const c = createClock('dev' + ++n);
  const next = () => c.next();
  next.observe = (rev) => c.observe(rev);
  return next;
};
/** 模擬伺服器：只收版本號比較大的 */
function server() {
  const recs = new Map();
  let seq = 0;
  return {
    push(list) {
      for (const r of list) {
        const cur = recs.get(r.key);
        if (cur && cur.rev >= r.rev) continue;
        recs.set(r.key, { key: r.key, rev: r.rev, deleted: r.deleted, data: r.data, seq: ++seq });
      }
    },
    pull(since) {
      return [...recs.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    },
  };
}
function sync(dev, srv) {
  const recs = srv.pull(0);
  for (const r of recs) dev.rev.observe(r.rev);
  mergeRemote(dev.data, dev.shadow, recs);
  const out = outgoing(dev.data, dev.shadow, dev.rev);
  srv.push(out);
  for (const r of out) dev.shadow[r.key] = { rev: r.rev, json: r.json };
}

test('每筆待辦、筆記、行程各一筆紀錄，另有標籤、外星人、設定', () => {
  const keys = [...snapshot(base()).keys()];
  assert.deepEqual(keys, [`${PREFIX}todo:t1`, `${PREFIX}tags`, `${PREFIX}pet`, `${PREFIX}settings`]);
});

test('手機的資料同步到空白的電腦', () => {
  const srv = server();
  const phone = { data: base(), shadow: {}, rev: clock() };
  const pc = { data: { todos: [], notes: [], events: [], tagLibrary: [], pet: { xp: 0 }, settings: {} }, shadow: {}, rev: clock() };
  sync(phone, srv);
  sync(pc, srv);
  assert.deepEqual(pc.data.todos, [{ id: 't1', title: '買牛奶' }]);
  assert.equal(pc.data.pet.xp, 10, '外星人取經驗值高的');
  assert.deepEqual(pc.data.tagLibrary, ['工作']);
  assert.equal(pc.data.settings.appearance.theme, 'classic');
});

test('新增、修改、刪除會傳到另一台；兩台原本各自的資料會合併', () => {
  const srv = server();
  const phone = { data: base(), shadow: {}, rev: clock() };
  const pc = { data: { ...base(), todos: [{ id: 'p1', title: '電腦上的' }], tagLibrary: ['私人'] }, shadow: {}, rev: clock() };
  sync(phone, srv);
  sync(pc, srv);
  sync(phone, srv);
  assert.deepEqual(phone.data.todos.map((t) => t.id).sort(), ['p1', 't1']);
  assert.deepEqual([...phone.data.tagLibrary].sort(), ['工作', '私人']);

  pc.data.todos.find((t) => t.id === 't1').title = '買豆漿';
  pc.data.notes.push({ id: 'n1', content: '筆記' });
  phone.data.todos = phone.data.todos.filter((t) => t.id !== 'p1');
  sync(pc, srv);
  sync(phone, srv);
  sync(pc, srv);
  for (const d of [phone, pc]) {
    assert.deepEqual(d.data.todos, [{ id: 't1', title: '買豆漿' }]);
    assert.deepEqual(d.data.notes, [{ id: 'n1', content: '筆記' }]);
  }
});

test('兩台都改了同一筆：後同步的那台的版本留下來，兩台最後一致', () => {
  const srv = server();
  const a = { data: base(), shadow: {}, rev: clock() };
  const b = { data: { todos: [], notes: [], events: [], tagLibrary: [], pet: {}, settings: {} }, shadow: {}, rev: clock() };
  sync(a, srv);
  sync(b, srv);
  a.data.todos[0].title = 'A 改的';
  b.data.todos[0].title = 'B 改的';
  sync(a, srv);
  sync(b, srv);
  sync(a, srv);
  assert.equal(a.data.todos[0].title, 'B 改的');
  assert.equal(b.data.todos[0].title, 'B 改的');
});

test('新裝置上的舊資料：雲端已經刪掉的不會復活', () => {
  const srv = server();
  const phone = { data: base(), shadow: {}, rev: clock() };
  sync(phone, srv);
  phone.data.todos = [];
  sync(phone, srv);
  const oldPc = { data: base(), shadow: {}, rev: clock() };
  sync(oldPc, srv);
  assert.deepEqual(oldPc.data.todos, []);
});

test('沒有變動就不送東西', () => {
  const srv = server();
  const phone = { data: base(), shadow: {}, rev: clock() };
  sync(phone, srv);
  assert.equal(outgoing(phone.data, phone.shadow, phone.rev).length, 0);
});

test('版本號會跟上看過的更新版本號（手機時間不準也送得出去）', () => {
  const c = createClock('x');
  const future = `${(Date.now() + 3_600_000).toString(36).padStart(10, '0')}.0000.y`;
  c.observe(future);
  assert.ok(c.next() > future);
});
