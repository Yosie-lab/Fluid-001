import { FluidSim } from "./fluid.js";
import { findPositiveWord } from "./positive.js";
import { InkCapture, recognizeInk } from "./ink.js";
import { createMeteorSystem } from "./meteors.js";


/** 太さ（線の幅・筆圧まわり） */
const STROKE_WIDTHS = [
  {
    id: "hairline",
    label: "超極細",
    splatRadius: 0.009,
    splatForce: 480,
    dyeGain: 0.055,
    moveForce: 0.07,
    step: 0.0035,
  },
  {
    id: "extrafine",
    label: "極細",
    splatRadius: 0.018,
    splatForce: 900,
    dyeGain: 0.10,
    moveForce: 0.11,
    step: 0.0055,
  },
  {
    id: "fine",
    label: "細",
    splatRadius: 0.031,
    splatForce: 1150,
    dyeGain: 0.135,
    moveForce: 0.145,
    step: 0.007,
  },
  {
    id: "std",
    label: "標準",
    splatRadius: 0.055,
    splatForce: 1725,
    dyeGain: 0.175,
    moveForce: 0.205,
    step: 0.008,
  },
  {
    id: "midbold",
    label: "中太",
    splatRadius: 0.086,
    splatForce: 1900,
    dyeGain: 0.21,
    moveForce: 0.23,
    step: 0.009,
  },
];

/** 消える時間（残る長さ） */
const STROKE_FADES = [
  {
    id: "short",
    label: "短め",
    densityDissipation: 0.915,
    velocityDissipation: 0.88,
  },
  {
    id: "mid",
    label: "やや長め",
    densityDissipation: 0.952,
    velocityDissipation: 0.90,
  },
  {
    id: "long",
    label: "長め",
    densityDissipation: 0.984,
    velocityDissipation: 0.91,
  },
  {
    id: "xlong",
    label: "超長め",
    // 長めの約5倍残る
    densityDissipation: 0.9968,
    velocityDissipation: 0.9813,
  },
];

function composeStroke(width, fade) {
  return {
    id: `${width.id}-${fade.id}`,
    label: `${width.label} / ${fade.label}`,
    desc: `太さ: ${width.label} / 消え方: ${fade.label}`,
    splatRadius: width.splatRadius,
    splatForce: width.splatForce,
    dyeGain: width.dyeGain,
    moveForce: width.moveForce,
    step: width.step,
    densityDissipation: fade.densityDissipation,
    velocityDissipation: fade.velocityDissipation,
    widthId: width.id,
    fadeId: fade.id,
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
let activeWidth = STROKE_WIDTHS[1]; // 標準
let activeFade = STROKE_FADES[1]; // やや長め
let activeStroke = composeStroke(activeWidth, activeFade);
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
let pendingResize = false;

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
function createCosmicRipple(x, y, maxR, speed, hue, alpha) {
  ripples.push({
    x,
    y,
    r: 0,
    maxR: maxR || (165 + Math.random() * 80),
    speed: speed || (2.2 + Math.random() * 1.2),
    baseAlpha: alpha !== undefined ? alpha : 0.8,
    alpha: alpha !== undefined ? alpha : 0.8,
    hue: hue !== undefined && hue !== null ? hue : 195,
  });
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
    // 脳リフレクソ同様: 本体リング + 外側グロー
    ctx.strokeStyle = `hsla(${hue}, 70%, 75%, ${r.alpha * 0.55})`;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `hsla(${hue}, 70%, 75%, ${r.alpha * 0.15})`;
    ctx.lineWidth = 6.4;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}


function makeStar(dpr) {
  return {
    x: Math.random(),
    y: Math.random(),
    r: (0.4 + Math.random() * 1.4) * dpr,
    a: 0.2 + Math.random() * 0.7,
    s: 0.004 + Math.random() * 0.01,
    p: Math.random() * Math.PI * 2,
  };
}

function starDensityDivisor() {
  return Math.max(2500, 4500 / (1 + cosmosBoost * 0.18));
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
  addBonusStars(28 + cosmosBoost * 4);

  const meteorCount = 4 + Math.floor(cosmosBoost / 2);
  meteorSystem?.spawnBurst(cx, cy, meteorCount);

  const ripplesToSpawn = 2 + Math.floor(cosmosBoost / 3);
  for (let i = 0; i < ripplesToSpawn; i++) {
    createCosmicRipple(
      cx + (Math.random() - 0.5) * 40,
      cy + (Math.random() - 0.5) * 40,
      120 + i * 35 + Math.random() * 40,
      1.8 + i * 0.35,
      rippleHue(),
      0.78 - i * 0.12
    );
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
    const word = findPositiveWord(text);
    if (word) celebratePositiveWord(word, cx, cy);
  } catch (err) {
    console.warn("Positive word scan skipped:", err);
  }
}

function scheduleInkAnalysis() {
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => finishInkSession(), 1200);
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
  }
  inkCapture.stroke(clientX, clientY);
}

function drawStars(t) {
  const ctx = starsCanvas.getContext("2d");
  const w = starsCanvas.width;
  const h = starsCanvas.height;
  ctx.clearRect(0, 0, w, h);
  for (const star of stars) {
    star.p += star.s;
    const alpha = Math.max(0.08, star.a + Math.sin(star.p + t * 0.001) * 0.25);
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
    target.closest("#palette, .swatch, button, a, #settings-panel, #btn-settings, #intro")
  );
}

function strokeSplat(x, y, dx, dy, color) {
  // 線方向にごく弱い力＝文字が流れにくく、筆跡が残る
  const force = sim.config.splatForce * (activeStroke.moveForce ?? 0.22);
  // dyeGain は sim 側に反映済み。ここは力のみ。
  sim.splat(x, y, dx * force, dy * force, color);
}

function getPointer(id) {
  let p = pointers.get(id);
  if (!p) {
    p = { id, x: 0, y: 0, dx: 0, dy: 0, down: false, moved: false, color: [1, 1, 1] };
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
  p.x = uv.x;
  p.y = uv.y;
  p.dx = 0;
  p.dy = 0;
  p.color = sim.nextColor();
  // 書き始めの点（拡散させない）
  strokeSplat(p.x, p.y, 0, 0, p.color);
  touchLayer.classList.add("active");
}

function onMove(id, clientX, clientY) {
  const p = pointers.get(id);
  if (!p || !p.down) return;
  const uv = clientToUV(clientX, clientY);
  const dx = uv.x - p.x;
  const dy = uv.y - p.y;
  const dist = Math.hypot(dx, dy);

  // 速いスワイプでも文字が途切れないよう補間
  const step = activeStroke.step ?? 0.008;
  const steps = Math.max(1, Math.min(22, Math.ceil(dist / step)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = p.x + dx * t;
    const y = p.y + dy * t;
    strokeSplat(x, y, dx / steps, dy / steps, p.color);
  }
  recordInkPoint(clientX, clientY);

  p.dx = dx;
  p.dy = dy;
  p.x = uv.x;
  p.y = uv.y;
  p.moved = false;
}

function onUp(id) {
  const p = pointers.get(id);
  if (!p) return;
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


function applyStrokeSettings({ flash = true } = {}) {
  activeStroke = composeStroke(activeWidth, activeFade);
  if (!sim) return;
  sim.config.splatRadius = activeStroke.splatRadius;
  sim.config.densityDissipation = activeStroke.densityDissipation;
  sim.config.velocityDissipation = activeStroke.velocityDissipation;
  sim.config.splatForce = activeStroke.splatForce;
  sim.config.dyeGain = activeStroke.dyeGain;
  sim.config.curl = 3;

  document.querySelectorAll("#stroke-width .stroke-chip").forEach((el) => {
    el.classList.toggle("active", el.dataset.widthId === activeWidth.id);
  });
  document.querySelectorAll("#stroke-fade .stroke-chip").forEach((el) => {
    el.classList.toggle("active", el.dataset.fadeId === activeFade.id);
  });

  const foot = document.getElementById("settings-foot");
  if (foot) {
    foot.textContent = `筆跡: ${activeWidth.label} / ${activeFade.label}`;
  }
  if (flash) {
    const { w, h } = viewSize();
    createCosmicRipple(w * 0.5, h * 0.62, 90, 2.4, 195, 0.55);
  }
}

function buildChipGroup(containerId, items, key, getActiveId, onPick) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stroke-chip" + (item.id === getActiveId() ? " active" : "");
    btn.dataset[key] = item.id;
    btn.textContent = item.label;
    btn.setAttribute("aria-label", item.label);
    btn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        onPick(item);
      },
      true
    );
    el.appendChild(btn);
  });
}

function buildStrokeUI() {
  buildChipGroup("stroke-width", STROKE_WIDTHS, "widthId", () => activeWidth.id, (item) => {
    activeWidth = item;
    applyStrokeSettings();
  });
  buildChipGroup("stroke-fade", STROKE_FADES, "fadeId", () => activeFade.id, (item) => {
    activeFade = item;
    applyStrokeSettings();
  });
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
      curl: 3,
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
  buildPaletteUI();
  buildStrokeUI();
  applyStrokeSettings({ flash: false });
  bindChromeUI();
  bindInput();
  installViewportLock();
  inkCapture = new InkCapture();
  inkCapture.resize(viewSize().w, viewSize().h);
  meteorSystem = createMeteorSystem();
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
