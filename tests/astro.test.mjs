import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, moonPhase, planetPosition, longitudeOf, nextPhase, eclipse, phaseName, gmst } from '../js/astro.js';

const near = (a, b, tol, msg) => {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  assert.ok(d <= tol, `${msg}: ${a.toFixed(2)} vs ${b} (差 ${d.toFixed(2)}°)`);
};

test('春分時太陽黃經 0 度、夏至 90 度', () => {
  near(sunPosition(new Date('2024-03-20T03:06Z')).lon, 0, 0.1, '2024 春分');
  near(sunPosition(new Date('2025-06-21T02:42Z')).lon, 90, 0.1, '2025 夏至');
});

test('日食、月食時月亮的位置對得上', () => {
  const solar = new Date('2024-04-08T18:17Z'); // 北美日全食
  near(moonPhase(solar).elong, 0, 0.6, '日食時日月同方向');
  assert.ok(Math.abs(moonPhase(solar).moon.lat) < 0.5);
  assert.equal(eclipse(solar), 'solar');
  const lunar = new Date('2025-03-14T06:59Z'); // 月全食
  near(moonPhase(lunar).elong, 180, 0.6, '月食時日月相對');
  assert.equal(eclipse(lunar), 'lunar');
  assert.equal(moonPhase(lunar).name, '滿月');
  assert.ok(moonPhase(lunar).illum > 0.99);
  assert.equal(eclipse(new Date('2025-03-20T00:00Z')), null);
});

test('下一次滿月、新月', () => {
  const full = nextPhase(new Date('2025-03-01T00:00Z'), 180);
  assert.ok(Math.abs(full - new Date('2025-03-14T06:55Z')) < 3 * 3600e3, `滿月 ${full.toISOString()}`);
  const nm = nextPhase(new Date('2024-04-01T00:00Z'), 0);
  assert.ok(Math.abs(nm - new Date('2024-04-08T18:21Z')) < 3 * 3600e3, `新月 ${nm.toISOString()}`);
});

test('地球的日心黃經 = 太陽地心黃經 + 180 度', () => {
  const d = new Date('2026-10-12T00:00Z');
  near(longitudeOf(planetPosition('earth', d)), sunPosition(d).lon + 180, 0.5, '地球');
});

test('行星衝日時，行星和地球在太陽同一側', () => {
  for (const [name, date] of [['mars', '2025-01-16'], ['jupiter', '2024-12-07'], ['saturn', '2025-09-21']]) {
    const d = new Date(date + 'T12:00Z');
    near(longitudeOf(planetPosition(name, d)), longitudeOf(planetPosition('earth', d)), 2, name);
  }
  const r = (p) => Math.hypot(p.x, p.y, p.z);
  assert.ok(Math.abs(r(planetPosition('jupiter', new Date())) - 5.2) < 0.3);
});

test('月相名稱', () => {
  assert.deepEqual([0, 45, 90, 135, 180, 225, 270, 315].map(phaseName), ['新月', '眉月', '上弦月', '盈凸月', '滿月', '虧凸月', '下弦月', '殘月']);
});

test('恆星時：2000-01-01 12:00 UT 約 280.46 度', () => {
  near(gmst(new Date(Date.UTC(2000, 0, 1, 12))), 280.46, 0.01, 'GMST');
});
