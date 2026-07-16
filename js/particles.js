/**
 * 筆跡に沿って出るエネルギー粒子（Canvas 2D）。
 * 流体シェーダの粒とは別に、なぞった瞬間のキラキラをはっきり出す。
 */
export function createStrokeParticles() {
  const particles = [];
  const MAX = 320;

  function spawn(x, y, color, amount = 3) {
    const r = Math.min(255, Math.round((color?.[0] ?? 1) * 52));
    const g = Math.min(255, Math.round((color?.[1] ?? 1) * 52));
    const b = Math.min(255, Math.round((color?.[2] ?? 1) * 52));
    const n = Math.max(1, Math.min(8, amount | 0));

    for (let i = 0; i < n; i++) {
      if (particles.length >= MAX) particles.shift();
      const ang = Math.random() * Math.PI * 2;
      const spd = 8 + Math.random() * 38;
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(ang) * spd * 0.02,
        vy: Math.sin(ang) * spd * 0.02 - (0.15 + Math.random() * 0.35),
        life: 1,
        decay: 0.014 + Math.random() * 0.028,
        size: 0.9 + Math.random() * 2.8,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: 8 + Math.random() * 14,
        r,
        g,
        b,
      });
    }
  }

  /** 線分に沿って間引きスポーン（スワイプ補間用） */
  function spawnAlong(x0, y0, x1, y1, color, density = 1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.min(10, Math.ceil(dist / 14) * density));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      spawn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, 2 + (Math.random() < 0.35 ? 1 : 0));
    }
  }

  function update(dt) {
    const t = Math.min(0.05, Math.max(0.001, dt));
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * (t * 60);
      p.y += p.vy * (t * 60);
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.vy -= 0.012 * t * 60; // ほんのり上へ
      p.life -= p.decay * (t * 60);
      p.twinkle += p.twinkleSpeed * t;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw(ctx, dpr = 1) {
    if (!particles.length) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = "screen";

    for (const p of particles) {
      const flicker = 0.55 + 0.45 * Math.sin(p.twinkle);
      const a = Math.max(0, Math.min(1, p.life * flicker));
      const radius = p.size * (0.65 + 0.55 * p.life);

      // 外側グロー
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.2);
      glow.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${a * 0.55})`);
      glow.addColorStop(0.45, `rgba(${p.r},${p.g},${p.b},${a * 0.18})`);
      glow.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 3.2, 0, Math.PI * 2);
      ctx.fill();

      // コア
      ctx.fillStyle = `rgba(255,248,255,${a * 0.95})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, radius * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  return { spawn, spawnAlong, update, draw, get count() { return particles.length; } };
}
