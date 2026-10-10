import { db, save, uid, replaceAll } from './store.js';
import { parseEvent, formatRange, formatDate, formatTime } from './parser.js';
import { icon } from './icons.js';
import { THEMES, MODES, themeById, applyTheme, effectiveMode } from './themes.js';
import { mountMascot, queueCheer, drawAlienPreview, drawAccessory } from './mascot.js';
import { classify } from './capture.js';
import { visit as petVisit, gain as petGain, energyNow, mood as petMood, levelInfo, ACCESSORIES, GAINS, MOOD_TEXT } from './pet.js';
import { ALIENS, character } from './aliens.js';
import * as todoSync from './sync/todo.js';
import * as ms from './sync/microsoft.js';
import * as cal from './sync/calendar.js';
import * as folio from './sync/folio.js';

const $app = document.getElementById('app');
const DRAFT_KEY = 'tte.noteDraft';
const WEEK = '日一二三四五六';
let refreshCurrent = null; // 同步完成後只刷新目前頁面的局部區塊，避免清掉正在輸入的內容
const ui = { todoTab: 'open', noteTag: '', noteQuery: '', capture: '' };
let liveMascot = null; // 首頁正在顯示的外星人

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

/** iOS 風格的輸入對話框，回傳輸入的文字；按取消回傳 null */
function inputDialog({ title, message = '', value = '', placeholder = '', confirm = '完成' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    wrap.innerHTML = `<form class="alert" role="dialog" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <input id="dialogInput" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="off" enterkeyhint="done">
        <div class="alert-actions">
          <button type="button" data-cancel>取消</button>
          <button type="submit" class="strong">${esc(confirm)}</button>
        </div>
      </form>`;
    const input = wrap.querySelector('input');
    const close = (result) => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 200);
      resolve(result);
    };
    wrap.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      close(input.value);
    });
    wrap.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    wrap.addEventListener('click', (e) => e.target === wrap && close(null));
    document.body.appendChild(wrap);
    input.focus();
    input.select();
    requestAnimationFrame(() => wrap.classList.add('open'));
  });
}

/** 選外星人的底部選單 */
function alienPicker(current) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet">
        <div class="sheet-group picker">
          <div class="sheet-title">選一隻外星人</div>
          <div class="alien-grid">${alienCards(current)}</div>
        </div>
        <div class="sheet-group cancel"><button data-cancel>取消</button></div>
      </div>`;
    const close = (id) => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 300);
      resolve(id);
    };
    wrap.addEventListener('click', (e) => {
      const card = e.target.closest('[data-alien]');
      if (card) close(card.dataset.alien);
      else if (e.target.closest('[data-cancel]') || e.target === wrap) close(null);
    });
    document.body.appendChild(wrap);
    paintAlienCards(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
  });
}

function alienCards(current) {
  return ALIENS.map(
    (a) => `<button class="alien-card ${a.id === current ? 'on' : ''}" data-alien="${a.id}">
      <canvas data-preview="${a.id}" width="16" height="16"></canvas>
      <b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      <span class="tick">${icon('check')}</span>
    </button>`
  ).join('');
}

function paintAlienCards(root) {
  root.querySelectorAll('canvas[data-preview]').forEach((c) => drawAlienPreview(c, c.dataset.preview));
}

function autosize(el, min = 0) {
  el.style.height = 'auto';
  el.style.height = Math.max(min, el.scrollHeight) + 'px';
}

// ---------- 同步 ----------

const onenoteReady = () => ms.isSignedIn() && Boolean(settings().onenote.sectionId);
/** 筆記要送去哪：有設定 Folio 就送 Folio，不然才是 OneNote */
const noteTarget = () => (folio.isConfigured(settings()) ? 'folio' : onenoteReady() ? 'onenote' : null);
const noteReady = () => Boolean(noteTarget());
const targetName = (t = noteTarget()) => (t === 'onenote' ? 'OneNote' : 'Folio');

/** 送到專案管理工具：沒送過就是「新增」，送過了就是「更新」（改內容、勾選完成都算） */
async function syncTodo(todo) {
  if (!todoSync.isConfigured(settings())) {
    todo.sync = { status: 'off' };
    save();
    return todo.sync;
  }
  const prev = todo.sync || {};
  const type = prev.at ? 'todo.updated' : 'todo.created';
  todo.sync = { ...prev, status: 'pending', error: undefined };
  save();
  refreshCurrent?.();
  try {
    const remoteId = await todoSync.sendTodo(todo, settings(), type);
    todo.sync = { status: 'ok', at: new Date().toISOString(), remoteId: remoteId || prev.remoteId || null };
  } catch (e) {
    todo.sync = { ...prev, status: 'error', error: e.message };
  }
  save();
  refreshCurrent?.();
  return todo.sync;
}

function deleteTodo(todo) {
  db().todos = db().todos.filter((t) => t !== todo);
  save();
  // 送過的才需要通知對方刪除；失敗也不擋
  if (todoSync.isConfigured(settings()) && todo.sync && todo.sync.at)
    todoSync.sendTodo(todo, settings(), 'todo.deleted').catch(() => {});
}

/** 有截止日的待辦也丟到 iPhone「提醒事項」（設定裡打開才會） */
function remindTodos(todos) {
  const r = settings().reminders;
  const withDue = todos.filter((t) => t.due && !t.done);
  if (!r.enabled || !withDue.length) return;
  setTimeout(() => (location.href = cal.remindersUrl(withDue, r.shortcutName, r.time)), 400);
}

// ---------- 養成 ----------

/** 做了一件事：外星人吃一顆星星，可能升級或解鎖配件 */
function reward(kind, text) {
  const pet = db().pet;
  const r = petGain(pet, kind);
  save();
  let line = text;
  if (r.levelUp) line = `升到 Lv.${r.levelUp} 了！`;
  if (r.unlocked.length) {
    line = `解鎖了${r.unlocked.map((a) => a.name).join('、')}！`;
    toast(`解鎖新配件：${r.unlocked.map((a) => a.name).join('、')}（到小屋穿上）`);
  }
  if (liveMascot && document.getElementById('stage')) liveMascot.feed(line);
  else queueCheer(line);
  return r;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function syncNote(note) {
  const prev = note.sync || {};
  const target = noteTarget();
  note.sync = { ...prev, status: 'pending', error: undefined };
  save();
  refreshCurrent?.();
  try {
    if (target === 'folio') {
      // Folio：送過的會更新同一頁
      const ids = await folio.sendNote({ ...note, sync: prev }, settings());
      note.sync = { status: 'ok', at: new Date().toISOString(), via: 'folio', folio: ids, url: folio.baseUrl(settings()) };
    } else {
      const page = await ms.createOneNotePage(note, settings());
      note.sync = { status: 'ok', at: new Date().toISOString(), via: 'onenote', remoteId: page.id, url: page.url };
    }
    note.editedAfterSync = false;
  } catch (e) {
    note.sync = { ...prev, status: 'error', error: e.message };
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
  if (noteReady()) for (const n of notes) await syncNote(n);
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
      todo.updatedAt = new Date().toISOString();
      li.classList.toggle('done', todo.done); // 先播勾選動畫，再重排
      if (todo.done && !todo.rewarded) {
        todo.rewarded = true; // 同一件只獎勵一次，避免來回勾選刷經驗
        reward('todo.done', pick(['完成一件！太強了', '又少一件～', '好耶！清掉了', '做得好！']));
      }
      if (todoSync.isConfigured(settings()) && todo.sync && todo.sync.at) syncTodo(todo);
      setTimeout(rerender, 450);
      return;
    }
    const actions = [{ label: '編輯', run: () => (location.hash = `#/todo/edit/${todo.id}`) }];
    if (todoSync.isConfigured(settings()) && (!todo.sync || todo.sync.status !== 'ok'))
      actions.push({
        label: '重新同步',
        run: () => syncTodo(todo).then((s) => toast(s.status === 'ok' ? '已同步' : `同步失敗：${s.error}`, s.status === 'error' ? 'error' : 'ok')),
      });
    actions.push({
      label: '刪除',
      danger: true,
      run: () => {
        deleteTodo(todo);
        rerender();
      },
    });
    const title = todo.sync && todo.sync.error ? `同步失敗：${todo.sync.error}` : todo.title;
    sheet(actions, title);
  });
}

// ---------- 首頁 ----------

function upcomingHtml() {
  const now = new Date();
  const upcoming = db()
    .events.filter((e) => new Date(e.end) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 3);
  if (!upcoming.length) return `<div class="up-empty">一句話加入行事曆，例如「明天 14:00 開會」</div>`;
  return upcoming
    .map((e) => {
      const s = new Date(e.start);
      const d = dayDiff(s);
      const when = d === 0 ? '今天' : d === 1 ? '明天' : `${s.getMonth() + 1}/${s.getDate()}（${WEEK[s.getDay()]}）`;
      return `<div class="up-row"><span class="bar"></span><div class="t"><b>${esc(e.title)}</b>
        <small>${when}${e.allDay ? ' 全天' : ' ' + formatTime(s)}${e.location ? ` · ${esc(e.location)}` : ''}</small></div></div>`;
    })
    .join('');
}

function petChip() {
  const pet = db().pet;
  const energy = energyNow(pet);
  return `<span class="lv">Lv.${levelInfo(pet.xp).level}</span>
    <span class="meter ${petMood(energy)}" title="能量 ${energy}"><i style="width:${energy}%"></i></span>
    <span class="streak">${icon('flame')}${pet.streak}</span>`;
}

/** 首頁的萬用輸入「丟給 Blip」 */
function bindCapture(refreshHome) {
  const form = document.getElementById('capture');
  const input = document.getElementById('captureInput');
  const hint = document.getElementById('captureHint');
  const send = document.getElementById('captureSend');
  const segs = document.querySelectorAll('#captureType button');
  let forced = null;
  let result = null;

  const update = () => {
    autosize(input, 124);
    ui.capture = input.value;
    const text = input.value.trim();
    if (!text) forced = null;
    result = text ? classify(text, { force: forced, defaultDuration: Number(settings().calendar.defaultDuration) }) : null;
    segs.forEach((b) => {
      b.classList.toggle('on', Boolean(result) && b.dataset.type === result.type);
      b.classList.toggle('forced', b.dataset.type === forced);
    });
    send.disabled = !result || !result.ok;
    form.classList.toggle('has-text', Boolean(text));
    if (!result) return (hint.textContent = '');
    const tagText = result.tags && result.tags.length ? ` · ${result.tags.map((t) => '#' + t).join(' ')}` : '';
    if (result.type === 'event') {
      hint.textContent = result.ok
        ? `會加進行事曆：${formatRange(result.event)}${result.event.location ? ` @${result.event.location}` : ''}「${result.event.title}」`
        : result.errors[0];
      hint.className = `capture-hint ${result.ok ? '' : 'bad'}`;
    } else if (result.type === 'todo') {
      const due = dueInfo(result.due);
      hint.textContent = `會新增待辦：${result.title}${due ? ` · 截止 ${due.text}` : ''}${result.priority === 'high' ? ' · 高優先' : ''}${tagText}`;
      hint.className = 'capture-hint';
    } else {
      hint.textContent = `會存成筆記${result.title ? `「${result.title}」` : ''}${tagText}${noteReady() ? ` · 自動送到 ${targetName()}` : ''}`;
      hint.className = 'capture-hint';
    }
  };

  document.getElementById('captureType').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    forced = forced === b.dataset.type ? null : b.dataset.type;
    update();
    input.focus();
  });
  document.getElementById('pasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast('剪貼簿是空的', 'error');
      input.value = input.value.trim() ? `${input.value.trim()}\n${text.trim()}` : text.trim();
      update();
      input.focus();
    } catch {
      toast('讀不到剪貼簿，請長按輸入框選「貼上」', 'error');
    }
  });
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    // 單行時按 Enter 直接送出；Shift+Enter 換行
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !input.value.includes('\n')) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!result || !result.ok) return;
    const r = result;
    if (r.type === 'todo') {
      createTodos([{ title: r.title, due: r.due, priority: r.priority, tags: r.tags }], { silent: true });
      toast('已加入待辦');
    } else if (r.type === 'note') {
      const now = new Date().toISOString();
      const note = { id: uid(), title: r.title, content: r.content, tags: r.tags, createdAt: now, updatedAt: now, sync: { status: 'off' } };
      db().notes.push(note);
      save();
      reward('note.add', pick(['筆記收到！', '記下來了！']));
      if (noteReady()) {
        const name = targetName();
        syncNote(note).then((s) => toast(s.status === 'ok' ? `筆記已送到 ${name}` : `筆記已存，${name} 送出失敗：${s.error}`, s.status === 'ok' ? 'ok' : 'error'));
      }
      else toast('已存成筆記');
    } else {
      addEvent(r.event, r.text, () => {});
    }
    input.value = '';
    forced = null;
    update();
    refreshHome();
  });

  if (ui.capture) {
    input.value = ui.capture;
    update();
  }
}

function viewHome() {
  const now = new Date();
  const todos = db().todos;
  const open = todos.filter((t) => !t.done);
  const focus = open
    .filter((t) => (t.due && dueInfo(t.due).diff <= 0) || t.priority === 'high')
    .sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))
    .slice(0, 4);
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
        <div class="stage-cap">
          <button class="alien-switch" id="alienSwitch" aria-label="換外星人"><b>${esc(character(settings().appearance.alien).name)}</b>${icon('chevronUpDown')}</button>
          <span id="blipStatus"></span>
          <a class="pet-link" id="petChip" href="#/pet" aria-label="小屋">${petChip()}</a>
        </div>
      </section>

      <form class="capture" id="capture" autocomplete="off">
        <textarea id="captureInput" rows="4" placeholder="丟給 ${esc(character(settings().appearance.alien).name)}：想到什麼都可以打…" enterkeyhint="send"></textarea>
        <div class="capture-foot">
          <div class="seg capture-type" id="captureType">
            <button type="button" data-type="todo">待辦</button><button type="button" data-type="note">筆記</button><button type="button" data-type="event">行程</button>
          </div>
          <button type="button" class="capsule" id="pasteBtn" aria-label="貼上">${icon('clipboard')}貼上</button>
          <button type="submit" class="send-btn" id="captureSend" aria-label="送出" disabled>${icon('send')}</button>
        </div>
        <p class="capture-hint" id="captureHint"></p>
      </form>

      <div class="tiles">
        <a class="tile" href="#/todo" style="${featureVars('todo')}">
          <div class="tile-head"><span class="tile-icon">${icon('checklist')}</span><span class="tile-count" id="todoCount">${open.length}</span></div>
          <div class="tile-name">待辦事項<small>${open.length ? `${open.length} 件未完成` : '寫下要做的事'}</small></div>
        </a>
        <a class="tile" href="#/notes" style="${featureVars('note')}">
          <div class="tile-head"><span class="tile-icon">${icon('note')}</span><span class="tile-count" id="noteCount">${db().notes.length}</span></div>
          <div class="tile-name">筆記<small>${db().notes.length ? `寫下想法・送到 ${targetName()}` : '開始第一篇筆記'}</small></div>
        </a>
        <a class="tile wide" href="#/events" style="${featureVars('event')}">
          <div class="tile-head">
            <span class="tile-icon day">${now.getDate()}</span>
            <span class="tile-name">行程</span>
            ${icon('chevronRight', 'chev')}
          </div>
          <div class="upcoming" id="upcoming">${upcomingHtml()}
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

  const mascot = mountMascot(document.getElementById('stage'), {
    alien: settings().appearance.alien,
    onSwap: (id) => {
      const name = document.querySelector('#alienSwitch b');
      if (name) name.textContent = character(id).name;
    },
    status: document.getElementById('blipStatus'),
    mood: () => petMood(energyNow(db().pet)),
    accessory: () => db().pet.equipped,
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
  liveMascot = mascot;
  bindCapture(() => {
    const openNow = db().todos.filter((t) => !t.done).length;
    document.getElementById('todoCount').textContent = openNow;
    document.getElementById('noteCount').textContent = db().notes.length;
    document.getElementById('upcoming').innerHTML = upcomingHtml();
    document.getElementById('petChip').innerHTML = petChip();
  });
  try {
    if (localStorage.getItem('beamup.debug')) window.beamupMascot = mascot; // 除錯：在主控台呼叫 beamupMascot.play('ride')
  } catch {}
  document.getElementById('alienSwitch').addEventListener('click', async () => {
    const id = await alienPicker(settings().appearance.alien);
    if (!id || id === settings().appearance.alien) return;
    settings().appearance.alien = id;
    save();
    mascot.swap(id);
  });
}

// ---------- 待辦事項 ----------

/** 新增一批待辦：存起來、同步、餵外星人、需要的話丟到提醒事項 */
function createTodos(items, { silent = false } = {}) {
  const configured = todoSync.isConfigured(settings());
  const now = new Date().toISOString();
  const created = items.map((t) => ({
    id: uid(),
    title: t.title,
    note: t.note || '',
    due: t.due || null,
    priority: t.priority || 'normal',
    tags: t.tags || [],
    done: false,
    createdAt: now,
    updatedAt: now,
    sync: { status: configured ? 'pending' : 'off' },
  }));
  db().todos.push(...created);
  save();
  reward('todo.add', created.length > 1 ? `收到 ${created.length} 件待辦！` : pick(['收到待辦！', '記下來了！', '交給我！']));
  if (!configured && !silent) toast(`已加入 ${created.length} 件待辦`);
  Promise.all(created.map(syncTodo)).then((results) => {
    const failed = results.filter((s) => s && s.status === 'error');
    if (failed.length) toast(`同步失敗：${failed[0].error}`, 'error');
    else if (configured) toast(`已加入並同步 ${created.length} 件`);
  });
  remindTodos(created);
  return created;
}

function viewTodo(editId = null) {
  const configured = todoSync.isConfigured(settings());
  const openCount = () => db().todos.filter((t) => !t.done).length;
  const editing = editId ? db().todos.find((t) => t.id === editId) : null;
  if (editId && !editing) {
    location.hash = '#/todo/list';
    return;
  }
  let priority = editing ? editing.priority : 'normal';
  const prioBtn = (p, label) => `<button type="button" data-p="${p}" class="${priority === p ? 'on' : ''}">${label}</button>`;

  $app.innerHTML = `
    ${nav({
      back: editing ? '#/todo/list' : '#/',
      backLabel: editing ? '清單' : 'Beamup',
      title: editing ? '編輯待辦' : '待辦事項',
      actions: editing
        ? `<button class="icon-btn" id="del" aria-label="刪除">${icon('trash')}</button>`
        : `<a class="pill-btn" href="#/todo/list">${icon('list')}清單<span class="count" id="count">${openCount()}</span></a>`,
    })}
    <main class="page" style="${featureVars('todo')}">
      <h1 class="large-title">${editing ? '編輯待辦' : '待辦事項'}</h1>
      <form id="form">
        <div class="composer">
          <textarea name="title" rows="1" placeholder="${editing ? '待辦內容' : '新增待辦…'}" enterkeyhint="enter" required>${editing ? esc(editing.title) : ''}</textarea>
          <div class="composer-foot"><span>${editing ? (editing.done ? '已完成' : '未完成') : '一行一件，可一次輸入多件'}</span></div>
        </div>

        <ul class="group icons" style="margin-top:16px">
          <li class="cell">
            <span class="cell-icon" style="--c: var(--event); --on-c: var(--on-event)">${icon('calendar')}</span>
            <span class="cell-label">截止日</span>
            <label class="value-pill empty-val" id="duePill"><span id="dueText">未設定</span><input type="date" name="due" aria-label="截止日" value="${editing && editing.due ? editing.due : ''}"></label>
            <button type="button" class="icon-btn plain small" id="clearDue" aria-label="清除截止日" hidden>${icon('xmark')}</button>
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--note); --on-c: var(--on-note)">${icon('flag')}</span>
            <span class="cell-label">優先度</span>
            <div class="seg small" id="prio">${prioBtn('low', '低')}${prioBtn('normal', '一般')}${prioBtn('high', '高')}</div>
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--todo); --on-c: var(--on-todo)">${icon('tag')}</span>
            <input name="tags" placeholder="標籤（空白分隔）" autocomplete="off" value="${editing ? esc(editing.tags.join(' ')) : ''}">
          </li>
          <li class="cell">
            <span class="cell-icon" style="--c: var(--gray)">${icon('text')}</span>
            <input name="note" placeholder="備註" autocomplete="off" value="${editing ? esc(editing.note) : ''}">
          </li>
        </ul>

        <button class="btn btn-primary" type="submit" style="margin-top:20px">${
          editing ? `${icon('check')}儲存修改` : `${icon(configured ? 'send' : 'plus')}${configured ? '新增並同步' : '新增'}`
        }</button>
      </form>
      ${
        editing
          ? `<p class="caption">${configured && editing.sync && editing.sync.at ? '儲存後會同步更新到專案管理工具' : '只會改 App 裡的這一筆'}</p>`
          : configured
            ? ''
            : `<p class="caption">尚未連結專案管理工具，待辦只會存在 App 內 · <a href="#/settings">設定</a></p>`
      }

      ${editing ? '' : `<h2 class="group-header big">最近新增<a href="#/todo/list">全部</a></h2><ul class="group rows" id="recent"></ul>`}
    </main>`;

  const form = document.getElementById('form');
  const titleEl = form.title;
  const dueInput = form.due;

  const renderDue = () => {
    const info = dueInfo(dueInput.value);
    document.getElementById('dueText').textContent = info ? `${dueInput.value.replace(/-/g, '/')}（${info.text}）` : '未設定';
    document.getElementById('duePill').classList.toggle('empty-val', !info);
    document.getElementById('clearDue').hidden = !info;
  };
  dueInput.addEventListener('change', renderDue);
  document.getElementById('clearDue').addEventListener('click', () => {
    dueInput.value = '';
    renderDue();
  });
  renderDue();

  document.getElementById('prio').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    priority = b.dataset.p;
    document.querySelectorAll('#prio button').forEach((x) => x.classList.toggle('on', x === b));
  });
  titleEl.addEventListener('input', () => autosize(titleEl, 56));
  autosize(titleEl, 56);

  if (editing) {
    document.getElementById('del').addEventListener('click', () =>
      sheet([{ label: '刪除這件待辦', danger: true, run: () => (deleteTodo(editing), toast('已刪除'), (location.hash = '#/todo/list')) }])
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const title = String(f.get('title')).replace(/\s*\n\s*/g, ' ').trim();
      if (!title) return toast('待辦內容不能是空的', 'error');
      const dueBefore = editing.due;
      Object.assign(editing, {
        title,
        due: f.get('due') || null,
        priority,
        tags: splitTags(f.get('tags')),
        note: String(f.get('note')).trim(),
        updatedAt: new Date().toISOString(),
      });
      save();
      if (todoSync.isConfigured(settings()) && editing.sync && (editing.sync.at || editing.sync.status === 'error')) syncTodo(editing);
      toast('已儲存');
      if (editing.due && editing.due !== dueBefore) remindTodos([editing]);
      location.hash = '#/todo/list';
    });
    titleEl.focus();
    return;
  }

  const recent = document.getElementById('recent');
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const titles = String(f.get('title')).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return;
    createTodos(
      titles.map((title) => ({
        title,
        note: String(f.get('note')).trim(),
        due: f.get('due') || null,
        priority,
        tags: splitTags(f.get('tags')),
      }))
    );
    form.reset();
    priority = 'normal';
    document.querySelectorAll('#prio button').forEach((x) => x.classList.toggle('on', x.dataset.p === 'normal'));
    autosize(titleEl, 56);
    renderDue();
    renderRecent();
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

/** 標籤名稱：去掉開頭的 #、空白與分隔符號 */
function cleanTag(name) {
  return String(name ?? '').replace(/^[#＃]+/, '').replace(/[\s,，、#＃]+/g, '').trim();
}

function parseTags(text) {
  return [...new Set(String(text).split(/[,，、\n]+/).map(cleanTag).filter(Boolean))];
}

function tagCounts() {
  const counts = new Map();
  db().notes.forEach((n) => (n.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  (db().tagLibrary || []).forEach((t) => !counts.has(t) && counts.set(t, 0));
  return counts;
}

/** 所有標籤：用過的依次數排序，接著是自己建好但還沒用的 */
function allNoteTags() {
  return [...tagCounts().entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function renameTag(from, to) {
  to = cleanTag(to);
  if (!to || to === from) return false;
  for (const n of db().notes)
    if (n.tags.includes(from)) n.tags = [...new Set(n.tags.map((t) => (t === from ? to : t)))];
  db().tagLibrary = [...new Set((db().tagLibrary || []).map((t) => (t === from ? to : t)))];
  save();
  return true;
}

function deleteTag(tag) {
  for (const n of db().notes) n.tags = n.tags.filter((t) => t !== tag);
  db().tagLibrary = (db().tagLibrary || []).filter((t) => t !== tag);
  save();
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
  const ready = noteReady();
  const tname = targetName();
  const sentToFolio = existing && existing.sync && existing.sync.via === 'folio';
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
      <div class="tagrow" id="tagrow">
        <span class="chips" id="chips"></span>
        <label class="tag-entry">${icon('tag')}<input id="tagInput" placeholder="加標籤" autocomplete="off" autocapitalize="off" enterkeyhint="done"></label>
      </div>
      <div class="suggest" id="suggest"></div>
      <textarea id="content" class="note-body" placeholder="開始書寫…">${esc(note.content)}</textarea>
    </main>
    <footer class="toolbar">
      ${
        ready
          ? `<button class="text-btn" id="saveOnly">只儲存</button>
             <span class="spacer"></span>
             <button class="capsule primary" id="send">${icon('send')}${sentToFolio && tname === 'Folio' ? '更新到 Folio' : `送到 ${tname}`}</button>`
          : `<button class="icon-btn plain" id="share" aria-label="分享">${icon('share')}</button>
             <span class="spacer"><a href="#/settings">連結 Folio 自動同步</a></span>
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
    if (s.status === 'pending') return ($('status').innerHTML = `<p class="sync-pill">${icon('spinner', 'spin')}傳送到 ${tname}…</p>`);
    if (s.status === 'error') return ($('status').innerHTML = `<p class="sync-pill error">${icon('alert')}送出失敗：${esc(s.error)}</p>`);
    $('status').innerHTML = `<p class="sync-pill ok">${icon('checkCircle')}已送到 ${s.via === 'folio' ? 'Folio' : 'OneNote'} · ${shortTime(s.at)}
      ${s.url ? `· <a href="${esc(s.url)}" target="_blank" rel="noopener">開啟</a>` : ''}
      ${current.editedAfterSync ? '· 之後有修改' : ''}</p>`;
  };

  const saveDraft = () => {
    if (existing) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: titleEl.value, content: contentEl.value, tags }));
  };

  const tagInput = $('tagInput');
  let composing = false; // 注音／拼音還在選字時，Enter 和空白鍵是用來選字的，不能當成「新增標籤」

  const renderTags = () => {
    $('chips').innerHTML = tags
      .map(
        (t, i) => `<span class="chip editable">
          <button class="chip-label" data-edit="${i}" aria-label="重新命名 ${esc(t)}">#${esc(t)}</button>
          <button class="chip-x" data-remove="${i}" aria-label="移除 ${esc(t)}">${icon('xmark')}</button>
        </span>`
      )
      .join('');
    tagInput.placeholder = tags.length ? '加標籤' : '加標籤（Enter 或逗號分隔）';
    const sugg = allNoteTags().filter((t) => !tags.includes(t)).slice(0, 15);
    $('suggest').innerHTML =
      sugg.map((t) => `<button class="chip ghost" data-add="${esc(t)}">#${esc(t)}</button>`).join('') +
      `<a class="chip ghost manage" href="#/tags">${icon('gear')}管理標籤</a>`;
  };

  const addTags = (text) => {
    const added = parseTags(text).filter((t) => !tags.includes(t));
    tagInput.value = '';
    if (!added.length) return;
    tags.push(...added);
    renderTags();
    saveDraft();
  };

  tagInput.addEventListener('compositionstart', () => (composing = true));
  tagInput.addEventListener('compositionend', () => (composing = false));
  tagInput.addEventListener('keydown', (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTags(tagInput.value);
    } else if (e.key === 'Backspace' && !tagInput.value && tags.length) {
      tags.pop();
      renderTags();
      saveDraft();
    }
  });
  tagInput.addEventListener('input', () => {
    if (!composing && /[,，、]$/.test(tagInput.value)) addTags(tagInput.value);
  });
  tagInput.addEventListener('blur', () => tagInput.value.trim() && addTags(tagInput.value));

  // 點標籤時不要讓輸入框失焦（不然畫面重排，點擊會落空）
  for (const id of ['chips', 'suggest'])
    $(id).addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

  $('chips').addEventListener('click', async (e) => {
    const remove = e.target.closest('[data-remove]');
    const edit = e.target.closest('[data-edit]');
    if (remove) {
      tags.splice(Number(remove.dataset.remove), 1);
      renderTags();
      saveDraft();
    } else if (edit) {
      const i = Number(edit.dataset.edit);
      const name = await inputDialog({ title: '標籤名稱', message: '只改這篇筆記的標籤', value: tags[i], confirm: '儲存' });
      if (name == null) return;
      const clean = cleanTag(name);
      if (!clean) {
        tags.splice(i, 1);
      } else if (tags.includes(clean) && tags[i] !== clean) {
        tags.splice(i, 1); // 改成已經有的標籤 → 合併
      } else tags[i] = clean;
      renderTags();
      saveDraft();
    }
  });
  $('suggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) addTags(b.dataset.add);
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
      reward('note.add', pick(['筆記收到！', '好有內容～', '記下來了！']));
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
      toast(`已送到 ${tname}`);
      if (existing) location.hash = '#/notes/list';
      else if (/^#\/notes(\/new)?$/.test(location.hash)) viewNoteEditor(null); // 換成空白新筆記
      else location.hash = '#/notes/new';
    } else {
      toast(`送出失敗：${result.error}`, 'error');
      if (!existing) location.hash = `#/notes/edit/${saved.id}`;
      else {
        btn.disabled = false;
        btn.innerHTML = `${icon('send')}送到 ${tname}`;
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
      toast('已複製');
    }
    if (!existing) location.hash = `#/notes/edit/${saved.id}`;
  });

  $('more')?.addEventListener('click', () => {
    const actions = [];
    const via = existing.sync && existing.sync.status === 'ok' ? existing.sync.via : null;
    if (existing.sync && existing.sync.url)
      actions.push({ label: `在 ${via === 'folio' ? 'Folio' : 'OneNote'} 開啟`, run: () => window.open(existing.sync.url, '_blank') });
    if (ready && via && via !== 'folio') actions.push({ label: '再送一次（建立新頁面）', run: () => $('send').click() });
    const inFolio = existing.sync && existing.sync.via === 'folio' && existing.sync.folio && folio.isConfigured(settings());
    actions.push({
      label: inFolio ? '刪除筆記（Folio 那頁也一起刪）' : '刪除筆記',
      danger: true,
      run: async () => {
        if (inFolio) {
          try {
            await folio.deleteNote(existing.sync.folio, settings());
          } catch (e) {
            return toast(`刪除失敗：${e.message}`, 'error');
          }
        }
        db().notes = db().notes.filter((n) => n !== existing);
        save();
        toast('已刪除');
        location.hash = '#/notes/list';
      },
    });
    sheet(actions, via === 'onenote' ? 'OneNote 上已送出的頁面不會被刪除' : '');
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

function viewTags() {
  $app.innerHTML = `
    ${nav({ back: '#/notes/list', backLabel: '筆記', title: '標籤', actions: `<button class="icon-btn" id="addTag" aria-label="新增標籤">${icon('plus')}</button>` })}
    <main class="page" style="${featureVars('note')}">
      <h1 class="large-title">標籤</h1>
      <ul class="group icons" id="tagList"></ul>
      <p class="group-footer">點標籤可以改名或刪除。改成已經存在的名稱，兩個標籤會合併。改名不會更新已經送出的筆記，重新送一次就會更新。</p>
    </main>`;
  const list = document.getElementById('tagList');
  const render = () => {
    const counts = tagCounts();
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
    list.innerHTML = items.length
      ? items
          .map(
            ([t, n]) => `<li><button class="cell tap" data-tag="${esc(t)}">
              <span class="cell-icon" style="${featureVars('note')}">${icon('tag')}</span>
              <span class="cell-label">${esc(t)}</span>
              <span class="cell-value">${n ? `${n} 篇` : '還沒用過'}</span>${icon('chevronRight', 'chev')}
            </button></li>`
          )
          .join('')
      : `<li class="empty">${icon('tag')}還沒有標籤<br>按右上角＋建立常用標籤</li>`;
  };
  render();

  document.getElementById('addTag').addEventListener('click', async () => {
    const name = await inputDialog({ title: '新增標籤', message: '建立後，寫筆記時可以直接點選', placeholder: '例如：會議', confirm: '新增' });
    const clean = cleanTag(name);
    if (!clean) return;
    if (tagCounts().has(clean)) return toast(`「${clean}」已經有了`, 'error');
    db().tagLibrary = [...(db().tagLibrary || []), clean];
    save();
    render();
    toast(`已新增 #${clean}`);
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const tag = b.dataset.tag;
    const n = tagCounts().get(tag) || 0;
    sheet(
      [
        {
          label: '重新命名',
          run: async () => {
            const name = await inputDialog({ title: '重新命名標籤', message: n ? `會一起更新 ${n} 篇筆記` : '', value: tag, confirm: '儲存' });
            if (name == null) return;
            const clean = cleanTag(name);
            if (!clean) return toast('標籤名稱不能是空的', 'error');
            const merged = tagCounts().has(clean) && clean !== tag;
            if (renameTag(tag, clean)) {
              toast(merged ? `已合併到 #${clean}` : `已改名為 #${clean}`);
              render();
            }
          },
        },
        ...(n ? [{ label: `查看 ${n} 篇筆記`, run: () => ((ui.noteTag = tag), (location.hash = '#/notes/list')) }] : []),
        {
          label: n ? `刪除（從 ${n} 篇筆記移除）` : '刪除',
          danger: true,
          run: () => {
            deleteTag(tag);
            render();
            toast(`已刪除 #${tag}`);
          },
        },
      ],
      `#${tag}`
    );
  });
}

function viewNoteList() {
  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: '筆記', actions: `<a class="pill-btn" href="#/tags">${icon('tag')}標籤</a>` })}
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

const toEvent = (r) => ({ ...r, start: new Date(r.start), end: new Date(r.end), tags: r.tags || [] });

/**
 * 依設定寫進行事曆。修改行程時：Outlook 會直接更新原本那筆；
 * 捷徑／.ics 只能再新增一筆，會附上舊行程資訊給進階版捷徑刪除舊的。
 */
async function deliverEvent(ev, record, onChange = () => {}) {
  const cfg = settings().calendar;
  try {
    if (cfg.mode === 'outlook') {
      record.sync = { ...record.sync, status: 'pending' };
      onChange();
      const remoteId =
        ev.replace && record.sync.remoteId && record.sync.via === 'outlook'
          ? await ms.updateOutlookEvent(record.sync.remoteId, ev, settings())
          : await ms.createOutlookEvent(ev, settings());
      record.sync = { status: 'ok', at: new Date().toISOString(), remoteId, via: 'outlook' };
      toast(ev.replace ? '已更新 Outlook 行事曆' : '已加入 Outlook 行事曆');
    } else if (cfg.mode === 'ics') {
      cal.openIcs(ev, record.id);
      record.sync = { status: 'ok', at: new Date().toISOString() };
    } else {
      record.sync = { status: 'ok', at: new Date().toISOString() };
      save();
      location.href = cal.shortcutUrl(ev, cfg.shortcutName);
    }
  } catch (e) {
    record.sync = { ...record.sync, status: 'error', error: e.message };
    toast(`加入失敗：${e.message}`, 'error');
  }
  save();
  onChange();
  return record.sync;
}

/** 新增一筆行程（行程頁與萬用輸入共用） */
function addEvent(parsed, text, onChange) {
  const record = {
    id: uid(),
    text,
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
  reward('event.add', `「${parsed.title}」排進行事曆了`);
  deliverEvent(parsed, record, onChange);
  return record;
}

function viewEvents() {
  const cfg = settings().calendar;
  let editingId = null;
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
        <button class="btn btn-tinted" id="cancelEdit" hidden style="margin-top:10px">取消修改</button>
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

  const setEditing = (record) => {
    editingId = record ? record.id : null;
    $('add').innerHTML = record ? `${icon('check')}更新行程` : `${icon('calendarPlus')}加入行事曆`;
    $('cancelEdit').hidden = !record;
    if (record) insert(record.text || `${formatRange(toEvent(record)).replace(/（.）/, '')} [${record.title}]`);
  };
  $('cancelEdit').addEventListener('click', () => {
    setEditing(null);
    insert('');
  });

  $('add').addEventListener('click', () => {
    if (!parsed || !parsed.ok) return;
    const ev = parsed;
    const text = input.value.trim();
    const record = editingId && db().events.find((r) => r.id === editingId);
    if (record) {
      ev.replace = { title: record.title, start: record.start };
      Object.assign(record, {
        text,
        title: ev.title,
        location: ev.location,
        notes: ev.notes,
        tags: ev.tags,
        allDay: ev.allDay,
        start: ev.start.toISOString(),
        end: ev.end.toISOString(),
      });
      save();
      deliverEvent(ev, record, renderHistory).then((s) => {
        if (s.status === 'ok' && cfg.mode !== 'outlook') toast('已送出新的時間；行事曆裡舊的那筆請記得刪除');
      });
      setEditing(null);
    } else addEvent(ev, text, renderHistory);
    input.value = '';
    update();
  });

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
        { label: '修改', run: () => setEditing(record) },
        { label: '再加入一次行事曆', run: () => deliverEvent(toEvent(record), record, renderHistory) },
        {
          label: record.sync && record.sync.via === 'outlook' ? '刪除（Outlook 行事曆也一起刪）' : '刪除紀錄（行事曆裡的要手動刪）',
          danger: true,
          run: async () => {
            if (record.sync && record.sync.via === 'outlook' && record.sync.remoteId) {
              try {
                await ms.deleteOutlookEvent(record.sync.remoteId, settings());
                toast('已從 Outlook 行事曆刪除');
              } catch (e) {
                return toast(`刪除失敗：${e.message}`, 'error');
              }
            }
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

// ---------- 外星人小屋 ----------

function viewPet() {
  const pet = db().pet;
  const alien = character(settings().appearance.alien);
  const energy = energyNow(pet);
  const mood = petMood(energy);
  const lv = levelInfo(pet.xp);
  let pokes = 0;
  try {
    pokes = Number(localStorage.getItem('beamup.pokes')) || 0;
  } catch {}

  // 最近 5 週的出席點點（每列一週，週一開頭）
  const today = startOfToday();
  const mondayOffset = (today.getDay() + 6) % 7;
  const firstDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - 28);
  const used = new Set(pet.days);
  const dots = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const future = d > today;
    const isToday = d.getTime() === today.getTime();
    return `<i class="${used.has(key) ? 'on' : ''} ${future ? 'future' : ''} ${isToday ? 'today' : ''}" title="${d.getMonth() + 1}/${d.getDate()}"></i>`;
  }).join('');

  $app.innerHTML = `
    ${nav({ back: '#/', backLabel: 'Beamup', title: `${alien.name} 的小屋` })}
    <main class="page" style="${featureVars('todo')}">
      <h1 class="large-title"><span class="brand-inline">${esc(alien.name)}</span> 的小屋</h1>

      <section class="pet-hero">
        <canvas id="petPreview" class="pet-sprite"></canvas>
        <div class="pet-info">
          <div class="pet-lv"><b>Lv.${lv.level}</b><small>再 ${lv.toNext} 點經驗升級</small></div>
          <div class="bar xp" role="progressbar" aria-valuenow="${lv.into}" aria-valuemax="${lv.need}"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div>
          <div class="pet-lv"><span>能量 ${energy}</span><small>${MOOD_TEXT[mood]}</small></div>
          <div class="bar energy ${mood}" role="progressbar" aria-valuenow="${energy}" aria-valuemax="100"><i style="width:${energy}%"></i></div>
        </div>
      </section>

      <h2 class="group-header">連續使用</h2>
      <section class="streak-card">
        <div class="streak-top">
          <div class="streak-num">${icon('flame')}<b>${pet.streak}</b><span>天</span></div>
          <small>最長紀錄 ${pet.best} 天<br>每天打開一次就算</small>
        </div>
        <div class="dots-head">${'一二三四五六日'.split('').map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="dots">${dots}</div>
      </section>

      <h2 class="group-header">成績</h2>
      <div class="stat-grid">
        <div><b>${pet.stats.todosDone}</b><small>完成待辦</small></div>
        <div><b>${pet.stats.notes}</b><small>筆記</small></div>
        <div><b>${pet.stats.events}</b><small>行程</small></div>
        <div><b>${pokes}</b><small>被戳</small></div>
      </div>

      <h2 class="group-header">配件</h2>
      <div class="acc-grid" id="accGrid">
        ${ACCESSORIES.map((a) => {
          const have = pet.unlocked.includes(a.id);
          const cur = Math.min(a.goal, a.stat(pet));
          return `<button class="acc-card ${have ? '' : 'locked'} ${pet.equipped === a.id ? 'on' : ''}" data-acc="${a.id}" ${have ? '' : 'aria-disabled="true"'}>
            <canvas data-acc-preview="${a.id}"></canvas>
            <b>${esc(a.name)}</b>
            ${
              have
                ? `<small>${pet.equipped === a.id ? '穿著中' : '點一下穿上'}</small>`
                : `<small>${icon('lock')}${esc(a.hint)}</small><span class="bar mini"><i style="width:${Math.round((cur / a.goal) * 100)}%"></i></span>`
            }
          </button>`;
        }).join('')}
      </div>

      <h2 class="group-header">怎麼餵 ${esc(alien.name)}</h2>
      <ul class="group">
        ${Object.values(GAINS)
          .map((g) => `<li class="cell"><span class="cell-label">${g.label}</span><span class="cell-value">能量 +${g.energy} · 經驗 +${g.xp}</span></li>`)
          .join('')}
      </ul>
      <p class="group-footer">能量每小時少 1 點。太久沒來，${esc(alien.name)} 會餓到垂頭喪氣喔。</p>
    </main>`;

  drawAlienPreview(document.getElementById('petPreview'), settings().appearance.alien, pet.equipped);
  document.querySelectorAll('canvas[data-acc-preview]').forEach((c) => drawAccessory(c, c.dataset.accPreview));
  document.getElementById('accGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-acc]');
    if (!card) return;
    const id = card.dataset.acc;
    const a = ACCESSORIES.find((x) => x.id === id);
    if (!pet.unlocked.includes(id)) return toast(`還沒解鎖：${a.hint}`, 'error');
    pet.equipped = pet.equipped === id ? null : id;
    save();
    toast(pet.equipped ? `穿上${a.name}了` : `脫下${a.name}了`);
    const y = window.scrollY;
    viewPet();
    window.scrollTo(0, y);
  });
}

// ---------- 說明：Siri 快速記錄、提醒 ----------

function steps(list) {
  return `<ol class="steps">${list.map((x) => `<li>${x}</li>`).join('')}</ol>`;
}

function copyRow(text) {
  return `<div class="copy-row"><span>${esc(text)}</span><button class="capsule" data-copy="${esc(text)}">${icon('copy')}複製</button></div>`;
}

function bindCopy() {
  if ($app.dataset.copyBound) return; // #app 不會被換掉，只綁一次
  $app.dataset.copyBound = '1';
  $app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('已複製');
    } catch {
      toast('無法複製，請長按文字選取', 'error');
    }
  });
}

function viewHelpSiri() {
  const name = character(settings().appearance.alien).name;
  $app.innerHTML = `
    ${nav({ back: '#/settings', backLabel: '設定', title: 'Siri 快速記錄' })}
    <main class="page">
      <h1 class="large-title">Siri 快速記錄</h1>
      <p class="lead">說一句「嘿 Siri，丟給 ${esc(name)}」就能記下來。也可以設定成輕點手機背面兩下，或按動作按鈕。</p>
      <div class="note-box">${icon('alert')}<span>iPhone 不允許捷徑直接打開主畫面上的網頁 App，所以會分兩步：捷徑先把你說的話拷貝起來，你打開 Beamup 後在首頁點「貼上」→「送出」。</span></div>

      <h2 class="group-header">建立捷徑（只要做一次）</h2>
      <div class="help-card">
        ${steps([
          '打開「捷徑」App，按右上角 <b>＋</b>，把捷徑命名為 <b>丟給 ' + esc(name) + '</b>。',
          '加入動作 <b>聽寫文字</b>，語言選「中文（台灣）」。',
          '加入動作 <b>拷貝到剪貼板</b>。',
          '加入動作 <b>顯示通知</b>，內容貼上：' + copyRow('已交給 ' + name + '，打開 Beamup 按「貼上」'),
          '按完成。現在說「嘿 Siri，丟給 ' + esc(name) + '」試試看。',
        ])}
      </div>

      <h2 class="group-header">更快的啟動方式</h2>
      <ul class="group icons">
        <li class="cell"><span class="cell-icon" style="--c: var(--gray)">${icon('person')}</span><span class="cell-label">輕點背面<small>設定 › 輔助使用 › 觸控 › 背面輕點 › 點兩下 › 選「丟給 ${esc(name)}」</small></span></li>
        <li class="cell"><span class="cell-icon" style="--c: var(--accent)">${icon('bolt')}</span><span class="cell-label">動作按鈕（iPhone 15 Pro 以上）<small>設定 › 動作按鈕 › 捷徑 › 選「丟給 ${esc(name)}」</small></span></li>
        <li class="cell"><span class="cell-icon" style="--c: var(--event); --on-c: var(--on-event)">${icon('house')}</span><span class="cell-label">放在 Dock<small>把 Beamup 拖到螢幕最下面的 Dock，貼上時一打開就到</small></span></li>
      </ul>

      <h2 class="group-header">說話的小技巧</h2>
      <ul class="group">
        <li class="cell"><span class="cell-label">「明天下午三點跟廠商開會」<small>有日期和時間 → 自動變成行程</small></span></li>
        <li class="cell"><span class="cell-label">「週五交期末報告」<small>只有日期 → 待辦，截止日是週五</small></span></li>
        <li class="cell"><span class="cell-label">「筆記 今天會議的三個重點…」<small>開頭說「筆記」「待辦」「行程」可以指定分類</small></span></li>
      </ul>
    </main>`;
  bindCopy();
}

function viewHelpReminders() {
  const name = character(settings().appearance.alien).name;
  const morning = `${name} 肚子餓了，打開 Beamup 看看今天要做什麼`;
  const evening = `今天完成了幾件事？回 Beamup 跟 ${name} 報告一下`;
  $app.innerHTML = `
    ${nav({ back: '#/settings', backLabel: '設定', title: '提醒' })}
    <main class="page">
      <h1 class="large-title">提醒</h1>
      <p class="lead">網頁 App 沒辦法自己推播通知，所以借用 iPhone 內建的「捷徑」來提醒你。不需要伺服器，也不用付費。</p>

      <h2 class="group-header">每天提醒我打開 Beamup</h2>
      <div class="help-card">
        ${steps([
          '打開「捷徑」App，點下方 <b>自動化</b>，再按右上角 <b>＋</b>。',
          '選 <b>特定時間</b>，設成早上 <b>9:00</b>、<b>每天</b>，下面選 <b>立即執行</b>。',
          '加入動作 <b>顯示通知</b>，內容貼上：' + copyRow(morning),
          '再建一個晚上 <b>21:00</b> 的自動化，通知內容：' + copyRow(evening),
        ])}
        <p class="help-note">點通知會先打開「捷徑」，再點 Beamup 圖示就好（iOS 的限制）。把 Beamup 放在 Dock 最方便。</p>
      </div>

      <h2 class="group-header">待辦到期時提醒我</h2>
      <div class="help-card">
        ${steps([
          `在「捷徑」App 新增捷徑，命名為 <b>${esc(settings().reminders.shortcutName)}</b>。`,
          '加入 <b>從輸入取得辭典</b>，再加 <b>取得辭典值</b>，鍵填 <code>items</code>。',
          '加入 <b>重複每一個項目</b>，在裡面：用 <b>取得辭典值</b> 取出 <code>title</code>、<code>due</code>、<code>notes</code>。',
          '同樣在重複裡面加入 <b>加入新提醒事項</b>：標題 = title、打開「提醒我」選日期 = due、備忘錄 = notes。',
          '回到 Beamup <a href="#/settings">設定</a>，打開「有截止日的待辦加到提醒事項」。',
        ])}
        <p class="help-note">之後新增或修改有截止日的待辦時，Beamup 會呼叫這個捷徑，到期當天 ${esc(settings().reminders.time)} 由 iPhone 提醒你。</p>
      </div>

      <h2 class="group-header">行程開始前提醒我</h2>
      <div class="help-card">
        ${steps(['打開「加入行程」捷徑，在 <b>加入新行程</b> 動作裡，把「提醒」設成 <b>15 分鐘前</b>（或你習慣的時間）。'])}
      </div>
    </main>`;
  bindCopy();
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

      <h2 class="group-header">外星人</h2>
      <div class="alien-grid" id="aliens">${alienCards(ap.alien)}</div>
      <p class="group-footer">也可以在首頁點外星人的名字直接換。</p>

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
  paintAlienCards($app);
  document.getElementById('aliens').addEventListener('click', (e) => {
    const b = e.target.closest('[data-alien]');
    if (!b) return;
    ap.alien = b.dataset.alien;
    save();
    document.querySelectorAll('#aliens .alien-card').forEach((x) => x.classList.toggle('on', x === b));
    toast(`${character(ap.alien).name} 已經在首頁等你了`);
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
          <label class="cell-label field"><span>Arbor 連接碼或 Webhook 網址</span><input id="webhookUrl" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="pm1.… 或 https://…/api/todos" value="${esc(s.todo.webhookUrl)}"></label>
        </li>
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('key')}</span>
          <label class="cell-label field"><span>Token（選填）</span><input id="token" type="password" autocomplete="off" placeholder="以 Authorization: Bearer 送出" value="${esc(s.todo.token)}"></label>
        </li>
        <li><button class="cell action tap" id="ping">測試連線</button></li>
      </ul>
      <p class="group-footer">貼上 Arbor「外觀 › 連接 Beamup」的連接碼，新增的待辦就會直接進 Arbor 上方的「待辦」清單（高優先進「急件」），修改、勾選完成也會同步。用 Webhook 時會 POST 一份 JSON 到這個網址，格式請見 README；Token 只有 Webhook 會用到。</p>

      <h2 class="group-header">筆記 → Folio</h2>
      <ul class="group icons">
        <li class="cell">
          <span class="cell-icon" style="${featureVars('note')}">${icon('book')}</span>
          <label class="cell-label field"><span>Folio 網址</span><input id="folioUrl" type="url" inputmode="url" placeholder="https://folio.xxx.workers.dev" autocomplete="off" value="${esc(s.folio.url)}"></label>
        </li>
        <li class="cell">
          <span class="cell-icon" style="--c: var(--gray)">${icon('key')}</span>
          <label class="cell-label field"><span>同步密碼（Folio 的 SYNC_TOKEN）</span><input id="folioToken" type="password" autocomplete="off" value="${esc(s.folio.token)}"></label>
        </li>
        <li><button class="cell action tap" id="folioPing">測試連線</button></li>
      </ul>
      <p class="group-footer">筆記會送到 Folio 的「Beamup › 收件匣」，一篇筆記一頁。修改後再送會更新同一頁，在 Beamup 刪除也會一起刪掉。設定了 Folio 就不會送到 OneNote。</p>

      <h2 class="group-header">Microsoft 帳號（${s.calendar.mode === 'outlook' ? 'Outlook 行事曆・' : ''}OneNote，選用）</h2>
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

      <h2 class="group-header">提醒與快速記錄</h2>
      <ul class="group icons">
        <li><a class="cell tap" href="#/help/siri">
          <span class="cell-icon" style="--c: #5E5CE6">${icon('mic')}</span>
          <span class="cell-label">Siri 快速記錄<small>說「嘿 Siri，丟給 ${esc(character(s.appearance.alien).name)}」</small></span>${icon('chevronRight', 'chev')}
        </a></li>
        <li><a class="cell tap" href="#/help/reminders">
          <span class="cell-icon" style="--c: var(--danger)">${icon('bell')}</span>
          <span class="cell-label">每天提醒我<small>用 iPhone 捷徑定時通知</small></span>${icon('chevronRight', 'chev')}
        </a></li>
        <li class="cell">
          <span class="cell-icon" style="${featureVars('todo')}">${icon('checklist')}</span>
          <label class="cell-label" for="remindOn">有截止日的待辦加到提醒事項<small>需要捷徑「${esc(s.reminders.shortcutName)}」</small></label>
          <input type="checkbox" class="switch" id="remindOn" ${s.reminders.enabled ? 'checked' : ''}>
        </li>
        <li class="cell" ${s.reminders.enabled ? '' : 'hidden'} id="remindTimeRow">
          <span class="cell-icon" style="--c: var(--gray)">${icon('clock')}</span>
          <span class="cell-label">到期當天幾點提醒</span>
          <input type="time" id="remindTime" class="right" style="flex:0 0 auto" value="${esc(s.reminders.time)}">
        </li>
      </ul>

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
  bindField('folioUrl', s.folio, 'url');
  bindField('folioToken', s.folio, 'token');
  $('folioPing').addEventListener('click', async () => {
    if (!folio.isConfigured(s)) return toast('請先填 Folio 網址和同步密碼', 'error');
    try {
      const n = await folio.ping(s);
      toast(`連線成功（Folio 裡有 ${n} 筆資料）`);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  bindField('clientId', s.microsoft, 'clientId');
  bindField('tenant', s.microsoft, 'tenant');
  bindField('shortcutName', s.calendar, 'shortcutName');
  $('remindOn').addEventListener('change', (e) => {
    s.reminders.enabled = e.target.checked;
    save();
    $('remindTimeRow').hidden = !e.target.checked;
    if (e.target.checked) toast('記得先建立「' + s.reminders.shortcutName + '」捷徑（見「每天提醒我」）');
  });
  $('remindTime').addEventListener('change', (e) => {
    s.reminders.time = e.target.value || '09:00';
    save();
  });
  bindField('duration', s.calendar, 'defaultDuration', () => ($('durText').textContent = `${s.calendar.defaultDuration} 分鐘`));

  $('ping').addEventListener('click', async () => {
    if (!s.todo.webhookUrl) return toast('請先填入連接碼或 Webhook 網址', 'error');
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
    data.settings.todo.token = ''; // 備份檔不含密碼
    if (data.settings.folio) data.settings.folio.token = '';
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
      data.settings = {
        ...data.settings,
        todo: { ...data.settings?.todo, token: s.todo.token },
        folio: { ...data.settings?.folio, token: s.folio.token },
      };
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
  [/^#\/todo$/, () => viewTodo()],
  [/^#\/todo\/list$/, viewTodoList],
  [/^#\/todo\/edit\/(.+)$/, (id) => viewTodo(decodeURIComponent(id))],
  [/^#\/pet$/, viewPet],
  [/^#\/help\/siri$/, viewHelpSiri],
  [/^#\/help\/reminders$/, viewHelpReminders],
  [/^#\/add\/(.*)$/, (text) => ((ui.capture = decodeURIComponent(text)), (location.hash = '#/'))],
  [/^#\/notes(?:\/new)?$/, () => viewNoteEditor(null)],
  [/^#\/notes\/list$/, viewNoteList],
  [/^#\/notes\/edit\/(.+)$/, (id) => viewNoteEditor(decodeURIComponent(id))],
  [/^#\/events$/, viewEvents],
  [/^#\/appearance$/, viewAppearance],
  [/^#\/tags$/, viewTags],
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

/** 每天第一次打開：算連續天數、餵一顆星星 */
function dailyVisit() {
  const v = petVisit(db().pet);
  save();
  if (!v.firstToday) return;
  const line = v.away >= 2 ? `${v.away} 天沒見了…好想你` : v.streak > 1 ? `連續 ${v.streak} 天見面了！` : '今天也來看我了！';
  if (v.unlocked.length) toast(`解鎖新配件：${v.unlocked.map((a) => a.name).join('、')}（到小屋穿上）`);
  if (liveMascot && document.getElementById('stage')) liveMascot.feed(line);
  else queueCheer(line);
  const chip = document.getElementById('petChip');
  if (chip) chip.innerHTML = petChip();
}

async function start() {
  applyTheme(settings().appearance);
  dailyVisit();
  // App 一直開著跨過午夜時，回到畫面也要算新的一天
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && dailyVisit());
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
