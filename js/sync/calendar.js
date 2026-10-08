// 把行程寫進 iPhone 內建「行事曆」：
//  - shortcut：呼叫 iOS「捷徑」App，自動新增事件（最順，需先建立一次捷徑，見 README）
//  - ics：下載 .ics 檔，iOS 會跳出「加入行事曆」
//  - outlook：透過 Microsoft Graph 寫入公司 Outlook 行事曆（手機已加公司帳號就會同步到內建行事曆）

const pad = (n) => String(n).padStart(2, '0');

function localStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortcutPayload(ev) {
  return {
    title: ev.title,
    start: localStamp(ev.start),
    end: localStamp(ev.end),
    allDay: ev.allDay ? '1' : '0',
    location: ev.location || '',
    notes: [ev.notes, (ev.tags || []).map((t) => '#' + t).join(' ')].filter(Boolean).join('\n'),
  };
}

export function shortcutUrl(ev, shortcutName) {
  const params = new URLSearchParams({
    name: shortcutName || '加入行程',
    input: 'text',
    text: JSON.stringify(shortcutPayload(ev)),
  });
  // iOS 捷徑不吃 URLSearchParams 的「+」空白，改成 %20
  return `shortcuts://run-shortcut?${params.toString().replace(/\+/g, '%20')}`;
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateStamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function buildIcs(ev, uid) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//thought-task-entry//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@thought-task-entry`,
    `DTSTAMP:${utcStamp(new Date())}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${dateStamp(ev.start)}` : `DTSTART:${utcStamp(ev.start)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${dateStamp(ev.end)}` : `DTEND:${utcStamp(ev.end)}`,
    `SUMMARY:${icsText(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${icsText(ev.location)}`);
  const notes = shortcutPayload(ev).notes;
  if (notes) lines.push(`DESCRIPTION:${icsText(notes)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function openIcs(ev, uid) {
  const ics = buildIcs(ev, uid);
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    // iOS Safari 開啟 text/calendar 會直接跳出「加入行事曆」畫面
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ev.title || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
