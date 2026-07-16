/**
 * Fluid — WebGL2 Navier–Stokes + spacey bloom
 */
const SHADER_BASE = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "Shader compile failed");
  }
  return shader;
}

function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPosition");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "Program link failed");
  }
  return p;
}

function getUniforms(gl, prog) {
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(prog, i);
    uniforms[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return uniforms;
}

function createGL(canvas) {
  const attrs = [
    { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "default" },
    { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true },
    {},
  ];
  for (const a of attrs) {
    const gl = canvas.getContext("webgl2", a);
    if (gl) return gl;
  }
  return null;
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(texture);
  return status === gl.FRAMEBUFFER_COMPLETE;
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      default:
        return null;
    }
  }
  return { internalFormat, format, type };
}

export class FluidSim {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.gl = createGL(canvas);
    if (!this.gl) {
      throw new Error("この端末では WebGL2 を初期化できませんでした");
    }

    // iPhone向け拡張を先に有効化
    this.gl.getExtension("EXT_color_buffer_float");
    this.gl.getExtension("EXT_color_buffer_half_float");
    this.gl.getExtension("OES_texture_float_linear");
    this.gl.getExtension("OES_texture_half_float_linear");

    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 700;
    this.config = {
      simResolution: options.simResolution ?? (mobile ? 96 : 180),
      dyeResolution: options.dyeResolution ?? (mobile ? 256 : 800),
      densityDissipation: options.densityDissipation ?? 0.925,
      velocityDissipation: options.velocityDissipation ?? 0.94,
      pressure: options.pressure ?? 0.8,
      pressureIterations: options.pressureIterations ?? (mobile ? 12 : 18),
      curl: options.curl ?? 14,
      splatRadius: options.splatRadius ?? 0.12,
      splatForce: options.splatForce ?? 3200,
      bloom: options.bloom !== false,
      bloomIntensity: options.bloomIntensity ?? 0.85,
      bloomThreshold: options.bloomThreshold ?? 0.28,
      dyeGain: options.dyeGain ?? 0.18,
    };

    this.palette = options.palette || {
      colors: [
        [0.4, 0.85, 1.0],
        [1.0, 0.35, 0.85],
        [0.55, 0.4, 1.0],
      ],
    };

    this._colorIndex = 0;
    this._initPrograms();
    this._initBlit();
    this.resize();
  }

  setPalette(palette) {
    this.palette = palette;
  }

  _initPrograms() {
    const gl = this.gl;
    const vert = `${SHADER_BASE}
in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform highp vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

    const make = (fs) => {
      const p = makeProgram(gl, vert, fs);
      return { program: p, uniforms: getUniforms(gl, p) };
    };

    this.programs = {
      clear: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 fragColor;
void main () {
  fragColor = value * texture(uTexture, vUv);
}`),
      splat: make(`${SHADER_BASE}
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 fragColor;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture(uTarget, vUv).xyz;
  fragColor = vec4(base + splat, 1.0);
}`),
      advection: make(`${SHADER_BASE}
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform highp vec2 texelSize;
uniform highp vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;
out vec4 fragColor;
vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
void main () {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
  fragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
  fragColor.a = 1.0;
}`),
      divergence: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}`),
      curl: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`),
      vorticity: make(`${SHADER_BASE}
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 fragColor;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy;
  fragColor = vec4(vel + force * dt, 0.0, 1.0);
}`),
      pressure: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColor;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`),
      gradientSubtract: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}`),
      display: make(`${SHADER_BASE}
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform float bloomIntensity;
uniform float useBloom;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.13));
}

vec3 speck(vec3 fluid, float dens, float n, float cut, float gain) {
  float s = step(cut, n) * dens;
  return normalize(fluid + vec3(0.05)) * s * gain + vec3(s * s * 1.8);
}

// セル内にエネルギー粒子を複数置く（cellPxが大きい=粗い）
vec3 energyParticles(vec2 uv, vec3 fluid, float dens, float cellPx, float sharpness, float thresh, float perCell, float gain) {
  vec2 scale = uResolution / max(cellPx, 1.0);
  vec2 gid = floor(uv * scale);
  vec2 f = fract(uv * scale);
  vec3 spark = vec3(0.0);
  vec3 tint = normalize(fluid + vec3(0.04, 0.05, 0.08)) * (1.6 + dens * 2.0);

  for (float i = 0.0; i < 3.0; i++) {
    if (i >= perCell) break;
    vec2 rnd = hash22(gid + i * 19.7);
    // 粗い粒は少なめ・細かい粒は多め
    float spawnCut = mix(0.35, 0.08, clamp(8.0 / cellPx, 0.0, 1.0));
    if (rnd.x > clamp(dens * 1.25 + spawnCut, 0.0, 0.98)) continue;

    vec2 center = mix(vec2(0.12), vec2(0.88), hash22(gid * 3.1 + i * 7.9));
    float d = length(f - center);
    float gate = smoothstep(thresh, thresh + 0.18, dens * (0.5 + rnd.y * 0.75));
    float core = exp(-d * d * sharpness) * gate;
    float halo = exp(-d * d * (sharpness * 0.16)) * gate * mix(0.7, 0.35, clamp(12.0 / cellPx, 0.0, 1.0));
    float twinkle = 0.55 + 0.45 * sin(uTime * (7.0 + rnd.y * 12.0) + rnd.x * 48.0 + i * 2.1);

    spark += tint * core * twinkle * 2.6 * gain;
    spark += tint * halo * gain;
    spark += vec3(1.0, 0.95, 1.08) * (core * core * mix(3.2, 5.0, clamp(10.0 / cellPx, 0.0, 1.0)) * gain);
  }
  return spark;
}

void main () {
  vec3 fluid = texture(uTexture, vUv).rgb;
  float dens = max(fluid.r, max(fluid.g, fluid.b));
  dens = pow(clamp(dens, 0.0, 4.0), 0.8);

  vec3 haze = fluid * 0.04;
  vec3 grains = vec3(0.0);

  // 粗 → 細のミックス（空間の奥行きが出る）
  grains += energyParticles(vUv, fluid, dens, 28.0, 36.0, 0.04, 1.0, 1.15);   // とても粗い
  grains += energyParticles(vUv + 0.11, fluid, dens, 16.0, 70.0, 0.05, 1.0, 1.0); // 粗い
  grains += energyParticles(vUv + 0.29, fluid, dens, 9.0, 110.0, 0.06, 2.0, 0.95); // 中
  grains += energyParticles(vUv + 0.47, fluid, dens, 4.5, 200.0, 0.08, 2.0, 1.0);  // 細
  grains += energyParticles(vUv + 0.67, fluid, dens, 2.4, 320.0, 0.10, 3.0, 0.9);  // より細
  grains += energyParticles(vUv + 0.83, fluid, dens, 1.3, 480.0, 0.12, 3.0, 0.75); // 極細

  float dust = hash21(floor(vUv * uResolution) + floor(uTime * 18.0));
  float dust2 = hash21(floor(vUv * uResolution * 1.6) + 29.3);
  grains += speck(fluid, dens, dust, 0.84, 1.2);
  grains += speck(fluid, dens, dust2, 0.91, 0.8);

  vec3 c = haze + grains;

  if (useBloom > 0.5) {
    vec3 b = texture(uBloom, vUv).rgb;
    c += b * bloomIntensity * 0.42;
  }

  c = pow(max(c, 0.0), vec3(0.9));
  c = mix(c, c * vec3(0.85, 0.92, 1.22), 0.22);
  float vignette = smoothstep(1.4, 0.2, length(vUv - 0.5) * 1.5);
  c *= mix(0.48, 1.0, vignette);
  fragColor = vec4(c, 1.0);
}`),
      bloomPrefilter: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
out vec4 fragColor;
void main () {
  vec3 c = texture(uTexture, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - curve.x, 0.0, curve.y);
  rq = curve.z * rq * rq;
  c *= max(rq, br - threshold) / max(br, 0.0001);
  fragColor = vec4(c, 1.0);
}`),
      bloomBlur: make(`${SHADER_BASE}
precision highp float;
precision mediump sampler2D;
in vec2 vUv;
uniform sampler2D uTexture;
uniform highp vec2 texelSize;
out vec4 fragColor;
void main () {
  vec4 sum = vec4(0.0);
  sum += texture(uTexture, vUv + vec2(-1.0, -1.0) * texelSize) * 0.0625;
  sum += texture(uTexture, vUv + vec2( 0.0, -1.0) * texelSize) * 0.125;
  sum += texture(uTexture, vUv + vec2( 1.0, -1.0) * texelSize) * 0.0625;
  sum += texture(uTexture, vUv + vec2(-1.0,  0.0) * texelSize) * 0.125;
  sum += texture(uTexture, vUv) * 0.25;
  sum += texture(uTexture, vUv + vec2( 1.0,  0.0) * texelSize) * 0.125;
  sum += texture(uTexture, vUv + vec2(-1.0,  1.0) * texelSize) * 0.0625;
  sum += texture(uTexture, vUv + vec2( 0.0,  1.0) * texelSize) * 0.125;
  sum += texture(uTexture, vUv + vec2( 1.0,  1.0) * texelSize) * 0.0625;
  fragColor = sum;
}`),
    };
  }

  _initBlit() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  _createFBO(w, h, internalFormat, format, type, filter) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  _createDouble(w, h, internalFormat, format, type, filter) {
    let fbo1 = this._createFBO(w, h, internalFormat, format, type, filter);
    let fbo2 = this._createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      get read() { return fbo1; },
      set read(v) { fbo1 = v; },
      get write() { return fbo2; },
      set write(v) { fbo2 = v; },
      swap() {
        const t = fbo1;
        fbo1 = fbo2;
        fbo2 = t;
      },
    };
  }

  _getFormats() {
    const gl = this.gl;
    // iOSは R16F / RG16F が不完全なことが多く、必ず実機テストしてから使う
    const halfFloat = gl.HALF_FLOAT;
    let rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloat);
    let rg = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloat);
    let r = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloat);

    // 失敗時は 8bit にフォールバック（iPhoneで確実に動かす）
    if (!rgba) {
      rgba = { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    }
    if (!rg) {
      rg = { internalFormat: rgba.internalFormat, format: rgba.format, type: rgba.type };
    }
    if (!r) {
      r = { internalFormat: rgba.internalFormat, format: rgba.format, type: rgba.type };
    }

    const canLinear =
      (rgba.type === gl.UNSIGNED_BYTE) ||
      !!gl.getExtension("OES_texture_half_float_linear") ||
      !!gl.getExtension("OES_texture_float_linear");

    return {
      formatRGBA: { internal: rgba.internalFormat, format: rgba.format, type: rgba.type },
      formatRG: { internal: rg.internalFormat, format: rg.format, type: rg.type },
      formatR: { internal: r.internalFormat, format: r.format, type: r.type },
      filter: canLinear ? gl.LINEAR : gl.NEAREST,
    };
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
    const w = Math.max(2, Math.floor(cssW * dpr));
    const h = Math.max(2, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const formats = this._getFormats();
    this._formats = formats;
    const simRes = this._calcResolution(this.config.simResolution);
    const dyeRes = this._calcResolution(this.config.dyeResolution);

    this.dye = this._createDouble(dyeRes.width, dyeRes.height, formats.formatRGBA.internal, formats.formatRGBA.format, formats.formatRGBA.type, formats.filter);
    this.velocity = this._createDouble(simRes.width, simRes.height, formats.formatRG.internal, formats.formatRG.format, formats.formatRG.type, formats.filter);
    this.divergence = this._createFBO(simRes.width, simRes.height, formats.formatR.internal, formats.formatR.format, formats.formatR.type, gl.NEAREST);
    this.curl = this._createFBO(simRes.width, simRes.height, formats.formatR.internal, formats.formatR.format, formats.formatR.type, gl.NEAREST);
    this.pressure = this._createDouble(simRes.width, simRes.height, formats.formatR.internal, formats.formatR.format, formats.formatR.type, gl.NEAREST);

    const bloomRes = this._calcResolution(256);
    this.bloom = this._createFBO(bloomRes.width, bloomRes.height, formats.formatRGBA.internal, formats.formatRGBA.format, formats.formatRGBA.type, formats.filter);
    this.bloomTemp = this._createFBO(bloomRes.width, bloomRes.height, formats.formatRGBA.internal, formats.formatRGBA.format, formats.formatRGBA.type, formats.filter);
  }

  _calcResolution(resolution) {
    let aspect = this.gl.drawingBufferWidth / this.gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    if (this.gl.drawingBufferWidth > this.gl.drawingBufferHeight) {
      return { width: max, height: min };
    }
    return { width: min, height: max };
  }

  _blit(target) {
    const gl = this.gl;
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  splat(x, y, dx, dy, color) {
    const gl = this.gl;
    const { splat } = this.programs;
    gl.useProgram(splat.program);
    gl.uniform1i(splat.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1f(splat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    gl.uniform2f(splat.uniforms.point, x, y);
    gl.uniform3f(splat.uniforms.color, dx, dy, 0);
    gl.uniform1f(splat.uniforms.radius, this._correctRadius(this.config.splatRadius / 100));
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(splat.uniforms.uTarget, this.dye.read.attach(0));
    const g = this.config.dyeGain ?? 0.18;
    gl.uniform3f(splat.uniforms.color, color[0] * g, color[1] * g, color[2] * g);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  _correctRadius(radius) {
    const aspect = this.canvas.width / this.canvas.height;
    if (aspect > 1) radius *= aspect;
    return radius;
  }

  nextColor() {
    const colors = this.palette.colors;
    this._colorIndex = (this._colorIndex + 1) % colors.length;
    const c = colors[this._colorIndex];
    return [c[0] * 4.2, c[1] * 4.2, c[2] * 4.2];
  }

  multipleSplats(amount = 5) {
    for (let i = 0; i < amount; i++) {
      this.splat(0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4, 280 * (Math.random() - 0.5), 280 * (Math.random() - 0.5), this.nextColor());
    }
  }

  applyInput(pointers) {
    pointers.forEach((p) => {
      if (p.moved) {
        p.moved = false;
        const force = this.config.splatForce;
        this.splat(p.x, p.y, p.dx * force, p.dy * force, p.color);
      }
    });
  }

  step(dt) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    const { curl, vorticity, divergence, clear, pressure, gradientSubtract, advection } = this.programs;

    gl.useProgram(curl.program);
    gl.uniform2f(curl.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(curl.uniforms.uVelocity, this.velocity.read.attach(0));
    this._blit(this.curl);

    gl.useProgram(vorticity.program);
    gl.uniform2f(vorticity.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(vorticity.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(vorticity.uniforms.uCurl, this.curl.attach(1));
    gl.uniform1f(vorticity.uniforms.curl, this.config.curl);
    gl.uniform1f(vorticity.uniforms.dt, dt);
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.useProgram(divergence.program);
    gl.uniform2f(divergence.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(divergence.uniforms.uVelocity, this.velocity.read.attach(0));
    this._blit(this.divergence);

    gl.useProgram(clear.program);
    gl.uniform1i(clear.uniforms.uTexture, this.pressure.read.attach(0));
    gl.uniform1f(clear.uniforms.value, this.config.pressure);
    this._blit(this.pressure.write);
    this.pressure.swap();

    gl.useProgram(pressure.program);
    gl.uniform2f(pressure.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(pressure.uniforms.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < this.config.pressureIterations; i++) {
      gl.uniform1i(pressure.uniforms.uPressure, this.pressure.read.attach(1));
      this._blit(this.pressure.write);
      this.pressure.swap();
    }

    gl.useProgram(gradientSubtract.program);
    gl.uniform2f(gradientSubtract.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gradientSubtract.uniforms.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(gradientSubtract.uniforms.uVelocity, this.velocity.read.attach(1));
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.useProgram(advection.program);
    gl.uniform2f(advection.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform2f(advection.uniforms.dyeTexelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(advection.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(advection.uniforms.uSource, this.velocity.read.attach(0));
    gl.uniform1f(advection.uniforms.dt, dt);
    gl.uniform1f(advection.uniforms.dissipation, this.config.velocityDissipation);
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform2f(advection.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(advection.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(advection.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(advection.uniforms.dissipation, this.config.densityDissipation);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  _applyBloom() {
    if (!this.config.bloom) return;
    const gl = this.gl;
    const { bloomPrefilter, bloomBlur } = this.programs;
    const knee = 0.7;
    const threshold = this.config.bloomThreshold;

    gl.useProgram(bloomPrefilter.program);
    gl.uniform3f(bloomPrefilter.uniforms.curve, threshold - knee, knee * 2, 0.25 / (knee + 0.00001));
    gl.uniform1f(bloomPrefilter.uniforms.threshold, threshold);
    gl.uniform1i(bloomPrefilter.uniforms.uTexture, this.dye.read.attach(0));
    this._blit(this.bloom);

    gl.useProgram(bloomBlur.program);
    for (let i = 0; i < 4; i++) {
      gl.uniform2f(bloomBlur.uniforms.texelSize, this.bloom.texelSizeX, 0);
      gl.uniform1i(bloomBlur.uniforms.uTexture, this.bloom.attach(0));
      this._blit(this.bloomTemp);
      gl.uniform2f(bloomBlur.uniforms.texelSize, 0, this.bloom.texelSizeY);
      gl.uniform1i(bloomBlur.uniforms.uTexture, this.bloomTemp.attach(0));
      this._blit(this.bloom);
    }
  }

  render() {
    const gl = this.gl;
    this._applyBloom();
    const { display } = this.programs;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.useProgram(display.program);
    gl.uniform1i(display.uniforms.uTexture, this.dye.read.attach(0));
    gl.uniform1i(display.uniforms.uBloom, this.bloom.attach(1));
    gl.uniform1f(display.uniforms.bloomIntensity, this.config.bloomIntensity);
    gl.uniform1f(display.uniforms.useBloom, this.config.bloom ? 1 : 0);
    gl.uniform1f(display.uniforms.uTime, this._time || 0);
    gl.uniform2f(display.uniforms.uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this._blit(null);
  }

  update(dt) {
    this._time = (this._time || 0) + dt;
    this.step(Math.min(dt, 0.016666));
    this.render();
  }
}
