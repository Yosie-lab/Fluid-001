let ocrWorker = null;
let ocrLoading = null;

export class InkCapture {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.dpr = 1;
    this.lastX = null;
    this.lastY = null;
    this.pointCount = 0;
    this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    this.active = false;
  }

  resize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
  }

  clear() {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastX = null;
    this.lastY = null;
    this.pointCount = 0;
    this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  beginSession() {
    this.clear();
    this.active = true;
  }

  stroke(x, y) {
    if (!this.active) return;
    const px = x * this.dpr;
    const py = y * this.dpr;

    this.bounds.minX = Math.min(this.bounds.minX, px);
    this.bounds.minY = Math.min(this.bounds.minY, py);
    this.bounds.maxX = Math.max(this.bounds.maxX, px);
    this.bounds.maxY = Math.max(this.bounds.maxY, py);

    this.ctx.strokeStyle = "#fff";
    this.ctx.lineWidth = 11 * this.dpr;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    if (this.lastX != null) {
      this.ctx.moveTo(this.lastX, this.lastY);
      this.ctx.lineTo(px, py);
      this.ctx.stroke();
    } else {
      this.ctx.fillStyle = "#fff";
      this.ctx.beginPath();
      this.ctx.arc(px, py, 5 * this.dpr, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.lastX = px;
    this.lastY = py;
    this.pointCount++;
  }

  getCentroid() {
    return {
      x: (this.bounds.minX + this.bounds.maxX) * 0.5 / this.dpr,
      y: (this.bounds.minY + this.bounds.maxY) * 0.5 / this.dpr,
    };
  }

  hasEnoughInk() {
    const w = this.bounds.maxX - this.bounds.minX;
    const h = this.bounds.maxY - this.bounds.minY;
    return this.pointCount >= 10 && w > 30 * this.dpr && h > 24 * this.dpr;
  }

  getCropCanvas() {
    const pad = 18 * this.dpr;
    const { minX, minY, maxX, maxY } = this.bounds;
    const w = Math.ceil(maxX - minX + pad * 2);
    const h = Math.ceil(maxY - minY + pad * 2);
    if (w < 12 || h < 12) return null;

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    octx.fillStyle = "#000";
    octx.fillRect(0, 0, w, h);
    octx.drawImage(this.canvas, minX - pad, minY - pad, w, h, 0, 0, w, h);

    const scale = Math.min(3, Math.max(1.6, 200 / Math.max(w, h)));
    if (scale <= 1.01) return out;

    const up = document.createElement("canvas");
    up.width = Math.ceil(w * scale);
    up.height = Math.ceil(h * scale);
    const uctx = up.getContext("2d");
    uctx.fillStyle = "#000";
    uctx.fillRect(0, 0, up.width, up.height);
    uctx.drawImage(out, 0, 0, up.width, up.height);
    return up;
  }
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!ocrLoading) {
    ocrLoading = (async () => {
      const { createWorker } = await import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js"
      );
      const worker = await createWorker("jpn+eng", 1, { logger: () => {} });
      ocrWorker = worker;
      return worker;
    })();
  }
  return ocrLoading;
}

export async function recognizeInk(cropCanvas) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(cropCanvas);
  return data.text || "";
}
