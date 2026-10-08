import { db, save, uid, replaceAll } from './store.js';
import { parseEvent, formatRange, formatDate, formatTime } from './parser.js';
import * as todoSync from './sync/todo.js';
import * as ms from './sync/microsoft.js';
import * as cal from './sync/calendar.js';

const $app = document.getElementById('app');
const DRAFT_KEY = 'tte.noteDraft';
let refreshCurrent = null; // 同步完成後，只刷新目前頁面的局部區塊（避免清掉正在輸入的內容）
const ui = { todoTab: 'open', noteTag: '', noteQuery: '' };

// ---------- 共用小工具 ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function splitTags(text) {
  return [...new Set(String(text).split(/[\s,，、#]+/).map((t) => t.trim()).filter(Boolean))];
}

function header(title, { back, right = '' } = {}) {
  return `<header class="bar">
    ${back ? `<a class="hbtn back" href="${back}" aria-label="返回">‹</a>` : '<span class="hbtn"></span>'}
    <h1>${esc(title)}</h1>
    <div class="hright">${right}</div>
  </header>`;
}

const SYNC_LABEL = { ok: '已同步', pending: '同步中', error: '同步失敗', off: '僅本機' };

function badge(sync, okText) {
  const status = (sync && sync.status) || 'off';
  const title = sync && sync.error ? ` title="${esc(sync.error)}"` : '';
  return `<span class="badge ${status}"${title}>${status === 'ok' && okText ? okText : SYNC_LABEL[status]}</span>`;
}

function timeAgo(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `今天 ${formatTime(d)}`;
  return `${formatDate(d)} ${formatTime(d)}`;
}

let toastTimer;
function toast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `show ${type}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), type === 'error' ? 5000 : 2500);
}

function sheet(actions) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet">
      ${actions.map((a, i) => `<button data-i="${i}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
      <button data-i="-1" class="cancel">取消</button>
    </div>`;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn && e.target !== wrap) return;
    wrap.remove();
    const action = btn ? actions[Number(btn.dataset.i)] : null;
    if (action) action.run();
  });
  document.body.appendChild(wrap);
}

function hint(html) {
  return `<p class="hint">${html}</p>`;
}

// ---------- 同步 ----------

const settings = () => db().settings;
const onenoteReady = () => ms.isSignedIn() && Boolean(settings().onenote.sectionId);

async function syncTodo(todo) {
  if (!todoSync.isConfigured(settings())) {
    todo.sync = { status: 'off' };
    save();
    return;
  }
  todo.sync = { status: 'pending' };
  save();
  refreshCurrent?.();
  try {
    const remoteId = await todoSync.sendTodo(todo, settings());
    todo.sync = { status: 'ok', at: new Date().toISOString(), remoteId };
  } catch (e) {
    todo.sync = { status: 'error', error: e.message };
  }
  save();
  refreshCurrent?.();
  return todo.sync;
}

async function syncNote(note) {
  note.sync = { status: 'pending' };
  save();
  refreshCurrent?.();
  try {
    const page = await ms.createOneNotePage(note, settings());
    note.sync = { status: 'ok', at: new Date().toISOString(), remoteId: page.id, url: page.url };
    note.editedAfterSync = false;
  } catch (e) {
    note.sync = { status: 'error', error: e.message };
  }
  save();
  refreshCurrent?.();
  return note.sync;
}

async function retryPending() {
  if (!navigator.onLine) return;
  const todos = db().todos.filter((t) => t.sync && ['pending', 'error'].includes(t.sync.status));
  if (todoSync.isConfigured(settings())) for (const t of todos) await syncTodo(t);
  const notes = db().notes.filter((n) => n.sync && ['pending', 'error'].includes(n.sync.status));
  if (onenoteReady()) for (const n of notes) await syncNote(n);
}

function pendingCount() {
  const bad = (x) => x.sync && ['pending', 'error'].includes(x.sync.status);
  return db().todos.filter(bad).length + db().notes.filter(bad).length;
}

// ---------- 首頁 ----------

function viewHome() {
  const now = new Date();
  const openTodos = db().todos.filter((t) => !t.done).length;
  const upcoming = db()
    .events.filter((e) => new Date(e.end) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const pending = pendingCount();
  $app.innerHTML = `
    ${header('隨手記', { right: '<a class="hbtn" href="#/settings" aria-label="設定">⚙︎</a>' })}
    <main class="page home">
      <p class="today">${formatDate(now)}（${'日一二三四五六'[now.getDay()]}）</p>
      <a class="tile todo" href="#/todo">
        <span class="icon">✓</span>
        <span class="label"><b>待辦事項</b><small>${openTodos ? `${openTodos} 件未完成` : '寫下要做的事'}</small></span>
        <span class="chev">›</span>
      </a>
      <a class="tile note" href="#/notes">
        <span class="icon">✎</span>
        <span class="label"><b>筆記</b><small>${db().notes.length ? `共 ${db().notes.length} 篇` : '寫筆記、加標籤、送到 OneNote'}</small></span>
        <span class="chev">›</span>
      </a>
      <a class="tile event" href="#/events">
        <span class="icon">${now.getDate()}</span>
        <span class="label"><b>行程</b><small>${upcoming.length ? `下一個：${esc(upcoming[0].title)}` : '一句話加入行事曆'}</small></span>
        <span class="chev">›</span>
      </a>
      ${
        pending
          ? `<button class="banner" id="retry">${pending} 筆尚未同步，點此重試</button>`
          : ''
      }
    </main>`;
  document.getElementById('retry')?.addEventListener('click', async () => {
    await retryPending();
    toast(pendingCount() ? '仍有項目同步失敗，請檢查設定' : '全部同步完成');
    viewHome();
  });
}

// ---------- 待辦事項 ----------

function todoMeta(t) {
  const parts = [];
  if (t.due) parts.push(`截止 ${t.due.replace(/-/g, '/')}`);
  if (t.priority === 'high') parts.push('<em class="high">高優先</em>');
  if (t.priority === 'low') parts.push('低優先');
  if (t.tags && t.tags.length) parts.push(t.tags.map((x) => '#' + esc(x)).join(' '));
  return parts.join(' · ');
}

function todoItem(t) {
  return `<li class="item ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check" data-act="toggle" aria-label="完成">${t.done ? '✓' : ''}</button>
    <div class="body" data-act="more">
      <div class="title">${esc(t.title)}</div>
      <div class="meta">${todoMeta(t)}${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}</div>
    </div>
    <span data-act="more">${badge(t.sync)}</span>
  </li>`;
}

function bindTodoList(root, rerender) {
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const li = e.target.closest('li[data-id]');
    if (!act || !li) return;
    const todo = db().todos.find((t) => t.id === li.dataset.id);
    if (!todo) return;
    if (act.dataset.act === 'toggle') {
      todo.done = !todo.done;
      todo.doneAt = todo.done ? new Date().toISOString() : null;
      save();
      rerender();
      return;
    }
    const actions = [];
    if (todoSync.isConfigured(settings()) && (!todo.sync || todo.sync.status !== 'ok'))
      actions.push({ label: '重新同步到專案管理工具', run: () => syncTodo(todo).then((s) => s && toast(SYNC_LABEL[s.status], s.status === 'error' ? 'error' : 'info')) });
    if (todo.sync && todo.sync.error) actions.push({ label: `錯誤：${todo.sync.error}`, run: () => {} });
    actions.push({
      label: '刪除（僅刪除 App 內）',
      danger: true,
      run: () => {
        db().todos = db().todos.filter((t) => t !== todo);
        save();
        rerender();
      },
    });
    sheet(actions);
  });
}

function viewTodo() {
  const configured = todoSync.isConfigured(settings());
  const openCount = () => db().todos.filter((t) => !t.done).length;
  $app.innerHTML = `
    ${header('待辦事項', { back: '#/', right: `<a class="hbtn pill" href="#/todo/list">清單 <b id="count">${openCount()}</b></a>` })}
    <main class="page">
      <form id="form" class="card form">
        <textarea name="title" rows="3" placeholder="要做什麼？&#10;（一行一件，可一次輸入多件）" required></textarea>
        <div class="row">
          <label>截止日<input type="date" name="due"></label>
          <label>優先度
            <select name="priority"><option value="normal">一般</option><option value="high">高</option><option value="low">低</option></select>
          </label>
        </div>
        <input name="tags" placeholder="標籤（空白分隔，可留空）" autocomplete="off">
        <textarea name="note" rows="2" placeholder="備註（可留空）"></textarea>
        <button class="primary" type="submit">${configured ? '新增並同步' : '新增'}</button>
      </form>
      ${configured ? '' : hint('尚未設定專案管理工具，待辦只會存在 App 內。<a href="#/settings">前往設定</a>')}
      <h2 class="section">最近新增</h2>
      <ul class="list" id="recent"></ul>
      <a class="more" href="#/todo/list">查看全部清單 ›</a>
    </main>`;

  const recent = document.getElementById('recent');
  const renderRecent = () => {
    const items = [...db().todos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    recent.innerHTML = items.length ? items.map(todoItem).join('') : '<li class="empty">還沒有待辦事項</li>';
    document.getElementById('count').textContent = openCount();
  };
  refreshCurrent = renderRecent;
  renderRecent();
  bindTodoList(recent, renderRecent);

  const form = document.getElementById('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const titles = String(f.get('title')).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return;
    const created = titles.map((title) => ({
      id: uid(),
      title,
      note: String(f.get('note')).trim(),
      due: f.get('due') || null,
      priority: f.get('priority'),
      tags: splitTags(f.get('tags')),
      done: false,
      createdAt: new Date().toISOString(),
      sync: { status: configured ? 'pending' : 'off' },
    }));
    db().todos.push(...created);
    save();
    form.reset();
    renderRecent();
    toast(`已加入 ${created.length} 件待辦`);
    Promise.all(created.map(syncTodo)).then((results) => {
      const failed = results.filter((s) => s && s.status === 'error');
      if (failed.length) toast(`同步失敗：${failed[0].error}`, 'error');
      else if (configured) toast('已同步到專案管理工具');
    });
  });
  form.title.focus();
}

function viewTodoList() {
  $app.innerHTML = `
    ${header('待辦清單', { back: '#/todo', right: '<a class="hbtn" href="#/todo" aria-label="新增">＋</a>' })}
    <main class="page">
      <div class="seg" id="tabs">
        <button data-tab="open">未完成</button><button data-tab="done">已完成</button><button data-tab="all">全部</button>
      </div>
      <ul class="list" id="list"></ul>
    </main>`;
  const list = document.getElementById('list');
  const render = () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.todoTab));
    const items = db()
      .todos.filter((t) => (ui.todoTab === 'all' ? true : ui.todoTab === 'done' ? t.done : !t.done))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const rank = { high: 0, normal: 1, low: 2 };
        if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
        if ((a.due || '9') !== (b.due || '9')) return (a.due || '9').localeCompare(b.due || '9');
        return b.createdAt.localeCompare(a.createdAt);
      });
    list.innerHTML = items.length ? items.map(todoItem).join('') : '<li class="empty">這裡沒有項目</li>';
  };
  refreshCurrent = render;
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.todoTab = b.dataset.tab;
    render();
  });
  bindTodoList(list, render);
  render();
}

// ---------- 筆記 ----------

function allNoteTags() {
  const counts = new Map();
  db().notes.forEach((n) => (n.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function viewNoteEditor(id) {
  const existing = id ? db().notes.find((n) => n.id === id) : null;
  if (id && !existing) {
    location.hash = '#/notes/list';
    return;
  }
  let draft = null;
  if (!existing) {
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch {}
  }
  const note = existing || draft || { title: '', content: '', tags: [] };
  let tags = [...(note.tags || [])];
  const ready = onenoteReady();

  $app.innerHTML = `
    ${header(existing ? '編輯筆記' : '新筆記', {
      back: existing ? '#/notes/list' : '#/',
      right: `<a class="hbtn pill" href="#/notes/list">☰ 全部 <b>${db().notes.length}</b></a>`,
    })}
    <main class="page">
      <div class="card form editor">
        <input id="title" class="title-input" placeholder="標題" value="${esc(note.title)}">
        <div class="tags-input" id="tagbox">
          <span id="chips"></span>
          <input id="tagInput" placeholder="${tags.length ? '' : '＋ 加標籤'}" autocomplete="off" enterkeyhint="done">
        </div>
        <div class="suggest" id="suggest"></div>
        <textarea id="content" placeholder="開始寫筆記…">${esc(note.content)}</textarea>
      </div>
      <div id="status"></div>
      <div class="actions">
        ${
          ready
            ? '<button class="primary" id="send">儲存並送到 OneNote</button><button id="saveOnly">只儲存</button>'
            : '<button class="primary" id="saveOnly">儲存</button><button id="share">分享到 OneNote App…</button>'
        }
        ${existing ? '<button class="danger" id="delete">刪除筆記</button>' : ''}
      </div>
      ${ready ? '' : hint('尚未連結 OneNote，可先用「分享」手動送出。<a href="#/settings">前往設定 OneNote 自動同步</a>')}
    </main>`;

  const $ = (sel) => document.getElementById(sel);
  const titleEl = $('title');
  const contentEl = $('content');
  const tagInput = $('tagInput');

  const autosize = () => {
    contentEl.style.height = 'auto';
    contentEl.style.height = Math.max(240, contentEl.scrollHeight) + 'px';
  };

  const renderStatus = () => {
    const current = existing && db().notes.find((n) => n.id === existing.id);
    if (!current || !current.sync) return ($('status').innerHTML = '');
    const s = current.sync;
    $('status').innerHTML = `<p class="status-line">${badge(s, '已送到 OneNote')}
      ${s.at ? `<small>${timeAgo(s.at)}</small>` : ''}
      ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">在 OneNote 開啟</a>` : ''}
      ${s.error ? `<small class="err">${esc(s.error)}</small>` : ''}
      ${current.editedAfterSync ? '<small>（送出後有修改，再送一次會建立新頁面）</small>' : ''}</p>`;
  };

  const saveDraft = () => {
    if (existing) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: titleEl.value, content: contentEl.value, tags }));
  };

  const renderTags = () => {
    $('chips').innerHTML = tags.map((t, i) => `<button class="chip" data-i="${i}">#${esc(t)} ×</button>`).join('');
    tagInput.placeholder = tags.length ? '' : '＋ 加標籤';
    const sugg = allNoteTags().filter((t) => !tags.includes(t)).slice(0, 12);
    $('suggest').innerHTML = sugg.map((t) => `<button class="chip ghost" data-t="${esc(t)}">#${esc(t)}</button>`).join('');
  };

  const addTags = (text) => {
    splitTags(text).forEach((t) => !tags.includes(t) && tags.push(t));
    tagInput.value = '';
    renderTags();
    saveDraft();
  };

  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    tags.splice(Number(b.dataset.i), 1);
    renderTags();
    saveDraft();
  });
  $('suggest').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) addTags(b.dataset.t);
  });
  $('tagbox').addEventListener('click', (e) => e.target.id === 'tagbox' && tagInput.focus());
  tagInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 注音/拼音選字中
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTags(tagInput.value);
    } else if (e.key === 'Backspace' && !tagInput.value && tags.length) {
      tags.pop();
      renderTags();
      saveDraft();
    }
  });
  tagInput.addEventListener('input', () => /[\s,，、]$/.test(tagInput.value) && addTags(tagInput.value));
  tagInput.addEventListener('blur', () => tagInput.value.trim() && addTags(tagInput.value));
  titleEl.addEventListener('input', saveDraft);
  contentEl.addEventListener('input', () => {
    autosize();
    saveDraft();
  });

  const persist = () => {
    if (tagInput.value.trim()) addTags(tagInput.value);
    const title = titleEl.value.trim();
    const content = contentEl.value.trim();
    if (!title && !content) {
      toast('筆記是空的', 'error');
      return null;
    }
    const now = new Date().toISOString();
    let target = existing;
    if (target) {
      const changed = target.title !== title || target.content !== content || target.tags.join() !== tags.join();
      Object.assign(target, { title, content, tags: [...tags], updatedAt: now });
      if (changed && target.sync && target.sync.status === 'ok') target.editedAfterSync = true;
    } else {
      target = { id: uid(), title, content, tags: [...tags], createdAt: now, updatedAt: now, sync: { status: 'off' } };
      db().notes.push(target);
      localStorage.removeItem(DRAFT_KEY);
    }
    save();
    return target;
  };

  $('saveOnly').addEventListener('click', () => {
    const saved = persist();
    if (!saved) return;
    toast('已儲存');
    location.hash = existing ? '#/notes/list' : `#/notes/edit/${saved.id}`;
  });

  $('send')?.addEventListener('click', async (e) => {
    const saved = persist();
    if (!saved) return;
    e.target.disabled = true;
    e.target.textContent = '傳送中…';
    const result = await syncNote(saved);
    if (result.status === 'ok') {
      toast('已送到 OneNote');
      if (existing) location.hash = '#/notes/list';
      else if (/^#\/notes(\/new)?$/.test(location.hash)) viewNoteEditor(null); // 換成空白新筆記
      else location.hash = '#/notes/new';
    } else {
      toast(`送出失敗：${result.error}（已存在 App 內，稍後可重試）`, 'error');
      if (!existing) location.hash = `#/notes/edit/${saved.id}`;
      else {
        e.target.disabled = false;
        e.target.textContent = '儲存並送到 OneNote';
      }
    }
  });

  $('share')?.addEventListener('click', async () => {
    const saved = persist();
    if (!saved) return;
    const text = `${ms.onenoteTitle(saved)}\n${saved.tags.map((t) => '#' + t).join(' ')}\n\n${saved.content}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: ms.onenoteTitle(saved), text });
      } catch {}
    } else {
      await navigator.clipboard?.writeText(text);
      toast('已複製，可貼到 OneNote');
    }
    if (!existing) location.hash = `#/notes/edit/${saved.id}`;
  });

  $('delete')?.addEventListener('click', () =>
    sheet([
      {
        label: '刪除這篇筆記（OneNote 上的不會被刪）',
        danger: true,
        run: () => {
          db().notes = db().notes.filter((n) => n !== existing);
          save();
          location.hash = '#/notes/list';
        },
      },
    ])
  );

  refreshCurrent = renderStatus;
  renderTags();
  renderStatus();
  autosize();
  if (!existing) (note.title ? contentEl : titleEl).focus();
}

function viewNoteList() {
  $app.innerHTML = `
    ${header('全部筆記', { back: '#/', right: '<a class="hbtn" href="#/notes/new" aria-label="新筆記">＋</a>' })}
    <main class="page">
      <input type="search" id="q" class="search" placeholder="搜尋標題或內容" value="${esc(ui.noteQuery)}">
      <div class="tagbar" id="tagbar"></div>
      <ul class="list notes" id="list"></ul>
    </main>`;
  const list = document.getElementById('list');
  const tagbar = document.getElementById('tagbar');
  const render = () => {
    const tags = allNoteTags();
    if (ui.noteTag && !tags.includes(ui.noteTag)) ui.noteTag = '';
    tagbar.innerHTML = tags.length
      ? [`<button class="chip ${ui.noteTag ? 'ghost' : ''}" data-t="">全部</button>`]
          .concat(tags.map((t) => `<button class="chip ${ui.noteTag === t ? '' : 'ghost'}" data-t="${esc(t)}">#${esc(t)}</button>`))
          .join('')
      : '';
    const q = ui.noteQuery.toLowerCase();
    const items = db()
      .notes.filter((n) => !ui.noteTag || n.tags.includes(ui.noteTag))
      .filter((n) => !q || (n.title + '\n' + n.content).toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    list.innerHTML = items.length
      ? items
          .map(
            (n) => `<li><a class="item note-item" href="#/notes/edit/${n.id}">
              <div class="body">
                <div class="title">${esc(n.title || n.content.split('\n')[0] || '未命名筆記')}</div>
                <div class="snippet">${esc(n.content.slice(0, 80))}</div>
                <div class="meta">${timeAgo(n.updatedAt)} ${n.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
              </div>
              ${badge(n.sync, 'OneNote ✓')}
            </a></li>`
          )
          .join('')
      : `<li class="empty">${db().notes.length ? '沒有符合的筆記' : '還沒有筆記'}</li>`;
  };
  refreshCurrent = render;
  document.getElementById('q').addEventListener('input', (e) => {
    ui.noteQuery = e.target.value;
    render();
  });
  tagbar.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    ui.noteTag = b.dataset.t;
    render();
  });
  render();
}

// ---------- 行程 ----------

const MODE_TEXT = {
  shortcut: (s) => `透過捷徑「${s.shortcutName}」寫入 iPhone 行事曆`,
  ics: () => '開啟 iPhone「加入行事曆」畫面',
  outlook: () => '寫入公司 Outlook 行事曆（會同步到 iPhone 行事曆）',
};

function viewEvents() {
  const cfg = settings().calendar;
  $app.innerHTML = `
    ${header('行程', { back: '#/' })}
    <main class="page">
      <div class="card form">
        <textarea id="input" rows="3" placeholder="例如：&#10;2026/11/12 9:30-12:00 @會議室 [期末審查]&#10;2026/11/12 9:00-10:00 院前瞻期末報告會議"></textarea>
        <div class="row quick">
          <button id="template">插入格式</button>
          <button id="tomorrow">明天</button>
          <button id="clear">清除</button>
        </div>
      </div>
      <div id="preview"></div>
      <button class="primary wide" id="add" disabled>加入行事曆</button>
      <p class="hint center">${esc(MODE_TEXT[cfg.mode](cfg))}　<a href="#/settings">變更</a></p>
      <h2 class="section">最近加入</h2>
      <ul class="list" id="history"></ul>
      <details class="help">
        <summary>可以怎麼寫？</summary>
        <ul>
          <li>日期：<code>2026/11/12</code>、<code>11/12</code>、<code>115/11/12</code>（民國）、<code>11月12日</code>、<code>今天/明天/後天</code>、<code>週三</code>、<code>下週五</code></li>
          <li>時間：<code>9:30-12:00</code>、<code>9：30～12：00</code>、<code>下午2點半-4點</code>；只寫開始時間就用預設長度（${cfg.defaultDuration} 分鐘）；沒寫時間就是全天</li>
          <li>地點：<code>@地點</code>　名稱：<code>[會議名稱]</code>（沒括號時，剩下的文字就是名稱）</li>
          <li>標籤：<code>#專案A</code>（會寫進備註）</li>
        </ul>
      </details>
    </main>`;

  const $ = (id) => document.getElementById(id);
  const input = $('input');
  let parsed = null;

  const update = () => {
    const text = input.value.trim();
    parsed = text ? parseEvent(text, { defaultDuration: Number(cfg.defaultDuration) }) : null;
    $('add').disabled = !parsed || !parsed.ok;
    if (!parsed) return ($('preview').innerHTML = '');
    $('preview').innerHTML = parsed.ok
      ? `<div class="card preview">
          <div class="pv-title">${esc(parsed.title)}</div>
          <div>🕘 ${esc(formatRange(parsed))}</div>
          ${parsed.location ? `<div>📍 ${esc(parsed.location)}</div>` : ''}
          ${parsed.notes ? `<div>📝 ${esc(parsed.notes)}</div>` : ''}
          ${parsed.tags.length ? `<div>🏷 ${parsed.tags.map((t) => '#' + esc(t)).join(' ')}</div>` : ''}
        </div>`
      : `<div class="card preview bad">${parsed.errors.map((e) => `<div>⚠︎ ${esc(e)}</div>`).join('')}</div>`;
  };

  const insert = (text) => {
    input.value = text;
    input.focus();
    const pos = text.indexOf('@');
    if (pos >= 0) input.setSelectionRange(pos + 1, pos + 3);
    update();
  };

  $('template').addEventListener('click', () => insert(`${formatDate(new Date())} 09:00-10:00 @地點 [會議名稱]`));
  $('tomorrow').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    insert(`${formatDate(d)} ${input.value.replace(/^\s*\d{2,4}\/\d{1,2}\/\d{1,2}\s*/, '') || '09:00-10:00 @地點 [會議名稱]'}`);
  });
  $('clear').addEventListener('click', () => insert(''));
  input.addEventListener('input', update);

  const send = async (ev, record) => {
    try {
      if (cfg.mode === 'outlook') {
        record.sync = { status: 'pending' };
        renderHistory();
        record.sync = { status: 'ok', at: new Date().toISOString(), remoteId: await ms.createOutlookEvent(ev, settings()) };
        toast('已加入 Outlook 行事曆');
      } else if (cfg.mode === 'ics') {
        cal.openIcs(ev, record.id);
        record.sync = { status: 'ok', at: new Date().toISOString() };
      } else {
        record.sync = { status: 'ok', at: new Date().toISOString() };
        save();
        location.href = cal.shortcutUrl(ev, cfg.shortcutName);
      }
    } catch (e) {
      record.sync = { status: 'error', error: e.message };
      toast(`加入失敗：${e.message}`, 'error');
    }
    save();
    renderHistory();
  };

  $('add').addEventListener('click', () => {
    if (!parsed || !parsed.ok) return;
    const record = {
      id: uid(),
      text: input.value.trim(),
      title: parsed.title,
      location: parsed.location,
      notes: parsed.notes,
      tags: parsed.tags,
      allDay: parsed.allDay,
      start: parsed.start.toISOString(),
      end: parsed.end.toISOString(),
      createdAt: new Date().toISOString(),
      sync: { status: 'pending' },
    };
    db().events.push(record);
    save();
    const ev = parsed;
    input.value = '';
    update();
    send(ev, record);
  });

  const toEvent = (r) => ({ ...r, start: new Date(r.start), end: new Date(r.end), tags: r.tags || [] });
  const renderHistory = () => {
    const items = [...db().events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
    $('history').innerHTML = items.length
      ? items
          .map(
            (r) => `<li class="item" data-id="${r.id}">
              <div class="body">
                <div class="title">${esc(r.title)}</div>
                <div class="meta">${esc(formatRange(toEvent(r)))}${r.location ? ` · 📍${esc(r.location)}` : ''}</div>
              </div>
              ${badge(r.sync, cfg.mode === 'outlook' ? '已加入' : '已送出')}
            </li>`
          )
          .join('')
      : '<li class="empty">還沒有行程</li>';
  };
  $('history').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    const record = li && db().events.find((r) => r.id === li.dataset.id);
    if (!record) return;
    sheet([
      { label: '再加入一次行事曆', run: () => send(toEvent(record), record) },
      { label: '複製到輸入框修改', run: () => insert(record.text) },
      {
        label: '刪除紀錄（行事曆上的不會被刪）',
        danger: true,
        run: () => {
          db().events = db().events.filter((r) => r !== record);
          save();
          renderHistory();
        },
      },
    ]);
  });

  refreshCurrent = renderHistory;
  renderHistory();
  input.focus();
}

// ---------- 設定 ----------

function viewSettings() {
  const s = settings();
  const signedIn = ms.isSignedIn();
  $app.innerHTML = `
    ${header('設定', { back: '#/' })}
    <main class="page settings">
      <h2 class="section">待辦事項 → 專案管理工具</h2>
      <div class="card form">
        <label>Webhook 網址<input id="webhookUrl" type="url" placeholder="https://your-tool.example.com/api/todos" value="${esc(s.todo.webhookUrl)}"></label>
        <label>Token（選填，會以 Authorization: Bearer 送出）<input id="token" type="password" autocomplete="off" value="${esc(s.todo.token)}"></label>
        <button id="ping">測試連線</button>
      </div>
      ${hint('每新增一筆待辦，會 POST 一份 JSON 到這個網址。格式請見 README。')}

      <h2 class="section">Microsoft 帳號（OneNote${s.calendar.mode === 'outlook' ? '、Outlook' : ''}）</h2>
      <div class="card form">
        <label>Application (client) ID<input id="clientId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${esc(s.microsoft.clientId)}"></label>
        <label>租用戶（公司網域或 Tenant ID）<input id="tenant" placeholder="organizations" value="${esc(s.microsoft.tenant)}"></label>
        <label>重新導向 URI（註冊 App 時填這個）
          <div class="copy"><code id="redirect">${esc(ms.redirectUri())}</code><button id="copy">複製</button></div>
        </label>
        ${
          signedIn
            ? `<p class="status-line">已登入：<b>${esc(ms.account())}</b></p><button id="logout">登出</button>`
            : '<button class="primary" id="login">登入 Microsoft 帳號</button>'
        }
      </div>
      <div class="card form">
        <label>OneNote 統一筆記的分區
          <select id="section" ${signedIn ? '' : 'disabled'}>
            ${s.onenote.sectionId ? `<option value="${esc(s.onenote.sectionId)}">${esc(s.onenote.sectionName)}</option>` : '<option value="">（尚未選擇）</option>'}
          </select>
        </label>
        <button id="loadSections" ${signedIn ? '' : 'disabled'}>載入我的筆記本分區</button>
      </div>

      <h2 class="section">行程 → 行事曆</h2>
      <div class="card form">
        <label class="radio"><input type="radio" name="mode" value="shortcut" ${s.calendar.mode === 'shortcut' ? 'checked' : ''}>
          <span><b>iOS 捷徑（推薦）</b><small>按一下直接寫入 iPhone 行事曆，需先建立一次捷徑</small></span></label>
        <label class="radio"><input type="radio" name="mode" value="ics" ${s.calendar.mode === 'ics' ? 'checked' : ''}>
          <span><b>行事曆檔案（.ics）</b><small>不用設定，但每次要再按一次「加入」</small></span></label>
        <label class="radio"><input type="radio" name="mode" value="outlook" ${s.calendar.mode === 'outlook' ? 'checked' : ''}>
          <span><b>公司 Outlook 行事曆</b><small>用上方 Microsoft 帳號寫入；iPhone 已加入公司帳號就會同步顯示</small></span></label>
        <label>捷徑名稱<input id="shortcutName" value="${esc(s.calendar.shortcutName)}"></label>
        <label>只寫開始時間時的預設長度
          <select id="duration">${[30, 60, 90, 120].map((m) => `<option value="${m}" ${Number(s.calendar.defaultDuration) === m ? 'selected' : ''}>${m} 分鐘</option>`).join('')}</select>
        </label>
      </div>

      <h2 class="section">資料</h2>
      <div class="card form">
        <p class="status-line">待辦 ${db().todos.length}・筆記 ${db().notes.length}・行程 ${db().events.length}・未同步 ${pendingCount()}</p>
        <button id="retry">重試所有未同步項目</button>
        <button id="export">匯出備份（JSON）</button>
        <label class="file-btn">匯入備份<input type="file" id="import" accept="application/json"></label>
      </div>
      ${hint('資料都存在這支手機上。iOS 若長時間沒開 App 可能清除網頁資料，建議偶爾匯出備份。')}
    </main>`;

  const $ = (id) => document.getElementById(id);
  const bindField = (id, obj, key, after) =>
    $(id).addEventListener('change', (e) => {
      obj[key] = e.target.value.trim();
      save();
      after?.();
    });
  bindField('webhookUrl', s.todo, 'webhookUrl');
  bindField('token', s.todo, 'token');
  bindField('clientId', s.microsoft, 'clientId');
  bindField('tenant', s.microsoft, 'tenant');
  bindField('shortcutName', s.calendar, 'shortcutName');
  bindField('duration', s.calendar, 'defaultDuration');

  $('ping').addEventListener('click', async () => {
    if (!s.todo.webhookUrl) return toast('請先填入 Webhook 網址', 'error');
    try {
      await todoSync.ping(s);
      toast('連線成功');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ms.redirectUri());
      toast('已複製');
    } catch {
      toast('無法複製，請手動選取', 'error');
    }
  });

  $('login')?.addEventListener('click', async () => {
    try {
      await ms.signIn(s, '#/settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  $('logout')?.addEventListener('click', () => {
    ms.signOut();
    viewSettings();
  });

  $('loadSections').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = '載入中…';
    try {
      const sections = await ms.listSections(s);
      $('section').innerHTML =
        '<option value="">（請選擇）</option>' +
        sections.map((x) => `<option value="${esc(x.id)}" ${x.id === s.onenote.sectionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      toast(sections.length ? `找到 ${sections.length} 個分區` : '沒有找到分區，請先在 OneNote 建立', sections.length ? 'info' : 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.disabled = false;
    e.target.textContent = '載入我的筆記本分區';
  });
  $('section').addEventListener('change', (e) => {
    s.onenote.sectionId = e.target.value;
    s.onenote.sectionName = e.target.value ? e.target.selectedOptions[0].textContent : '';
    save();
    toast(e.target.value ? '已設定 OneNote 分區' : '已取消 OneNote 分區');
  });

  document.querySelectorAll('input[name=mode]').forEach((r) =>
    r.addEventListener('change', (e) => {
      const before = s.calendar.mode;
      s.calendar.mode = e.target.value;
      save();
      if (e.target.value === 'outlook' && before !== 'outlook' && ms.isSignedIn())
        toast('需要行事曆權限：請登出後重新登入一次', 'error');
      viewSettings();
    })
  );

  $('retry').addEventListener('click', async () => {
    await retryPending();
    toast(pendingCount() ? '仍有項目同步失敗' : '全部同步完成');
    viewSettings();
  });

  $('export').addEventListener('click', () => {
    const data = JSON.parse(JSON.stringify(db()));
    data.settings.todo.token = ''; // 備份檔不含 token
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `隨手記備份-${formatDate(new Date()).replace(/\//g, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });

  $('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.todos) || !Array.isArray(data.notes)) throw new Error();
      data.settings = { ...data.settings, todo: { ...data.settings?.todo, token: s.todo.token } };
      replaceAll(data);
      toast('已匯入');
      viewSettings();
    } catch {
      toast('檔案格式不正確', 'error');
    }
  });
}

// ---------- 路由 ----------

const routes = [
  [/^#\/?$/, viewHome],
  [/^#\/todo$/, viewTodo],
  [/^#\/todo\/list$/, viewTodoList],
  [/^#\/notes(?:\/new)?$/, () => viewNoteEditor(null)],
  [/^#\/notes\/list$/, viewNoteList],
  [/^#\/notes\/edit\/(.+)$/, (id) => viewNoteEditor(decodeURIComponent(id))],
  [/^#\/events$/, viewEvents],
  [/^#\/settings$/, viewSettings],
];

function render() {
  refreshCurrent = null;
  const hash = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      view(...m.slice(1));
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}

async function start() {
  try {
    if (await ms.handleRedirect(settings())) toast('Microsoft 登入成功');
  } catch (e) {
    toast(`登入失敗：${e.message}`, 'error');
  }
  window.addEventListener('hashchange', render);
  render();
  retryPending();
  window.addEventListener('online', retryPending);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
