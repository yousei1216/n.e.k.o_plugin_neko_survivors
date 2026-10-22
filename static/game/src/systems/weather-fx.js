// 天气特效 v2（第一百八十五轮 · 全局美化）
//
// 用户："天气系统……特效优化，你有更好的想法就优化"。
// 范围：流星雨(火球/燃烧区)、血月、快晴、晴岚、烈日、雾雨。
// 不动：台风 / 川雾 / 浓雾 —— 那三个是用户逐轮写规格定下来的，视觉与手感都已认可。
//
// 全部预烘焙精灵 + 确定性公式（无状态），帧内零 createRadialGradient / shadowBlur。
// 粒子位置全由 (i, t) 推出，不占内存、暂停时自然冻结。
const TAU = Math.PI * 2;

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
function hash(i, s = 0) {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}
function radial(size, stops) {
  const c = mk(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

let S = null;
function ensure() {
  if (S) return;
  S = {
    hot: radial(128, [[0, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,225,170,0.95)'], [0.5, 'rgba(255,150,60,0.5)'], [1, 'rgba(255,100,30,0)']]),
    fire: radial(128, [[0, 'rgba(255,230,160,0.95)'], [0.35, 'rgba(255,128,48,0.8)'], [0.75, 'rgba(220,50,16,0.3)'], [1, 'rgba(180,30,10,0)']]),
    ember: radial(32, [[0, 'rgba(255,210,120,1)'], [0.45, 'rgba(255,170,70,0.6)'], [1, 'rgba(255,120,40,0)']]),
    redGlow: radial(128, [[0, 'rgba(255,90,70,0.5)'], [0.5, 'rgba(220,30,40,0.2)'], [1, 'rgba(160,10,30,0)']]),
    sun: radial(256, [[0, 'rgba(255,255,240,1)'], [0.12, 'rgba(255,244,190,0.85)'], [0.35, 'rgba(255,220,130,0.3)'], [1, 'rgba(255,200,100,0)']]),
    warm: radial(64, [[0, 'rgba(255,230,160,0.7)'], [1, 'rgba(255,200,100,0)']]),
    mist: radial(128, [[0, 'rgba(190,214,240,0.5)'], [0.6, 'rgba(170,200,230,0.18)'], [1, 'rgba(160,190,225,0)']]),
    rays: null, moon: null, petal: [], ripple: null,
  };
  // 日光射线（扇形，从中心发散）
  {
    const N = 512, c = mk(N, N), g = c.getContext('2d');
    g.translate(N / 2, N / 2);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + hash(i, 3) * 0.2, w = 0.04 + hash(i, 4) * 0.05, L = 250;
      const gr = g.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
      gr.addColorStop(0, 'rgba(255,248,210,0.9)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - w) * L, Math.sin(a - w) * L); g.lineTo(Math.cos(a + w) * L, Math.sin(a + w) * L); g.closePath(); g.fill();
    }
    S.rays = c;
  }
  // 血月：暗红圆盘 + 月面斑 + 缘光
  {
    const N = 256, c = mk(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, N * 0.16, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,70,60,0.5)'); gr.addColorStop(0.55, 'rgba(200,20,40,0.22)'); gr.addColorStop(1, 'rgba(150,0,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    g.beginPath(); g.arc(N / 2, N / 2, N * 0.27, 0, TAU);
    const disc = g.createRadialGradient(N * 0.45, N * 0.42, 4, N / 2, N / 2, N * 0.27);
    disc.addColorStop(0, '#ff7a64'); disc.addColorStop(0.7, '#d02a34'); disc.addColorStop(1, '#8c1224');
    g.fillStyle = disc; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(90,0,20,${0.14 + hash(i, 9) * 0.14})`; g.beginPath(); g.arc(N / 2 + (hash(i, 5) - 0.5) * N * 0.36, N / 2 + (hash(i, 6) - 0.5) * N * 0.36, 6 + hash(i, 7) * 14, 0, TAU); g.fill(); }
    g.restore();
    S.moon = c;
  }
  // 花瓣 / 叶片（两色）
  for (const col of ['#ffd2e0', '#c8f2b8', '#fff0b0']) {
    const c = mk(24, 24), g = c.getContext('2d');
    g.translate(12, 12);
    const gr = g.createLinearGradient(-9, 0, 9, 0);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0.7)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-9, 0); g.quadraticCurveTo(0, -8, 9, 0); g.quadraticCurveTo(0, 8, -9, 0); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-8, 0); g.lineTo(8, 0); g.stroke();
    S.petal.push(c);
  }
  // 水纹
  {
    const c = mk(64, 32), g = c.getContext('2d');
    g.strokeStyle = 'rgba(210,230,250,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(32, 16, 28, 11, 0, 0, TAU); g.stroke();
    g.lineWidth = 1; g.globalAlpha = 0.6; g.beginPath(); g.ellipse(32, 16, 17, 6.5, 0, 0, TAU); g.stroke();
    S.ripple = c;
  }
}
export function warm() { ensure(); }

// =================================================================
// 流星雨（世界坐标）
// =================================================================
/**
 * 下落火球：白热核 + 橙色火团 + 沿来路的 12 团渐小渐暗余烬尾 + 前方炽热光晕。
 * (px,py) 当前位置；ox,oy = 入射起点相对落点偏移；k = 0..1 落地进度；m = {x,y}
 */
export function drawMeteorBall(ctx, m, ox, oy, k, ramp, t) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 12; i >= 1; i--) {
    const tb = Math.max(0, k - i * 0.045);
    const tx = m.x + ox * (1 - tb), ty = m.y + oy * (1 - tb);
    const u = i / 12, sz = (46 - u * 30) * (0.9 + 0.1 * Math.sin(t * 30 + i));
    ctx.globalAlpha = (0.7 - u * 0.6) * ramp;
    ctx.drawImage(u < 0.4 ? S.fire : S.redGlow, tx - sz / 2 + (hash(i, 1) - 0.5) * 6, ty - sz / 2, sz, sz);
  }
  const px = m.x + ox * (1 - k), py = m.y + oy * (1 - k);
  ctx.globalAlpha = 0.85 * ramp; ctx.drawImage(S.fire, px - 40, py - 40, 80, 80);
  ctx.globalAlpha = ramp; ctx.drawImage(S.hot, px - 26, py - 26, 52, 52);
  ctx.restore();
}

/** 落点预警环（阶段 1）：加法的红环 + 内部倒计时填充 + 外圈细环。prog = 0..1 */
export function drawMeteorWarn(ctx, m, prog, pulse) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const d = m.r * 2.3;
  ctx.globalAlpha = 0.22 * prog + 0.06; ctx.drawImage(S.redGlow, m.x - d / 2, m.y - d / 2, d, d);
  const shrink = m.r * (1.5 - 0.5 * prog);
  ctx.strokeStyle = '#ff3a22'; ctx.lineWidth = 2.5 + prog * 2;
  ctx.globalAlpha = 0.45 + 0.4 * pulse;
  ctx.beginPath(); ctx.arc(m.x, m.y, shrink, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.18 + 0.1 * pulse; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(m.x, m.y, shrink + 8, 0, TAU); ctx.stroke();
  // 8 个向内收拢的小箭头刻度，让"正在锁定"一眼可读
  ctx.globalAlpha = 0.5 * prog; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + prog * 1.2, r0 = shrink + 4, r1 = shrink + 14 * (1 - prog) + 4;
    ctx.beginPath(); ctx.moveTo(m.x + Math.cos(a) * r1, m.y + Math.sin(a) * r1); ctx.lineTo(m.x + Math.cos(a) * r0, m.y + Math.sin(a) * r0); ctx.stroke();
  }
  ctx.restore();
}

/** 持续燃烧区：地面辉光盘 + 3 簇跳动的火舌(精灵叠加) + 上飘火星。fade = 0..1 */
export function drawBurnZone(ctx, z, t, fade) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const d = z.r * 2.2;
  ctx.globalAlpha = 0.5 * fade; ctx.drawImage(S.redGlow, z.x - d / 2, z.y - d / 2, d, d);
  ctx.globalAlpha = 0.55 * fade; ctx.strokeStyle = '#ff4a22'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
  const seed = z.x * 0.013 + z.y * 0.007;
  for (let c = 0; c < 5; c++) {
    const ca = (c / 5) * TAU + seed, fx = z.x + Math.cos(ca) * z.r * 0.5, fy = z.y + Math.sin(ca) * z.r * 0.5;
    for (let i = 0; i < 3; i++) {
      const fl = 0.5 + 0.5 * Math.sin(t * 13 + c * 2.1 + i * 1.7);
      const sz = (44 - i * 11) * (0.75 + fl * 0.4);
      ctx.globalAlpha = (0.55 - i * 0.12) * fade * (0.65 + fl * 0.35);
      ctx.drawImage(i === 0 ? S.fire : S.hot, fx - sz / 2, fy - i * 10 - fl * 7 - sz / 2, sz, sz);
    }
  }
  for (let i = 0; i < 12; i++) {
    const per = 1.4 + hash(i, 2) * 1.2, u = ((t + hash(i, 3) * per) % per) / per;
    const ex = z.x + (hash(i, 4) - 0.5) * z.r * 1.6 + Math.sin(t * 3 + i) * 6, ey = z.y - u * 70;
    ctx.globalAlpha = (1 - u) * 0.8 * fade; ctx.drawImage(S.ember, ex - 5, ey - 5, 10, 10);
  }
  ctx.restore();
}

// =================================================================
// 屏幕层
// =================================================================
/** 血月：左上方一轮巨大的血色月亮 + 缘光呼吸 + 12 颗缓缓上升的红色余烬 */
export function drawBloodMoon(ctx, W, H, t, ramp) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = Math.min(W, H) * 0.62, x = W * 0.18, y = H * 0.16;
  ctx.globalAlpha = ramp * (0.55 + 0.1 * Math.sin(t * 1.4)); ctx.drawImage(S.moon, x - R / 2, y - R / 2, R, R);
  for (let i = 0; i < 14; i++) {
    const per = 7 + hash(i, 1) * 6, u = ((t + hash(i, 2) * per) % per) / per;
    const ex = hash(i, 3) * W + Math.sin(t * 0.8 + i) * 18, ey = H + 10 - u * (H + 20);
    const sz = 8 + hash(i, 4) * 12;
    ctx.globalAlpha = ramp * Math.sin(u * Math.PI) * 0.4;
    ctx.drawImage(S.redGlow, ex - sz, ey - sz, sz * 2, sz * 2);
  }
  ctx.restore();
}

/** 快晴：右上的太阳（核心 + 缓转日光射线 + 柔光），取代原来的单个渐变 */
export function drawSun(ctx, W, H, sunX, t, ramp) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.3);
  const R = Math.min(W, H) * 1.15;
  ctx.globalAlpha = ramp * 0.5 * pulse; ctx.drawImage(S.sun, sunX - R / 2, H * 0.14 - R / 2, R, R);
  ctx.save(); ctx.translate(sunX, H * 0.14); ctx.rotate(t * 0.05);
  const RR = Math.min(W, H) * 1.5;
  ctx.globalAlpha = ramp * 0.16 * pulse; ctx.drawImage(S.rays, -RR / 2, -RR / 2, RR, RR);
  ctx.restore();
  // 光尘：缓慢漂浮的暖色亮点
  for (let i = 0; i < 18; i++) {
    const per = 10 + hash(i, 1) * 8, u = ((t + hash(i, 2) * per) % per) / per;
    const px = hash(i, 3) * W + Math.sin(t * 0.5 + i) * 20, py = (hash(i, 4) * 0.8 + u * 0.3) * H;
    const sz = 6 + hash(i, 5) * 10;
    ctx.globalAlpha = ramp * Math.sin(u * Math.PI) * 0.35; ctx.drawImage(S.warm, px - sz, py - sz, sz * 2, sz * 2);
  }
  ctx.restore();
}

/** 晴岚：花瓣与嫩叶顺风斜飘，旋转摇摆 */
export function drawPetals(ctx, W, H, t, ramp) {
  ensure();
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const per = 9 + hash(i, 1) * 7, u = ((t + hash(i, 2) * per) % per) / per;
    const x = (hash(i, 3) * 1.3 - 0.15 + u * 0.35) * W + Math.sin(t * 1.2 + i * 2) * 26;
    const y = -20 + u * (H + 40);
    const sz = 12 + hash(i, 4) * 12, sp = S.petal[i % 3];
    ctx.globalAlpha = ramp * Math.sin(u * Math.PI) * 0.8;
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * (0.8 + hash(i, 5)) + i); ctx.scale(1, 0.55 + 0.45 * Math.sin(t * 2 + i));
    ctx.drawImage(sp, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  }
  ctx.restore();
}

/** 烈日：地表热浪(上升的暖色光斑) + 底部橙色辉光带 */
export function drawHeat(ctx, W, H, t, ramp) {
  ensure();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const per = 6 + hash(i, 1) * 5, u = ((t + hash(i, 2) * per) % per) / per;
    const x = hash(i, 3) * W + Math.sin(t * 1.1 + i * 1.7) * 30, y = H * 0.95 - u * H * 0.5;
    const sz = 50 + hash(i, 4) * 70;
    ctx.globalAlpha = ramp * Math.sin(u * Math.PI) * 0.12; ctx.drawImage(S.warm, x - sz, y - sz * 0.6, sz * 2, sz * 1.2);
  }
  ctx.globalAlpha = ramp * (0.12 + 0.03 * Math.sin(t * 2)); ctx.drawImage(S.fire, -W * 0.2, H * 0.78, W * 1.4, H * 0.5);
  ctx.restore();
}

/** 雾雨：地面水纹 + 低空薄雾(两团横向漂移)。雨线本身仍由 renderer 里的批量 stroke 画 */
export function drawRainExtras(ctx, W, H, t, ramp) {
  ensure();
  ctx.save();
  for (let i = 0; i < 14; i++) {
    const per = 1.1 + hash(i, 1) * 0.9, u = ((t + hash(i, 2) * per) % per) / per;
    const cyc = Math.floor((t + hash(i, 2) * per) / per);
    const x = hash(i + cyc * 13, 3) * W, y = H * (0.3 + hash(i + cyc * 7, 4) * 0.65);
    const sz = 14 + u * 44;
    ctx.globalAlpha = ramp * (1 - u) * 0.5; ctx.drawImage(S.ripple, x - sz, y - sz * 0.5, sz * 2, sz);
  }
  for (const [yy, spd, a] of [[H * 0.72, 22, 0.5], [H * 0.86, -16, 0.4]]) {
    const off = ((t * spd) % W + W) % W;
    ctx.globalAlpha = ramp * a * 0.5;
    for (const x0 of [off - W, off]) ctx.drawImage(S.mist, x0, yy, W, H * 0.3);
  }
  ctx.restore();
}
