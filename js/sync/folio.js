// 把筆記送進 Folio（你的另一個筆記 App），透過 Folio 自己的同步伺服器（/api/changes）。
//
// 筆記會放在 Folio 的「Beamup › 收件匣」：第一次送出時自動建立這本筆記本和分區。
// 每篇 Beamup 筆記對應 Folio 的一頁，頁面上一個文字框；修改後再送會更新同一頁，刪除會一起刪。
// Folio 的紀錄格式見 folio repo 的 js/syncmodel.js、js/model.js。

const DEVICE = 'beamup';
export const FOLIO_NOTEBOOK = 'nb_beamup';
export const FOLIO_SECTION = 'sc_beamup_inbox';

// 筆記本和分區用最舊的版本號送：Folio 裡已經有（或被你改過名、刪掉）就不會被蓋掉，沒有才建立
const BASE_REV = `${'1'.padStart(10, '0')}.0000.${DEVICE}`;

let counter = 0;
let lastMs = 0;
/** Folio 的版本號：<毫秒36進位>.<計數36進位>.<裝置>，字串比大小就是先後 */
export function makeRev(ms = Date.now()) {
  ms = Math.floor(ms);
  if (ms > lastMs) {
    lastMs = ms;
    counter = 0;
  } else counter += 1;
  return `${lastMs.toString(36).padStart(10, '0')}.${counter.toString(36).padStart(4, '0')}.${DEVICE}`;
}

export function isConfigured(settings) {
  return Boolean(settings.folio && settings.folio.url && settings.folio.token);
}

/** 只留下網址的「https://主機」部分：貼成 …/index.html、…/#/xxx 或結尾有斜線都沒關係 */
export function baseUrl(settings) {
  let u = String(settings.folio.url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
}

function randomId(prefix) {
  const r = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12);
  return prefix + r;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Folio 頁面標題：標籤放前面，方便在 Folio 裡一眼看出分類 */
export function pageTitle(note) {
  const tags = (note.tags || []).map((t) => `[${t}]`).join('');
  const title = note.title || String(note.content || '').split('\n')[0].slice(0, 40) || '未命名筆記';
  return `${tags}${tags ? ' ' : ''}${title}`;
}

/** 文字框內容：第一行是標籤，接著是內文；「- [ ]」「- [x]」開頭的行變成 Folio 的勾選清單 */
export function noteHtml(note) {
  const parts = [];
  if (note.tags && note.tags.length) parts.push(`<span style="color:#8e8e93">${note.tags.map((t) => '#' + esc(t)).join(' ')}</span>`);
  const lines = String(note.content || '').split('\n');
  let list = [];
  let text = [];
  const flushText = () => {
    if (text.length) parts.push(text.map(esc).join('<br>'));
    text = [];
  };
  const flushList = () => {
    if (list.length) parts.push(`<ul class="checklist">${list.join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(line);
    if (m) {
      flushText();
      list.push(`<li${m[1].trim() ? ' class="done"' : ''}>${esc(m[2])}</li>`);
    } else {
      flushList();
      text.push(line);
    }
  }
  flushText();
  flushList();
  return parts.join('<br>') || '&nbsp;';
}

/** 要送給 Folio 的紀錄：筆記本、分區（只在沒有時建立）、頁面、文字框 */
export function noteRecords(note, ids, now = Date.now()) {
  const created = new Date(note.createdAt || now).getTime();
  return [
    {
      key: `nb:${FOLIO_NOTEBOOK}`,
      rev: BASE_REV,
      deleted: 0,
      data: { id: FOLIO_NOTEBOOK, name: 'Beamup', order: 999, createdAt: now, updatedAt: now },
    },
    {
      key: `sc:${FOLIO_SECTION}`,
      rev: BASE_REV,
      deleted: 0,
      data: { id: FOLIO_SECTION, notebookId: FOLIO_NOTEBOOK, name: '收件匣', color: '#8a5cd1', order: 1, createdAt: now, updatedAt: now },
    },
    {
      key: `pg:${ids.page}`,
      rev: makeRev(now),
      deleted: 0,
      data: {
        id: ids.page,
        sectionId: FOLIO_SECTION,
        title: pageTitle(note),
        background: 'ruled',
        order: Math.floor(created / 1000),
        createdAt: created,
        updatedAt: now,
      },
    },
    {
      key: `it:${ids.page}:${ids.item}`,
      rev: makeRev(now),
      deleted: 0,
      data: { id: ids.item, type: 'text', x: 64, y: 156, w: 640, html: noteHtml(note) },
    },
  ];
}

async function api(settings, path, body) {
  const url = baseUrl(settings);
  let res;
  try {
    res = await fetch(`${url}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${settings.folio.token.trim()}`,
        'X-Folio-Device': DEVICE,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('連不到 Folio（網址不對，或離線）');
  }
  let data = null;
  try {
    data = await res.clone().json();
  } catch {}
  const code = data && data.error;
  const host = url.replace(/^https?:\/\//, '');
  if (res.status === 401 || code === 'unauthorized') throw new Error('Folio 同步密碼不對（要跟 Cloudflare 上的 SYNC_TOKEN 一模一樣）');
  // 只有 Folio 伺服器自己說「沒設定」才是 SYNC_TOKEN 的問題；其他 503 是 Cloudflare 暫時出錯
  if (code === 'not_configured')
    throw new Error(`${host} 這個 Worker 執行時讀不到 SYNC_TOKEN：請到 Cloudflare › 這個 Worker › Settings › Variables and Secrets 新增，類型選 Secret`);
  if (res.status === 404 || (res.ok && !data)) throw new Error(`${host} 不是 Folio（找不到同步伺服器），請檢查網址`);
  if (!res.ok) throw new Error(`Folio 回應 ${res.status}${code ? `（${code}）` : ''}，請稍後再試`);
  return data;
}

/** 測試連線，回傳 Folio 裡有幾筆資料 */
export async function ping(settings) {
  const s = await api(settings, '/status');
  return s.records;
}

/** 送出（或更新）一篇筆記，回傳 Folio 的頁面 id */
export async function sendNote(note, settings) {
  const prev = note.sync && note.sync.via === 'folio' && note.sync.folio;
  const ids = prev && prev.page ? prev : { page: randomId('pg_'), item: randomId('t_') };
  await api(settings, '/changes', { records: noteRecords(note, ids) });
  return ids;
}

/** 在 Folio 刪掉這篇筆記的頁面 */
export async function deleteNote(ids, settings) {
  const now = Date.now();
  await api(settings, '/changes', {
    records: [
      { key: `it:${ids.page}:${ids.item}`, rev: makeRev(now), deleted: 1, data: null },
      { key: `pg:${ids.page}`, rev: makeRev(now), deleted: 1, data: null },
    ],
  });
}
