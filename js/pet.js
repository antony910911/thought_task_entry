// 外星人養成：每天來看他、完成事情就能餵他、讓他升級，還能解鎖配件。
//
// 能量 0–100：每小時少 1 點（一天約 24 點），做事情會補回來。
// 經驗值：做事情就會增加，升到下一級需要的經驗越來越多。
// 連續天數：每天第一次打開 App 算一天；中間斷一天就重新算。

export const GAINS = {
  visit: { xp: 2, energy: 5, label: '每天打開 App' },
  'todo.add': { xp: 1, energy: 4, label: '新增待辦' },
  'todo.done': { xp: 3, energy: 12, label: '完成待辦' },
  'note.add': { xp: 3, energy: 10, label: '寫一篇筆記' },
  'event.add': { xp: 2, energy: 6, label: '加入行程' },
};

export const ACCESSORIES = [
  { id: 'party', name: '派對帽', hint: '完成第 1 件待辦', goal: 1, stat: (p) => p.stats.todosDone },
  { id: 'flower', name: '小花', hint: '連續使用 3 天', goal: 3, stat: (p) => p.best },
  { id: 'shades', name: '太陽眼鏡', hint: '寫 5 篇筆記', goal: 5, stat: (p) => p.stats.notes },
  { id: 'bow', name: '蝴蝶結', hint: '完成 20 件待辦', goal: 20, stat: (p) => p.stats.todosDone },
  { id: 'crown', name: '皇冠', hint: '連續使用 7 天', goal: 7, stat: (p) => p.best },
];

const DECAY_PER_HOUR = 1;

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 第 n 級需要的累積經驗：Lv1=0、Lv2=10、Lv3=30、Lv4=60、Lv5=100… */
export function xpForLevel(n) {
  return 5 * n * (n - 1);
}

export function levelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level += 1;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, into: xp - from, need: to - from, toNext: to - xp };
}

export function energyNow(pet, now = new Date()) {
  const at = pet.energyAt ? new Date(pet.energyAt) : now;
  const hours = Math.max(0, (now - at) / 3_600_000);
  return Math.max(0, Math.min(100, Math.round(pet.energy - hours * DECAY_PER_HOUR)));
}

export function mood(energy) {
  if (energy >= 70) return 'happy';
  if (energy >= 35) return 'ok';
  if (energy >= 10) return 'hungry';
  return 'starving';
}

export const MOOD_TEXT = { happy: '吃飽飽', ok: '還可以', hungry: '肚子餓了', starving: '快餓扁了' };

function checkUnlocks(pet) {
  const found = [];
  for (const a of ACCESSORIES) {
    if (!pet.unlocked.includes(a.id) && a.stat(pet) >= a.goal) {
      pet.unlocked.push(a.id);
      found.push(a);
    }
  }
  return found;
}

function apply(pet, kind, now) {
  const g = GAINS[kind];
  const before = levelInfo(pet.xp).level;
  pet.energy = Math.min(100, energyNow(pet, now) + g.energy);
  pet.energyAt = now.toISOString();
  pet.xp += g.xp;
  const level = levelInfo(pet.xp).level;
  return { kind, gain: g, levelUp: level > before ? level : null, unlocked: checkUnlocks(pet) };
}

/** 每次打開 App 呼叫；一天只算一次 */
export function visit(pet, now = new Date()) {
  const today = dayKey(now);
  if (pet.lastDay === today) return { firstToday: false, streak: pet.streak, unlocked: [] };
  const yesterday = dayKey(addDays(now, -1));
  pet.streak = pet.lastDay === yesterday ? pet.streak + 1 : 1;
  pet.best = Math.max(pet.best, pet.streak);
  const away = pet.lastDay ? Math.round((new Date(`${today}T00:00`) - new Date(`${pet.lastDay}T00:00`)) / 86_400_000) : 0;
  pet.lastDay = today;
  pet.days = [...new Set([...pet.days, today])].slice(-120);
  return { firstToday: true, streak: pet.streak, away, ...apply(pet, 'visit', now) };
}

/** 做了一件事：kind 是 GAINS 的 key */
export function gain(pet, kind, now = new Date()) {
  if (kind === 'todo.add') pet.stats.todosAdded += 1;
  if (kind === 'todo.done') pet.stats.todosDone += 1;
  if (kind === 'note.add') pet.stats.notes += 1;
  if (kind === 'event.add') pet.stats.events += 1;
  return apply(pet, kind, now);
}
