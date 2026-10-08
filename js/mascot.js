// 首頁的像素外星人（角色圖鑑在 aliens.js，可以隨時換角色）。
// 戳他會有反應（連戳會頭暈、長按是摸摸頭），點空地他會走過去；放著不管他會自己找事做，
// 偶爾會開飛碟兜風，太久沒理他就會睡著。全部用 canvas 一格一格畫。

import { CHARACTERS, character } from './aliens.js';

const PX = 5; // 一個像素點 = 5 CSS px
const STAGE_H = 170;

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
// 載人用的大飛碟（22 格寬），外星人坐在上面、頭罩在玻璃罩裡
const RIDE_UFO = [
  '..TSSSSSSSSSSSSSSSST..',
  '.SSSSSSSSSSSSSSSSSSSS.',
  'SSYSSSSYSSSSSSYSSSSYSS',
  '.TTTTTTTTTTTTTTTTTTTT.',
  '.....TTTTTTTTTTTT.....',
];
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
  ride: '開飛碟兜風中',
  swap: '換班中',
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
  rideCooldown: 0,
  alien: 'blip',
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
 * @param {{ alien?: string, lines?: () => string[], status?: HTMLElement, counter?: HTMLElement, onSwap?: (id: string) => void }} opts
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
    const accentNote = get('--note', '#ff9f0a');
    const eventColor = get('--event', '#ff3b30');
    return {
      theme: { todo: get('--todo', '#34c759'), note: accentNote },
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

  // 角色自己的顏色疊在共用色票上（每次換角色或換配色時重算）
  let alienPal = null;
  let alienPalKey = '';
  function paletteFor(id) {
    const key = id + pal.theme.todo + pal.theme.note;
    if (key !== alienPalKey) {
      const c = character(id).colors(pal.theme);
      alienPal = { ...pal, D: shade(c.B, -0.32), L: shade(c.B, 0.38), ...c };
      alienPalKey = key;
    }
    return alienPal;
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
    const own = character(S.alien).lines || [];
    return pick(lines.length && Math.random() < 0.6 ? lines : LINES.random.concat(own, own));
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
    // 開飛碟兜風：飛碟從旁邊滑進來把他載走，繞場幾圈後降落，他跳下來、飛碟離開
    ride: {
      init: (a) => {
        a.phase = 'arrive';
        a.sx = S.x < W / 2 ? W + 2 : -24;
        S.rideCooldown = performance.now() + 50_000;
        say('我的飛碟來了！', 1.6);
      },
      tick: (a, dt) => {
        const dock = S.x - 11;
        if (a.phase === 'arrive') {
          frame.expr = a.sx < dock ? 'lookL' : 'lookR';
          const step = 34 * dt;
          if (Math.abs(dock - a.sx) <= step) {
            a.phase = 'fly';
            a.pt = a.t;
            a.way = rand(14, W - 14);
            a.hops = 0;
            say(pick(['兜風囉！', '出發～', '咻——']), 1.6);
          } else a.sx += Math.sign(dock - a.sx) * step;
          frame.saucer = a.sx;
          return false;
        }
        if (a.phase === 'fly') {
          const lt = a.t - a.pt;
          frame.riding = true;
          frame.expr = 'happy';
          S.floating = true;
          S.y = Math.max(0, Math.min(7, lt * 5) + Math.sin(lt * 3) * 1.2);
          if (a.t < (a.wobble || 0)) frame.shake = Math.floor(a.t / 0.06) % 2 ? 1 : -1;
          if (lt > 1.2) {
            const step = 18 * dt;
            if (Math.abs(a.way - S.x) <= step) {
              a.hops += 1;
              a.way = rand(14, W - 14);
              if (a.hops >= 3) a.phase = 'land';
            } else S.x += Math.sign(a.way - S.x) * step;
            if (Math.random() < dt * 4)
              particles.push({ kind: 'spark', x: S.x + (Math.random() < 0.5 ? -11 : 11), y: headTop() + 13, vx: rand(-3, 3), vy: 6, life: 0.6 });
          }
          return false;
        }
        if (a.phase === 'land') {
          frame.riding = true;
          S.floating = true;
          S.y = Math.max(0, S.y - 8 * dt);
          if (S.y === 0) {
            a.phase = 'exit';
            a.sx = S.x - 11;
            a.dirOut = Math.random() < 0.5 ? -1 : 1;
            S.floating = false;
            S.vy = 36;
            say('好好玩！', 1.6);
          }
          return false;
        }
        frame.expr = 'happy';
        a.sx += 40 * dt * a.dirOut;
        frame.saucer = a.sx;
        return (a.sx > W + 2 || a.sx < -24) && S.y === 0;
      },
    },
    // 換角色：光束把舊的吸上去，新的降下來
    swap: {
      init: (a) => {
        a.phase = 'up';
        S.floating = true;
      },
      tick: (a, dt) => {
        frame.beam = true;
        if (a.phase === 'up') {
          frame.expr = 'surprised';
          S.y += 45 * dt;
          if (S.y > 24) {
            S.alien = a.to;
            opts.onSwap?.(a.to);
            a.phase = 'down';
          }
          return false;
        }
        if (a.phase === 'down') {
          frame.expr = 'happy';
          S.y = Math.max(0, S.y - 40 * dt);
          if (S.y === 0) {
            a.phase = 'hi';
            a.pt = a.t;
            S.floating = false;
            say(character(S.alien).intro, 2.2);
          }
          return false;
        }
        frame.beam = a.t - a.pt < 0.3;
        frame.expr = 'happy';
        frame.arms = Math.floor((a.t - a.pt) / 0.25) % 2 ? 'upR' : 'midR';
        return a.t - a.pt > 1.8;
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
    const now = performance.now();
    const weights = reduceMotion
      ? { idle: 40, look: 20, think: 20 }
      : {
          idle: 22,
          walk: 28,
          look: 12,
          think: 12,
          jump: 6,
          dance: 6,
          wave: 4,
          star: 5,
          ufo: now > S.ufoCooldown ? 3 : 0,
          ride: now > S.rideCooldown ? 5 : 0,
          ...character(S.alien).weights,
        };
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
    if (current === 'swap') return;
    if (current === 'ride' && S.action.phase !== 'exit') {
      S.action.wobble = S.action.t + 0.5;
      return say(pick(['別吵，我在開飛碟！', '安全帶繫好了嗎？', '嗶嗶，請勿干擾駕駛']), 1.6);
    }
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
    if (press.alien && !['ride', 'swap'].includes(S.action?.name)) {
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
    const riding = S.action?.name === 'ride' && S.action.phase === 'fly';
    if (press.alien && (press.timer || ['ride', 'swap'].includes(S.action?.name))) {
      clearTimeout(press.timer);
      poke();
    } else if (!press.alien && !S.pressing) {
      S.lastInteract = Date.now();
      if (riding) {
        S.action.way = Math.min(Math.max(press.p.x, 12), W - 12);
        say('收到，往那邊飛！', 1.4);
      } else if (S.action?.name === 'swap') {
        // 換班中不打斷
      } else if (S.action?.name === 'sleep') start('wake');
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

  function drawMap(rows, x, y, alpha = 1, colors = pal) {
    ctx.globalAlpha = alpha;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = colors[ch] || ch;
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function alienRows() {
    return composeAlien(character(S.alien), frame, performance.now());
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

    const def = character(S.alien);
    const colors = paletteFor(S.alien);
    const hover = def.float && !frame.riding ? 2 + Math.round(Math.sin(now / 420)) : 0;

    // 換角色的光束
    if (frame.beam) {
      ctx.fillStyle = 'rgba(255, 224, 102, 0.18)';
      for (let y = 0; y < groundY; y++) {
        const spread = Math.floor(y / 8);
        ctx.fillRect(Math.round(S.x) - 5 - spread, y, 10 + spread * 2, 1);
      }
    }

    // 影子
    const shadowW = frame.riding ? 18 : Math.max(4, 10 - Math.round(S.y + hover));
    ctx.fillStyle = pal.star;
    ctx.fillRect(Math.round(S.x - shadowW / 2), groundY - 1, shadowW, 1);

    // 外星人本人（開飛碟時只畫上半身，罩在玻璃罩裡）
    const ax = Math.round(S.x) - 8 + (frame.shake || 0);
    const ay = groundY - 16 - Math.round(S.y) + (frame.bob || 0) - hover;
    const rows = alienRows();
    const blink = Math.floor(now / 250) % 2;
    const seat = def.rideRows || 10; // 坐在飛碟裡時露出來的列數（要看得到眼睛和嘴巴）
    if (frame.riding) {
      drawMap(rows.slice(0, seat), ax, ay, 1, colors);
      ctx.fillStyle = 'rgba(165, 228, 255, 0.28)';
      for (let r = 0; r <= seat; r++) {
        const half = Math.round(9 * Math.sqrt(1 - ((seat - r) / (seat + 1)) ** 2));
        ctx.fillRect(ax + 8 - half, ay - 1 + r, half * 2, 1);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(ax + 3, ay + 2, 1, 2);
      pal.Y = blink ? '#ffd60a' : '#ff9f0a';
      drawMap(RIDE_UFO, ax - 3, ay + seat);
      pal.Y = '#ffd60a';
    } else {
      drawMap(rows, ax, ay, 1, colors);
    }
    if (frame.saucer != null) {
      pal.Y = blink ? '#ffd60a' : '#ff9f0a';
      drawMap(RIDE_UFO, Math.round(frame.saucer), groundY - 7);
      pal.Y = '#ffd60a';
    }

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
    frame = { expr: 'normal', arms: 'down', legs: 0, bob: 0, shake: 0, cheeks: false, orbit: null, riding: false, saucer: null, beam: false };
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
    if (character(S.alien).float && !frame.riding) frame.legs = Math.floor(now / 320) % 2; // 觸手一直擺動
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
  if (opts.alien && S.action?.name !== 'swap') S.alien = opts.alien;

  // 久沒見面先打招呼；不然就接著做剛剛的事
  if (Date.now() - S.greetedAt > 10 * 60_000) {
    S.greetedAt = Date.now();
    const line = (opts.lines && opts.lines()[0]) || character(S.alien).intro;
    start('wave', { text: line });
  } else if (S.action) {
    setStatus(S.action.name);
  }
  raf = requestAnimationFrame(loop);

  return {
    stop: () => cancelAnimationFrame(raf),
    /** 直接做某個動作（除錯用） */
    play: (name) => ACTIONS[name] && start(name),
    /** 用光束換成另一隻外星人 */
    swap: (id) => {
      if (!CHARACTERS[id] || (id === S.alien && S.action?.name !== 'swap')) return;
      S.lastInteract = Date.now();
      start('swap', { to: id });
    },
  };
}

/** 依目前的動作組出 16×16 的像素圖 */
function composeAlien(def, f, now) {
  const grid = def.base.map((r) => r.split(''));
  const set = (r, c, ch) => {
    if (r >= 0 && r < 16 && c >= 0 && c < 16) grid[r][c] = ch;
  };
  if (f.legs && def.legs) for (const [r, str] of def.legs) grid[r] = str.split('');
  const ex = EXPR[f.expr] || EXPR.normal;
  for (const [r, c, ch] of def.eyes[ex.eyes] || def.eyes.normal) {
    const rr = r + (ex.dr || 0);
    const dc = ex.dc || 0;
    set(rr, c + dc, ch);
    if (def.mirror !== false) set(rr, 15 - c + dc, ch);
  }
  for (const [r, c] of def.mouths[ex.mouth]) set(r, c, 'M');
  if (f.cheeks) for (const [r, c] of def.cheeks) set(r, c, 'P');
  for (const [r, c] of def.arms[f.arms] || def.arms.down) set(r, c, def.armChar || 'B');
  if (Math.floor(now / 700) % 3 === 0) for (const [r, c] of def.glow) set(r, c, 'Y');
  return grid.map((r) => r.join(''));
}

/** 在小 canvas 上畫出角色的立繪（選角色用） */
export function drawAlienPreview(canvas, id) {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const def = character(id);
  const c = def.colors({ todo: get('--todo', '#34c759'), note: get('--note', '#ff9f0a') });
  const colors = { E: '#15131f', W: '#ffffff', M: '#15131f', P: '#ff8fab', Y: '#ffd60a', G: '#a5e4ff', S: '#c9ccd6', T: '#8d92a3', D: shade(c.B, -0.32), L: shade(c.B, 0.38), ...c };
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);
  const rows = composeAlien(def, { expr: 'happy', arms: 'upR', cheeks: true }, 1);
  rows.forEach((row, r) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = colors[ch] || ch;
      ctx.fillRect(x, r, 1, 1);
    })
  );
}
