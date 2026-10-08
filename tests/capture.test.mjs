import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../js/capture.js';

const today = new Date(2026, 9, 8); // 2026/10/08（四）
const c = (s, o = {}) => classify(s, { today, ...o });

test('有日期和時間 → 行程', () => {
  const r = c('2026/11/12 9：00-10：00 院前瞻期末報告會議');
  assert.equal(r.type, 'event');
  assert.ok(r.ok);
  assert.equal(r.event.title, '院前瞻期末報告會議');
  assert.equal(c('明天 14:00 跟廠商開會').type, 'event');
});

test('只有日期沒有時間 → 待辦＋截止日', () => {
  const r = c('週五交期末報告 #專案A');
  assert.equal(r.type, 'todo');
  assert.equal(r.title, '交期末報告');
  assert.equal(r.due, '2026-10-09');
  assert.deepEqual(r.tags, ['專案A']);
});

test('一般短句 → 待辦，! 代表高優先，地點保留', () => {
  const r = c('!! 買牛奶 @全聯');
  assert.equal(r.type, 'todo');
  assert.equal(r.priority, 'high');
  assert.equal(r.title, '買牛奶 @全聯');
  assert.equal(r.due, null);
});

test('多行或很長 → 筆記，第一行當標題', () => {
  const r = c('週會重點\n1. 預算\n2. 時程 #會議');
  assert.equal(r.type, 'note');
  assert.equal(r.title, '週會重點');
  assert.equal(r.content, '1. 預算\n2. 時程');
  assert.deepEqual(r.tags, ['會議']);
  assert.equal(c('今天讀到一段很有意思的話：' + '好'.repeat(60)).type, 'note');
});

test('開頭指定類型或 #筆記', () => {
  assert.equal(c('筆記 明天 10:00 的會議要準備什麼').type, 'note');
  assert.equal(c('筆記：靈感一則').content, '靈感一則');
  assert.equal(c('待辦 明天 10:00 打電話').type, 'todo');
  assert.equal(c('行程 11/20 員工旅遊').type, 'event');
  const n = c('想到一個點子 #筆記 #靈感');
  assert.equal(n.type, 'note');
  assert.deepEqual(n.tags, ['靈感']);
});

test('手動指定類型', () => {
  assert.equal(c('買牛奶', { force: 'note' }).type, 'note');
});

test('空字串', () => {
  assert.ok(c('   ').empty);
});
