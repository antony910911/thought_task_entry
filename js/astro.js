// 日、地、月和九大行星的實際位置（低精度天文公式，誤差約 0.5 度以內，畫圖綽綽有餘）。
// 座標都是「黃道座標」：x 指向春分點，z 指向黃道北極，單位是 AU（月亮另計）。
// 公式：太陽、月亮用 Meeus／Schlyter 的簡化項；行星用 JPL「Approximate Positions of the Planets」
// 的軌道根數（1800–2050 年適用）。

const RAD = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;

/** 從 J2000.0（2000-01-01 12:00 UT）起算的天數 */
export function daysSinceJ2000(date) {
  return (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
}

/** 太陽的地心黃經（度）和距離（AU） */
export function sunPosition(date) {
  const d = daysSinceJ2000(date);
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lon = norm360(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const dist = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  return { lon, dist };
}

/** 月亮的地心黃經、黃緯（度）和距離（公里） */
export function moonPosition(date) {
  const d = daysSinceJ2000(date);
  const L = 218.316 + 13.176396 * d; // 平黃經
  const M = (134.963 + 13.064993 * d) * RAD; // 月亮平近點角
  const F = (93.272 + 13.22935 * d) * RAD; // 升交角距
  const D = (297.85 + 12.190749 * d) * RAD; // 日月平距角
  const Ms = (357.529 + 0.98560028 * d) * RAD; // 太陽平近點角
  const lon =
    L +
    6.289 * Math.sin(M) -
    1.274 * Math.sin(M - 2 * D) +
    0.658 * Math.sin(2 * D) -
    0.186 * Math.sin(Ms) -
    0.059 * Math.sin(2 * M - 2 * D) -
    0.057 * Math.sin(M - 2 * D + Ms) +
    0.053 * Math.sin(M + 2 * D) +
    0.046 * Math.sin(2 * D - Ms) +
    0.041 * Math.sin(M - Ms) -
    0.035 * Math.sin(D) -
    0.031 * Math.sin(M + Ms) -
    0.015 * Math.sin(2 * F - 2 * D) +
    0.011 * Math.sin(M - 4 * D);
  const lat =
    5.128 * Math.sin(F) +
    0.281 * Math.sin(M + F) +
    0.278 * Math.sin(M - F) +
    0.173 * Math.sin(2 * D - F) +
    0.055 * Math.sin(2 * D - M + F) -
    0.046 * Math.sin(2 * D - M - F) +
    0.033 * Math.sin(2 * D + F) +
    0.017 * Math.sin(2 * M + F);
  const dist = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D);
  return { lon: norm360(lon), lat, dist };
}

/** 月相：elong 是月亮離太陽多遠（0 新月、180 滿月），illum 是亮面比例 0–1 */
export function moonPhase(date) {
  const s = sunPosition(date);
  const m = moonPosition(date);
  const elong = norm360(m.lon - s.lon);
  const cosPsi = Math.cos(m.lat * RAD) * Math.cos((m.lon - s.lon) * RAD);
  const illum = (1 - cosPsi) / 2;
  return { elong, illum, name: phaseName(elong), sun: s, moon: m };
}

export function phaseName(elong) {
  const e = norm360(elong);
  if (e < 7 || e >= 353) return '新月';
  if (e < 83) return '眉月';
  if (e < 97) return '上弦月';
  if (e < 173) return '盈凸月';
  if (e < 187) return '滿月';
  if (e < 263) return '虧凸月';
  if (e < 277) return '下弦月';
  return '殘月';
}

/** 往後找下一次月亮離太陽 target 度（180 = 滿月、0 = 新月）的時間 */
export function nextPhase(date, target) {
  const f = (t) => ((moonPhase(new Date(t)).elong - target + 540) % 360) - 180; // -180..180，穿過 0 時就是那一刻
  let t = date.getTime() + 3600e3;
  let prev = f(t);
  for (let i = 0; i < 24 * 32; i++) {
    const t2 = t + 3600e3;
    const cur = f(t2);
    if (prev < 0 && cur >= 0) {
      let lo = t;
      let hi = t2;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid;
        else hi = mid;
      }
      return new Date(hi);
    }
    t = t2;
    prev = cur;
  }
  return null;
}

/** 現在是不是日食／月食（大概判斷：新月或滿月，而且月亮夠靠近黃道） */
export function eclipse(date) {
  const p = moonPhase(date);
  const fromNew = Math.min(p.elong, 360 - p.elong);
  const fromFull = Math.abs(p.elong - 180);
  if (fromNew < 1.2 && Math.abs(p.moon.lat) < 0.55) return 'solar';
  if (fromFull < 1.2 && Math.abs(p.moon.lat) < 0.5) return 'lunar';
  return null;
}

// JPL 軌道根數：a（AU）、e、I、L、ϖ、Ω（度），和每世紀的變化量
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  pluto: [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
};
export const PLANETS = Object.keys(ELEMENTS);

/** 行星的日心黃道座標（AU） */
export function planetPosition(name, date) {
  const T = daysSinceJ2000(date) / 36525;
  const [base, rate] = ELEMENTS[name];
  const [a, e, I, L, peri, node] = base.map((v, i) => v + rate[i] * T);
  const w = (peri - node) * RAD;
  const O = node * RAD;
  const inc = I * RAD;
  const M = norm360(L - peri) * RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(inc), sI = Math.sin(inc);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/** 黃經（度） */
export const longitudeOf = (p) => norm360(Math.atan2(p.y, p.x) / RAD);

/** 格林威治恆星時（度）：用來轉地球，讓白天那面對著太陽、陸地在對的位置 */
export function gmst(date) {
  return norm360(280.46061837 + 360.98564736629 * daysSinceJ2000(date));
}

export const OBLIQUITY = 23.4393;
