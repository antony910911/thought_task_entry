import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, normalize, formatRange } from '../js/parser.js';

const today = new Date(2026, 9, 8); // 2026/10/08（四）
const p = (s, o = {}) => parseEvent(s, { today, ...o });
const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('固定格式：日期 時間 @地點 [名稱]', () => {
  const r = p('2026/11/12 9:30-12:00@中研院 [期末審查會議]');
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.title, '期末審查會議');
  assert.equal(r.location, '中研院');
  assert.equal(ymd(r.start), '2026-11-12');
  assert.equal(hm(r.start), '9:30');
  assert.equal(hm(r.end), '12:00');
  assert.equal(r.allDay, false);
});

test('全形符號：冒號、括號、＠', () => {
  const r = p('２０２６／１１／１２　９：３０－１２：００＠會議室Ａ　［期末報告］');
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.title, '期末報告');
  assert.equal(r.location, '會議室A');
  assert.equal(hm(r.start), '9:30');
  assert.equal(hm(r.end), '12:00');
});

test('隨意輸入：沒有括號時剩下的文字當名稱', () => {
  const r = p('2026/11/12 9：00-10：00 院前瞻期末報告會議');
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.title, '院前瞻期末報告會議');
  assert.equal(r.location, '');
  assert.equal(hm(r.start), '9:00');
  assert.equal(hm(r.end), '10:00');
});

test('有括號時多出的文字放備註', () => {
  const r = p('2026/11/12 14:00-15:00 [週會] 記得帶筆電');
  assert.equal(r.title, '週會');
  assert.equal(r.notes, '記得帶筆電');
});

test('只有開始時間時使用預設長度', () => {
  const r = p('11/20 14:00 牙醫', { defaultDuration: 30 });
  assert.ok(r.ok);
  assert.equal(ymd(r.start), '2026-11-20');
  assert.equal(hm(r.end), '14:30');
});

test('沒有時間就是全天', () => {
  const r = p('2026-12-25 聖誕節');
  assert.ok(r.ok);
  assert.equal(r.allDay, true);
  assert.equal(ymd(r.end), '2026-12-26');
});

test('上午/下午與「點」「半」', () => {
  const r = p('明天 下午2點半-4點 @台大 [口試]');
  assert.ok(r.ok, r.errors.join());
  assert.equal(ymd(r.start), '2026-10-9');
  assert.equal(hm(r.start), '14:30');
  assert.equal(hm(r.end), '16:00');
});

test('結束時間比開始早時推到下午', () => {
  const r = p('10/30 11:00-1:00 午餐會');
  assert.equal(hm(r.end), '13:00');
});

test('民國年', () => {
  const r = p('115/11/12 9:00-10:00 [審查]');
  assert.equal(ymd(r.start), '2026-11-12');
});

test('沒寫年份且已過很久 → 明年', () => {
  assert.equal(ymd(p('1/5 開工').start), '2027-1-5');
  assert.equal(ymd(p('10/1 補登').start), '2026-10-1');
});

test('星期', () => {
  assert.equal(ymd(p('週五 10:00 [例會]').start), '2026-10-9');
  assert.equal(ymd(p('週四 10:00 [例會]').start), '2026-10-8');
  assert.equal(ymd(p('下週三 10:00 [例會]').start), '2026-10-14');
  assert.equal(ymd(p('下週日 10:00 [例會]').start), '2026-10-18');
});

test('#tag 會被抽出', () => {
  const r = p('11/12 9:00-10:00 [週會] #專案A #重要');
  assert.deepEqual(r.tags, ['專案A', '重要']);
  assert.equal(r.notes, '');
});

test('錯誤提示', () => {
  assert.ok(!p('開會').ok);
  assert.ok(!p('2026/02/30 開會').ok);
  assert.ok(!p('2026/11/12 9:00-10:00').ok);
});

test('normalize 與 formatRange', () => {
  assert.equal(normalize('【會議】〜—'), '[會議]--');
  const r = p('2026/11/12 9:30-12:00 [期末報告]');
  assert.equal(formatRange(r), '2026/11/12（四） 09:30–12:00');
});
