import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, themeVars, onColor, contrast } from '../js/themes.js';

const KEYS = ['accent', 'todo', 'note', 'event', 'bg'];

test('每組配色都有完整的淺色與深色', () => {
  const ids = new Set();
  for (const t of THEMES) {
    assert.ok(!ids.has(t.id), `重複 id ${t.id}`);
    ids.add(t.id);
    for (const mode of ['light', 'dark'])
      for (const k of KEYS) assert.match(t[mode][k], /^#[0-9A-F]{6}$/i, `${t.id}.${mode}.${k}`);
  }
});

test('按鈕文字與底色有足夠對比', () => {
  for (const t of THEMES)
    for (const mode of ['light', 'dark']) {
      const c = t[mode];
      for (const k of ['accent', 'todo', 'note', 'event'])
        assert.ok(contrast(c[k], onColor(c[k])) >= 1.8, `${t.id}.${mode}.${k} 上的文字太淡`);
      // 主色當文字（連結）放在底色上要看得到
      assert.ok(contrast(c.accent, c.bg) >= 2.5, `${t.id}.${mode} accent 在底色上太淡`);
    }
});

test('themeVars 產生淺深兩組變數', () => {
  const vars = themeVars(THEMES[0]);
  assert.equal(vars['--accent-l'], '#007AFF');
  assert.equal(vars['--accent-d'], '#0A84FF');
  assert.equal(vars['--on-accent-l'], '#FFFFFF');
  assert.equal(onColor('#E5E5EA'), '#000000');
});
