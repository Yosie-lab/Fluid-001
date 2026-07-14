/** 宇宙空間の流れ星（脳リフレクソ同系統） */

export function createMeteorSystem() {
  const meteors = [];
  let lastSpawn = performance.now();
  let nextDelay = 16000 + Math.random() * 24000;
  let boost = 0;

  function pushMeteor(opts) {
    meteors.push({
      x: opts.x,
      y: opts.y,
      vx: opts.vx,
      vy: opts.vy,
      speed: opts.speed,
      length: opts.length,
      width: opts.width,
      hue: opts.hue ?? 0,
      alpha: 0,
      fadeSpeed: opts.fadeSpeed ?? 0.16,
      targetAlpha: opts.targetAlpha ?? 0.6,
      maxLife: opts.maxLife ?? 28,
      life: 0,
      isBackground: !!opts.isBackground,
    });
  }

  function spawnBackground() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const fromLeft = Math.random() < 0.5;
    let x;
    let y;
    if (fromLeft) {
      x = -80;
      y = Math.random() * h * 0.45;
    } else {
      x = Math.random() * w * 0.55;
      y = -80;
    }
    const angle = ((18 + Math.random() * 24) * Math.PI) / 180;
    const speed = 12 + Math.random() * 7;
    pushMeteor({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      length: 110 + Math.random() * 90,
      width: 1.0 + Math.random() * 0.9,
      targetAlpha: 0.48 + Math.random() * 0.24,
      maxLife: 18 + Math.random() * 14,
      isBackground: true,
    });
  }

  function spawnBurst(cx, cy, count = 6) {
    const hues = [195, 210, 262, 280, 320, 145];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 10;
      pushMeteor({
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        length: 80 + Math.random() * 100,
        width: 1.2 + Math.random() * 1.6,
        hue: hues[i % hues.length],
        targetAlpha: 0.7 + Math.random() * 0.2,
        maxLife: 16 + Math.random() * 12,
        fadeSpeed: 0.14,
        isBackground: false,
      });
    }
  }

  function setBoost(level) {
    boost = level;
  }

  function update(now) {
    const interval = nextDelay / (1 + boost * 0.14);
    if (now - lastSpawn >= interval) {
      spawnBackground();
      if (boost >= 2 && Math.random() < 0.45) spawnBackground();
      if (boost >= 5 && Math.random() < 0.35) spawnBackground();
      lastSpawn = now;
      nextDelay = 10000 + Math.random() * 30000;
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx;
      m.y += m.vy;
      m.life++;

      if (m.life > m.maxLife * 0.55) {
        m.alpha = m.targetAlpha * (1 - (m.life - m.maxLife * 0.55) / (m.maxLife * 0.45));
      } else if (m.alpha < m.targetAlpha) {
        m.alpha = Math.min(m.targetAlpha, m.alpha + m.fadeSpeed);
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      if (m.life >= m.maxLife || m.x < -200 || m.y < -200 || m.x > w + 200 || m.y > h + 200) {
        meteors.splice(i, 1);
      }
    }
  }

  function draw(ctx, dpr) {
    if (!ctx || meteors.length === 0) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";

    for (const m of meteors) {
      const tailX = m.x - (m.vx * m.length) / m.speed;
      const tailY = m.y - (m.vy * m.length) / m.speed;

      let grad;
      let glowGrad;
      if (m.isBackground) {
        grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255, 255, 255, ${m.alpha})`);
        grad.addColorStop(0.35, `rgba(242, 246, 255, ${m.alpha * 0.85})`);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        glowGrad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        glowGrad.addColorStop(0, `rgba(255, 255, 255, ${m.alpha * 0.22})`);
        glowGrad.addColorStop(1, "rgba(240, 245, 255, 0)");
      } else {
        grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255, 255, 255, ${m.alpha})`);
        grad.addColorStop(0.2, `hsla(${m.hue}, 95%, 82%, ${m.alpha})`);
        grad.addColorStop(0.55, `hsla(${m.hue}, 90%, 65%, ${m.alpha * 0.55})`);
        grad.addColorStop(1, `hsla(${m.hue}, 90%, 50%, 0)`);
        glowGrad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        glowGrad.addColorStop(0, `rgba(255, 255, 255, ${m.alpha * 0.28})`);
        glowGrad.addColorStop(0.3, `hsla(${m.hue}, 95%, 82%, ${m.alpha * 0.22})`);
        glowGrad.addColorStop(1, `hsla(${m.hue}, 90%, 50%, 0)`);
      }

      ctx.strokeStyle = glowGrad;
      ctx.lineWidth = m.isBackground ? m.width * 1.6 : m.width * 2.4;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      ctx.strokeStyle = grad;
      ctx.lineWidth = m.width;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }

    ctx.restore();
  }

  return {
    update,
    draw,
    spawnBurst,
    spawnBackground,
    setBoost,
  };
}
