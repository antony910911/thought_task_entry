import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../js/aliens.js';

const inside = (r, c) => r >= 0 && r < 16 && c >= 0 && c < 16;

test('每隻外星人的像素圖都是 16×16，部位都在圖內', () => {
  for (const [id, a] of Object.entries(CHARACTERS)) {
    assert.equal(a.base.length, 16, `${id} 列數`);
    a.base.forEach((row, i) => assert.equal(row.length, 16, `${id} 第 ${i} 列`));
    for (const [r, str] of a.legs || []) assert.ok(r < 16 && str.length === 16, `${id} 腳 ${r}`);
    for (const [name, cells] of Object.entries(a.eyes))
      for (const [r, c] of cells) {
        assert.ok(inside(r, c) && inside(r - 1, c + 1) && inside(r, c - 1), `${id} eyes.${name} ${r},${c}`);
        if (a.mirror !== false) assert.ok(inside(r, 15 - c + 1) && inside(r, 15 - c - 1), `${id} 右眼 ${r},${c}`);
      }
    for (const group of [a.mouths, a.arms])
      for (const [name, cells] of Object.entries(group)) for (const [r, c] of cells) assert.ok(inside(r, c), `${id} ${name} ${r},${c}`);
    for (const k of ['normal', 'blink', 'closed', 'happy', 'surprised', 'dizzy']) assert.ok(a.eyes[k], `${id} 缺 eyes.${k}`);
    for (const k of ['smile', 'neutral', 'open', 'wavy']) assert.ok(a.mouths[k], `${id} 缺 mouths.${k}`);
    for (const k of ['down', 'up', 'upL', 'upR', 'midR']) assert.ok(a.arms[k], `${id} 缺 arms.${k}`);
    assert.ok(a.colors({ todo: '#000000', note: '#000000' }).B, `${id} 缺身體顏色`);
  }
});
