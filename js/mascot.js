// Blip：住在首頁的像素外星人。
// 戳他會有反應（連戳會頭暈、長按是摸摸頭），點空地他會走過去；放著不管他會自己找事做，太久沒理他就會睡著。
// 全部用 canvas 一格一格畫，顏色跟著目前的配色走（身體 = 待辦色、天線 = 筆記色）。

const PX = 5; // 一個像素點 = 5 CSS px
const STAGE_H = 170;

// 16×16 外星人。B 身體、D 陰影、L 亮面、A 天線燈
const BASE = [
  '...A........A...',
  '....B......B....',
  '.....B....B.....',
  '....BBBBBBBB....',
  '...BLLBBBBBBB...',
  '..BLBBBBBBBBBB..',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBB..',
  '...DBBBBBBBBD...',
  '.....DBBBBD.....',
  '....BBBBBBBB....',
  '....BBLLLLBB....',
  '.....DD..DD.....',
  '....DDD..DDD....',
];
const LEGS_ALT = ['....DD....DD....', '...DDD....DDD...'];

// 左眼的格子；右眼左右鏡射（col → 15 - col）
const EYES = {
  normal: [[6, 4, 'E'], [6, 5, 'W'], [6, 6, 'E'], [7, 3, 'E'], [7, 4, 'E'], [7, 5, 'E'], [7, 6, 'E'], [8, 4, 'E'], [8, 5, 'E']],
  blink: [[7, 3, 'E'], [7, 4, 'E'], [7, 5, 'E'], [7, 6, 'E']],
  closed: [[7, 3, 'D'], [7, 4, 'D'], [7, 5, 'D'], [7, 6, 'D']],
  happy: [[7, 3, 'E'], [6, 4, 'E'], [6, 5, 'E'], [7, 6, 'E']],
  surprised: [[5, 4, 'E'], [5, 5, 'E'], [6, 3, 'E'], [6, 4, 'W'], [6, 5, 'E'], [6, 6, 'E'], [7, 3, 'E'], [7, 4, 'E'], [7, 5, 'E'], [7, 6, 'E'], [8, 4, 'E'], [8, 5, 'E']],
  dizzy: [[6, 3, 'E'], [6, 6, 'E'], [7, 4, 'E'], [7, 5, 'E'], [8, 3, 'E'], [8, 6, 'E']],
};
const MOUTHS = {
  smile: [[9, 6], [9, 9], [10, 7], [10, 8]],
  neutral: [[9, 7], [9, 8]],
  open: [[9, 7], [9, 8], [10, 7], [10, 8]],
  wavy: [[9, 6], [10, 7], [9, 8], [10, 9]],
};
const ARMS = {
  down: [[12, 3], [13, 3], [12, 12], [13, 12]],
  up: [[12, 3], [11, 2], [10, 1], [12, 12], [11, 13], [10, 14]],
  upL: [[12, 3], [11, 2], [10, 1], [12, 12], [13, 12]],
  upR: [[12, 3], [13, 3], [12, 12], [11, 13], [10, 14]],
  midR: [[12, 3], [13, 3], [12, 12], [12, 13], [12, 14]],
};
const EXPR = {
  normal: { eyes: 'normal', mouth: 'smile' },
  blink: { eyes: 'blink', mouth: 'smile' },
  happy: { eyes: 'happy', mouth: 'smile' },
  surprised: { eyes: 'surprised', mouth: 'open' },
  sleep: { eyes: 'closed', mouth: 'neutral' },
  dizzy: { eyes: 'dizzy', mouth: 'wavy' },
  lookL: { eyes: 'normal', mouth: 'neutral', dc: -1 },
  lookR: { eyes: 'normal', mouth: 'neutral', dc: 1 },
  lookUp: { eyes: 'normal', mouth: 'neutral', dr: -1 },
};

const UFO = ['....GGG....', '...GGGGG...', '.TSSSSSSST.', 'SSYSSYSSYSS', '..TTTTTTT..'];
const PLANET = ['...OOO...', '..OOOOO..', 'RRRRRRRRR', '..OOOOO..', '...OOO...'];
const SPRITES = {
  z: ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'],
  heart: ['HH.HH', 'HHHHH', '.HHH.', '..H..'],
  note: ['.NN', '.N.', 'NN.', 'NN.'],
  spark: ['.K.', 'KKK', '.K.'],
  bang: ['R', 'R', 'R', '.', 'R'],
  star: ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '.Y.Y.'],
};

const LINES = {
  poke: ['嗶！', '嘿！', '我在～', '幹嘛戳我', '!?', '嗶嗶？'],
  random: ['嗶嗶嗶～', '地球的咖啡好好喝', '想到什麼就丟給我', '我的飛碟停哪了…', '（偷看你的筆記）', '今天也要加油喔', '我會幫你記著的'],
};

const STATUS = {
  idle: '在發呆',
  walk: '在散步',
  look: '東張西望',
  jump: '跳一下',
  dance: '在跳舞',
  wave: '跟你打招呼',
  think: '在想事情',
  sleep: '打瞌睡中 Zzz',
  wake: '被吵醒了',
  ufo: '跟飛碟講話',
  star: '在接星星',
  bang: '嚇一跳',
  giggle: '覺得好癢',
  hearts: '心情很好',
  spin: '轉圈圈',
  dizzy: '頭暈中',
  pet: '被摸頭',
  cheer: '在幫你慶祝',
};

// 跨頁面保留狀態：回到首頁時 Blip 會接著做原本的事
const S = {
  x: null,
  y: 0,
  vy: 0,
  floating: false,
  action: null,
  blinkAt: 0,
  lastInteract: Date.now(),
  greetedAt: 0,
  combo: 0,
  lastPoke: 0,
  pressing: false,
  queue: null,
  ufoCooldown: 0,
};
let pokes = readPokes();

function readPokes() {
  try {
    return Number(localStorage.getItem('beamup.pokes')) || 0;
  } catch {
    return 0;
  }
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function shade(hex, amount) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const mix = (v) => Math.round(v + (target - v) * k);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `rgb(${r},${g},${b})`;
}

/** 有新的事情時，Blip 下次出現會先慶祝一下 */
export function queueCheer(text) {
  S.queue = { name: 'cheer', text, at: Date.now() };
}

/**
 * @param {HTMLElement} stage 舞台容器
 * @param {{ lines?: () => string[], status?: HTMLElement, counter?: HTMLElement }} opts
 */
export function mountMascot(stage, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'blip-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Blip，像素外星人。點他、長按他，或點空地叫他走過去');
  const bubble = document.createElement('div');
  bubble.className = 'blip-bubble';
  bubble.hidden = true;
  stage.append(canvas, bubble);
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 60;
  const H = Math.floor(STAGE_H / PX);
  const groundY = H - 3;
  let stars = [];
  let particles = [];
  let pal = null;
  let palAt = 0;
  let bubbleUntil = 0;
  let frame = {};
  let raf = 0;
  let last = performance.now();

  function resize() {
    const cssW = stage.clientWidth || 340;
    const dpr = window.devicePixelRatio || 1;
    W = Math.floor(cssW / PX);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(STAGE_H * dpr);
    canvas.style.height = STAGE_H + 'px';
    ctx.setTransform(PX * dpr, 0, 0, PX * dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    stars = Array.from({ length: Math.round(W / 3) }, () => ({ x: Math.floor(rand(0, W)), y: Math.floor(rand(1, groundY - 19)), p: rand(0, 6) }));
    if (S.x == null) S.x = W / 2;
    S.x = Math.min(Math.max(S.x, 8), W - 8);
  }

  function readPalette() {
    const cs = getComputedStyle(stage);
    const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const body = get('--todo', '#34c759');
    const accentNote = get('--note', '#ff9f0a');
    const eventColor = get('--event', '#ff3b30');
    return {
      B: body,
      D: shade(body, -0.32),
      L: shade(body, 0.38),
      A: accentNote,
      E: '#15131f',
      W: '#ffffff',
      M: '#15131f',
      P: '#ff8fab',
      G: '#a5e4ff',
      S: '#c9ccd6',
      T: '#8d92a3',
      Y: '#ffd60a',
      K: '#ffd60a',
      O: shade(eventColor, 0.15),
      R: accentNote,
      Z: get('--label-2', 'rgba(60,60,67,.6)'),
      H: '#ff5c8a',
      N: get('--accent', '#007aff'),
      star: get('--label-3', 'rgba(60,60,67,.3)'),
    };
  }

  // ---------- 對話框與狀態 ----------

  function say(text, seconds = 2.6) {
    bubble.textContent = text;
    bubble.hidden = false;
    bubbleUntil = performance.now() + seconds * 1000;
  }

  function setStatus(name) {
    if (opts.status) opts.status.textContent = STATUS[name] || '';
  }

  function updateCounter() {
    if (opts.counter) opts.counter.textContent = pokes ? `被戳了 ${pokes} 次` : '戳戳看';
  }

  function contextLine() {
    const lines = (opts.lines && opts.lines()) || [];
    return pick(lines.length && Math.random() < 0.7 ? lines : LINES.random);
  }

  function burst(kind, x, y, n, spread = 8) {
    for (let i = 0; i < n; i++)
      particles.push({ kind, x: x + rand(-2, 2), y: y + rand(-1, 1), vx: rand(-spread, spread), vy: rand(-16, -8), life: rand(0.9, 1.4), delay: i * 0.12 });
  }

  // ---------- 動作 ----------

  const headTop = () => groundY - 16 - S.y;

  const ACTIONS = {
    idle: {
      init: (a) => (a.dur = rand(2, 4.5)),
      tick: (a) => a.t > a.dur,
    },
    walk: {
      init: (a) => {
        if (a.to == null) a.to = rand(9, W - 9);
        a.to = Math.min(Math.max(a.to, 8), W - 8);
      },
      tick: (a, dt) => {
        const dir = Math.sign(a.to - S.x);
        frame.expr = dir >= 0 ? 'lookR' : 'lookL';
        frame.legs = Math.floor(a.t * 7) % 2;
        frame.bob = frame.legs;
        const step = (a.user ? 16 : 10) * dt;
        if (Math.abs(a.to - S.x) <= step) {
          S.x = a.to;
          if (a.user) say('有什麼事嗎？', 1.8);
          return true;
        }
        S.x += dir * step;
        return false;
      },
    },
    look: {
      tick: (a) => {
        frame.expr = a.t < 0.9 ? 'lookL' : a.t < 1.8 ? 'lookR' : 'normal';
        return a.t > 2.6;
      },
    },
    jump: {
      init: () => (S.vy = 46),
      tick: (a) => {
        frame.expr = 'happy';
        frame.arms = 'up';
        return a.t > 0.1 && S.y === 0;
      },
    },
    dance: {
      init: (a) => (a.nextNote = 0),
      tick: (a) => {
        frame.expr = 'happy';
        frame.arms = Math.floor(a.t / 0.3) % 2 ? 'upL' : 'upR';
        frame.bob = Math.floor(a.t / 0.15) % 2;
        if (a.t > a.nextNote) {
          a.nextNote += 0.55;
          particles.push({ kind: 'note', x: S.x + rand(-7, 5), y: headTop() - 2, vx: rand(-4, 4), vy: -10, life: 1.3 });
        }
        return a.t > 3.6;
      },
    },
    wave: {
      init: (a) => say(a.text || '嗨～', a.text ? 3.2 : 1.8),
      tick: (a) => {
        frame.expr = 'happy';
        frame.arms = Math.floor(a.t / 0.25) % 2 ? 'upR' : 'midR';
        return a.t > 2.2;
      },
    },
    think: {
      init: () => say(contextLine(), 3.4),
      tick: (a) => {
        frame.expr = a.t < 2.8 ? 'lookUp' : 'normal';
        return a.t > 3.6;
      },
    },
    sleep: {
      init: (a) => (a.nextZ = 0.6),
      tick: (a) => {
        frame.expr = 'sleep';
        frame.bob = Math.floor(a.t / 1.3) % 2;
        if (a.t > a.nextZ) {
          a.nextZ += 1.3;
          particles.push({ kind: 'z', x: S.x + 5, y: headTop() + 1, vx: 4, vy: -6, life: 2 });
        }
        return a.t > 40;
      },
    },
    wake: {
      init: () => {
        S.vy = 38;
        say('我沒睡！真的！', 2);
        particles.push({ kind: 'bang', x: S.x + 6, y: headTop() - 4, vx: 0, vy: -4, life: 0.8 });
      },
      tick: (a) => {
        frame.expr = a.t < 0.6 ? 'surprised' : 'blink';
        return a.t > 1.6;
      },
    },
    ufo: {
      init: (a) => {
        a.ux = -12;
        a.phase = 'in';
        S.ufoCooldown = performance.now() + 60_000;
      },
      tick: (a, dt) => {
        const target = S.x - 5.5;
        if (a.phase === 'in') {
          frame.expr = 'lookUp';
          a.ux = Math.min(target, a.ux + 30 * dt);
          if (a.ux >= target) {
            a.phase = 'beam';
            a.pt = a.t;
            say('老大來接我了？', 2);
          }
        } else if (a.phase === 'beam') {
          S.floating = true;
          S.y = Math.min(6, (a.t - a.pt) * 5);
          frame.expr = 'happy';
          frame.arms = 'up';
          if (a.t - a.pt > 2.4) {
            a.phase = 'out';
            a.pt = a.t;
            S.floating = false;
            S.vy = 0;
            say('……原來只是路過', 2.2);
          }
        } else {
          frame.expr = a.t - a.pt < 0.8 ? 'surprised' : 'normal';
          a.ux += 42 * dt;
          if (a.ux > W + 2 && S.y === 0) return true;
        }
        return false;
      },
    },
    star: {
      init: (a) => {
        a.sx = Math.min(Math.max(S.x + rand(-16, 16), 8), W - 8);
        a.sy = -6;
        a.phase = 'fall';
        say('咦？', 1.2);
      },
      tick: (a, dt) => {
        if (a.phase === 'fall') {
          a.sy += 10 * dt;
          frame.expr = 'lookUp';
          const dir = Math.sign(a.sx - S.x);
          if (Math.abs(a.sx - S.x) > 0.6) {
            S.x += dir * 13 * dt;
            frame.legs = Math.floor(a.t * 8) % 2;
          }
          if (a.sy + 4 >= headTop() - 1) {
            const caught = Math.abs(a.sx - S.x) < 3;
            a.phase = caught ? 'caught' : 'missed';
            a.pt = a.t;
            if (caught) {
              burst('spark', S.x, headTop() - 2, 5, 14);
              say('撿到星星了！', 1.8);
            } else say('差一點…', 1.6);
          }
          return false;
        }
        frame.expr = a.phase === 'caught' ? 'happy' : 'normal';
        if (a.phase === 'caught') frame.arms = 'up';
        return a.t - a.pt > 1.5;
      },
    },
    // ---- 互動反應 ----
    bang: {
      init: () => {
        S.vy = 40;
        say(pick(LINES.poke), 1.4);
        particles.push({ kind: 'bang', x: S.x + 6, y: headTop() - 4, vx: 0, vy: -6, life: 0.7 });
      },
      tick: (a) => {
        frame.expr = a.t < 0.35 ? 'surprised' : 'happy';
        return a.t > 0.3 && S.y === 0;
      },
    },
    giggle: {
      init: () => say('嘻嘻～好癢', 1.5),
      tick: (a) => {
        frame.expr = 'happy';
        frame.cheeks = true;
        frame.shake = Math.floor(a.t / 0.07) % 2 ? 1 : -1;
        return a.t > 1.3;
      },
    },
    hearts: {
      init: () => {
        say(pick(['最喜歡你了', '♥', '嘿嘿']), 1.5);
        burst('heart', S.x, headTop() - 2, 3);
      },
      tick: (a) => {
        frame.expr = 'happy';
        frame.cheeks = true;
        return a.t > 1.6;
      },
    },
    spin: {
      tick: (a) => {
        frame.expr = Math.floor(a.t / 0.12) % 2 ? 'lookL' : 'lookR';
        frame.arms = 'up';
        if (a.t > 1 && !a.said) {
          a.said = true;
          say('轉轉轉～', 1.2);
        }
        return a.t > 1.4;
      },
    },
    dizzy: {
      init: () => say('頭…頭好暈', 2.2),
      tick: (a) => {
        frame.expr = 'dizzy';
        frame.shake = Math.round(Math.sin(a.t * 7));
        frame.orbit = a.t;
        return a.t > 2.8;
      },
    },
    pet: {
      init: (a) => {
        a.nextHeart = 0.2;
        say('好舒服～', 1.6);
      },
      tick: (a) => {
        frame.expr = 'happy';
        frame.cheeks = true;
        frame.bob = Math.floor(a.t / 0.4) % 2;
        if (a.t > a.nextHeart) {
          a.nextHeart += 0.45;
          particles.push({ kind: 'heart', x: S.x + rand(-6, 4), y: headTop() - 2, vx: rand(-4, 4), vy: -12, life: 1.2 });
        }
        return !S.pressing && a.t > 0.6;
      },
    },
    cheer: {
      init: (a) => {
        say(a.text || '好耶！', 2.4);
        S.vy = 42;
        burst('spark', S.x, headTop() - 2, 5, 16);
      },
      tick: (a) => {
        frame.expr = 'happy';
        frame.cheeks = true;
        frame.arms = Math.floor(a.t / 0.25) % 2 ? 'up' : 'upR';
        return a.t > 2;
      },
    },
  };

  function start(name, data = {}) {
    S.floating = false;
    S.action = { name, t: 0, ...data };
    setStatus(name);
    ACTIONS[name].init?.(S.action);
  }

  function next() {
    if (S.queue && Date.now() - S.queue.at < 60_000) {
      const q = S.queue;
      S.queue = null;
      return start(q.name, { text: q.text });
    }
    S.queue = null;
    if (Date.now() - S.lastInteract > 45_000 && Math.random() < 0.6) return start('sleep');
    const weights = reduceMotion
      ? { idle: 40, look: 20, think: 20 }
      : { idle: 22, walk: 28, look: 12, think: 12, jump: 6, dance: 6, wave: 4, star: 5, ufo: performance.now() > S.ufoCooldown ? 4 : 0 };
    let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [name, w] of Object.entries(weights)) {
      if ((r -= w) <= 0) return start(name);
    }
    start('idle');
  }

  // ---------- 互動 ----------

  function poke() {
    const now = performance.now();
    S.lastInteract = Date.now();
    pokes += 1;
    try {
      localStorage.setItem('beamup.pokes', String(pokes));
    } catch {}
    updateCounter();
    S.combo = now - S.lastPoke < 700 ? S.combo + 1 : 1;
    S.lastPoke = now;
    const current = S.action && S.action.name;
    if (current === 'sleep') return start('wake');
    if (S.combo >= 5) {
      S.combo = 0;
      return start('dizzy');
    }
    if (current === 'dizzy') return;
    start(pick(['bang', 'bang', 'giggle', 'hearts', 'spin']));
  }

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / PX, y: (e.clientY - r.top) / PX };
  }

  function onAlien(p) {
    return p.x >= S.x - 9 && p.x <= S.x + 9 && p.y >= headTop() - 2 && p.y <= groundY + 1;
  }

  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toLogical(e);
    press = { p, sx: e.clientX, sy: e.clientY, alien: onAlien(p), timer: 0 };
    if (press.alien) {
      press.timer = setTimeout(() => {
        S.pressing = true;
        S.lastInteract = Date.now();
        if (S.action?.name !== 'pet') start('pet');
        press.timer = 0;
      }, 450);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > 12) {
      clearTimeout(press.timer);
      press = null;
      S.pressing = false;
    }
  });
  const release = () => {
    if (!press) return;
    if (press.alien && press.timer) {
      clearTimeout(press.timer);
      poke();
    } else if (!press.alien && !S.pressing) {
      S.lastInteract = Date.now();
      if (S.action?.name === 'sleep') start('wake');
      else {
        start('walk', { to: press.p.x, user: true });
        say(pick(['來了來了～', '嗶嗶，出發', '要去那邊嗎？']), 1.4);
      }
    }
    S.pressing = false;
    press = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => {
    if (press) clearTimeout(press.timer);
    press = null;
    S.pressing = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 畫圖 ----------

  function drawMap(rows, x, y, alpha = 1) {
    ctx.globalAlpha = alpha;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = pal[ch] || ch;
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function alienRows() {
    const grid = BASE.map((r) => r.split(''));
    if (frame.legs) {
      grid[14] = LEGS_ALT[0].split('');
      grid[15] = LEGS_ALT[1].split('');
    }
    const ex = EXPR[frame.expr] || EXPR.normal;
    for (const [r, c, ch] of EYES[ex.eyes]) {
      const rr = r + (ex.dr || 0);
      grid[rr][c + (ex.dc || 0)] = ch;
      grid[rr][15 - c + (ex.dc || 0)] = ch;
    }
    for (const [r, c] of MOUTHS[ex.mouth]) grid[r][c] = 'M';
    if (frame.cheeks) {
      grid[8][2] = 'P';
      grid[8][13] = 'P';
    }
    for (const [r, c] of ARMS[frame.arms] || ARMS.down) grid[r][c] = 'B';
    // 天線燈一閃一閃
    if (Math.floor(performance.now() / 700) % 3 === 0) {
      grid[0][3] = 'Y';
      grid[0][12] = 'Y';
    }
    return grid.map((r) => r.join(''));
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);

    // 星星
    ctx.fillStyle = pal.star;
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(now / 900 + s.p));
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.globalAlpha = 1;
    drawMap(PLANET, W - 13, 3, 0.9);

    // 地面
    ctx.fillStyle = pal.star;
    ctx.fillRect(0, groundY, W, 1);
    ctx.globalAlpha = 0.45;
    for (let x = 0; x < W; x++) if ((x * 7) % 5 < 2) ctx.fillRect(x, groundY + 1 + (x % 2), 1, 1);
    ctx.globalAlpha = 1;

    const a = S.action;
    // 飛碟與光束
    if (a && a.name === 'ufo') {
      const ux = Math.round(a.ux);
      if (a.phase === 'beam') {
        ctx.fillStyle = 'rgba(255, 224, 102, 0.28)';
        for (let y = 6; y < groundY; y++) {
          const spread = Math.floor((y - 6) / 6);
          ctx.fillRect(ux + 2 - spread, y, 7 + spread * 2, 1);
        }
      }
      const blink = Math.floor(now / 250) % 2;
      pal.Y = blink ? '#ffd60a' : '#ff9f0a';
      drawMap(UFO, ux, 1);
      pal.Y = '#ffd60a';
    }
    if (a && a.name === 'star' && a.phase === 'fall') drawMap(SPRITES.star, Math.round(a.sx) - 2, Math.round(a.sy));

    // 影子
    const shadowW = Math.max(4, 10 - Math.round(S.y));
    ctx.fillStyle = pal.star;
    ctx.fillRect(Math.round(S.x) - shadowW / 2, groundY - 1, shadowW, 1);

    // Blip 本人
    const ax = Math.round(S.x) - 8 + (frame.shake || 0);
    const ay = groundY - 16 - Math.round(S.y) + (frame.bob || 0);
    drawMap(alienRows(), ax, ay);

    // 頭暈時繞著頭轉的星星
    if (frame.orbit != null) {
      for (let i = 0; i < 2; i++) {
        const ang = frame.orbit * 6 + i * Math.PI;
        drawMap(SPRITES.spark, Math.round(S.x + Math.cos(ang) * 8) - 1, Math.round(ay + 1 + Math.sin(ang) * 2) - 1);
      }
    }

    // 粒子
    for (const p of particles) {
      if (p.delay > 0) continue;
      const map = SPRITES[p.kind];
      drawMap(map, Math.round(p.x) - Math.floor(map[0].length / 2), Math.round(p.y), Math.min(1, p.life * 2));
    }

    // 對話框跟著頭
    if (!bubble.hidden) {
      if (now > bubbleUntil) bubble.hidden = true;
      else {
        const bw = bubble.offsetWidth;
        const cx = Math.min(Math.max(S.x * PX, bw / 2 + 8), W * PX - bw / 2 - 8);
        bubble.style.left = `${cx - bw / 2}px`;
        bubble.style.top = `${Math.max(6, ay * PX - bubble.offsetHeight - 6)}px`;
      }
    }
  }

  function update(dt) {
    frame = { expr: 'normal', arms: 'down', legs: 0, bob: 0, shake: 0, cheeks: false, orbit: null };
    if (!S.action) next();
    const a = S.action;
    a.t += dt;
    const done = ACTIONS[a.name].tick(a, dt);

    if (!S.floating && (S.y > 0 || S.vy !== 0)) {
      S.y += S.vy * dt;
      S.vy -= 230 * dt;
      if (S.y <= 0) {
        S.y = 0;
        S.vy = 0;
      }
    }

    const now = performance.now();
    if (frame.expr === 'normal') {
      if (now > S.blinkAt + 150) S.blinkAt = now + rand(1800, 4800);
      else if (now > S.blinkAt) frame.expr = 'blink';
    }

    for (const p of particles) {
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    if (done) next();
  }

  function loop(now) {
    if (!canvas.isConnected) return; // 換頁後自動停止
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!pal || now - palAt > 1000) {
      pal = readPalette();
      palAt = now;
    }
    update(dt);
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) return ro.disconnect();
    resize();
  });
  ro.observe(stage);
  resize();
  updateCounter();

  // 久沒見面先打招呼；不然就接著做剛剛的事
  if (Date.now() - S.greetedAt > 10 * 60_000) {
    S.greetedAt = Date.now();
    const line = (opts.lines && opts.lines()[0]) || '嗨～我是 Blip';
    start('wave', { text: line });
  } else if (S.action) {
    setStatus(S.action.name);
  }
  raf = requestAnimationFrame(loop);

  return { stop: () => cancelAnimationFrame(raf) };
}
