import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteHtml, noteRecords, pageTitle, makeRev, FOLIO_NOTEBOOK, FOLIO_SECTION, baseUrl, ping } from '../js/sync/folio.js';

test('頁面標題把標籤放前面', () => {
  assert.equal(pageTitle({ title: '週會', tags: ['會議', '專案A'] }), '[會議][專案A] 週會');
  assert.equal(pageTitle({ title: '', content: '第一行\n第二行', tags: [] }), '第一行');
});

test('文字框內容：標籤、換行、勾選清單、跳脫 HTML', () => {
  const html = noteHtml({ tags: ['會議'], content: '重點 <b>\n- [ ] 寄信\n- [x] 訂會議室\n結尾' });
  assert.equal(
    html,
    '<span style="color:#8e8e93">#會議</span><br>重點 &lt;b&gt;<br><ul class="checklist"><li>寄信</li><li class="done">訂會議室</li></ul><br>結尾'
  );
});

test('紀錄：筆記本和分區用最舊版本號（不會蓋掉 Folio 裡改過的），頁面和文字框用新的', () => {
  const recs = noteRecords({ title: 'A', content: 'x', tags: [], createdAt: '2026-10-10T00:00:00Z' }, { page: 'pg_1', item: 't_1' }, 1791600000000);
  assert.deepEqual(recs.map((r) => r.key), [`nb:${FOLIO_NOTEBOOK}`, `sc:${FOLIO_SECTION}`, 'pg:pg_1', 'it:pg_1:t_1']);
  assert.ok(recs[0].rev < recs[2].rev && recs[1].rev < recs[3].rev);
  assert.equal(recs[1].data.notebookId, FOLIO_NOTEBOOK);
  assert.equal(recs[2].data.sectionId, FOLIO_SECTION);
  assert.equal(recs[3].data.type, 'text');
});

test('版本號越來越大（同一毫秒也一樣）', () => {
  const a = makeRev(1000);
  const b = makeRev(1000);
  const c = makeRev(2000);
  assert.ok(a < b && b < c);
  assert.match(a, /^[0-9a-z]{10}\.[0-9a-z]{4}\.beamup$/);
});

test('網址自動補 https、去掉結尾斜線', () => {
  assert.equal(baseUrl({ folio: { url: 'folio.me.workers.dev/' } }), 'https://folio.me.workers.dev');
  assert.equal(baseUrl({ folio: { url: ' https://folio.me.workers.dev/index.html#/nb ' } }), 'https://folio.me.workers.dev');
});

test('連線錯誤分清楚：沒設 SYNC_TOKEN、密碼錯、Cloudflare 暫時 503、網址不是 Folio', async () => {
  const s = { folio: { url: 'folio.me.workers.dev', token: 'abc' } };
  const reply = (status, body, type = 'application/json') => async () => new Response(body, { status, headers: { 'Content-Type': type } });
  const real = globalThis.fetch;
  try {
    globalThis.fetch = reply(503, '{"error":"not_configured"}');
    await assert.rejects(ping(s), /讀不到 SYNC_TOKEN/);
    globalThis.fetch = reply(401, '{"error":"unauthorized"}');
    await assert.rejects(ping(s), /同步密碼不對/);
    globalThis.fetch = reply(503, 'Service Unavailable', 'text/plain');
    await assert.rejects(ping(s), /回應 503，請稍後再試/);
    globalThis.fetch = reply(200, '<!doctype html><html></html>', 'text/html');
    await assert.rejects(ping(s), /不是 Folio/);
    globalThis.fetch = reply(200, '{"records":7}');
    assert.equal(await ping(s), 7);
  } finally {
    globalThis.fetch = real;
  }
});
