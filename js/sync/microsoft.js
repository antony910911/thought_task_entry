// Microsoft 帳號登入（OAuth 2.0 授權碼 + PKCE，純前端，不需要伺服器）
// 以及 Microsoft Graph：OneNote 建立頁面、Outlook 建立行程。

const AUTH_KEY = 'tte.msauth.v1';
const PENDING_KEY = 'tte.msauth.pending';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function redirectUri() {
  return location.origin + location.pathname;
}

function scopesFor(settings) {
  const scopes = ['openid', 'profile', 'offline_access', 'User.Read', 'Notes.Create'];
  if (settings.calendar.mode === 'outlook') scopes.push('Calendars.ReadWrite');
  return scopes.join(' ');
}

function authority(settings) {
  return `https://login.microsoftonline.com/${encodeURIComponent(settings.microsoft.tenant || 'organizations')}/oauth2/v2.0`;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function readAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

export function account() {
  const auth = readAuth();
  return auth ? auth.account : null;
}

export function isSignedIn() {
  return Boolean(readAuth());
}

export function signOut() {
  writeAuth(null);
}

export async function signIn(settings, returnHash) {
  if (!settings.microsoft.clientId) throw new Error('請先在設定填入 Application (client) ID');
  const verifier = randomString();
  const state = randomString();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnHash, scope: scopesFor(settings) }));
  const params = new URLSearchParams({
    client_id: settings.microsoft.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: scopesFor(settings),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  location.assign(`${authority(settings)}/authorize?${params}`);
}

async function requestToken(settings, body) {
  const res = await fetch(`${authority(settings)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.microsoft.clientId, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ? data.error_description.split('\r\n')[0] : `登入失敗（${res.status}）`);
  return data;
}

function decodeIdToken(idToken) {
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      [...atob(part)].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    const claims = JSON.parse(json);
    return claims.preferred_username || claims.email || claims.name || '已登入';
  } catch {
    return '已登入';
  }
}

function storeTokens(data, previous) {
  writeAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || (previous && previous.refreshToken),
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || (previous && previous.scope) || '',
    account: data.id_token ? decodeIdToken(data.id_token) : previous && previous.account,
  });
}

/** 登入完成導回 App 時呼叫；回傳要回到的頁面 hash（或 null）。 */
export async function handleRedirect(settings) {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;

  const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
  localStorage.removeItem(PENDING_KEY);
  history.replaceState(null, '', url.pathname + (pending && pending.returnHash ? pending.returnHash : ''));

  if (error) throw new Error(url.searchParams.get('error_description') || error);
  if (!pending || pending.state !== url.searchParams.get('state')) throw new Error('登入狀態不符，請再試一次');

  const data = await requestToken(settings, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
    scope: pending.scope,
  });
  storeTokens(data, null);
  return pending.returnHash || '#/settings';
}

async function accessToken(settings) {
  const auth = readAuth();
  if (!auth) throw new Error('尚未登入 Microsoft 帳號');
  if (auth.expiresAt - 60_000 > Date.now()) return auth.accessToken;
  if (!auth.refreshToken) throw new Error('登入已過期，請到設定重新登入');
  try {
    const data = await requestToken(settings, {
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      scope: scopesFor(settings),
    });
    storeTokens(data, auth);
    return data.access_token;
  } catch (e) {
    writeAuth(null);
    throw new Error('登入已過期，請到設定重新登入');
  }
}

async function graph(settings, path, { method = 'GET', body, contentType = 'application/json' } = {}) {
  const token = await accessToken(settings);
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': contentType } : {}) },
    body,
  });
  if (!res.ok) {
    let message = `Microsoft 回應 ${res.status}`;
    try {
      const err = await res.json();
      if (err.error && err.error.message) message += `：${err.error.message}`;
    } catch {}
    if (res.status === 401 || res.status === 403) message += '（可能權限不足，請到設定重新登入）';
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- OneNote ----------

export async function listSections(settings) {
  const sections = [];
  let next = '/me/onenote/sections?$select=id,displayName&$expand=parentNotebook($select=displayName)&$top=100';
  while (next) {
    const data = await graph(settings, next);
    sections.push(
      ...data.value.map((s) => ({
        id: s.id,
        name: `${s.parentNotebook ? s.parentNotebook.displayName : ''} › ${s.displayName}`,
      }))
    );
    next = data['@odata.nextLink'] || null;
  }
  return sections.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function onenoteTitle(note) {
  const tagPart = (note.tags || []).map((t) => `[${t}]`).join('');
  return `${tagPart}${tagPart ? ' ' : ''}${note.title || '未命名筆記'}`;
}

export function onenoteHtml(note) {
  const paragraphs = String(note.content || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
  const tags = (note.tags || []).map((t) => `#${esc(t)}`).join(' ');
  return `<!DOCTYPE html>
<html>
<head>
<title>${esc(onenoteTitle(note))}</title>
<meta name="created" content="${new Date(note.createdAt).toISOString()}" />
</head>
<body>
${tags ? `<p style="color:#6b6b6b">標籤：${tags}</p>` : ''}
${paragraphs}
</body>
</html>`;
}

export async function createOneNotePage(note, settings) {
  const sectionId = settings.onenote.sectionId;
  if (!sectionId) throw new Error('請先在設定選擇 OneNote 分區');
  const page = await graph(settings, `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`, {
    method: 'POST',
    body: onenoteHtml(note),
    contentType: 'text/html',
  });
  return { id: page.id, url: page.links && page.links.oneNoteWebUrl ? page.links.oneNoteWebUrl.href : '' };
}

// ---------- Outlook 行事曆 ----------

export async function createOutlookEvent(ev, settings) {
  const body = {
    subject: ev.title,
    isAllDay: ev.allDay,
    start: { dateTime: ev.allDay ? localMidnight(ev.start) : ev.start.toISOString(), timeZone: ev.allDay ? tz() : 'UTC' },
    end: { dateTime: ev.allDay ? localMidnight(ev.end) : ev.end.toISOString(), timeZone: ev.allDay ? tz() : 'UTC' },
  };
  if (ev.location) body.location = { displayName: ev.location };
  if (ev.notes || ev.tags.length)
    body.body = { contentType: 'text', content: [ev.notes, ev.tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n') };
  const created = await graph(settings, '/me/events', { method: 'POST', body: JSON.stringify(body) });
  return created.id;
}

function tz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function localMidnight(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
}
