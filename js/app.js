import { db, save, uid, replaceAll } from './store.js';
import { parseEvent, formatRange, formatDate, formatTime } from './parser.js';
import { icon } from './icons.js';
import { THEMES, MODES, themeById, applyTheme, effectiveMode } from './themes.js';
import { mountMascot, queueCheer } from './mascot.js';
import * as todoSync from './sync/todo.js';
import * as ms from './sync/microsoft.js';
import * as cal from './sync/calendar.js';

const $app = document.getElementById('app');
const DRAFT_KEY = 'tte.noteDraft';
const WEEK = '日一二三四五六';
let refreshCurrent = null; // 同步完成後只刷新目前頁面的局部區塊，避免清掉正在輸入的內容
const ui = { todoTab: 'open', noteTag: '', noteQuery: '' };

// ---------- 共用小工具 ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const settings = () => db().settings;
const featureVars = (key) => `--c: var(--${key}); --on-c: var(--on-${key})`;

function splitTags(text) {
  return [...new Set(String(text).split(/[\s,，、#]+/).map((t) => t.trim()).filter(Boolean))];
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((d - startOfToday()) / 86_400_000);
}

function shortTime(iso) {
  const d = new Date(iso);
  const diff = dayDiff(d);
  if (diff === 0) return formatTime(d);
  if (diff === -1) return '昨天';
  if (diff > -7) return `週${WEEK[d.getDay()]}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function longDate(d) {
  const h = d.getHours();
  const period = h < 12 ? '上午' : '下午';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${period}${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dueInfo(due) {
  if (!due) return null;
  const diff = dayDiff(new Date(`${due}T00:00`));
  const d = new Date(`${due}T00:00`);
  if (diff < 0) return { text: `逾期 ${-diff} 天`, cls: 'overdue', diff };
  if (diff === 0) return { text: '今天', cls: 'today', diff };
  if (diff === 1) return { text: '明天', cls: '', diff };
  if (diff < 7) return { text: `週${WEEK[d.getDay()]}`, cls: '', diff };
  return { text: `${d.getMonth() + 1}月${d.getDate()}日`, cls: '', diff };
}

function nav({ back, backLabel = '返回', title = '', actions = '', staticTitle = false } = {}) {
  return `<header class="nav${staticTitle ? ' static' : ''}">
    ${back ? `<a class="nav-back" href="${back}">${icon('chevronLeft')}<span>${esc(backLabel)}</span></a>` : '<span></span>'}
    <div class="nav-title">${esc(title)}</div>
    <div class="nav-actions">${actions}</div>
  </header>`;
}

function updateNav() {
  const bar = document.querySelector('.nav');
  if (!bar) return;
  const title = document.querySelector('.large-title');
  const limit = title ? title.offsetTop + title.offsetHeight - bar.offsetHeight : 0;
  bar.classList.toggle('scrolled', window.scrollY > Math.max(4, limit));
}

function syncIcon(sync) {
  const status = sync && sync.status;
  if (status === 'ok') return `<span class="sync ok" title="已同步">${icon('checkCircle')}</span>`;
  if (status === 'pending') return `<span class="sync pending" title="同步中">${icon('spinner', 'spin')}</span>`;
  if (status === 'error') return `<span class="sync error" title="${esc(sync.error || '同步失敗')}">${icon('alert')}</span>`;
  return '';
}

let toastTimer;
function toast(message, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = type === 'error' ? 'error' : '';
  el.innerHTML = `<span class="ti">${icon(type === 'error' ? 'xmark' : 'check')}</span><span>${esc(message)}</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 4500 : 2200);
}

function sheet(actions, title = '') {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet">
      <div class="sheet-group">
        ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
        ${actions.map((a, i) => `<button data-i="${i}" class="${a.danger ? 'danger' : ''} ${title ? 'after-title' : ''}">${esc(a.label)}</button>`).join('')}
      </div>
      <div class="sheet-group cancel"><button data-i="-1">取消</button></div>
    </div>`;
  const close = (action) => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 300);
    if (action) action.run();
  };
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) close(actions[Number(btn.dataset.i)]);
    else if (e.target === wrap) close(null);
  });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
}

function autosize(el, min = 0) {
  el.style.height = 'auto';
  el.style.height = Math.max(min, el.scrollHeight) + 'px';
}

// ---------- 同步 ----------

const onenoteReady = () => ms.isSignedIn() && Boolean(settings().onenote.sectionId);

async function syncTodo(todo) {
  if (!todoSync.isConfigured(settings())) {
    todo.sync = { status: 'off' };
    save();
    return todo.sync;
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

// ---------- 待辦：共用列 ----------

function todoRow(t) {
  const due = dueInfo(t.due);
  const meta = [];
  if (due) meta.push(`<span class="${due.cls}">${icon('calendar')}${due.text}</span>`);
  if (t.priority === 'low') meta.push('<span>低優先</span>');
  if (t.tags && t.tags.length) meta.push(`<span class="tagtxt" style="--c: var(--todo)">${t.tags.map((x) => '#' + esc(x)).join(' ')}</span>`);
  return `<li class="${t.done ? 'done' : ''}" data-id="${t.id}">
    <div class="cell task">
      <button class="check" data-act="toggle" aria-label="${t.done ? '標為未完成' : '完成'}">${icon('check')}</button>
      <div class="task-body" data-act="more">
        <div class="task-title">${t.priority === 'high' ? '<span class="prio">!!</span>' : ''}${esc(t.title)}</div>
        ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
        ${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ''}
      </div>
      <span data-act="more">${syncIcon(t.sync)}</span>
    </div>
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
      li.classList.toggle('done', todo.done); // 先播勾選動畫，再重排
      if (todo.done) queueCheer(['完成一件！太強了', '又少一件～', '好耶！清掉了', '做得好！'][Math.floor(Math.random() * 4)]);
      setTimeout(rerender, 450);
      return;
    }
    const actions = [];
    if (todoSync.isConfigured(settings()) && (!todo.sync || todo.sync.status !== 'ok'))
      actions.push({
        label: '重新同步',
        run: () => syncTodo(todo).then((s) => toast(s.status === 'ok' ? '已同步' : `同步失敗：${s.error}`, s.status === 'error' ? 'error' : 'ok')),
      });
    actions.push({
      label: '刪除',
      danger: true,
      run: () => {
        db().todos = db().todos.filter((t) => t !== todo);
        save();
        rerender();
      },
    });
    const title = todo.sync && todo.sync.error ? `同步失敗：${todo.sync.error}` : todo.title;
    sheet(actions, title);
  });
}

// ---------- 首頁 ----------

function viewHome() {
  const now = new Date();
  const todos = db().todos;
  const open = todos.filter((t) => !t.done);
  const focus = open
    .filter((t) => (t.due && dueInfo(t.due).diff <= 0) || t.priority === 'high')
    .sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))
    .slice(0, 4);
  const upcoming = db()
    .events.filter((e) => new Date(e.end) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 3);
  const pending = pendingCount();

  $app.innerHTML = `
    ${nav({
      title: 'Beamup',
      actions: `<a class="icon-btn" href="#/appearance" aria-label="外觀">${icon('palette')}</a>
                <a class="icon-btn" href="#/settings" aria-label="設定">${icon('gear')}</a>`,
    })}
    <main class="page">
      <p class="eyebrow">${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}</p>
      <h1 class="large-title brand">Beamup</h1>

      <section class="stage-card" aria-label="Blip">
        <div class="stage" id="stage"></div>
        <div class="stage-cap"><b>Blip</b><span id="blipStatus"></span><span class="pokes" id="blipPokes"></span></div>
      </section>

      <div class="tiles">
        <a class="tile" href="#/todo" style="${featureVars('todo')}">
          <div class="tile-head"><span class="tile-icon">${icon('checklist')}</span><span class="tile-count">${open.length}</span></div>
          <div class="tile-name">待辦事項<small>${open.length ? `${open.length} 件未完成` : '寫下要做的事'}</small></div>
        </a>
        <a class="tile" href="#/notes" style="${featureVars('note')}">
          <div class="tile-head"><span class="tile-icon">${icon('note')}</span><span class="tile-count">${db().notes.length}</span></div>
          <div class="tile-name">筆記<small>${db().notes.length ? '寫下想法・送到 OneNote' : '開始第一篇筆記'}</small></div>
        </a>
        <a class="tile wide" href="#/events" style="${featureVars('event')}">
          <div class="tile-head">
            <span class="tile-icon day">${now.getDate()}</span>
            <span class="tile-name">行程</span>
            ${icon('chevronRight', 'chev')}
          </div>
          <div class="upcoming">
            ${
              upcoming.length
                ? upcoming
                    .map((e) => {
                      const s = new Date(e.start);
                      const d = dayDiff(s);
                      const when = d === 0 ? '今天' : d === 1 ? '明天' : `${s.getMonth() + 1}/${s.getDate()}（${WEEK[s.getDay()]}）`;
                      return `<div class="up-row"><span class="bar"></span><div class="t"><b>${esc(e.title)}</b>
                        <small>${when}${e.allDay ? ' 全天' : ' ' + formatTime(s)}${e.location ? ` · ${esc(e.location)}` : ''}</small></div></div>`;
                    })
                    .join('')
                : `<div class="up-empty">一句話加入行事曆，例如「明天 14:00 開會」</div>`
            }
          </div>
        </a>
      </div>

      ${
        pending
          ? `<button class="notice" id="retry">${icon('alert')}<span>${pending} 筆尚未同步</span><b>重試</b></button>`
          : ''
      }

      ${
        focus.length
          ? `<h2 class="group-header big">今天要做<a href="#/todo/list">全部</a></h2>
             <ul class="group rows" id="focus">${focus.map(todoRow).join('')}</ul>`
          : ''
      }
    </main>`;

  document.getElementById('retry')?.addEventListener('click', async () => {
    await retryPending();
    toast(pendingCount() ? '仍有項目同步失敗，請檢查設定' : '全部同步完成', pendingCount() ? 'error' : 'ok');
    viewHome();
  });
  const focusEl = document.getElementById('focus');
  if (focusEl) bindTodoList(focusEl, viewHome);

  mountMascot(document.getElementById('stage'), {
    status: document.getElementById('blipStatus'),
    counter: document.getElementById('blipPokes'),
    lines: () => {
      const list = [];
      const openNow = db().todos.filter((t) => !t.done);
      const overdue = openNow.filter((t) => t.due && dueInfo(t.due).diff < 0).length;
      if (overdue) list.push(`有 ${overdue} 件待辦逾期了！`);
      list.push(openNow.length ? `還有 ${openNow.length} 件待辦，加油！` : '待辦都清空了，好厲害！');
      const nextEv = db()
        .events.filter((e) => new Date(e.end) >= new Date())
        .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
      if (nextEv) {
        const d = dayDiff(new Date(nextEv.start));
        list.push(`${d === 0 ? '今天' : d === 1 ? '明天' : '之後'}有「${nextEv.title}」`);
      }
      if (db().notes.length) list.push(`已經寫了 ${db().notes.length} 篇筆記囉`);
      return list;
    },
  });
}

// ---------- 待辦事項 ----------

function viewTodo() {
  const configured = todoSync.isConfigured(settings());
  const openCount = () => db().todos.filter((t) => !t.done).length;
  let priority = 'normal';

  $app.innerHTML = `
    ${nav({
      back: '#/',
      backLabel: 'Beamup',
      title: '待辦事項',
      actions: `<a class="pill-btn" href="#/todo/list">${icon('list')}清單<span class="count" id="count">${openCount()}</span></a>`,
    })}
    <main class="page" style="${featureVars('todo')}">
      <h1 class="large-title">待辦事項</h1>
      <form id="form">
        <div class="composer">
          <textarea name="title" rows="1" placeholder="新增待辦…" enterkeyhint="enter" required></textarea>
          <div class="composer-foot"><span>一行一件，可一次輸入多件</span></div>
        </div>

        <ul class="group icons" style="margin-top:16px">
          <li class="cell">
            <span class="cell-icon" style="--c: var(--event); --on-c: var(--on-event)">${icon('calendar')}</span>
            <span class="cell-label">截止日</span>
            <label class="value-pill empty-val" id="duePill"><span id="dueText">未設定</span><input type="date" name="due" aria-label="截止日"></label>
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--note); --on-c: var(--on-note)">${icon('flag')}</span>
            <span class="cell-label">優先度</span>
            <div class="seg small" id="prio">
              <button type="button" data-p="low">低</button><button type="button" data-p="normal" class="on">一般</button><button type="button" data-p="high">高</button>
            </div>
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--todo); --on-c: var(--on-todo)">${icon('tag')}</span>
            <input name="tags" placeholder="標籤（空白分隔）" autocomplete="off">
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--gray)">${icon('text')}</span>
            <input name="note" placeholder="備註" autocomplete="off">
          </li>
        </ul>

        <button class="btn btn-primary" type="submit" style="margin-top:20px">${icon(configured ? 'send' : 'plus')}${configured ? '新增並同步' : '新增'}</button>
      </form>
      ${configured ? '' : `<p class="caption">尚未連結專案管理工具，待辦只會存在 App 內 · <a href="#/settings">設定</a></p>`}

      <h2 class="group-header big">最近新增<a href="#/todo/list">全部</a></h2>
      <ul class="group rows" id="recent"></ul>
    </main>`;

  const form = document.getElementById('form');
  const recent = document.getElementById('recent');
  const titleEl = form.title;
  const dueInput = form.due;

  const renderRecent = () => {
    const items = [...db().todos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    recent.innerHTML = items.length
      ? items.map(todoRow).join('')
      : `<li class="empty">${icon('checklist')}還沒有待辦事項</li>`;
    document.getElementById('count').textContent = openCount();
  };
  refreshCurrent = renderRecent;
  renderRecent();
  bindTodoList(recent, renderRecent);

  const renderDue = () => {
    const info = dueInfo(dueInput.value);
    document.getElementById('dueText').textContent = info ? `${dueInput.value.replace(/-/g, '/')}（${info.text}）` : '未設定';
    document.getElementById('duePill').classList.toggle('empty-val', !info);
  };
  dueInput.addEventListener('change', renderDue);

  document.getElementById('prio').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    priority = b.dataset.p;
    document.querySelectorAll('#prio button').forEach((x) => x.classList.toggle('on', x === b));
  });

  titleEl.addEventListener('input', () => autosize(titleEl, 56));

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
      priority,
      tags: splitTags(f.get('tags')),
      done: false,
      createdAt: new Date().toISOString(),
      sync: { status: configured ? 'pending' : 'off' },
    }));
    db().todos.push(...created);
    save();
    form.reset();
    autosize(titleEl, 56);
    renderDue();
    renderRecent();
    if (!configured) toast(`已加入 ${created.length} 件待辦`);
    Promise.all(created.map(syncTodo)).then((results) => {
      const failed = results.filter((s) => s && s.status === 'error');
      if (failed.length) toast(`同步失敗：${failed[0].error}`, 'error');
      else if (configured) toast(`已加入並同步 ${created.length} 件`);
      queueCheer(failed.length ? '有待辦沒傳出去，等等再試' : `收到 ${created.length} 件待辦！`);
    });
  });
  titleEl.focus();
}

function groupTodos(items) {
  const groups = [
    ['逾期', []],
    ['今天', []],
    ['明天', []],
    ['之後', []],
    ['未排定', []],
  ];
  for (const t of items) {
    const info = dueInfo(t.due);
    const idx = !info ? 4 : info.diff < 0 ? 0 : info.diff === 0 ? 1 : info.diff === 1 ? 2 : 3;
    groups[idx][1].push(t);
  }
  const rank = { high: 0, normal: 1, low: 2 };
  for (const [, list] of groups)
    list.sort((a, b) => (a.due || '').localeCompare(b.due || '') || rank[a.priority] - rank[b.priority] || b.createdAt.localeCompare(a.createdAt));
  return groups.filter(([, list]) => list.length);
}

function viewTodoList() {
  $app.innerHTML = `
    ${nav({ back: '#/todo', backLabel: '待辦事項', title: '清單', actions: `<a class="icon-btn" href="#/todo" aria-label="新增">${icon('plus')}</a>` })}
    <main class="page" style="${featureVars('todo')}">
      <h1 class="large-title">清單</h1>
      <div class="seg" id="tabs"><button data-tab="open">未完成</button><button data-tab="done">已完成</button><button data-tab="all">全部</button></div>
      <div id="list"></div>
    </main>`;
  const list = document.getElementById('list');
  const render = () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.todoTab));
    const open = db().todos.filter((t) => !t.done);
    const done = db().todos.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    let sections = [];
    if (ui.todoTab !== 'done') sections = groupTodos(open);
    if (ui.todoTab !== 'open' && done.length) sections.push(['已完成', done]);
    list.innerHTML = sections.length
      ? sections
          .map(([name, items]) => `<h2 class="group-header">${name}<span>${items.length}</span></h2><ul class="group rows">${items.map(todoRow).join('')}</ul>`)
          .join('')
      : `<div class="group" style="margin-top:20px"><div class="empty">${icon('checkCircle')}${ui.todoTab === 'done' ? '還沒有完成的項目' : '全部完成了！'}</div></div>`;
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
  const tags = [...(note.tags || [])];
  const ready = onenoteReady();
  const created = existing ? new Date(existing.createdAt) : new Date();

  $app.innerHTML = `
    ${nav({
      back: existing ? '#/notes/list' : '#/',
      backLabel: existing ? '筆記' : 'Beamup',
      actions: `<a class="icon-btn" href="#/notes/list" aria-label="全部筆記">${icon('list')}</a>
                ${existing ? `<button class="icon-btn" id="more" aria-label="更多">${icon('ellipsis')}</button>` : ''}`,
    })}
    <main class="page has-toolbar" style="${featureVars('note')}">
      <p class="note-date">${longDate(created)}</p>
      <div id="status"></div>
      <input id="title" class="note-title" placeholder="標題" value="${esc(note.title)}" autocomplete="off">
      <div class="tagrow" id="tagrow"></div>
      <div class="suggest" id="suggest"></div>
      <textarea id="content" class="note-body" placeholder="開始書寫…">${esc(note.content)}</textarea>
    </main>
    <footer class="toolbar">
      ${
        ready
          ? `<button class="text-btn" id="saveOnly">只儲存</button>
             <span class="spacer"></span>
             <button class="capsule primary" id="send">${icon('send')}送到 OneNote</button>`
          : `<button class="icon-btn plain" id="share" aria-label="分享到 OneNote App">${icon('share')}</button>
             <span class="spacer"><a href="#/settings">連結 OneNote 自動同步</a></span>
             <button class="capsule primary" id="saveOnly">${icon('check')}儲存</button>`
      }
    </footer>`;

  const $ = (sel) => document.getElementById(sel);
  const titleEl = $('title');
  const contentEl = $('content');

  const renderStatus = () => {
    const current = existing && db().notes.find((n) => n.id === existing.id);
    const s = current && current.sync;
    if (!s || s.status === 'off') return ($('status').innerHTML = '');
    if (s.status === 'pending') return ($('status').innerHTML = `<p class="sync-pill">${icon('spinner', 'spin')}傳送到 OneNote…</p>`);
    if (s.status === 'error') return ($('status').innerHTML = `<p class="sync-pill error">${icon('alert')}送出失敗：${esc(s.error)}</p>`);
    $('status').innerHTML = `<p class="sync-pill ok">${icon('checkCircle')}已送到 OneNote · ${shortTime(s.at)}
      ${s.url ? `· <a href="${esc(s.url)}" target="_blank" rel="noopener">開啟</a>` : ''}
      ${current.editedAfterSync ? '· 之後有修改' : ''}</p>`;
  };

  const saveDraft = () => {
    if (existing) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: titleEl.value, content: contentEl.value, tags }));
  };

  const renderTags = () => {
    $('tagrow').innerHTML =
      tags.map((t, i) => `<button class="chip" data-i="${i}">#${esc(t)}${icon('xmark')}</button>`).join('') +
      `<label class="tag-entry">${icon('tag')}<input id="tagInput" placeholder="加標籤" autocomplete="off" enterkeyhint="done"></label>`;
    const sugg = allNoteTags().filter((t) => !tags.includes(t)).slice(0, 12);
    $('suggest').innerHTML = sugg.map((t) => `<button class="chip ghost" data-t="${esc(t)}">#${esc(t)}</button>`).join('');
    bindTagInput();
  };

  const addTags = (text, refocus = true) => {
    const before = tags.length;
    splitTags(text).forEach((t) => !tags.includes(t) && tags.push(t));
    if (tags.length === before) {
      $('tagInput').value = '';
      return;
    }
    renderTags();
    saveDraft();
    if (refocus) $('tagInput').focus();
  };

  function bindTagInput() {
    const input = $('tagInput');
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 注音/拼音選字中
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        e.preventDefault();
        addTags(input.value);
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        tags.pop();
        renderTags();
        saveDraft();
        $('tagInput').focus();
      }
    });
    input.addEventListener('input', () => /[\s,，、]$/.test(input.value) && addTags(input.value));
    input.addEventListener('blur', () => input.value.trim() && addTags(input.value, false));
  }

  $('tagrow').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    tags.splice(Number(b.dataset.i), 1);
    renderTags();
    saveDraft();
  });
  $('suggest').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) addTags(b.dataset.t, false);
  });
  titleEl.addEventListener('input', saveDraft);
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      contentEl.focus();
    }
  });
  contentEl.addEventListener('input', () => {
    autosize(contentEl);
    saveDraft();
  });

  const persist = () => {
    const pendingTag = $('tagInput').value;
    if (pendingTag.trim()) addTags(pendingTag, false);
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
    const btn = e.currentTarget;
    const saved = persist();
    if (!saved) return;
    btn.disabled = true;
    btn.innerHTML = `${icon('spinner', 'spin')}傳送中`;
    const result = await syncNote(saved);
    if (result.status === 'ok') {
      toast('已送到 OneNote');
      queueCheer('筆記傳上 OneNote 了！');
      if (existing) location.hash = '#/notes/list';
      else if (/^#\/notes(\/new)?$/.test(location.hash)) viewNoteEditor(null); // 換成空白新筆記
      else location.hash = '#/notes/new';
    } else {
      toast(`送出失敗：${result.error}`, 'error');
      if (!existing) location.hash = `#/notes/edit/${saved.id}`;
      else {
        btn.disabled = false;
        btn.innerHTML = `${icon('send')}送到 OneNote`;
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

  $('more')?.addEventListener('click', () => {
    const actions = [];
    if (existing.sync && existing.sync.url) actions.push({ label: '在 OneNote 開啟', run: () => window.open(existing.sync.url, '_blank') });
    if (ready && existing.sync && existing.sync.status === 'ok')
      actions.push({ label: '再送一次（建立新頁面）', run: () => $('send').click() });
    actions.push({
      label: '刪除筆記',
      danger: true,
      run: () => {
        db().notes = db().notes.filter((n) => n !== existing);
        save();
        toast('已刪除');
        location.hash = '#/notes/list';
      },
    });
    sheet(actions, 'OneNote 上已送出的頁面不會被刪除');
  });

  refreshCurrent = renderStatus;
  renderTags();
  renderStatus();
  autosize(contentEl);
  if (!existing) (note.title ? contentEl : titleEl).focus();
}

function noteGroups(notes) {
  const groups = new Map();
  for (const n of notes) {
    const d = new Date(n.updatedAt);
    const diff = dayDiff(d);
    const key =
      diff === 0 ? '今天' : diff === -1 ? '昨天' : diff > -7 ? '過去 7 天' : diff > -30 ? '過去 30 天' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return [...groups.entries()];
}

function viewNoteList() {
  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: '筆記' })}
    <main class="page has-toolbar" style="${featureVars('note')}">
      <h1 class="large-title">筆記</h1>
      <label class="search">${icon('search')}<input type="search" id="q" placeholder="搜尋" value="${esc(ui.noteQuery)}"></label>
      <div class="chipbar" id="tagbar"></div>
      <div id="list"></div>
    </main>
    <footer class="toolbar">
      <span style="width:34px"></span>
      <span class="spacer" id="total"></span>
      <a class="icon-btn plain" href="#/notes/new" aria-label="新筆記" style="color: var(--note)">${icon('note')}</a>
    </footer>`;
  const list = document.getElementById('list');
  const tagbar = document.getElementById('tagbar');
  const render = () => {
    const tags = allNoteTags();
    if (ui.noteTag && !tags.includes(ui.noteTag)) ui.noteTag = '';
    tagbar.innerHTML = tags.length
      ? [`<button class="chip ${ui.noteTag ? 'ghost' : 'on'}" data-t="">全部</button>`]
          .concat(tags.map((t) => `<button class="chip ${ui.noteTag === t ? 'on' : 'ghost'}" data-t="${esc(t)}">#${esc(t)}</button>`))
          .join('')
      : '';
    const q = ui.noteQuery.toLowerCase();
    const items = db()
      .notes.filter((n) => !ui.noteTag || n.tags.includes(ui.noteTag))
      .filter((n) => !q || (n.title + '\n' + n.content + '\n' + n.tags.join(' ')).toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    document.getElementById('total').textContent = `${db().notes.length} 則筆記`;
    list.innerHTML = items.length
      ? noteGroups(items)
          .map(
            ([name, notes]) => `<h2 class="group-header">${name}</h2><ul class="group">${notes
              .map((n) => {
                const lines = n.content.split('\n').map((s) => s.trim()).filter(Boolean);
                const title = n.title || lines[0] || '未命名筆記';
                const snippet = (n.title ? lines[0] : lines[1]) || '沒有其他內容';
                return `<li><a class="cell note-row tap" href="#/notes/edit/${n.id}">
                  <div class="head"><b>${esc(title)}</b>${syncIcon(n.sync)}</div>
                  <p><time>${shortTime(n.updatedAt)}</time>${esc(snippet)}</p>
                  ${n.tags.length ? `<div class="tags">${n.tags.map((t) => '#' + esc(t)).join('  ')}</div>` : ''}
                </a></li>`;
              })
              .join('')}</ul>`
          )
          .join('')
      : `<div class="group" style="margin-top:8px"><div class="empty">${icon('note')}${db().notes.length ? '沒有符合的筆記' : '還沒有筆記，點右下角開始寫'}</div></div>`;
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
  outlook: () => '寫入公司 Outlook 行事曆',
};

function datebox(d, mini = false) {
  return `<div class="datebox${mini ? ' mini' : ''}"><small>${d.getMonth() + 1}月</small><b>${d.getDate()}</b>${mini ? '' : `<span>週${WEEK[d.getDay()]}</span>`}</div>`;
}

function viewEvents() {
  const cfg = settings().calendar;
  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: '行程' })}
    <main class="page" style="${featureVars('event')}">
      <h1 class="large-title">行程</h1>
      <div class="composer">
        <textarea id="input" rows="2" placeholder="2026/11/12 9:30-12:00 @會議室 [期末審查]"></textarea>
        <div class="quick">
          <button class="capsule" id="template">${icon('sparkles')}插入格式</button>
          <button class="capsule" id="today">今天</button>
          <button class="capsule" id="tomorrow">明天</button>
          <button class="capsule push" id="clear" aria-label="清除">${icon('xmark')}</button>
        </div>
      </div>
      <div id="preview"></div>
      <div class="ev-actions">
        <button class="btn btn-primary" id="add" disabled>${icon('calendarPlus')}加入行事曆</button>
        <p class="caption">${esc(MODE_TEXT[cfg.mode](cfg))} · <a href="#/settings">變更</a></p>
      </div>

      <h2 class="group-header big">最近加入</h2>
      <ul class="group" id="history"></ul>

      <details class="help">
        <summary>${icon('chevronRight')}可以怎麼寫？</summary>
        <div class="group">
          <dl>
            <dt>日期</dt><dd><code>2026/11/12</code> <code>11/12</code> <code>115/11/12</code> <code>11月12日</code> <code>明天</code> <code>下週五</code></dd>
            <dt>時間</dt><dd><code>9:30-12:00</code> <code>9：30～12：00</code> <code>下午2點半-4點</code><br>只寫開始時間＝預設 ${cfg.defaultDuration} 分鐘；沒寫時間＝全天</dd>
            <dt>地點與名稱</dt><dd><code>@地點</code> <code>[會議名稱]</code>，沒有括號時剩下的文字就是名稱</dd>
            <dt>標籤</dt><dd><code>#專案A</code> 會寫進備註</dd>
          </dl>
        </div>
      </details>
    </main>`;

  const $ = (id) => document.getElementById(id);
  const input = $('input');
  let parsed = null;

  const update = () => {
    autosize(input, 56);
    const text = input.value.trim();
    parsed = text ? parseEvent(text, { defaultDuration: Number(cfg.defaultDuration) }) : null;
    $('add').disabled = !parsed || !parsed.ok;
    if (!parsed) return ($('preview').innerHTML = '');
    if (!parsed.ok) {
      $('preview').innerHTML = `<div class="event-card bad">${parsed.errors.map((e) => `<div class="ev-line">${icon('alert')}<span>${esc(e)}</span></div>`).join('')}</div>`;
      return;
    }
    const time = parsed.allDay ? '全天' : `${formatTime(parsed.start)} – ${formatTime(parsed.end)}`;
    $('preview').innerHTML = `<div class="event-card">
        ${datebox(parsed.start)}
        <div class="ev-body">
          <div class="ev-title">${esc(parsed.title)}</div>
          <div class="ev-line">${icon('clock')}<span>${time}</span></div>
          ${parsed.location ? `<div class="ev-line">${icon('pin')}<span>${esc(parsed.location)}</span></div>` : ''}
          ${parsed.notes ? `<div class="ev-line">${icon('text')}<span>${esc(parsed.notes)}</span></div>` : ''}
          ${parsed.tags.length ? `<div class="ev-line">${icon('tag')}<span>${parsed.tags.map((t) => '#' + esc(t)).join(' ')}</span></div>` : ''}
        </div>
      </div>`;
  };

  const insert = (text) => {
    input.value = text;
    input.focus();
    const pos = text.indexOf('@地點');
    if (pos >= 0) input.setSelectionRange(pos + 1, pos + 3);
    update();
  };
  const withDate = (d) => {
    const rest = input.value.replace(/^\s*(\d{2,4}\/\d{1,2}\/\d{1,2}|今天|明天|後天)\s*/, '');
    insert(`${formatDate(d)} ${rest || '09:00-10:00 @地點 [會議名稱]'}`);
  };

  $('template').addEventListener('click', () => insert(`${formatDate(new Date())} 09:00-10:00 @地點 [會議名稱]`));
  $('today').addEventListener('click', () => withDate(new Date()));
  $('tomorrow').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    withDate(d);
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
    queueCheer(`「${ev.title}」排進行事曆了`);
    input.value = '';
    update();
    send(ev, record);
  });

  const toEvent = (r) => ({ ...r, start: new Date(r.start), end: new Date(r.end), tags: r.tags || [] });
  const renderHistory = () => {
    const items = [...db().events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
    $('history').innerHTML = items.length
      ? items
          .map((r) => {
            const ev = toEvent(r);
            const time = ev.allDay ? '全天' : `${formatTime(ev.start)} – ${formatTime(ev.end)}`;
            return `<li data-id="${r.id}"><div class="cell ev-row tap">
              ${datebox(ev.start, true)}
              <div class="t"><b>${esc(r.title)}</b><small>週${WEEK[ev.start.getDay()]} ${time}${r.location ? ` · ${esc(r.location)}` : ''}</small></div>
              ${syncIcon(r.sync)}
            </div></li>`;
          })
          .join('')
      : `<li class="empty">${icon('calendar')}還沒有行程</li>`;
  };
  $('history').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    const record = li && db().events.find((r) => r.id === li.dataset.id);
    if (!record) return;
    sheet(
      [
        { label: '再加入一次行事曆', run: () => send(toEvent(record), record) },
        { label: '複製到輸入框修改', run: () => insert(record.text) },
        {
          label: '刪除紀錄',
          danger: true,
          run: () => {
            db().events = db().events.filter((r) => r !== record);
            save();
            renderHistory();
          },
        },
      ],
      `${record.title}・${formatRange(toEvent(record))}`
    );
  });

  refreshCurrent = renderHistory;
  renderHistory();
  input.focus();
}

// ---------- 外觀 ----------

function viewAppearance() {
  const ap = settings().appearance;
  const mode = effectiveMode(ap.mode);
  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: '外觀' })}
    <main class="page">
      <h1 class="large-title">外觀</h1>

      <div class="preview-phone">
        <div class="mini-tiles">
          <div class="mini-tile"><span class="tile-icon" style="${featureVars('todo')}">${icon('checklist')}</span><span class="mini-label">待辦</span></div>
          <div class="mini-tile"><span class="tile-icon" style="${featureVars('note')}">${icon('note')}</span><span class="mini-label">筆記</span></div>
          <div class="mini-tile"><span class="tile-icon day" style="${featureVars('event')}">${new Date().getDate()}</span><span class="mini-label">行程</span></div>
        </div>
        <div class="btn btn-primary">${icon('send')}主要按鈕</div>
      </div>

      <h2 class="group-header">顯示模式</h2>
      <div class="mode-card">
        <div class="seg" id="modes">
          ${MODES.map((m) => `<button data-mode="${m.id}" class="${ap.mode === m.id ? 'on' : ''}">${icon({ auto: 'circleHalf', light: 'sun', dark: 'moon' }[m.id])}${m.name}</button>`).join('')}
        </div>
      </div>
      <p class="group-footer">「自動」會跟著 iPhone 的淺色／深色模式切換。</p>

      <h2 class="group-header">配色</h2>
      <div class="swatches" id="swatches">
        ${THEMES.map((t) => {
          const c = t[mode];
          return `<button class="swatch ${ap.theme === t.id ? 'on' : ''}" data-theme="${t.id}" style="--sw-bg: ${c.bg}">
            <div class="swatch-art">${['accent', 'todo', 'note', 'event'].map((k) => `<i style="background:${c[k]}"></i>`).join('')}</div>
            <b>${t.name}</b><small>${t.desc}</small>
            <span class="tick">${icon('check')}</span>
          </button>`;
        }).join('')}
      </div>
      <p class="group-footer">配色只套用在 App 內；主畫面圖示不會改變。</p>
    </main>`;

  document.getElementById('modes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ap.mode = b.dataset.mode;
    save();
    applyTheme(ap);
    viewAppearance();
  });
  document.getElementById('swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    ap.theme = b.dataset.theme;
    save();
    applyTheme(ap);
    document.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
  });
}

// ---------- 設定 ----------

function viewSettings() {
  const s = settings();
  const signedIn = ms.isSignedIn();
  const theme = themeById(s.appearance.theme);
  const modeName = MODES.find((m) => m.id === s.appearance.mode)?.name || '自動';
  const calModes = [
    ['shortcut', 'iOS 捷徑', '一鍵寫入 iPhone 行事曆（推薦）'],
    ['ics', '行事曆檔案', '免設定，每次需再按「加入」'],
    ['outlook', '公司 Outlook', '用 Microsoft 帳號寫入，會同步到 iPhone'],
  ];

  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: '設定' })}
    <main class="page">
      <h1 class="large-title">設定</h1>

      <ul class="group icons">
        <li><a class="cell tap" href="#/appearance">
          <span class="cell-icon">${icon('palette')}</span>
          <span class="cell-label">外觀</span>
          <span class="cell-value">${esc(theme.name)} · ${modeName}</span>${icon('chevronRight', 'chev')}
        </a></li>
      </ul>

      <h2 class="group-header">待辦事項 → 專案管理工具</h2>
      <ul class="group icons">
        <li class="cell">
          <span class="cell-icon" style="${featureVars('todo')}">${icon('link')}</span>
          <label class="cell-label field"><span>Webhook 網址</span><input id="webhookUrl" type="url" inputmode="url" placeholder="https://…/api/todos" value="${esc(s.todo.webhookUrl)}"></label>
        </li>
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('key')}</span>
          <label class="cell-label field"><span>Token（選填）</span><input id="token" type="password" autocomplete="off" placeholder="以 Authorization: Bearer 送出" value="${esc(s.todo.token)}"></label>
        </li>
        <li><button class="cell action tap" id="ping">測試連線</button></li>
      </ul>
      <p class="group-footer">每新增一筆待辦，會 POST 一份 JSON 到這個網址，格式請見 README。</p>

      <h2 class="group-header">Microsoft 帳號（OneNote${s.calendar.mode === 'outlook' ? '・Outlook' : ''}）</h2>
      <ul class="group icons">
        <li class="cell">
          <span class="cell-icon" style="--c: #0078D4">${icon('key')}</span>
          <label class="cell-label field"><span>Application (client) ID</span><input id="clientId" placeholder="xxxxxxxx-xxxx-…" autocomplete="off" value="${esc(s.microsoft.clientId)}"></label>
        </li>
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('building')}</span>
          <label class="cell-label field"><span>租用戶（公司網域或 Tenant ID）</span><input id="tenant" placeholder="organizations" autocomplete="off" value="${esc(s.microsoft.tenant)}"></label>
        </li>
        <li><button class="cell tap" id="copy">
          <span class="cell-icon" style="--c: var(--gray)">${icon('copy')}</span>
          <span class="cell-label">重新導向 URI<small>${esc(ms.redirectUri())}</small></span>
        </button></li>
        ${
          signedIn
            ? `<li class="cell"><span class="cell-icon" style="--c: var(--todo); --on-c: var(--on-todo)">${icon('person')}</span>
                 <span class="cell-label">已登入<small>${esc(ms.account())}</small></span></li>
               <li><button class="cell action danger tap" id="logout">登出</button></li>`
            : `<li><button class="cell action tap" id="login">登入 Microsoft 帳號</button></li>`
        }
      </ul>

      <h2 class="group-header">OneNote 統一筆記</h2>
      <ul class="group icons">
        <li class="cell">
          <span class="cell-icon" style="--c: #7719AA">${icon('book')}</span>
          <span class="cell-label">分區</span>
          <label class="value-pill ${s.onenote.sectionId ? '' : 'empty-val'}" style="max-width:55%">
            <span id="sectionName" style="overflow:hidden;text-overflow:ellipsis">${esc(s.onenote.sectionName || '未選擇')}</span>${icon('chevronUpDown')}
            <select id="section" ${signedIn ? '' : 'disabled'}>
              ${s.onenote.sectionId ? `<option value="${esc(s.onenote.sectionId)}">${esc(s.onenote.sectionName)}</option>` : '<option value="">未選擇</option>'}
            </select>
          </label>
        </li>
        <li><button class="cell action tap" id="loadSections" ${signedIn ? '' : 'disabled'}>${signedIn ? '載入我的筆記本分區' : '登入後即可選擇分區'}</button></li>
      </ul>

      <h2 class="group-header">行程 → 行事曆</h2>
      <ul class="group icons" id="calModes">
        ${calModes
          .map(
            ([id, name, desc]) => `<li><button class="cell tap" data-mode="${id}">
              <span class="cell-icon" style="${featureVars('event')}">${icon(id === 'shortcut' ? 'bolt' : id === 'ics' ? 'calendar' : 'building')}</span>
              <span class="cell-label">${name}<small>${desc}</small></span>
              ${s.calendar.mode === id ? icon('check', 'checkmark') : ''}
            </button></li>`
          )
          .join('')}
      </ul>
      <ul class="group icons" style="margin-top:16px">
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('bolt')}</span>
          <span class="cell-label">捷徑名稱</span>
          <input id="shortcutName" class="right" style="flex:0 1 50%" value="${esc(s.calendar.shortcutName)}">
        </li>
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('timer')}</span>
          <span class="cell-label">預設長度</span>
          <label class="value-pill"><span id="durText">${s.calendar.defaultDuration} 分鐘</span>${icon('chevronUpDown')}
            <select id="duration">${[30, 60, 90, 120].map((m) => `<option value="${m}" ${Number(s.calendar.defaultDuration) === m ? 'selected' : ''}>${m} 分鐘</option>`).join('')}</select>
          </label>
        </li>
      </ul>
      <p class="group-footer">只寫開始時間時，行程會用預設長度。</p>

      <h2 class="group-header">資料</h2>
      <ul class="group icons">
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('tray')}</span>
          <span class="cell-label">本機資料</span>
          <span class="cell-value">待辦 ${db().todos.length}・筆記 ${db().notes.length}・行程 ${db().events.length}</span>
        </li>
        <li><button class="cell tap" id="retry">
          <span class="cell-icon" style="--c: var(--warning)">${icon('retry')}</span>
          <span class="cell-label">重試未同步項目</span><span class="cell-value">${pendingCount()}</span>
        </button></li>
        <li><button class="cell tap" id="export">
          <span class="cell-icon">${icon('download')}</span><span class="cell-label">匯出備份</span>${icon('chevronRight', 'chev')}
        </button></li>
        <li><label class="cell tap">
          <span class="cell-icon">${icon('upload')}</span><span class="cell-label">匯入備份</span>${icon('chevronRight', 'chev')}
          <input type="file" id="import" accept="application/json" hidden>
        </label></li>
      </ul>
      <p class="group-footer">資料都存在這支手機上。iOS 若長時間沒開 App 可能清除網頁資料，建議偶爾匯出備份。</p>
    </main>`;

  const $ = (id) => document.getElementById(id);
  const bindField = (id, obj, key, after) =>
    $(id).addEventListener('change', (e) => {
      obj[key] = e.target.value.trim();
      save();
      after?.(e);
    });
  bindField('webhookUrl', s.todo, 'webhookUrl');
  bindField('token', s.todo, 'token');
  bindField('clientId', s.microsoft, 'clientId');
  bindField('tenant', s.microsoft, 'tenant');
  bindField('shortcutName', s.calendar, 'shortcutName');
  bindField('duration', s.calendar, 'defaultDuration', () => ($('durText').textContent = `${s.calendar.defaultDuration} 分鐘`));

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
      toast('已複製重新導向 URI');
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
  $('logout')?.addEventListener('click', () =>
    sheet([{ label: '登出 Microsoft 帳號', danger: true, run: () => (ms.signOut(), viewSettings()) }])
  );

  $('loadSections').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '載入中…';
    try {
      const sections = await ms.listSections(s);
      $('section').innerHTML =
        '<option value="">未選擇</option>' +
        sections.map((x) => `<option value="${esc(x.id)}" ${x.id === s.onenote.sectionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      if (sections.length) {
        toast(`找到 ${sections.length} 個分區，請點「分區」選擇`);
        $('section').focus();
      } else toast('沒有找到分區，請先在 OneNote 建立', 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = '重新載入分區';
  });
  $('section').addEventListener('change', (e) => {
    s.onenote.sectionId = e.target.value;
    s.onenote.sectionName = e.target.value ? e.target.selectedOptions[0].textContent : '';
    save();
    $('sectionName').textContent = s.onenote.sectionName || '未選擇';
    e.target.closest('.value-pill').classList.toggle('empty-val', !e.target.value);
    toast(e.target.value ? '已設定 OneNote 分區' : '已取消 OneNote 分區');
  });

  $('calModes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === s.calendar.mode) return;
    const before = s.calendar.mode;
    s.calendar.mode = b.dataset.mode;
    save();
    if (s.calendar.mode === 'outlook' && before !== 'outlook' && ms.isSignedIn())
      toast('需要行事曆權限：請登出後重新登入一次', 'error');
    const y = window.scrollY;
    viewSettings();
    window.scrollTo(0, y);
  });

  $('retry').addEventListener('click', async () => {
    await retryPending();
    toast(pendingCount() ? '仍有項目同步失敗' : '全部同步完成', pendingCount() ? 'error' : 'ok');
    const y = window.scrollY;
    viewSettings();
    window.scrollTo(0, y);
  });

  $('export').addEventListener('click', () => {
    const data = JSON.parse(JSON.stringify(db()));
    data.settings.todo.token = ''; // 備份檔不含 token
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Beamup-備份-${formatDate(new Date()).replace(/\//g, '')}.json`;
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
      applyTheme(settings().appearance);
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
  [/^#\/appearance$/, viewAppearance],
  [/^#\/settings$/, viewSettings],
];

function render() {
  refreshCurrent = null;
  document.querySelectorAll('.sheet-wrap').forEach((el) => el.remove());
  const hash = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      window.scrollTo(0, 0);
      view(...m.slice(1));
      updateNav();
      return;
    }
  }
  location.hash = '#/';
}

async function start() {
  applyTheme(settings().appearance);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (location.hash === '#/appearance') viewAppearance();
  });
  try {
    if (await ms.handleRedirect(settings())) toast('Microsoft 登入成功');
  } catch (e) {
    toast(`登入失敗：${e.message}`, 'error');
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('scroll', updateNav, { passive: true });
  render();
  retryPending();
  window.addEventListener('online', retryPending);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
