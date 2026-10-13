// 石墨配色的首頁舞台：像素風的日、地、月（或九大行星），位置跟著真實的天體走。
// - 單指拖曳：轉視角（明暗會跟著變，從太陽那側看是滿的、從背面看是細細一彎）
// - 雙指捏合／滑鼠滾輪：放大縮小；雙指拖曳：平移；點兩下：回到預設視角
// - 戳星球：會有表情和動畫，還會說出現在的真實資料（月相、距離…）；太小的星球會先飛過去
// - 時光機：快轉時間看月相、日月食、行星繞太陽
// 畫法：先在小解析度的緩衝區一格一格算（每格做球面打光、z-buffer），再放大貼到 canvas。

import { sunPosition, moonPosition, moonPhase, planetPosition, nextPhase, eclipse, gmst, OBLIQUITY } from './astro.js';

const PX = 3; // 一格 = 3 CSS px
const STAGE_H = 240;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

// ---------- 小工具 ----------

const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fract = (x) => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
const mix = (c1, c2, k) => [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)];

/** 赤道座標（赤經、赤緯，度）的方向 → 黃道座標的單位向量 */
function eqToEcl(ra, dec) {
  const e = OBLIQUITY * RAD;
  const x = Math.cos(dec * RAD) * Math.cos(ra * RAD);
  const y = Math.cos(dec * RAD) * Math.sin(ra * RAD);
  const z = Math.sin(dec * RAD);
  return V(x, y * Math.cos(e) + z * Math.sin(e), -y * Math.sin(e) + z * Math.cos(e));
}
const eclDir = (lonDeg, latDeg = 0) => V(Math.cos(latDeg * RAD) * Math.cos(lonDeg * RAD), Math.cos(latDeg * RAD) * Math.sin(lonDeg * RAD), Math.sin(latDeg * RAD));

/** 自轉軸 P 與兩個和它垂直的方向（經度 0 在 A） */
function frame(P, hint = V(1, 0, 0)) {
  let A = sub(hint, mul(P, dot(hint, P)));
  if (len(A) < 1e-6) A = sub(V(0, 1, 0), mul(P, P.y));
  A = unit(A);
  return { P, A, B: cross(P, A) };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

// ---------- 星球的表面（輸入：緯度、經度（弧度）；輸出 RGB） ----------

// 地球陸地：每列是 10 度緯度帶（北到南，70N 開始），[起, 迄] 是經度格（-180 起每 10 度一格）
const LAND = [
  [[1, 3], [5, 15], [19, 19], [23, 23], [25, 34]], // 70–80N
  [[0, 7], [10, 14], [16, 16], [18, 35]], // 60–70N
  [[2, 2], [4, 12], [17, 31], [34, 34]], // 50–60N
  [[5, 12], [17, 21], [23, 32]], // 40–50N
  [[6, 10], [17, 31]], // 30–40N
  [[7, 9], [16, 30]], // 20–30N
  [[8, 9], [16, 22], [25, 25], [28, 28], [30, 30]], // 10–20N
  [[10, 12], [17, 22], [28, 30]], // 0–10N
  [[10, 14], [19, 21], [28, 32]], // 0–10S
  [[10, 13], [19, 22], [30, 32]], // 10–20S
  [[11, 13], [19, 21], [29, 32]], // 20–30S
  [[11, 12], [19, 19], [29, 32], [35, 35]], // 30–40S
  [[11, 11], [32, 32], [34, 34]], // 40–50S
  [[11, 11]], // 50–60S
  [[10, 11]], // 60–70S
];
const DESERT = [[5, [16, 24]], [4, [22, 25]], [9, [30, 31]], [10, [29, 31]]];
function landAt(latDeg, lonDeg) {
  const row = Math.floor((80 - latDeg) / 10);
  if (row < 0 || row >= LAND.length) return 0;
  const col = ((Math.floor((lonDeg + 180) / 10) % 36) + 36) % 36;
  if (!LAND[row].some(([a, b]) => col >= a && col <= b)) return 0;
  return DESERT.some(([r, [a, b]]) => r === row && col >= a && col <= b) ? 2 : 1;
}

function earthTex(lat, lon, t) {
  const la = lat / RAD, lo = lon / RAD;
  if (Math.abs(la) > 72 + noise(lo / 25, 3) * 8) return [236, 242, 248];
  // 海岸線加一點雜訊，不會那麼方
  const j = (noise(lo / 7, la / 7) - 0.5) * 9;
  const k = landAt(la + j, lo + j);
  let c = k === 2 ? [212, 180, 112] : k === 1 ? mix([72, 158, 72], [120, 170, 70], noise(lo / 9, la / 9)) : mix([28, 88, 190], [40, 110, 210], noise(lo / 12, la / 12));
  const cloud = noise(lo / 22 + t * 0.002, la / 14) * noise(lo / 9 - t * 0.003, la / 9 + 5);
  if (cloud > 0.36) c = mix(c, [250, 250, 252], Math.min(1, (cloud - 0.36) * 6));
  return c;
}
const MARIA = [[32, -16, 14], [28, 17, 9], [8, 31, 10], [17, 59, 6], [-8, 51, 7], [-21, -17, 8], [18, -57, 16], [-25, -40, 7]];
function moonTex(lat, lon) {
  const la = lat / RAD, lo = lon / RAD;
  let c = mix([196, 196, 198], [214, 214, 216], noise(lo / 10, la / 10));
  for (const [mla, mlo, r] of MARIA) {
    const d = Math.hypot(la - mla, (lo - mlo) * Math.cos(la * RAD));
    if (d < r + noise(lo / 4, la / 4) * 5) c = mix(c, [128, 128, 134], 0.75);
  }
  if (hash(Math.floor(lo / 6), Math.floor(la / 6)) > 0.93) c = mix(c, [150, 150, 154], 0.6);
  return c;
}
function sunTex(lat, lon, t) {
  const g = noise(lon * 8 + t * 0.4, lat * 8) * 0.5 + noise(lon * 20, lat * 20 + t) * 0.5;
  return mix([255, 176, 30], [255, 226, 110], g);
}
const bands = (lat, cols, wob = 0) => {
  const i = Math.floor(((lat / RAD + 90 + wob) / 180) * cols.length * 3) % cols.length;
  return cols[(i + cols.length) % cols.length];
};
const TEX = {
  sun: sunTex,
  earth: earthTex,
  moon: moonTex,
  mercury: (lat, lon) => (hash(Math.floor(lon / 0.18), Math.floor(lat / 0.18)) > 0.88 ? [120, 116, 112] : mix([150, 146, 140], [178, 172, 166], noise(lon * 3, lat * 3))),
  venus: (lat, lon, t) => mix([226, 196, 130], [246, 226, 170], noise(lon * 2 + t * 0.01, lat * 6)),
  mars: (lat, lon) => (Math.abs(lat / RAD) > 72 ? [240, 236, 230] : noise(lon * 2.5, lat * 2.5) > 0.62 ? [130, 60, 34] : mix([196, 86, 44], [214, 120, 70], noise(lon * 5, lat * 5))),
  jupiter: (lat, lon) => {
    const la = lat / RAD;
    const dl = (((lon / RAD) % 360) + 360) % 360;
    if (Math.abs(la + 22) < 6 && (dl < 22 || dl > 338)) return [196, 92, 60]; // 大紅斑
    return bands(lat, [[214, 176, 132], [242, 226, 196], [176, 124, 84], [236, 210, 170]], noise(lon * 3, lat * 3) * 4);
  },
  saturn: (lat, lon) => bands(lat, [[228, 206, 150], [210, 184, 124], [240, 222, 172]], noise(lon * 2, lat * 2) * 2),
  uranus: (lat) => mix([150, 218, 226], [176, 232, 236], Math.abs(Math.sin(lat * 3))),
  neptune: (lat, lon) => (Math.abs(lat / RAD + 20) < 6 && Math.abs(((lon / RAD + 540) % 360) - 180) < 12 ? [36, 52, 140] : mix([62, 98, 216], [90, 130, 232], noise(lon * 2, lat * 5))),
  pluto: (lat, lon) => {
    const la = lat / RAD, lo = lon / RAD;
    const heart = Math.hypot((lo - 0) / 1.2, la - 5) < 22 || Math.hypot((lo + 18) / 1.2, la - 18) < 14;
    return heart ? [244, 230, 210] : mix([188, 150, 116], [214, 184, 150], noise(lo / 12, la / 12));
  },
};

// ---------- 星球資料 ----------

const BODY = {
  sun: { name: '太陽', color: [255, 186, 40], pole: [286.13, 63.87], period: 609.1 },
  mercury: { name: '水星', color: [160, 156, 150], pole: [281.01, 61.41], period: 1407.6, r: 0.32 },
  venus: { name: '金星', color: [232, 206, 146], pole: [272.76, 67.16], period: -5832.5, r: 0.5 },
  earth: { name: '地球', color: [60, 140, 220], pole: [0, 90], r: 0.52 },
  moon: { name: '月亮', color: [196, 196, 198] },
  mars: { name: '火星', color: [204, 96, 54], pole: [317.68, 52.89], period: 24.62, r: 0.4 },
  jupiter: { name: '木星', color: [216, 180, 136], pole: [268.06, 64.5], period: 9.93, r: 1.15 },
  saturn: { name: '土星', color: [226, 204, 148], pole: [40.59, 83.54], period: 10.66, r: 0.95, ring: [1.35, 2.2, [220, 202, 156]] },
  uranus: { name: '天王星', color: [156, 222, 230], pole: [257.31, -15.18], period: -17.24, r: 0.72, ring: [1.6, 1.75, [180, 210, 220]] },
  neptune: { name: '海王星', color: [70, 110, 220], pole: [299.36, 43.46], period: 16.11, r: 0.7 },
  pluto: { name: '冥王星', color: [214, 186, 152], pole: [132.99, -6.16], period: -153.3, r: 0.26 },
};
const ORDER = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
for (const b of Object.values(BODY)) if (b.pole) b.poleVec = eqToEcl(b.pole[0], b.pole[1]);
const visR = (au) => 3.2 + 4 * Math.sqrt(au); // 九大行星的距離壓縮：外行星不會跑太遠

const ZODIAC = ['牡羊座', '金牛座', '雙子座', '巨蟹座', '獅子座', '處女座', '天秤座', '天蠍座', '射手座', '摩羯座', '水瓶座', '雙魚座'];

const FACTS = {
  sun: ['我是太陽，今天也努力發光！', '光從我這裡跑到地球要 8 分 20 秒', '我大到可以裝下 130 萬個地球', '我已經 46 億歲了，還很年輕喔'],
  earth: ['藍藍的就是我～', '我轉一圈是一天，繞太陽一圈是一年', '我是唯一有你的星球'],
  moon: ['我永遠用同一面看著你', '我每年離地球遠 3.8 公分', '潮汐是我拉出來的喔'],
  mercury: ['我是水星，跑最快的！繞太陽一圈只要 88 天', '我白天 430 度、晚上零下 180 度…'],
  venus: ['我是金星，最亮的那顆「星」就是我', '我自轉是反著轉的，太陽從西邊出來', '我比水星還熱，雲裡都是硫酸'],
  mars: ['我是火星，紅紅的是鐵鏽', '我有太陽系最高的火山：奧林帕斯山', '好幾台探測車在我身上散步'],
  jupiter: ['我是木星，太陽系最大！', '我身上的大紅斑是比地球還大的風暴', '我有 90 幾顆衛星'],
  saturn: ['我是土星，看我的呼拉圈！', '我的密度比水還小，丟進浴缸會浮起來', '我的環主要是冰塊'],
  uranus: ['我是天王星，我是躺著轉的', '我的一年是 84 個地球年'],
  neptune: ['我是海王星，風速每小時 2000 公里！', '我是用數學算出來才被找到的'],
  pluto: ['我是冥王星…我還算是行星嗎？', '在這裡我還是第九大行星！謝謝你', '我身上有一顆愛心喔'],
};

const ANIMS = {
  sun: ['flare', 'cool', 'bounce', 'spin'],
  earth: ['wave', 'spin', 'jump', 'blush'],
  moon: ['wink', 'jump', 'blush', 'spin'],
  mercury: ['zoom', 'jump', 'spin'],
  venus: ['blush', 'wave', 'spin'],
  mars: ['dust', 'wave', 'jump'],
  jupiter: ['storm', 'bounce', 'wave'],
  saturn: ['hula', 'wave', 'bounce'],
  uranus: ['roll', 'wave', 'jump'],
  neptune: ['wind', 'wave', 'spin'],
  pluto: ['blush', 'jump', 'wave'],
};

/** 從時區猜你大概在哪（只拿來在地球上標「你在這裡」） */
function homeLocation() {
  const zones = {
    'Asia/Taipei': [25.03, 121.56], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Shanghai': [31.23, 121.47], 'Asia/Hong_Kong': [22.32, 114.17],
    'Asia/Singapore': [1.35, 103.82], 'Asia/Seoul': [37.57, 126.98], 'Europe/London': [51.5, -0.12], 'America/New_York': [40.71, -74.0],
    'America/Los_Angeles': [34.05, -118.24], 'Australia/Sydney': [-33.87, 151.21],
  };
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zones[z]) return zones[z];
  } catch {}
  return [25, -new Date().getTimezoneOffset() / 4];
}

// ---------- 時光機 ----------

const SPEEDS = [
  { s: 0, label: '現在' },
  { s: 3600, label: '1 小時/秒' },
  { s: 86400, label: '1 天/秒' },
  { s: 86400 * 7, label: '1 週/秒' },
  { s: 86400 * 30, label: '1 個月/秒' },
];

/**
 * @param {HTMLElement} stage
 * @param {{ view?: 'moon'|'planets', status?: HTMLElement, lines?: () => string[] }} opts
 */
export function mountCosmos(stage, opts = {}) {
  stage.classList.add('cosmos');
  const canvas = document.createElement('canvas');
  canvas.className = 'blip-canvas cosmos-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '太陽、地球和月亮現在的實際位置。拖曳轉視角、捏合縮放、點星球互動');
  const bubble = document.createElement('div');
  bubble.className = 'blip-bubble';
  bubble.hidden = true;
  const ui = document.createElement('div');
  ui.className = 'cosmos-ui';
  ui.innerHTML = `<button type="button" class="cz-btn" data-act="time" aria-label="時光機"></button><button type="button" class="cz-btn" data-act="reset" aria-label="回到預設視角">⟲</button>`;
  stage.append(canvas, bubble, ui);
  const ctx = canvas.getContext('2d');
  const low = document.createElement('canvas');
  const lctx = low.getContext('2d');

  let view = opts.view === 'planets' ? 'planets' : 'moon';
  let W = 120;
  let H = Math.floor(STAGE_H / PX);
  let img, buf, zbuf, idbuf;
  let stars = [];
  const home = homeLocation();

  // 時間
  let offset = 0;
  let speedIdx = 0;
  const simDate = () => new Date(Date.now() + offset);

  // 相機（cur 會慢慢追 want）
  const cam = { yaw: 0, pitch: 55 * RAD, scale: 6, tx: 0, ty: 0, tz: 0 };
  const want = { ...cam };
  let focus = null; // 正在跟著的星球
  let faceDir = V(0, -1, 0.3); // 大家的臉都朝著預設視角（轉視角就會看到側臉、後腦勺）
  let faceCam = { yaw: 0, pitch: 0.5 };
  let bodies = [];
  let drawn = []; // 最後畫出來的那一幀（有螢幕位置），點擊判斷用
  let orbits = {};
  const state = {}; // 每顆星球的動畫、戳的次數
  const particles = [];
  let bubbleFor = null;
  let bubbleUntil = 0;
  let statusOverride = null;
  let statusUntil = 0;
  let lastStatus = 0;

  // ---------- 場景 ----------

  function scene(date) {
    const t = date.getTime() / 3600e3; // 小時
    const list = [];
    if (view === 'moon') {
      const s = sunPosition(date);
      const m = moonPosition(date);
      const sunDir = eclDir(s.lon);
      const moonDir = eclDir(m.lon, m.lat);
      const g = gmst(date);
      const ecl = eclipse(date);
      list.push({ id: 'sun', pos: mul(sunDir, 9), r: 2.4, emissive: true, spin: (t / BODY.sun.period) * TAU });
      list.push({ id: 'earth', pos: V(0, 0, 0), r: 1.6, light: sunDir, earth: g, home: true });
      list.push({ id: 'moon', pos: mul(moonDir, 3.6), r: 0.85, light: sunDir, faceEarth: true, tint: ecl === 'lunar' ? [190, 70, 40] : null, eclipse: ecl });
    } else {
      list.push({ id: 'sun', pos: V(0, 0, 0), r: 2.0, emissive: true, spin: (t / BODY.sun.period) * TAU });
      for (const id of ORDER) {
        const p = planetPosition(id, date);
        const r = len(p);
        const pos = mul(p, visR(r) / r);
        const b = { id, pos, r: BODY[id].r, light: unit(mul(pos, -1)), au: r, raw: p };
        if (id === 'earth') b.earth = gmst(date);
        else b.spin = (t / BODY[id].period) * TAU;
        list.push(b);
        if (id === 'earth') {
          const m = moonPosition(date);
          list.push({ id: 'moon', pos: add(pos, mul(eclDir(m.lon, m.lat), 1.15)), r: 0.17, light: b.light, faceEarth: true, earthPos: pos });
        }
      }
    }
    for (const b of list) {
      const st = state[b.id] || (state[b.id] = { pokes: 0, pokeAt: 0, anim: null, blinkAt: performance.now() + rand(1000, 4000) });
      b.st = st;
      b.def = BODY[b.id];
    }
    return list;
  }

  function buildOrbits() {
    orbits = {};
    if (view !== 'planets') return;
    const now = simDate();
    for (const id of ORDER) {
      const a = len(planetPosition(id, now));
      const days = 365.25 * Math.pow(a, 1.5);
      const pts = [];
      const n = 120;
      for (let i = 0; i < n; i++) {
        const p = planetPosition(id, new Date(now.getTime() + (i / n) * days * 86400e3));
        const r = len(p);
        pts.push(mul(p, visR(r) / r));
      }
      orbits[id] = pts;
    }
  }

  // ---------- 相機 ----------

  function project(p, c = cam) {
    const x = p.x - c.tx, y = p.y - c.ty, z = p.z - c.tz;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const x1 = x * cy + y * sy;
    const y1 = -x * sy + y * cy;
    return { sx: W / 2 + x1 * c.scale, sy: H / 2 - (y1 * sp + z * cp) * c.scale, depth: -y1 * cp + z * sp };
  }
  /** 螢幕上的法向量（x 右、y 上、z 朝向你）→ 世界座標 */
  function toWorld(nx, ny, nz) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = nx;
    const y1 = ny * sp - nz * cp;
    const z1 = ny * cp + nz * sp;
    return V(x1 * cy - y1 * sy, x1 * sy + y1 * cy, z1);
  }
  const viewDir = () => toWorld(0, 0, 1);

  /** 預設視角：所有東西剛好裝進畫面 */
  function defaultView() {
    const list = scene(simDate());
    const c = { yaw: 0, pitch: 55 * RAD, scale: 1, tx: 0, ty: 0, tz: 0 };
    if (view === 'moon') {
      const sun = list.find((b) => b.id === 'sun');
      // 太陽在左邊；視角稍微偏向太陽那側，看到的地球、月亮大多是亮的
      c.yaw = Math.atan2(sun.pos.y, sun.pos.x) + Math.PI - 35 * RAD;
      c.pitch = 26 * RAD;
    } else {
      c.yaw = -90 * RAD;
      c.pitch = 58 * RAD;
    }
    const pts = [];
    for (const b of list) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push({ p: b.pos, ox: dx * b.r, oy: dy * b.r });
    if (view === 'planets') for (const o of Object.values(orbits)) for (const p of o) pts.push({ p, ox: 0, oy: 0 });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { p, ox, oy } of pts) {
      const q = project(p, c);
      const x = q.sx - W / 2 + ox, y = q.sy - H / 2 + oy;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const scale = Math.min((W - 10) / (maxX - minX || 1), (H - 26) / (maxY - minY || 1));
    // 把中心移到外框中間：先算出外框中心對應的世界座標
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), sp = Math.sin(c.pitch);
    const x1 = midX, y1 = -midY / sp;
    c.tx = x1 * cy - y1 * sy;
    c.ty = x1 * sy + y1 * cy;
    c.scale = scale;
    c.fit = scale;
    return c;
  }

  /** 相機所在的方向（從場景指向你） */
  const viewerDir = (c) => V(Math.cos(c.pitch) * Math.sin(c.yaw), -Math.cos(c.pitch) * Math.cos(c.yaw), Math.sin(c.pitch));

  function resetView(immediate = false) {
    focus = null;
    const c = defaultView();
    const vd = viewerDir(c);
    faceDir = vd;
    faceCam = { yaw: c.yaw, pitch: c.pitch };
    Object.assign(want, c);
    if (immediate) Object.assign(cam, c);
  }

  // ---------- 畫 ----------

  function resize() {
    const cssW = stage.clientWidth || 340;
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(40, Math.floor(cssW / PX));
    H = Math.floor(STAGE_H / PX);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(STAGE_H * dpr);
    canvas.style.height = STAGE_H + 'px';
    low.width = W;
    low.height = H;
    img = lctx.createImageData(W, H);
    buf = img.data;
    zbuf = new Float32Array(W * H);
    idbuf = new Int8Array(W * H);
    stars = Array.from({ length: 160 }, () => {
      const u = rand(-1, 1), a = rand(0, TAU), s = Math.sqrt(1 - u * u);
      return { d: V(s * Math.cos(a), s * Math.sin(a), u), p: rand(0, TAU), b: rand(0.3, 1) };
    });
  }

  function put(x, y, c, a = 1) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    if (a >= 1) {
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
    } else {
      buf[i] = lerp(buf[i], c[0], a); buf[i + 1] = lerp(buf[i + 1], c[1], a); buf[i + 2] = lerp(buf[i + 2], c[2], a);
    }
    buf[i + 3] = 255;
  }

  /** 明暗分成幾階，交界用網點（像素風） */
  function lightLevel(b, x, y) {
    const k = b * 1.2 + BAYER[(y & 3) * 4 + (x & 3)] * 0.45;
    return k < 0.02 ? 0.24 : k < 0.3 ? 0.5 : k < 0.62 ? 0.78 : 1;
  }

  function drawBackground(now) {
    for (let i = 0; i < W * H; i++) {
      const y = Math.floor(i / W);
      const g = y / H;
      buf[i * 4] = 6 + g * 6; buf[i * 4 + 1] = 8 + g * 6; buf[i * 4 + 2] = 18 + g * 10; buf[i * 4 + 3] = 255;
      zbuf[i] = -Infinity;
      idbuf[i] = -1;
    }
    // 星星固定在很遠的天球上：轉視角時會跟著轉
    const big = Math.max(W, H) * 0.75;
    for (const s of stars) {
      const q = project(add(mul(s.d, big / cam.scale), V(cam.tx, cam.ty, cam.tz)));
      if (q.depth > 0) continue;
      const tw = 0.55 + 0.45 * Math.sin(now / 600 + s.p);
      put(Math.round(q.sx), Math.round(q.sy), [220, 225, 255], s.b * tw);
    }
  }

  function drawOrbit(pts, color, dash = 2) {
    for (let i = 0; i < pts.length; i++) {
      const a = project(pts[i]);
      const b = project(pts[(i + 1) % pts.length]);
      const steps = Math.max(1, Math.ceil(Math.hypot(b.sx - a.sx, b.sy - a.sy)));
      for (let s = 0; s < steps; s++) {
        const k = s / steps;
        const x = Math.round(lerp(a.sx, b.sx, k)), y = Math.round(lerp(a.sy, b.sy, k));
        if ((x + y) % dash) continue;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = lerp(a.depth, b.depth, k);
        if (zbuf[y * W + x] > d) continue;
        put(x, y, color, 0.55);
      }
    }
  }

  /** 地球表面某一點的地理緯度、經度（度） */
  function earthGeo(b, n) {
    const f = frame(b.def.poleVec, V(1, 0, 0));
    const lat = Math.asin(clamp(dot(n, f.P), -1, 1)) / RAD;
    let lon = Math.atan2(dot(n, f.B), dot(n, f.A)) / RAD - b.earth;
    lon = ((lon + 540) % 360) - 180;
    return [lat, lon];
  }

  function surfaceColor(b, n, t) {
    const def = b.def;
    let lat, lon;
    if (b.faceEarth) {
      // 月亮潮汐鎖定：經度 0 對著地球
      const toEarth = unit(mul(sub(b.earthPos || V(0, 0, 0), b.pos), 1));
      const f = frame(V(0, 0, 1), toEarth);
      lat = Math.asin(clamp(dot(n, f.P), -1, 1));
      lon = Math.atan2(dot(n, f.B), dot(n, f.A)) + (b.st.spinBoost || 0);
    } else if (b.earth != null) {
      const f = frame(def.poleVec, V(1, 0, 0));
      lat = Math.asin(clamp(dot(n, f.P), -1, 1));
      lon = Math.atan2(dot(n, f.B), dot(n, f.A)) - b.earth * RAD + (b.st.spinBoost || 0);
    } else {
      const f = frame(def.poleVec || V(0, 0, 1));
      lat = Math.asin(clamp(dot(n, f.P), -1, 1));
      lon = Math.atan2(dot(n, f.B), dot(n, f.A)) - (b.spin || 0) - (b.st.spinBoost || 0);
    }
    lon = Math.atan2(Math.sin(lon), Math.cos(lon));
    return TEX[b.id](lat, lon, t);
  }

  function drawBody(b, idx, t, now) {
    const st = b.st;
    const an = st.anim;
    let r = b.r * (an ? an.scale || 1 : 1);
    const q = project(b.pos);
    b.sx = q.sx + (an ? an.dx || 0 : 0);
    b.sy = q.sy + (an ? an.dy || 0 : 0);
    b.depth = q.depth;
    const pr = r * cam.scale;
    b.pr = pr;
    if (b.sx + pr * 2.4 < 0 || b.sx - pr * 2.4 > W || b.sy + pr * 2.4 < 0 || b.sy - pr * 2.4 > H) return;

    // 太遠太小：畫成一兩格的亮點
    if (pr < 1.3) {
      const lit = b.emissive ? 1 : 0.35 + 0.65 * Math.max(0, dot(b.light, viewDir()));
      const c = b.def.color.map((v) => v * lit);
      const x = Math.round(b.sx), y = Math.round(b.sy);
      const s = pr > 0.75 ? 2 : 1;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const xx = x + dx - (s > 1 ? 1 : 0), yy = y + dy - (s > 1 ? 1 : 0);
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || zbuf[yy * W + xx] > b.depth) continue;
          put(xx, yy, c);
          zbuf[yy * W + xx] = b.depth;
          idbuf[yy * W + xx] = idx;
        }
      if (b.def.ring) drawRing(b, idx, r, pr);
      return;
    }

    const x0 = Math.max(0, Math.floor(b.sx - pr - 1)), x1 = Math.min(W - 1, Math.ceil(b.sx + pr + 1));
    const y0 = Math.max(0, Math.floor(b.sy - pr - 1)), y1 = Math.min(H - 1, Math.ceil(b.sy + pr + 1));
    const vd = viewDir();
    const ff = pr >= 4.5 ? faceFrame() : null;
    b.face = ff;
    const expr = ff ? expression(b, now) : null;
    const blush = !!(an && (an.cheeks || an.expr === 'happy'));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - b.sx) / pr, dy = -(y + 0.5 - b.sy) / pr;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const depth = b.depth + nz * r;
        const i = y * W + x;
        if (zbuf[i] > depth) continue;
        const n = toWorld(dx, dy, nz);
        let c = surfaceColor(b, n, t);
        if (ff && dot(n, ff.F) > 0.05) {
          const fu = dot(n, ff.R), fv = dot(n, ff.U);
          // 地球表面很花，臉的位置淡淡地刷亮一點，五官才看得清楚
          if (b.id === 'earth' && fu * fu + fv * fv < 0.5) c = mix(c, [90, 160, 230], 0.35);
          const fc = faceColor(fu, fv, expr, pr, blush);
          if (fc) c = mix(c, fc.c, fc.a);
        }
        if (b.emissive) {
          const limb = 0.72 + 0.28 * nz;
          c = c.map((v) => Math.min(255, v * limb * (an && an.type === 'flare' ? 1.15 : 1)));
        } else {
          const lit = lightLevel(dot(n, b.light), x, y);
          if (b.tint) c = mix(c, b.tint, 0.65);
          if (lit < 0.2 && b.id === 'earth' && landAt(...earthGeo(b, n)) === 1 && hash(x * 3.1, y * 7.7 + Math.floor(now / 900)) > 0.8)
            c = [255, 214, 120]; // 夜晚的城市燈光
          else c = c.map((v) => v * lit);
          // 大氣：亮面邊緣一圈淡藍
          if (b.id === 'earth' && d2 > 0.8) c = mix(c, [140, 200, 255], dot(n, b.light) > -0.1 ? 0.45 : 0.22);
        }
        put(x, y, c);
        zbuf[i] = depth;
        idbuf[i] = idx;
      }
    }
    if (expr === 'sleep' && Math.floor(now / 900) % 3 === 0 && Math.random() < 0.15) spawn('z', b.sx + pr * 0.8, b.sy - pr, 1, 3);
    if (b.emissive) drawCorona(b, pr, now);
    if (b.def.ring) drawRing(b, idx, r, pr);
    if (b.home) drawHome(b, r, pr, vd, now);
  }

  function drawCorona(b, pr, now) {
    const an = b.st.anim;
    const reach = an && an.type === 'flare' ? 1.9 : 1.45;
    const R = pr * reach;
    const x0 = Math.max(0, Math.floor(b.sx - R)), x1 = Math.min(W - 1, Math.ceil(b.sx + R));
    const y0 = Math.max(0, Math.floor(b.sy - R)), y1 = Math.min(H - 1, Math.ceil(b.sy + R));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (idbuf[i] !== -1) continue;
        const dx = x + 0.5 - b.sx, dy = y + 0.5 - b.sy;
        const d = Math.hypot(dx, dy) / pr;
        if (d <= 1 || d > reach) continue;
        const ang = Math.atan2(dy, dx);
        const ray = 0.5 + 0.5 * Math.sin(ang * 8 + now / 700) * Math.sin(ang * 3 - now / 1100);
        const a = Math.pow((reach - d) / (reach - 1), 1.6) * (0.35 + 0.65 * ray) + BAYER[(y & 3) * 4 + (x & 3)] * 0.2;
        if (a > 0.18) put(x, y, [255, 170, 40], Math.min(0.85, a));
      }
  }

  function drawRing(b, idx, r, pr) {
    const [ri, ro, col] = b.def.ring;
    const an = b.st.anim;
    let P = b.def.poleVec;
    if (an && an.type === 'hula') {
      const w = Math.sin(an.t * 12) * 0.35 * (1 - an.t / an.dur);
      P = unit(add(P, mul(V(Math.cos(an.t * 6), Math.sin(an.t * 6), 0), w)));
    }
    const f = frame(P);
    const steps = Math.max(24, Math.ceil(ro * pr * 7));
    const rings = Math.max(3, Math.ceil((ro - ri) * pr * 1.6));
    for (let k = 0; k <= rings; k++) {
      const f01 = k / rings;
      if (b.id === 'saturn' && f01 > 0.62 && f01 < 0.7) continue; // 卡西尼縫
      const rr = lerp(ri, ro, f01) * r;
      const shade = 0.82 + 0.18 * Math.sin(f01 * 9);
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * TAU;
        const p = add(b.pos, add(mul(f.A, Math.cos(a) * rr), mul(f.B, Math.sin(a) * rr)));
        const q = project(p);
        const x = Math.round(q.sx + (an ? an.dx || 0 : 0)), y = Math.round(q.sy + (an ? an.dy || 0 : 0));
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (zbuf[i] > q.depth) continue;
        // 環在行星影子裡就暗一點
        const toP = sub(p, b.pos);
        const inShadow = b.light && dot(toP, b.light) < 0 && len(sub(toP, mul(b.light, dot(toP, b.light)))) < r;
        const lit = b.light ? (inShadow ? 0.25 : 0.9) : 0.9;
        put(x, y, col.map((v) => v * shade * lit), 0.9);
        zbuf[i] = q.depth;
        idbuf[i] = idx;
      }
    }
  }

  function drawHome(b, r, pr, vd, now) {
    const [la, lo] = home;
    const ra = (lo + b.earth) * RAD;
    const f = frame(b.def.poleVec, V(1, 0, 0));
    const d = add(add(mul(f.A, Math.cos(la * RAD) * Math.cos(ra)), mul(f.B, Math.cos(la * RAD) * Math.sin(ra))), mul(f.P, Math.sin(la * RAD)));
    b.homeDay = dot(d, b.light) > 0;
    if (dot(d, vd) < 0.15 || pr < 4) return;
    const q = project(add(b.pos, mul(d, r)));
    const blink = Math.floor(now / 500) % 2;
    const x = Math.round(q.sx), y = Math.round(q.sy);
    put(x, y, blink ? [255, 70, 90] : [255, 255, 255]);
    if (pr > 12) {
      put(x, y - 1, [255, 70, 90]);
      put(x, y - 2, [255, 70, 90]);
    }
  }

  // ---------- 表情和手 ----------

  function expression(b, now) {
    const st = b.st;
    const an = st.anim;
    if (an && an.expr) return an.expr;
    if (st.pokes >= 4 && now - st.pokeAt < 2500) return 'dizzy';
    if (b.id === 'moon' && view === 'moon' && moonPhaseCache && moonPhaseCache.illum < 0.06) return 'sleep';
    if (b.eclipse === 'lunar' && b.id === 'moon') return 'surprised';
    if (now > st.blinkAt && now < st.blinkAt + 160) return 'blink';
    if (now > st.blinkAt + 160) st.blinkAt = now + rand(2200, 5200);
    return 'normal';
  }

  // 臉畫在星球表面上（固定朝某個方向），跟著打光、跟著視角轉；u、v 是臉部平面上的座標（星球半徑 = 1）
  const FACE_INK = [52, 30, 48];
  const WHITE = [255, 255, 255];
  const BLUSH = [255, 120, 156];
  const TONGUE = [255, 112, 128];

  /** 臉固定朝著預設視角的方向（世界座標，不會跟著你轉） */
  function faceFrame() {
    const F = faceDir;
    let U = sub(V(0, 0, 1), mul(F, F.z));
    if (len(U) < 1e-3) U = V(0, 1, 0);
    U = unit(U);
    return { F, U, R: cross(U, F) };
  }

  function faceColor(u, v, expr, pr, blush) {
    const px = 1 / pr;
    const er = Math.max(0.17, 2.1 * px); // 眼睛半徑
    const ex = 0.33, ey = 0.04;
    const th = Math.max(0.05, 0.95 * px); // 線條粗細
    const mr = Math.max(0.14, 2.2 * px); // 嘴巴大小
    // 眼睛
    for (const side of [-1, 1]) {
      const du = u - side * ex, dv = v - ey;
      if (Math.abs(du) > er * 1.5 || Math.abs(dv) > er * 1.5) continue;
      const kind = expr === 'wink' && side === 1 ? 'happy' : expr;
      const d2 = du * du + dv * dv;
      switch (kind) {
        case 'cool': {
          if (Math.abs(du) < er * 1.3 && dv < er * 0.75 && dv > -er * 0.9 && (du * du) / (er * er * 1.69) + (Math.min(0, dv) ** 2) / (er * er * 0.81) < 1)
            return { c: Math.abs(du + dv * 0.8 - er * 0.3) < th * 0.6 ? [120, 120, 140] : [20, 18, 26], a: 1 };
          break;
        }
        case 'blink':
          if (Math.abs(du) < er && Math.abs(dv) < th / 2) return { c: FACE_INK, a: 1 };
          break;
        case 'sleep': // ‿ 閉眼
          if (Math.abs(du) < er && Math.abs(dv - ((0.9 * du * du) / er - 0.25 * er)) < th * 0.6) return { c: FACE_INK, a: 1 };
          break;
        case 'happy': // ^ 笑眼
          if (Math.abs(du) < er && Math.abs(dv - (0.35 * er - (1.1 * du * du) / er)) < th * 0.6) return { c: FACE_INK, a: 1 };
          break;
        case 'dizzy':
          if (Math.abs(du) < er * 0.95 && Math.abs(dv) < er * 0.95 && Math.abs(Math.abs(du) - Math.abs(dv)) < th * 0.7) return { c: FACE_INK, a: 1 };
          break;
        default: {
          const r = kind === 'surprised' ? er * 1.15 : er;
          if (d2 < r * r) {
            // 大大的亮晶晶眼睛：一大一小兩個反光
            if ((du + 0.32 * r) ** 2 + (dv - 0.32 * r) ** 2 < (0.4 * r) ** 2) return { c: WHITE, a: 1 };
            if ((du - 0.35 * r) ** 2 + (dv + 0.35 * r) ** 2 < (0.2 * r) ** 2) return { c: WHITE, a: 1 };
            return { c: FACE_INK, a: 1 };
          }
        }
      }
    }
    if (expr === 'cool' && Math.abs(v - ey - er * 0.3) < th / 2 && Math.abs(u) < ex) return { c: [20, 18, 26], a: 1 };
    // 嘴巴
    const my = -0.17;
    switch ({ surprised: 'open', dizzy: 'wavy', sleep: 'tiny', happy: 'grin', wink: 'cat', cool: 'smile', blink: 'cat' }[expr] || 'cat') {
      case 'grin': {
        // D 字張嘴笑，裡面有舌頭
        const d = Math.hypot(u, v - my);
        if (v < my && d < mr * 1.25) return { c: Math.hypot(u, v - (my - mr * 0.85)) < mr * 0.55 ? TONGUE : FACE_INK, a: 1 };
        break;
      }
      case 'open':
        if ((u / (mr * 0.75)) ** 2 + ((v - my + mr * 0.2) / mr) ** 2 < 1) return { c: FACE_INK, a: 1 };
        break;
      case 'tiny':
        if (Math.abs(v - my) < th / 2 && Math.abs(u) < mr * 0.5) return { c: FACE_INK, a: 1 };
        break;
      case 'wavy':
        if (Math.abs(u) < mr * 1.3 && Math.abs(v - my - mr * 0.25 * Math.sin((u / mr) * 5)) < th / 2) return { c: FACE_INK, a: 1 };
        break;
      case 'smile': {
        const d = Math.hypot(u, v - my - mr * 0.6);
        if (v < my + mr * 0.2 && Math.abs(d - mr) < th / 2) return { c: FACE_INK, a: 1 };
        break;
      }
      default: {
        // ω 貓咪嘴
        for (const s of [-1, 1]) {
          const cx = s * mr * 0.55;
          const d = Math.hypot(u - cx, v - my);
          if (v < my + th * 0.3 && Math.abs(d - mr * 0.55) < th / 2) return { c: FACE_INK, a: 1 };
        }
      }
    }
    // 腮紅（一直都有，被戳時更紅）
    for (const s of [-1, 1]) {
      const bu = (u - s * 0.56) / Math.max(0.13, 1.6 * px), bv = (v + 0.08) / Math.max(0.08, 1.1 * px);
      if (bu * bu + bv * bv < 1) return { c: BLUSH, a: blush ? 0.85 : 0.5 };
    }
    return null;
  }

  function drawArms(b, idx, now) {
    const pr = b.pr;
    if (pr < 4.5 || !b.face || dot(b.face.F, viewDir()) < 0.15) return;
    const an = b.st.anim;
    const big = pr >= 10;
    const L = big ? 3 : 2;
    const yBase = Math.round(b.sy + pr * 0.15);
    const color = b.def.color.map((v) => v * 0.78);
    const hand = b.def.color.map((v) => Math.min(255, v * 1.1));
    let left = 'down', right = 'down';
    if (an) {
      if (['wave', 'wink', 'blush'].includes(an.type)) right = Math.floor(an.t / 0.22) % 2 ? 'up' : 'mid';
      if (['jump', 'bounce', 'flare', 'storm', 'roll', 'dust', 'wind'].includes(an.type)) left = right = 'up';
      if (an.type === 'hula') left = right = Math.floor(an.t / 0.3) % 2 ? 'up' : 'mid';
      if (an.type === 'cool') right = 'mid';
    } else if (Math.sin(now / 1800 + idx) > 0.97) right = 'mid';
    const arm = (side, pose) => {
      const sx = side < 0 ? Math.floor(b.sx - pr) : Math.ceil(b.sx + pr) - 1;
      const dir = { down: 1, mid: 0, up: -1 }[pose];
      let x = sx, y = yBase;
      for (let k = 1; k <= L; k++) {
        x += side;
        if (dir !== 0 || k > 1) y += dir * (k % 2 === 0 || dir === -1 ? 1 : 0);
        const i = y * W + x;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (zbuf[i] > b.depth + b.r && idbuf[i] !== idx) continue;
        put(x, y, k === L ? hand : color);
      }
    };
    arm(-1, left);
    arm(1, right);
  }

  // ---------- 粒子 ----------

  const SPR = {
    spark: [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]],
    heart: [[-1, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [0, 1]],
    z: [[-1, -1], [0, -1], [1, -1], [0, 0], [-1, 1], [0, 1], [1, 1]],
    dot: [[0, 0]],
    bang: [[0, -2], [0, -1], [0, 1]],
  };
  const PCOL = { spark: [255, 230, 120], heart: [255, 110, 150], z: [200, 210, 255], dot: [255, 180, 80], bang: [255, 240, 140], dust: [214, 130, 80], wind: [190, 220, 255], star: [255, 255, 255] };
  function spawn(kind, x, y, n = 1, spread = 10, opt = {}) {
    for (let i = 0; i < n; i++)
      particles.push({ kind, x, y, vx: opt.vx ?? rand(-spread, spread), vy: opt.vy ?? rand(-spread, spread * 0.4) - 4, life: rand(0.8, 1.4), color: opt.color });
  }

  // ---------- 動畫 ----------

  function startAnim(b, type) {
    const st = b.st;
    const dur = { flare: 1.8, spin: 1.6, roll: 2, hula: 2.2, storm: 2, dust: 1.8, wind: 1.8, zoom: 1.4 }[type] || 1.4;
    st.anim = { type, t: 0, dur };
    const pr = Math.max(b.pr || 4, 3);
    if (type === 'blush') spawn('heart', b.sx, b.sy - pr, 4, 8);
    if (type === 'flare') for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU);
      particles.push({ kind: 'dot', x: b.sx + Math.cos(a) * pr, y: b.sy + Math.sin(a) * pr, vx: Math.cos(a) * rand(14, 30), vy: Math.sin(a) * rand(14, 30), life: rand(0.6, 1.2) });
    }
    if (type === 'wink' || type === 'cool') spawn('spark', b.sx + pr, b.sy - pr, 2, 6);
  }

  function updateAnim(b, dt) {
    const an = b.st.anim;
    if (!an) return;
    an.t += dt;
    const k = an.t / an.dur;
    const pr = b.pr || 4;
    an.dx = 0; an.dy = 0; an.scale = 1;
    switch (an.type) {
      case 'bounce': an.scale = 1 + 0.14 * Math.sin(an.t * 18) * (1 - k); an.expr = 'happy'; break;
      case 'jump': an.dy = -Math.sin(Math.PI * k) * Math.max(3, pr * 0.7); an.expr = 'happy'; break;
      case 'spin': b.st.spinBoost = (b.st.spinBoost || 0) + dt * 9 * (1 - k); an.expr = k < 0.7 ? 'happy' : 'dizzy'; break;
      case 'roll': b.st.spinBoost = (b.st.spinBoost || 0) + dt * 12 * (1 - k); an.expr = 'dizzy'; break;
      case 'wave': an.expr = 'happy'; break;
      case 'wink': an.expr = 'wink'; break;
      case 'blush': an.expr = 'happy'; an.cheeks = true; break;
      case 'cool': an.expr = 'cool'; break;
      case 'flare': an.expr = 'cool'; an.scale = 1 + 0.06 * Math.sin(an.t * 20); break;
      case 'zoom': an.dx = Math.sin(an.t * 30) * Math.max(1.5, pr * 0.25) * (1 - k); an.expr = 'happy'; if (Math.random() < 0.5) spawn('wind', b.sx - pr * 1.4, b.sy + rand(-pr, pr), 1, 0, { vx: -30, vy: 0 }); break;
      case 'hula': an.expr = 'happy'; break;
      case 'storm': an.expr = 'surprised'; if (Math.random() < 0.6) spawn('dust', b.sx + rand(-pr, pr), b.sy + rand(-pr, pr) * 0.6, 1, 0, { vx: rand(-25, 25), vy: rand(-3, 3), color: [196, 92, 60] }); break;
      case 'dust': an.expr = 'surprised'; if (Math.random() < 0.6) spawn('dust', b.sx + rand(-pr, pr), b.sy + pr * 0.6, 1, 14); break;
      case 'wind': an.expr = 'happy'; if (Math.random() < 0.6) spawn('wind', b.sx + pr * 1.6, b.sy + rand(-pr, pr), 1, 0, { vx: -40, vy: 0 }); break;
      case 'surprise': an.expr = 'surprised'; break;
    }
    if (an.t >= an.dur) b.st.anim = null;
  }

  // ---------- 說話 ----------

  function say(b, text, seconds = 3.2) {
    bubble.textContent = text;
    bubble.hidden = false;
    bubbleFor = b ? b.id : null;
    bubbleUntil = performance.now() + seconds * 1000;
  }

  const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const fmtTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  function liveLine(b) {
    const date = simDate();
    if (b.id === 'moon') {
      const p = moonPhase(date);
      const opts = [`我現在是${p.name}，亮了 ${Math.round(p.illum * 100)}%`];
      const full = nextPhase(date, 180);
      const nw = nextPhase(date, 0);
      if (full) opts.push(`下次滿月是 ${fmtDate(full)} ${fmtTime(full)}`);
      if (nw) opts.push(`下次新月是 ${fmtDate(nw)}`);
      if (b.eclipse === 'lunar') return '月食中！我被地球的影子染紅了';
      return pick(opts);
    }
    if (b.id === 'earth') {
      if (view === 'moon') return pick([`你在這裡！現在是${b.homeDay ? '白天' : '晚上'}`, `你那邊現在是${b.homeDay ? '白天，太陽照得到你' : '晚上，轉到背光那面了'}`]);
      return '你在這裡！第三顆就是我';
    }
    if (b.id === 'sun') {
      if (view === 'moon' && eclipse(date) === 'solar') return '日食！月亮擋住我了';
      return pick([`我現在在${ZODIAC[Math.floor(sunPosition(date).lon / 30) % 12]}的方向`, ...FACTS.sun]);
    }
    if (b.raw) {
      const e = planetPosition('earth', date);
      const d = len(sub(b.raw, e));
      return pick([`離地球 ${d.toFixed(2)} AU（${(d * 1.496).toFixed(1)} 億公里）`, `離太陽 ${b.au.toFixed(2)} AU`, ...FACTS[b.id]]);
    }
    return pick(FACTS[b.id] || ['嗨！']);
  }

  // ---------- 互動 ----------

  function hit(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const b of drawn) {
      if (b.sx == null) continue;
      const d = Math.hypot(x - b.sx, y - b.sy);
      const tol = Math.max((b.pr || 0) + 1.5, 5);
      if (d > tol) continue;
      // 點在星球身上的優先；都沒點中時取最近的，小小的月亮讓給旁邊的地球
      const score = (d <= (b.pr || 0) ? -100 - b.depth : d) + (view === 'planets' && b.id === 'moon' && (b.pr || 0) < 3 ? 3 : 0);
      if (score < bestD) {
        best = b;
        bestD = score;
      }
    }
    return best;
  }

  function poke(b) {
    const now = performance.now();
    const st = b.st;
    st.pokes = now - st.pokeAt < 1600 ? st.pokes + 1 : 1;
    st.pokeAt = now;
    // 太小看不清楚：先飛過去
    if ((b.pr || 0) < 7) {
      focus = b.id;
      want.scale = clamp(13 / b.r, want.fit * 0.5, want.fit * 40);
      // 轉回看得到臉的角度
      let yaw = faceCam.yaw;
      while (yaw - want.yaw > Math.PI) yaw -= TAU;
      while (yaw - want.yaw < -Math.PI) yaw += TAU;
      want.yaw = yaw;
      want.pitch = faceCam.pitch;
    }
    if (st.pokes >= 4) {
      st.anim = { type: 'dizzy', t: 0, dur: 1.6, expr: 'dizzy' };
      say(b, pick(['頭好暈～', '別再戳了啦', '眼冒金星…']), 2);
      spawn('spark', b.sx, b.sy - (b.pr || 3), 3, 6);
      return;
    }
    startAnim(b, pick(ANIMS[b.id] || ['bounce']));
    say(b, liveLine(b));
    statusOverride = `${b.def.name}${b.au ? ` · 離太陽 ${b.au.toFixed(2)} AU` : ''}`;
    statusUntil = now + 6000;
  }

  // 手勢
  const pointers = new Map();
  let gesture = null;
  let lastTap = 0;
  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) gesture = { start: local(e), at: performance.now(), moved: 0, yaw: want.yaw, pitch: want.pitch };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { pinch: Math.hypot(a.x - b.x, a.y - b.y), scale: want.scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, moved: 99 };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1 && gesture.start) {
      const p = local(e);
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      if (gesture.moved > 2) {
        want.yaw = gesture.yaw - dx * 0.045;
        want.pitch = clamp(gesture.pitch + dy * 0.035, 4 * RAD, 89.5 * RAD);
      }
    } else if (pointers.size === 2 && gesture.pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      want.scale = clamp(gesture.scale * (d / gesture.pinch), want.fit * 0.4, want.fit * 40);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      panBy(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
      gesture.mid = mid;
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.start && pointers.size === 0 && gesture.moved <= 2 && performance.now() - gesture.at < 400) {
      const now = performance.now();
      const p = gesture.start;
      if (now - lastTap < 300) {
        resetView();
        lastTap = 0;
      } else {
        lastTap = now;
        const b = hit(p.x, p.y);
        if (b) poke(b);
      }
    }
    if (pointers.size === 0) gesture = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      want.scale = clamp(want.scale * Math.exp(-e.deltaY * 0.0015), want.fit * 0.4, want.fit * 40);
    },
    { passive: false }
  );
  function panBy(dx, dy) {
    focus = null;
    const cy = Math.cos(want.yaw), sy = Math.sin(want.yaw), sp = Math.sin(want.pitch);
    const x1 = -dx / want.scale, y1 = dy / want.scale / sp;
    want.tx += x1 * cy - y1 * sy;
    want.ty += x1 * sy + y1 * cy;
  }

  ui.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'reset') return resetView();
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    if (view === 'moon' && SPEEDS[speedIdx].s > 86400 * 7) speedIdx = 0; // 日地月看一個月一秒太快
    if (speedIdx === 0) offset = 0;
    updateTimeButton();
  });
  function updateTimeButton() {
    const b = ui.querySelector('[data-act=time]');
    const sp = SPEEDS[speedIdx];
    b.textContent = speedIdx === 0 ? '⏵ 時光機' : `⏩ ${sp.label} · ${fmtDate(simDate())}`;
    b.classList.toggle('on', speedIdx !== 0);
  }

  // ---------- 主迴圈 ----------

  let moonPhaseCache = null;
  let phaseAt = 0;
  let raf = 0;
  let last = performance.now();
  let lastDraw = 0;
  let idleAt = performance.now() + 5000;

  function updateStatus(now) {
    if (now - lastStatus < 500) return;
    lastStatus = now;
    const el = opts.status;
    if (!el) return;
    if (statusOverride && now < statusUntil) {
      el.textContent = statusOverride;
      return;
    }
    const date = simDate();
    const when = speedIdx || Math.abs(offset) > 60e3 ? `${fmtDate(date)} ${fmtTime(date)} · ` : '';
    if (view === 'moon') {
      const p = moonPhaseCache || moonPhase(date);
      const ecl = eclipse(date);
      el.textContent = `${when}${ecl === 'lunar' ? '月食！' : ecl === 'solar' ? '日食！' : ''}${p.name} ${Math.round(p.illum * 100)}%`;
    } else {
      el.textContent = `${when}${speedIdx ? '快轉中' : '即時位置'}`;
    }
  }

  function loop(now) {
    if (!canvas.isConnected) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (SPEEDS[speedIdx].s) {
      offset += SPEEDS[speedIdx].s * dt * 1000;
      if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) updateTimeButton();
    }
    const date = simDate();
    if (view === 'moon' && (now - phaseAt > 1000 || SPEEDS[speedIdx].s)) {
      moonPhaseCache = moonPhase(date);
      phaseAt = now;
    }
    bodies = scene(date);

    // 跟著選中的星球
    if (focus) {
      const f = bodies.find((b) => b.id === focus);
      if (f) {
        want.tx = f.pos.x;
        want.ty = f.pos.y;
        want.tz = f.pos.z;
      }
    }
    const k = 1 - Math.exp(-dt * 7);
    for (const key of ['yaw', 'pitch', 'tx', 'ty', 'tz']) cam[key] = lerp(cam[key], want[key], k);
    cam.scale = Math.exp(lerp(Math.log(cam.scale), Math.log(want.scale), k));

    for (const b of bodies) updateAnim(b, dt);

    // 沒人理的時候，偶爾有星球自己動一下
    if (now > idleAt) {
      idleAt = now + rand(6000, 12000);
      const visible = bodies.filter((b) => (b.pr || 0) >= 4);
      if (visible.length && !gesture) startAnim(pick(visible), pick(['wave', 'wink', 'bounce']));
    }

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.life -= dt;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);

    // 30 fps 就夠了，省電
    if (now - lastDraw < 32) return;
    lastDraw = now;
    const t = date.getTime() / 3600e3;
    drawBackground(now);
    if (view === 'planets') {
      for (const id of ORDER) if (orbits[id]) drawOrbit(orbits[id], id === 'earth' ? [90, 140, 220] : [80, 86, 110], id === 'pluto' ? 3 : 2);
    } else {
      const moonOrbit = [];
      const m = moonPosition(date);
      for (let i = 0; i < 90; i++) moonOrbit.push(mul(eclDir(m.lon + i * 4, m.lat * Math.cos(i * 4 * RAD)), 3.6));
      drawOrbit(moonOrbit, [80, 86, 110], 3);
    }
    bodies.forEach((b, i) => drawBody(b, i, t, now));
    drawn = bodies;
    bodies.forEach((b, i) => {
      drawArms(b, i, now);
    });
    // 太陽跑出畫面時，在邊邊畫一個箭頭指過去
    const sun = bodies.find((b) => b.id === 'sun');
    if (sun && (sun.sx < -sun.pr || sun.sx > W + sun.pr || sun.sy < -sun.pr || sun.sy > H + sun.pr)) {
      const ang = Math.atan2(sun.sy - H / 2, sun.sx - W / 2);
      const ex = Math.round(clamp(W / 2 + Math.cos(ang) * W, 3, W - 4));
      const ey = Math.round(clamp(H / 2 + Math.sin(ang) * H, 3, H - 4));
      for (const [dx, dy] of SPR.spark) put(ex + dx, ey + dy, [255, 190, 60]);
    }
    for (const p of particles) {
      const s = SPR[p.kind] || SPR.dot;
      const c = p.color || PCOL[p.kind] || PCOL.dot;
      for (const [dx, dy] of s) put(Math.round(p.x) + dx, Math.round(p.y) + dy, c, Math.min(1, p.life * 1.5));
    }
    lctx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, canvas.width, canvas.height);

    // 對話框跟著說話的星球
    if (!bubble.hidden) {
      if (now > bubbleUntil) bubble.hidden = true;
      else {
        const b = drawn.find((x) => x.id === bubbleFor) || { sx: W / 2, sy: H / 2, pr: 0 };
        const bw = bubble.offsetWidth;
        const cx = clamp(b.sx * PX, bw / 2 + 8, W * PX - bw / 2 - 8);
        bubble.style.left = `${cx - bw / 2}px`;
        const above = (b.sy - (b.pr || 0)) * PX - bubble.offsetHeight - 8;
        bubble.style.top = `${above > 4 ? above : Math.min(STAGE_H - bubble.offsetHeight - 40, (b.sy + (b.pr || 0)) * PX + 8)}px`;
      }
    }
    updateStatus(now);
  }

  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) return ro.disconnect();
    resize();
    resetView(true);
  });
  resize();
  buildOrbits();
  resetView(true);
  updateTimeButton();
  raf = requestAnimationFrame(loop);
  ro.observe(stage);

  // 打招呼
  setTimeout(() => {
    if (!canvas.isConnected) return;
    const list = scene(simDate());
    const greeter = list.find((b) => b.id === (view === 'moon' ? 'moon' : 'sun'));
    if (greeter && !bubbleFor) {
      const lines = (opts.lines && opts.lines()) || [];
      greeter.sx = greeter.sx ?? W / 2;
      say(greeter, lines.length && Math.random() < 0.5 ? pick(lines) : liveLine({ ...greeter, st: greeter.st }), 3.4);
    }
  }, 700);

  return {
    stop: () => cancelAnimationFrame(raf),
    /** 做完一件事：主角星球開心一下 */
    feed: (text) => {
      const b = drawn.find((x) => x.id === (view === 'moon' ? 'earth' : 'sun'));
      if (!b) return;
      startAnim(b, 'jump');
      spawn('spark', b.sx, b.sy - (b.pr || 4), 5, 10);
      say(b, text, 3);
    },
    play: (type) => {
      const b = drawn.find((x) => x.id === (view === 'moon' ? 'moon' : 'saturn')) || drawn[0];
      if (b) startAnim(b, type);
    },
    swap: () => {},
    setView: (v) => {
      view = v === 'planets' ? 'planets' : 'moon';
      for (const k of Object.keys(state)) delete state[k];
      particles.length = 0;
      bubble.hidden = true;
      bubbleFor = null;
      if (view === 'moon' && SPEEDS[speedIdx].s > 86400 * 7) speedIdx = 3;
      buildOrbits();
      resetView(true);
      updateTimeButton();
      lastStatus = 0;
    },
    /** 除錯用：星球在畫面上的位置（格） */
    _bodies: () => drawn.map((b) => ({ id: b.id, sx: b.sx, sy: b.sy, pr: b.pr })),
    get view() {
      return view;
    },
  };
}
