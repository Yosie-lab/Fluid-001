import { FluidSim } from "./fluid.js";
import { findPositiveWord } from "./positive.js";
import { InkCapture, recognizeInk, preloadOcr } from "./ink.js";
import { createMeteorSystem } from "./meteors.js";
import { createHaptics } from "./haptics.js";


/** 太さの端点（超極細 → 中太）。スライダーで連続補間 */
const STROKE_WIDTH_STOPS = [
  { splatRadius: 0.0045, splatForce: 225, dyeGain: 0.025, moveForce: 0.028, step: 0.0014 },
  { splatRadius: 0.018, splatForce: 900, dyeGain: 0.10, moveForce: 0.11, step: 0.0055 },
  { splatRadius: 0.031, splatForce: 1150, dyeGain: 0.135, moveForce: 0.145, step: 0.007 },
  { splatRadius: 0.055, splatForce: 1725, dyeGain: 0.175, moveForce: 0.205, step: 0.008 },
  { splatRadius: 0.086, splatForce: 1900, dyeGain: 0.21, moveForce: 0.23, step: 0.009 },
];

/** 消える時間の端点（短め → 超長め） */
const STROKE_FADE_STOPS = [
  { densityDissipation: 0.915, velocityDissipation: 0.88 },
  { densityDissipation: 0.952, velocityDissipation: 0.90 },
  { densityDissipation: 0.984, velocityDissipation: 0.91 },
  { densityDissipation: 0.9968, velocityDissipation: 0.9813 },
];

const STROKE_STORAGE_KEY = "fluid-words-stroke-v4";
const WIDTH_KEYS = ["splatRadius", "splatForce", "dyeGain", "moveForce", "step"];
const FADE_KEYS = ["densityDissipation", "velocityDissipation"];

function clamp01(t) {
  return Math.min(1, Math.max(0, Number(t) || 0));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleStops(stops, t, keys) {
  const n = stops.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  const out = {};
  for (const key of keys) out[key] = lerp(a[key], b[key], f);
  return out;
}

function composeStrokeFromSliders(widthT, fadeT) {
  const width = sampleStops(STROKE_WIDTH_STOPS, widthT, WIDTH_KEYS);
  const fade = sampleStops(STROKE_FADE_STOPS, fadeT, FADE_KEYS);
  const wPct = Math.round(clamp01(widthT) * 100);
  const fPct = Math.round(clamp01(fadeT) * 100);
  return {
    id: `w${wPct}-f${fPct}`,
    label: `太さ ${wPct}% / 長さ ${fPct}%`,
    desc: `細い→太い ${wPct}% / 短い→長い ${fPct}%`,
    ...width,
    ...fade,
    widthT: clamp01(widthT),
    fadeT: clamp01(fadeT),
  };
}

const PALETTES = [
  {
    id: "nebula",
    label: "Nebula",
    swatch: "linear-gradient(135deg, #6ef3ff, #ff6ad5 55%, #a78bfa)",
    colors: [[0.42, 0.9, 1.0], [1.0, 0.38, 0.82], [0.62, 0.42, 1.0]],
  },
  {
    id: "aurora",
    label: "Aurora",
    swatch: "linear-gradient(135deg, #5dffb0, #55e0ff, #7cff9a)",
    colors: [[0.3, 1.0, 0.7], [0.3, 0.85, 1.0], [0.55, 1.0, 0.55]],
  },
  {
    id: "solar",
    label: "Solar",
    swatch: "linear-gradient(135deg, #ffd166, #ff6b4a, #ff9ecd)",
    colors: [[1.0, 0.82, 0.35], [1.0, 0.4, 0.28], [1.0, 0.55, 0.75]],
  },
  {
    id: "void",
    label: "Void",
    swatch: "linear-gradient(135deg, #c4b5fd, #67e8f9, #f5d0fe)",
    colors: [[0.72, 0.65, 1.0], [0.4, 0.9, 0.98], [0.95, 0.75, 1.0]],
  },
];

const canvas = document.getElementById("fluid");
const starsCanvas = document.getElementById("stars");
const rippleCanvas = document.getElementById("ripple");
const touchLayer = document.getElementById("touch-layer");
const paletteEl = document.getElementById("palette");

const pointers = new Map();
let sim;
let activePalette = PALETTES[0];
// デフォルト: 太さ 20% / 消える時間 70%
let widthT = 0.2;
let fadeT = 0.7;
let activeStroke = composeStrokeFromSliders(widthT, fadeT);
let stars = [];
let last = performance.now();
let ambientTimer = 0;
let nextRippleIn = 6.5 + Math.random() * 1.5; // ~7秒ごと
let ripples = [];
let cosmosBoost = 0;
let inkCapture = null;
let inkSessionActive = false;
let analyzeTimer = null;
let toastTimer = null;
let meteorSystem = null;
let haptics = null;
let pendingResize = false;
/** 0=暗い元の星空 → 1=文字があるときの明るさ */
let skyLit = 0;

/** なぞり波紋（いったん無効） */
const STROKE_RIPPLES_ENABLED = false;
/** なぞり波紋の間隔（px） */
const STROKE_RIPPLE_STEP = 64;
/** 曲がり角とみなす角度（ラジアン） */
const STROKE_TURN_ANGLE = 0.72;
/** 星空の基本の暗さ（0=真っ暗寄り, 1=従来）※最初・最後はこの明るさ */
const STAR_BASE_DIM = 0.82;
/** 文字があるときの星の明るさ倍率 */
const STAR_LIT_BOOST = 1.35;

function viewSize() {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round(vv?.width ?? window.innerWidth)),
    h: Math.max(1, Math.round(vv?.height ?? window.innerHeight)),
    top: vv?.offsetTop ?? 0,
    left: vv?.offsetLeft ?? 0,
  };
}

function applyViewportLock() {
  const { w, h, top, left } = viewSize();
  const root = document.documentElement;
  root.style.setProperty("--app-h", `${h}px`);
  root.style.setProperty("--app-w", `${w}px`);
  root.style.setProperty("--vv-top", `${top}px`);
  root.style.setProperty("--vv-left", `${left}px`);
  if (window.scrollX || window.scrollY) {
    window.scrollTo(0, 0);
  }
  if ([...pointers.values()].some((p) => p.down)) {
    pendingResize = true;
    return;
  }
  onResize();
}

function installViewportLock() {
  applyViewportLock();
  window.visualViewport?.addEventListener("resize", applyViewportLock);
  window.visualViewport?.addEventListener("scroll", applyViewportLock);
  window.addEventListener("resize", applyViewportLock);
}

function installScrollLock() {
  const blockGesture = (e) => e.preventDefault();
  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, { passive: false });
  document.addEventListener("gestureend", blockGesture, { passive: false });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (isUiTarget(e.target)) return;
      e.preventDefault();
    },
    { passive: false }
  );
}

// 脳リフレクソ同系統: 宇宙空間の広がる光の波紋
const MAX_RIPPLES = 48;

function createCosmicRipple(x, y, maxR, speed, hue, alpha, kind = "ambient") {
  if (ripples.length >= MAX_RIPPLES) ripples.shift();
  ripples.push({
    x,
    y,
    r: 0,
    maxR: maxR || (165 + Math.random() * 80),
    speed: speed || (2.2 + Math.random() * 1.2),
    baseAlpha: alpha !== undefined ? alpha : 0.8,
    alpha: alpha !== undefined ? alpha : 0.8,
    hue: hue !== undefined && hue !== null ? hue : 195,
    kind,
  });
}

function bumpSkyLit(amount = 0.2) {
  skyLit = Math.min(1, skyLit + amount);
}

function spawnStrokeRipple(x, y) {
  if (!STROKE_RIPPLES_ENABLED) return;
  const hue = rippleHue();
  // 通常波紋と同じ alpha。線幅は描画時にサイズ比例で合わせる
  createCosmicRipple(x, y, 26 + Math.random() * 12, 1.5 + Math.random() * 0.35, hue, 0.85, "stroke");
}

/** 指を離したとき（波紋はいったん出さない） */
function celebrateStrokeComplete(_cx, _cy) {
  bumpSkyLit(0.45);
}

function spawnAmbientRipple() {
  const { w, h } = viewSize();
  const x = w * (0.15 + Math.random() * 0.7);
  const y = h * (0.18 + Math.random() * 0.64);
  // パレットに寄せた宇宙の色相
  const hues = {
    nebula: [195, 210, 280, 320],
    aurora: [145, 160, 185],
    solar: [35, 20, 330],
    void: [250, 210, 290],
  };
  const list = hues[activePalette.id] || hues.nebula;
  const hue = list[Math.floor(Math.random() * list.length)];
  const maxR = 120 + Math.random() * 110;
  const speed = 1.6 + Math.random() * 1.0;
  createCosmicRipple(x, y, maxR, speed, hue, 0.85);
  // たまに二重波紋
  if (Math.random() < 0.35) {
    createCosmicRipple(x, y, maxR * 0.7, speed * 1.15, hue, 0.55);
  }
}

function updateRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.r += r.speed;
    r.alpha = r.baseAlpha * (1.0 - r.r / r.maxR);
    if (r.r >= r.maxR || r.alpha <= 0) {
      ripples.splice(i, 1);
    }
  }
}

function resizeRippleCanvas() {
  if (!rippleCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = viewSize();
  rippleCanvas.width = Math.floor(w * dpr);
  rippleCanvas.height = Math.floor(h * dpr);
  rippleCanvas.style.width = "100%";
  rippleCanvas.style.height = "100%";
}

function drawRipples() {
  if (!rippleCanvas) return;
  const ctx = rippleCanvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.clearRect(0, 0, rippleCanvas.width, rippleCanvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.globalCompositeOperation = "screen";

  for (const r of ripples) {
    const hue = r.hue || 195;
    const isBless = r.kind === "bless";
    // 小さいなぞり波紋でも通常と同じ見た目の「細いリング」になるよう線幅をスケール
    const sizeScale = isBless ? 1 : Math.min(1, Math.max(0.28, r.maxR / 150));
    const coreMul = isBless ? 0.85 : 0.55;
    const glowMul = isBless ? 0.35 : 0.15;
    const coreW = (isBless ? 4.2 : 3.2) * sizeScale;
    const glowW = (isBless ? 9.5 : 6.4) * sizeScale;

    if (isBless && r.r < 10) {
      const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 12);
      g.addColorStop(0, `hsla(${hue}, 85%, 88%, ${r.alpha * 0.55})`);
      g.addColorStop(1, `hsla(${hue}, 80%, 70%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `hsla(${hue}, 70%, 75%, ${r.alpha * coreMul})`;
    ctx.lineWidth = coreW;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0.5, r.r), 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `hsla(${hue}, 70%, 75%, ${r.alpha * glowMul})`;
    ctx.lineWidth = glowW;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0.5, r.r), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}


function makeStar(dpr) {
  return {
    x: Math.random(),
    y: Math.random(),
    r: (0.38 + Math.random() * 1.25) * dpr,
    // やや暗めだが最初・最後でも見える明るさ
    a: Math.min(1, (0.18 + Math.random() * 0.55) * 0.95),
    s: 0.004 + Math.random() * 0.01,
    p: Math.random() * Math.PI * 2,
  };
}

function starDensityDivisor() {
  // 以前の 4500 基準の約2倍の星数
  return Math.max(1250, 2250 / (1 + cosmosBoost * 0.18));
}

function resizeStars() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = viewSize();
  starsCanvas.width = Math.floor(w * dpr);
  starsCanvas.height = Math.floor(h * dpr);
  starsCanvas.style.width = "100%";
  starsCanvas.style.height = "100%";
  const count = Math.floor((w * h) / starDensityDivisor());
  stars = Array.from({ length: count }, () => makeStar(dpr));
}

function addBonusStars(amount) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 0; i < amount; i++) {
    stars.push(makeStar(dpr));
  }
}

function rippleHue() {
  const hues = {
    nebula: [195, 210, 280, 320],
    aurora: [145, 160, 185],
    solar: [35, 20, 330],
    void: [250, 210, 290],
  };
  const list = hues[activePalette.id] || hues.nebula;
  return list[Math.floor(Math.random() * list.length)];
}

function showPositiveToast(word) {
  const toast = document.getElementById("pos-toast");
  if (!toast) return;
  toast.textContent = `✦ ${word}`;
  toast.hidden = false;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
    }, 500);
  }, 2200);
}

function celebratePositiveWord(word, cx, cy) {
  cosmosBoost = Math.min(12, cosmosBoost + 1);
  meteorSystem?.setBoost(cosmosBoost);
  bumpSkyLit(1);
  addBonusStars(36 + cosmosBoost * 6);

  const meteorCount = 6 + Math.floor(cosmosBoost / 2);
  meteorSystem?.spawnBurst(cx, cy, meteorCount);

  const ripplesToSpawn = 3 + Math.floor(cosmosBoost / 3);
  for (let i = 0; i < ripplesToSpawn; i++) {
    createCosmicRipple(
      cx + (Math.random() - 0.5) * 50,
      cy + (Math.random() - 0.5) * 50,
      140 + i * 45 + Math.random() * 50,
      1.6 + i * 0.4,
      rippleHue(),
      0.9 - i * 0.1
    );
  }

  // 背景フルードも反応させる
  if (sim) {
    const { w, h } = viewSize();
    const ux = Math.min(1, Math.max(0, cx / Math.max(1, w)));
    const uy = 1 - Math.min(1, Math.max(0, cy / Math.max(1, h)));
    for (let i = 0; i < 5; i++) {
      const color = sim.nextColor();
      const ang = Math.random() * Math.PI * 2;
      const force = 900 + Math.random() * 900;
      sim.splat(
        Math.min(1, Math.max(0, ux + (Math.random() - 0.5) * 0.12)),
        Math.min(1, Math.max(0, uy + (Math.random() - 0.5) * 0.12)),
        Math.cos(ang) * force,
        Math.sin(ang) * force,
        color
      );
    }
  }

  // 周囲にも星を短時間増やす
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      if (meteorSystem) meteorSystem.spawnBackground();
      spawnAmbientRipple();
    }, 180 + i * 220);
  }

  showPositiveToast(word);
}

async function finishInkSession() {
  analyzeTimer = null;
  inkSessionActive = false;
  if (!inkCapture || !inkCapture.hasEnoughInk()) {
    inkCapture?.clear();
    return;
  }

  const crop = inkCapture.getCropCanvas();
  const { x: cx, y: cy } = inkCapture.getCentroid();
  inkCapture.clear();
  if (!crop) return;

  try {
    const text = await recognizeInk(crop);
    console.log("[Fluid Words OCR]", text);
    const word = findPositiveWord(text);
    if (word) {
      celebratePositiveWord(word, cx, cy);
    }
  } catch (err) {
    console.warn("Positive word scan skipped:", err);
  }
}

function scheduleInkAnalysis() {
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => finishInkSession(), 900);
}

function recordInkPoint(clientX, clientY) {
  if (!inkCapture) return;
  if (analyzeTimer) {
    clearTimeout(analyzeTimer);
    analyzeTimer = null;
  }
  if (!inkSessionActive) {
    inkCapture.beginSession();
    inkSessionActive = true;
    preloadOcr();
  }
  inkCapture.stroke(clientX, clientY);
}

function drawStars(t) {
  const ctx = starsCanvas.getContext("2d");
  const w = starsCanvas.width;
  const h = starsCanvas.height;
  ctx.clearRect(0, 0, w, h);
  // 文字があるときだけ明るく。消えると暗い元の星空へ
  const lit = STAR_BASE_DIM + (STAR_LIT_BOOST - STAR_BASE_DIM) * skyLit;
  for (const star of stars) {
    star.p += star.s;
    const twinkle = Math.sin(star.p + t * 0.001) * (0.18 + skyLit * 0.14);
    const alpha = Math.min(1, Math.max(0.07, (star.a + twinkle) * lit));
    ctx.fillStyle = `rgba(230, 235, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clientToUV(clientX, clientY) {
  const { w, h } = viewSize();
  const x = clientX / w;
  const y = 1 - clientY / h;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function isUiTarget(target) {
  return !!(
    target &&
    target.closest &&
    target.closest("#palette, .swatch, button, a, #settings-panel, #btn-settings, #intro, #chk-haptic, .settings-toggle")
  );
}

function strokeSplat(x, y, color) {
  // 速度 0 で色だけ置く（動かすと文字が崩れる／色パスを飛ばすと見えない）
  sim.splat(x, y, 0, 0, color);
}

function getPointer(id) {
  let p = pointers.get(id);
  if (!p) {
    p = {
      id,
      x: 0,
      y: 0,
      clientX: 0,
      clientY: 0,
      dx: 0,
      dy: 0,
      down: false,
      moved: false,
      lastAngle: null,
      drew: false,
      rippleDist: 0,
      color: [1, 1, 1],
    };
    pointers.set(id, p);
  }
  return p;
}

function onDown(id, clientX, clientY) {
  dismissIntro();
  if (!document.getElementById("settings-panel")?.hidden) {
    setSettingsOpen(false);
  }
  recordInkPoint(clientX, clientY);
  const p = getPointer(id);
  const uv = clientToUV(clientX, clientY);
  p.down = true;
  p.moved = false;
  p.drew = false;
  p.rippleDist = 0;
  p.x = uv.x;
  p.y = uv.y;
  p.clientX = clientX;
  p.clientY = clientY;
  p.dx = 0;
  p.dy = 0;
  p.lastAngle = null;
  p.color = sim.nextColor();
  strokeSplat(p.x, p.y, p.color);
  bumpSkyLit(0.2);
  // 書き始めは波紋を出さない（直後のなぞりと重なって多すぎるため）
  haptics?.touchStart();
  touchLayer.classList.add("active");
}

function onMove(id, clientX, clientY) {
  const p = pointers.get(id);
  if (!p || !p.down) return;
  const uv = clientToUV(clientX, clientY);
  const dx = uv.x - p.x;
  const dy = uv.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.0004) return;

  const prevClientX = p.clientX;
  const prevClientY = p.clientY;
  const screenDist = Math.hypot(clientX - prevClientX, clientY - prevClientY);

  const step = activeStroke.step ?? 0.008;
  const steps = Math.max(1, Math.min(22, Math.ceil(dist / step)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = p.x + dx * t;
    const y = p.y + dy * t;
    strokeSplat(x, y, p.color);
  }

  // なぞり波紋はいったん無効（STROKE_RIPPLES_ENABLED）
  if (STROKE_RIPPLES_ENABLED) {
    p.rippleDist += screenDist;
    while (p.rippleDist >= STROKE_RIPPLE_STEP) {
      p.rippleDist -= STROKE_RIPPLE_STEP;
      spawnStrokeRipple(clientX, clientY);
    }
  }

  const angle = Math.atan2(dy, dx);
  if (p.lastAngle != null && dist > 0.006) {
    let turn = Math.abs(angle - p.lastAngle);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn >= STROKE_TURN_ANGLE) {
      haptics?.strokeTick();
      p.lastAngle = angle;
    }
  } else if (p.lastAngle == null) {
    p.lastAngle = angle;
  }

  recordInkPoint(clientX, clientY);

  p.dx = dx;
  p.dy = dy;
  p.x = uv.x;
  p.y = uv.y;
  p.clientX = clientX;
  p.clientY = clientY;
  p.drew = true;
}

function onUp(id) {
  const p = pointers.get(id);
  if (!p) return;

  // 指を離した位置に必ず最後の波紋
  celebrateStrokeComplete(p.clientX, p.clientY);
  haptics?.liftEnd();

  p.down = false;
  p.moved = false;
  pointers.delete(id);
  if (![...pointers.values()].some((q) => q.down)) {
    touchLayer.classList.remove("active");
    if (inkSessionActive) scheduleInkAnalysis();
    if (pendingResize) {
      pendingResize = false;
      onResize();
    }
  }
}


function loadStrokePrefs() {
  try {
    const raw = localStorage.getItem(STROKE_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.widthT === "number") widthT = clamp01(data.widthT);
    if (typeof data.fadeT === "number") fadeT = clamp01(data.fadeT);
  } catch (_) {
    /* ignore corrupt prefs */
  }
}

function saveStrokePrefs() {
  try {
    localStorage.setItem(
      STROKE_STORAGE_KEY,
      JSON.stringify({ widthT: clamp01(widthT), fadeT: clamp01(fadeT) })
    );
  } catch (_) {
    /* private mode etc. */
  }
}

function applyStrokeSettings({ flash = true, persist = true } = {}) {
  activeStroke = composeStrokeFromSliders(widthT, fadeT);
  if (!sim) return;
  sim.config.splatRadius = activeStroke.splatRadius;
  sim.config.densityDissipation = activeStroke.densityDissipation;
  sim.config.velocityDissipation = activeStroke.velocityDissipation;
  sim.config.splatForce = activeStroke.splatForce;
  sim.config.dyeGain = activeStroke.dyeGain;
  sim.config.curl = 0.4;

  const widthSlider = document.getElementById("stroke-width-slider");
  const fadeSlider = document.getElementById("stroke-fade-slider");
  if (widthSlider) widthSlider.value = String(Math.round(clamp01(widthT) * 100));
  if (fadeSlider) fadeSlider.value = String(Math.round(clamp01(fadeT) * 100));

  const foot = document.getElementById("settings-foot");
  if (foot) foot.textContent = `筆跡: ${activeStroke.label}`;

  if (persist) saveStrokePrefs();

  if (flash) {
    const { w, h } = viewSize();
    createCosmicRipple(w * 0.5, h * 0.62, 90, 2.4, 195, 0.55);
  }
}

function buildStrokeUI() {
  const widthSlider = document.getElementById("stroke-width-slider");
  const fadeSlider = document.getElementById("stroke-fade-slider");

  const onWidth = (e) => {
    e.stopPropagation();
    widthT = clamp01(Number(e.target.value) / 100);
    applyStrokeSettings({ flash: false });
  };
  const onFade = (e) => {
    e.stopPropagation();
    fadeT = clamp01(Number(e.target.value) / 100);
    applyStrokeSettings({ flash: false });
  };
  const flashOnce = () => applyStrokeSettings({ flash: true, persist: true });

  widthSlider?.addEventListener("input", onWidth);
  fadeSlider?.addEventListener("input", onFade);
  widthSlider?.addEventListener("change", flashOnce);
  fadeSlider?.addEventListener("change", flashOnce);

  // iOS: スライダー操作中に描画へタッチが抜けないよう止める
  for (const el of [widthSlider, fadeSlider]) {
    if (!el) continue;
    el.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
  }
}

function buildPaletteUI() {
  paletteEl.replaceChildren();
  PALETTES.forEach((pal, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch" + (idx === 0 ? " active" : "");
    btn.style.setProperty("--swatch", pal.swatch);
    btn.title = pal.label;
    btn.setAttribute("aria-label", pal.label);
    btn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        activePalette = pal;
        sim.setPalette(pal);
        paletteEl.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        sim.multipleSplats(4);
      },
      true
    );
    paletteEl.appendChild(btn);
  });
}


function dismissIntro() {
  const intro = document.getElementById("intro");
  if (!intro || intro.classList.contains("is-hidden")) return;
  intro.classList.add("is-hidden");
  document.getElementById("brand-corner")?.classList.add("visible");
}

function setSettingsOpen(open) {
  const panel = document.getElementById("settings-panel");
  const btn = document.getElementById("btn-settings");
  if (!panel || !btn) return;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.setAttribute("aria-label", open ? "設定を閉じる" : "設定を開く");
}

function bindChromeUI() {
  const intro = document.getElementById("intro");
  const btn = document.getElementById("btn-settings");
  const closeBtn = document.getElementById("btn-settings-close");
  const panel = document.getElementById("settings-panel");

  const hideIntro = (e) => {
    if (e) e.preventDefault();
    dismissIntro();
  };
  intro?.addEventListener("pointerdown", hideIntro, { passive: false });
  intro?.addEventListener("touchstart", hideIntro, { passive: false });

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissIntro();
    setSettingsOpen(!!panel?.hidden);
  });

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setSettingsOpen(false);
  });

  // パネル外タップで閉じる（touch-layer 側でも可）
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!panel || panel.hidden) return;
      if (e.target.closest("#settings-panel, #btn-settings")) return;
      setSettingsOpen(false);
    },
    true
  );
}

function bindInput() {
  // --- Touch (iOS primary) ---
  const onTouchStart = (e) => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    for (const t of e.changedTouches) onDown(t.identifier, t.clientX, t.clientY);
  };
  const onTouchMove = (e) => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    for (const t of e.changedTouches) onMove(t.identifier, t.clientX, t.clientY);
  };
  const onTouchEnd = (e) => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    for (const t of e.changedTouches) onUp(t.identifier);
  };

  const opts = { passive: false, capture: true };
  document.addEventListener("touchstart", onTouchStart, opts);
  document.addEventListener("touchmove", onTouchMove, opts);
  document.addEventListener("touchend", onTouchEnd, opts);
  document.addEventListener("touchcancel", onTouchEnd, opts);
  installScrollLock();

  // --- Mouse / Pencil ---
  touchLayer.addEventListener("mousedown", (e) => {
    if (isUiTarget(e.target)) return;
    if (e.button !== 0) return;
    onDown(-1, e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => {
    if (e.buttons !== 1) return;
    onMove(-1, e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", () => onUp(-1));
}

function onResize() {
  sim.resize();
  const { w, h } = viewSize();
  inkCapture?.resize(w, h);
  resizeStars();
  resizeRippleCanvas();
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;

  ambientTimer += dt;
  if (ambientTimer >= nextRippleIn) {
    ambientTimer = 0;
    nextRippleIn = (6.2 + Math.random() * 1.8) / (1 + cosmosBoost * 0.12);
    if (![...pointers.values()].some((p) => p.down)) {
      const bursts = 1 + Math.floor(cosmosBoost / 4);
      for (let i = 0; i < bursts; i++) spawnAmbientRipple();
    }
  }

  // 文字が残っている間は明るめ。消えるにつれて暗い星空へ戻す
  const drawing = [...pointers.values()].some((p) => p.down);
  if (drawing) {
    bumpSkyLit(0.035);
  } else {
    // 筆跡の消え方に合わせてゆっくり戻す（長い設定ほどゆっくり）
    const fadeHold = 0.35 + fadeT * 1.4;
    const decay = 1 - Math.min(0.9, dt / fadeHold);
    skyLit *= decay;
    if (skyLit < 0.01) skyLit = 0;
  }

  updateRipples();
  meteorSystem?.update(now);
  // move中は onMove で直接 splat 済み。down状態の維持だけ。
  sim.update(dt);
  drawStars(now);
  if (meteorSystem && starsCanvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    meteorSystem.draw(starsCanvas.getContext("2d"), dpr);
  }
  drawRipples();
  requestAnimationFrame(frame);
}

function boot() {
  // iOS: レイアウト確定後に初期化
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  try {
    sim = new FluidSim(canvas, {
      palette: activePalette,
      splatForce: activeStroke.splatForce,
      splatRadius: activeStroke.splatRadius,
      densityDissipation: activeStroke.densityDissipation,
      velocityDissipation: activeStroke.velocityDissipation,
      dyeGain: activeStroke.dyeGain,
      curl: 0.4,
      pressure: 0.7,
      simResolution: 96,
      dyeResolution: 320,
      pressureIterations: 10,
    });
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? err.message : String(err);
    document.body.innerHTML = "<p style='color:#fff;padding:24px;font-family:sans-serif;line-height:1.6'>描画の初期化に失敗しました。<br><small style='opacity:.7'>" + msg.replace(/</g,"&lt;") + "</small></p>";
    return;
  }
  loadStrokePrefs();
  buildPaletteUI();
  buildStrokeUI();
  applyStrokeSettings({ flash: false, persist: false });
  bindChromeUI();
  bindInput();
  installViewportLock();
  inkCapture = new InkCapture();
  inkCapture.resize(viewSize().w, viewSize().h);
  preloadOcr();
  meteorSystem = createMeteorSystem();
  haptics = createHaptics();
  haptics.bindToggle(document.getElementById("chk-haptic"));
  resizeStars();
  resizeRippleCanvas();
  sim.multipleSplats(1);
  // 起動直後にも一回、空間の波紋を出しておく
  setTimeout(() => spawnAmbientRipple(), 1200);
  window.addEventListener("orientationchange", () => setTimeout(applyViewportLock, 200));
  requestAnimationFrame(frame);
}

if (document.readyState === "complete") {
  setTimeout(boot, 50);
} else {
  window.addEventListener("load", () => setTimeout(boot, 50));
}
