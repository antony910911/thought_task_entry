// 萬用輸入「丟給 Blip」：隨便打一句話，自動判斷是待辦、筆記還是行程。
//
// 規則（由上往下，先符合先用）：
//  1. 開頭寫「待辦 / 筆記 / 行程」（或 todo / note / event），或內容有 #筆記 → 照你說的分類
//  2. 有日期「而且有時間」→ 行程（例如「明天 14:00 開會」）
//  3. 多行，或超過 60 個字 → 筆記
//  4. 其他 → 待辦；有日期但沒時間就當截止日（例如「週五交報告」）
// 開頭的 ! 或 !! 代表高優先待辦。

import { parseEvent } from './parser.js';

const PREFIXES = [
  [/^(待辦|todo|任務)\s*[:：]?\s+|^(待辦|任務)[:：]\s*/i, 'todo'],
  [/^(筆記|note)\s*[:：]?\s+|^筆記[:：]\s*/i, 'note'],
  [/^(行程|event)\s*[:：]?\s+|^行程[:：]\s*/i, 'event'],
];
const TAG_RE = /[#＃]([^\s#＃,，、]+)/g;

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function takeTags(text) {
  const tags = [];
  const rest = text.replace(TAG_RE, (_, t) => {
    if (t !== '筆記') tags.push(t);
    return ' ';
  });
  return { tags: [...new Set(tags)], rest: rest.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim() };
}

/**
 * @param {string} raw
 * @param {{ today?: Date, defaultDuration?: number, force?: 'todo'|'note'|'event' }} [opts]
 */
export function classify(raw, opts = {}) {
  let text = String(raw ?? '').trim();
  let forced = opts.force || null;
  for (const [re, type] of PREFIXES) {
    if (re.test(text)) {
      forced = forced || type;
      text = text.replace(re, '').trim();
      break;
    }
  }
  if (!forced && /(^|\s)[#＃]筆記(?=\s|$)/.test(text)) forced = 'note';

  let priority = 'normal';
  const bang = text.match(/^[!！]{1,3}\s*/);
  if (bang) {
    priority = 'high';
    text = text.slice(bang[0].length);
  }

  const ev = parseEvent(text, opts);
  const hasTime = Boolean(ev.start) && !ev.allDay;
  const longText = text.includes('\n') || text.length > 60;
  const type = forced || (ev.ok && hasTime ? 'event' : longText ? 'note' : 'todo');

  if (!text) return { type, empty: true };

  if (type === 'event') return { type, event: ev, ok: ev.ok, errors: ev.errors, text };

  const { tags, rest } = takeTags(text);
  if (type === 'note') {
    const lines = rest.split('\n');
    const multi = lines.length > 1;
    return {
      type,
      ok: Boolean(rest),
      title: multi ? lines[0].trim() : '',
      content: multi ? lines.slice(1).join('\n').trim() : rest,
      tags,
    };
  }

  // 待辦：有日期但沒時間 → 截止日；保留地點
  let title = rest;
  let due = null;
  if (ev.start && ev.allDay) {
    due = ymd(ev.start);
    title = [ev.title, ev.notes, ev.location ? `@${ev.location}` : ''].filter(Boolean).join(' ');
  }
  return { type, ok: Boolean(title), title, due, priority, tags };
}
