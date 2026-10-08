// 行程語句解析：把「2026/11/12 9:30-12:00 @會議室 [期末報告]」或隨意句子轉成日曆事件。

const WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

// 全形轉半形、統一括號與連接符號
export function normalize(text) {
  return String(text)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[【〔「]/g, '[')
    .replace(/[】〕」]/g, ']')
    .replace(/[～〜—–‐−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function validDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function takeDate(text, today) {
  let m = text.match(/(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*[日號号]?/);
  if (m) {
    let y = Number(m[1]);
    if (m[1].length === 3) y += 1911; // 民國年，例如 115/11/12
    else if (m[1].length === 2) y += 2000;
    return { date: validDate(y, Number(m[2]), Number(m[3])), match: m[0] };
  }

  m = text.match(/(?<!\d)(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*[日號号]?(?!\d)/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    let date = validDate(today.getFullYear(), month, day);
    // 沒寫年份且日期已過一個月以上，視為明年
    if (date && date < addDays(today, -30)) date = validDate(today.getFullYear() + 1, month, day);
    return { date, match: m[0] };
  }

  m = text.match(/大後天|後天|明天|明日|今天|今日/);
  if (m) {
    const offset = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2, 大後天: 3 }[m[0]];
    return { date: addDays(today, offset), match: m[0] };
  }

  m = text.match(/(下下|下|這|本)?\s*(?:週|周|星期|禮拜)\s*([一二三四五六日天])/);
  if (m) {
    const target = WEEKDAYS[m[2]];
    let date;
    if (m[1] === '下' || m[1] === '下下') {
      // 以週一為一週開始
      const mondayOffset = (today.getDay() + 6) % 7;
      const nextMonday = addDays(today, 7 - mondayOffset + (m[1] === '下下' ? 7 : 0));
      date = addDays(nextMonday, (target + 6) % 7);
    } else {
      date = addDays(today, (target - today.getDay() + 7) % 7);
    }
    return { date, match: m[0] };
  }

  return null;
}

const PERIOD = '(上午|早上|凌晨|中午|下午|晚上|傍晚|am|pm|AM|PM)?';
const CLOCK = '(\\d{1,2})\\s*(?::|點|点|時|时)\\s*(\\d{1,2}|半)?\\s*分?';
const TIME_RE = new RegExp(`${PERIOD}\\s*${CLOCK}\\s*${PERIOD}`);
const RANGE_RE = new RegExp(
  `${PERIOD}\\s*${CLOCK}\\s*${PERIOD}\\s*(?:-|~|至|到)\\s*${PERIOD}\\s*${CLOCK}\\s*${PERIOD}`
);

function toMinutes(period, hour, minute) {
  let h = Number(hour);
  const min = minute === '半' ? 30 : Number(minute || 0);
  const p = (period || '').toLowerCase();
  if (['下午', '晚上', '傍晚', 'pm'].includes(p) && h < 12) h += 12;
  if (p === '中午' && h < 11) h += 12;
  if (['上午', '早上', '凌晨', 'am'].includes(p) && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function takeTime(text) {
  let m = text.match(RANGE_RE);
  if (m) {
    const startPeriod = m[1] || m[4];
    const start = toMinutes(startPeriod, m[2], m[3]);
    let end = toMinutes(m[5] || m[8] || startPeriod, m[6], m[7]);
    // 例如「下午1:00-3:00」或「11:00-1:00」，結束時間比開始早就往後推 12 小時
    if (start != null && end != null && end <= start && end < 12 * 60) end += 12 * 60;
    return { start, end, range: true, match: m[0] };
  }
  m = text.match(TIME_RE);
  if (m) return { start: toMinutes(m[1] || m[4], m[2], m[3]), end: null, range: false, match: m[0] };
  return null;
}

/**
 * @param {string} input 使用者輸入
 * @param {{today?: Date, defaultDuration?: number}} [opts]
 */
export function parseEvent(input, opts = {}) {
  const today = startOfDay(opts.today || new Date());
  const defaultDuration = opts.defaultDuration || 60;
  const errors = [];
  let rest = normalize(input);

  const tags = [];
  rest = rest.replace(/#([^\s#\[\]@]+)/g, (_, tag) => {
    tags.push(tag);
    return ' ';
  });

  let title = '';
  const bracket = rest.match(/\[([^\]]+)\]/);
  if (bracket) {
    title = bracket[1].trim();
    rest = rest.replace(bracket[0], ' ');
  }

  let location = '';
  const loc = rest.match(/(?:@|＠|地點\s*:)\s*([^\s\[\]#@]+)/);
  if (loc) {
    location = loc[1].trim();
    rest = rest.replace(loc[0], ' ');
  }

  const dateHit = takeDate(rest, today);
  if (dateHit) rest = rest.replace(dateHit.match, ' ');
  const timeHit = takeTime(rest);
  if (timeHit) rest = rest.replace(timeHit.match, ' ');

  rest = rest.replace(/\s+/g, ' ').replace(/^[\s,，、:\-]+|[\s,，、:\-]+$/g, '');
  let notes = '';
  if (title) notes = rest;
  else title = rest;

  if (!dateHit) errors.push('找不到日期，例如 2026/11/12、11/12、明天、下週三');
  else if (!dateHit.date) errors.push('日期不存在，請檢查月份與日期');
  if (timeHit && (timeHit.start == null || (timeHit.range && timeHit.end == null)))
    errors.push('時間格式看不懂，例如 9:30-12:00');
  if (timeHit && timeHit.start != null && timeHit.end != null && timeHit.end <= timeHit.start)
    errors.push('結束時間要晚於開始時間');
  if (!title) errors.push('缺少行程名稱，例如 [院前瞻期末報告會議]');

  const allDay = !timeHit;
  let start = null;
  let end = null;
  if (dateHit && dateHit.date) {
    const base = dateHit.date;
    if (allDay) {
      start = base;
      end = addDays(base, 1);
    } else if (timeHit.start != null) {
      start = new Date(base.getTime());
      start.setMinutes(timeHit.start);
      end = new Date(base.getTime());
      end.setMinutes(timeHit.end != null ? timeHit.end : timeHit.start + defaultDuration);
    }
  }

  return { ok: errors.length === 0, errors, title, location, notes, tags, allDay, start, end };
}

const pad = (n) => String(n).padStart(2, '0');

export function formatDate(d) {
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function formatTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRange(ev) {
  const weekday = '日一二三四五六'[ev.start.getDay()];
  const day = `${formatDate(ev.start)}（${weekday}）`;
  if (ev.allDay) return `${day} 全天`;
  const sameDay = startOfDay(ev.start).getTime() === startOfDay(ev.end).getTime();
  return `${day} ${formatTime(ev.start)}–${sameDay ? '' : formatDate(ev.end) + ' '}${formatTime(ev.end)}`;
}
