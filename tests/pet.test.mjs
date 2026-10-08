import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visit, gain, energyNow, levelInfo, mood } from '../js/pet.js';

const fresh = () => ({ xp: 0, energy: 70, energyAt: '', streak: 0, best: 0, lastDay: null, days: [], stats: { todosDone: 0, todosAdded: 0, notes: 0, events: 0 }, unlocked: [], equipped: null });
const at = (d, h = 9) => new Date(2026, 9, d, h);

test('連續天數：同一天只算一次，隔天 +1，斷掉重算', () => {
  const p = fresh();
  assert.equal(visit(p, at(1)).streak, 1);
  assert.equal(visit(p, at(1, 20)).firstToday, false);
  assert.equal(visit(p, at(2)).streak, 2);
  assert.equal(visit(p, at(3)).streak, 3);
  const r = visit(p, at(6));
  assert.equal(r.streak, 1);
  assert.equal(r.away, 3);
  assert.equal(p.best, 3);
  assert.deepEqual(p.days, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06']);
});

test('連續 3 天解鎖小花、第一次完成待辦解鎖派對帽', () => {
  const p = fresh();
  visit(p, at(1));
  visit(p, at(2));
  assert.deepEqual(visit(p, at(3)).unlocked.map((a) => a.id), ['flower']);
  assert.deepEqual(gain(p, 'todo.done', at(3)).unlocked.map((a) => a.id), ['party']);
  assert.deepEqual(gain(p, 'todo.done', at(3)).unlocked, []);
});

test('能量每小時少 1，做事會補，最多 100', () => {
  const p = fresh();
  p.energyAt = at(1, 0).toISOString();
  assert.equal(energyNow(p, at(1, 10)), 60);
  gain(p, 'todo.done', at(1, 10));
  assert.equal(p.energy, 72);
  assert.equal(energyNow(p, at(5, 10)), 0);
  for (let i = 0; i < 20; i++) gain(p, 'todo.done', at(5, 10));
  assert.equal(p.energy, 100);
  assert.equal(mood(5), 'starving');
});

test('升級門檻', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(9).level, 1);
  assert.equal(levelInfo(10).level, 2);
  assert.deepEqual(levelInfo(35), { level: 3, into: 5, need: 30, toNext: 25 });
  const p = fresh();
  p.xp = 8;
  assert.equal(gain(p, 'todo.done').levelUp, 2);
});
