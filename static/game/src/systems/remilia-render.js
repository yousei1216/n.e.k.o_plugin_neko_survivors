// ============================================================
// 蕾米莉亚终演出 · 渲染层（第二百零三轮）
//
// 素材：assets/boss/remilia/remilia_00..23.png（24 帧）+ cutin.png（eff07 符卡立绘）
// 结构（自下而上）：
//   ① 背景：深红夜空 + 血色月亮 + 红雾 + 远处的红魔馆剪影 + 飘落的蝙蝠
//   ② 蝙蝠群（绕场飞的纯视觉小黑影）
//   ③ 双人：蕾米（24 帧）+ 芙兰（敌人贴图 4 帧），各自带光晕/翅膀辉光/投影
//   ④ 符卡 cut-in：cutin.png 从屏幕中央一闪（0.62s：0.28s 淡入、0.34s 淡出，伴随横向拉开）
//   ⑤ 全屏红闪 + 屏幕层暗角/HUD
// 全部走预烘焙精灵 + 一次 drawImage，避免每帧建渐变。
// ============================================================
import { makeCanvas } from './no-dom.js';

const TAU = Math.PI * 2;
const SC = 1;

// ---- 贴图 ----
const IMG = { frames: [], cutin: null };
function loadArt() {
  if (typeof Image === 'undefined') return;
  if (!IMG.frames.length) {
    for (let i = 0; i < 24; i++) {
      const im = new Image();
      im.src = `assets/boss/remilia/remilia_${String(i).padStart(2, '0')}.png`;
      IMG.frames.push(im);   // 载入失败时 naturalWidth = 0，draw 时跳过走占位
    }
  }
  if (!IMG.cutin) {
    const im = new Image();
    im.src = 'assets/boss/remilia/cutin.png';
    IMG.cutin = im;
  }
}
const ready = (im) => im && im.naturalWidth > 0;

// ---- 预烘焙精灵 ----
let S = null;
function ensure() {
  if (typeof document === 'undefined') return false;
  if (S) return true;
  const mk = (w, h) => { const c = makeCanvas(); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const soft = (size, stops) => {
    const c = mk(size * SC, size * SC);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  };
  S = {
    // 蕾米的光晕（绯红）
    aura: soft(128, [[0, 'rgba(255,90,130,0.55)'], [0.45, 'rgba(200,30,60,0.22)'], [1, 'rgba(140,10,40,0)']]),
    // 芙兰的光晕（金粉）
    auraF: soft(128, [[0, 'rgba(255,200,140,0.5)'], [0.45, 'rgba(255,120,160,0.2)'], [1, 'rgba(200,60,110,0)']]),
    // 脚下投影
    shadow: soft(96, [[0, 'rgba(10,0,10,0.55)'], [0.6, 'rgba(10,0,10,0.22)'], [1, 'rgba(10,0,10,0)']]),
    // 蝙蝠翼辉光（蓄力时叠在身后）
    wingGlow: soft(160, [[0, 'rgba(255,60,90,0.42)'], [0.5, 'rgba(180,20,50,0.18)'], [1, 'rgba(120,0,30,0)']]),
    // 月亮
    moon: soft(256, [[0, 'rgba(255,226,196,0.95)'], [0.42, 'rgba(255,150,120,0.55)'], [0.72, 'rgba(210,60,70,0.18)'], [1, 'rgba(160,20,50,0)']]),
    // 红雾
    fog: soft(160, [[0, 'rgba(190,30,60,0.28)'], [0.55, 'rgba(150,15,45,0.12)'], [1, 'rgba(120,0,30,0)']]),
    // 角色背衬（暗色柔光）：两人飞过血月/亮弹幕时会被吃成一片，垫一层暗色让他们始终读得出来
    backing: soft(96, [[0, 'rgba(18,0,10,0.62)'], [0.55, 'rgba(18,0,10,0.3)'], [1, 'rgba(18,0,10,0)']]),
    // 小蝙蝠（单帧，画的时候缩放）
    bat: null,
  };
  // 蝙蝠：一对翅膀的黑影
  {
    const c = mk(32, 20); const g = c.getContext('2d');
    g.fillStyle = 'rgba(28,4,14,0.92)';
    g.beginPath();
    g.moveTo(16, 12);
    g.quadraticCurveTo(10, 2, 2, 5);
    g.quadraticCurveTo(9, 9, 16, 12);
    g.quadraticCurveTo(23, 9, 30, 5);
    g.quadraticCurveTo(22, 2, 16, 12);
    g.fill();
    g.beginPath(); g.ellipse(16, 13, 2.6, 3.6, 0, 0, TAU); g.fill();
    S.bat = c;
  }
  // 红魔馆远景剪影（尖塔钟楼），预烘焙成一条长图
  {
    const W = 1400, H = 260;
    const c = mk(W, H); const g = c.getContext('2d');
    g.fillStyle = 'rgba(22,2,12,0.95)';
    const tower = (x, w, h) => {
      g.beginPath();
      g.moveTo(x, H); g.lineTo(x, H - h); g.lineTo(x + w * 0.5, H - h - w * 1.1); g.lineTo(x + w, H - h); g.lineTo(x + w, H);
      g.closePath(); g.fill();
    };
    tower(300, 90, 120); tower(420, 130, 170); tower(580, 70, 96); tower(680, 110, 140);
    // 连廊
    g.fillRect(300, H - 60, 500, 60);
    // 亮着的窗
    g.fillStyle = 'rgba(255,180,90,0.75)';
    for (let i = 0; i < 14; i++) { const x = 320 + i * 34, y = H - 96 + (i % 3) * 22; g.fillRect(x, y, 5, 8); }
    S.castle = c;
  }
  return true;
}

function art() {
  loadArt();
  ensure();
  return { IMG, S };
}

/** 预热（进入蕾米战时调用一次，避免第一帧现场烘焙/解码卡一下） */
export function warm() { art(); }

// ---------------------------------------------------------------
// 背景
// ---------------------------------------------------------------
export function drawBg(ctx, fight, ax, ay, W, H) {
  const { S: s } = art();
  if (!s) return;
  const t = fight?.t ?? 0;
  ctx.save();
  // 深红夜空
  ctx.fillStyle = '#180210';
  ctx.fillRect(0, 0, W, H);
  // 血色月亮（缓慢呼吸）
  const moonR = Math.min(W, H) * 0.26;
  const mx = ax + W * 0.26, my = ay - H * 0.34;
  ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.8);
  ctx.drawImage(s.moon, mx - moonR, my - moonR, moonR * 2, moonR * 2);
  ctx.globalAlpha = 1;
  // 月亮里的剪影：一座小城堡的尖顶
  ctx.fillStyle = 'rgba(60,6,24,0.55)';
  ctx.beginPath();
  ctx.moveTo(mx - 40, my + 30);
  ctx.lineTo(mx - 22, my - 18);
  ctx.lineTo(mx - 6, my + 4);
  ctx.lineTo(mx + 12, my - 34);
  ctx.lineTo(mx + 30, my + 6);
  ctx.lineTo(mx + 46, my + 30);
  ctx.closePath();
  ctx.fill();
  // 红雾（三层慢飘）
  for (const [yy, sc, spd, a] of [[0.18, 1.5, 0.05, 0.5], [0.55, 2.1, -0.035, 0.42], [0.85, 1.7, 0.07, 0.34]]) {
    const RR = Math.min(W, H) * sc;
    for (let i = 0; i < 3; i++) {
      const x = ax + Math.sin(t * spd + i * 2.1) * W * 0.35 + (i - 1) * W * 0.34;
      const y = ay + (yy - 0.5) * H * 0.9 + Math.cos(t * spd * 1.3 + i) * 28;
      ctx.globalAlpha = a;
      ctx.drawImage(s.fog, x - RR / 2, y - RR / 2, RR, RR);
    }
  }
  ctx.globalAlpha = 1;
  // 红魔馆远景
  const cw = Math.max(W * 1.6, 1400), ch = (s.castle.height / s.castle.width) * cw;
  const drift = Math.sin(t * 0.1) * 22;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(s.castle, ax - cw / 2 + drift, ay + H * 0.56 - ch * 0.55, cw, ch);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------
// 蝙蝠群
// ---------------------------------------------------------------
export function drawBats(ctx, fight, ax, ay) {
  const { S: s } = art();
  if (!s) return;
  const t = fight?.t ?? 0;
  ctx.save();
  for (const b of (fight?.bats ?? [])) {
    const R = 620 * b.r;
    const x = ax + Math.cos(b.a) * R;
    const y = ay + Math.sin(b.a) * R * 0.55;
    const flap = 0.55 + 0.45 * Math.sin(t * 13 + b.ph);
    const w = 26 * b.s, h = w * 0.62 * flap;
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 2 + b.ph);
    ctx.drawImage(s.bat, x - w / 2, y - h / 2, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------
// 双人
// ---------------------------------------------------------------
function drawAura(ctx, s, x, y, R, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(s, x - R, y - R, R * 2, R * 2);
  ctx.globalAlpha = 1;
}

/** 两人头顶的小名牌（同款美术太难分，演出里给名字最稳） */
function drawName(ctx, x, y, text, color, alpha) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = 'rgba(16,0,10,0.66)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 11, w, 20, 10); else ctx.rect(x - w / 2, y - 11, w, 20);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 蕾米：24 帧精灵 + 绯红光晕 + 背后的蝙蝠翼辉光 + 投影 */
export function drawRemilia(ctx, fight) {
  const { IMG: img, S: s } = art();
  if (!s) return;
  const b = fight?.b?.remilia;
  if (!b) return;
  const t = fight?.t ?? 0;
  const R = 82;                                  // 精灵绘制半径（帧本身 ~150px）
  // 背衬（先垫暗色，保证在血月/密集弹幕上也读得出）
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.drawImage(s.backing, b.x - R * 1.5, b.y - R * 1.5, R * 3, R * 3);
  ctx.restore();
  // 投影
  ctx.save();
  ctx.globalAlpha = 0.5 * (b.alpha ?? 1);
  ctx.drawImage(s.shadow, b.x - R * 0.9, b.y + R * 0.5, R * 1.8, R * 0.7);
  ctx.restore();
  // 背后的蝙蝠翼辉光（蓄力）
  if ((b.wing ?? 0) > 0.2) {
    const tip = img.frames[20];
    const wg = R * 2.4;
    ctx.save();
    ctx.globalAlpha = 0.5 * b.wing * (b.alpha ?? 1);
    ctx.drawImage(s.wingGlow, b.x - wg / 2, b.y - wg / 2, wg, wg);
    if (ready(tip)) {
      ctx.globalAlpha = 0.6 * b.wing * (b.alpha ?? 1);
      const tw = R * 3.9, th = tw * (tip.naturalHeight / tip.naturalWidth);
      ctx.drawImage(tip, b.x - tw / 2, b.y - th * 0.42, tw, th);
    }
    ctx.restore();
  }
  // 光晕
  drawAura(ctx, s.aura, b.x, b.y, R * 1.9, (0.3 + 0.12 * Math.sin(t * 2.6)) * (b.alpha ?? 1));
  drawName(ctx, b.x, b.y - R * 1.55, '蕾米莉亚', '#ff8fa8', b.alpha ?? 1);
  // 本体
  const fr = img.frames[b.frame ?? 0];
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.x, b.y);
  if (ready(fr)) {
    const h = R * 2.6, w = h * (fr.naturalWidth / fr.naturalHeight);
    ctx.drawImage(fr, -w / 2, -h * 0.62, w, h);
  } else {
    // 素材没就绪：暗红剪影兜底（保证演出不出现"空场"）
    ctx.fillStyle = 'rgba(200,30,60,0.75)';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** 芙兰：敌人贴图 + 金粉光晕 */
export function drawFlandreSprite(ctx, fight, getSprite) {
  const { S: s } = art();
  if (!s) return;
  const b = fight?.b?.flandre;
  if (!b) return;
  const t = fight?.t ?? 0;
  const R = 66;
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.drawImage(s.backing, b.x - R * 1.5, b.y - R * 1.5, R * 3, R * 3);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.5 * (b.alpha ?? 1);
  ctx.drawImage(s.shadow, b.x - R * 0.9, b.y + R * 0.5, R * 1.8, R * 0.7);
  ctx.globalAlpha = 1;
  ctx.restore();
  drawAura(ctx, s.auraF, b.x, b.y, R * 1.85, (0.28 + 0.12 * Math.sin(t * 2.9 + 1)) * (b.alpha ?? 1));
  drawName(ctx, b.x, b.y - R * 1.55, '芙兰朵露', '#ffd9a0', b.alpha ?? 1);
  const img = getSprite?.(b.spriteId);
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  if (ready(img)) {
    const hh = R * 2.6, ww = hh * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, b.x - ww / 2, b.y - hh * 0.62, ww, hh);
  } else {
    ctx.fillStyle = 'rgba(255,120,160,0.8)';
    ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.68, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------
// cut-in
// ---------------------------------------------------------------
/** @param k 0→1 的进度（0.28s 淡入 / 0.34s 淡出 由调用方算好） */
export function drawCutin(ctx, W, H, k, t) {
  const { IMG: img } = art();
  if (!ready(img.cutin)) return;
  // 0.62s 总时长：u<0.45 淡入，之后淡出；同时从中央向两侧"拉开"
  const u = 1 - k;
  const a = u < 0.45 ? u / 0.45 : (1 - u) / 0.55;
  const z = 1 + u * 0.22;
  const size = Math.min(W, H) * 1.15 * z;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a)) * 0.92;
  ctx.drawImage(img.cutin, W / 2 - size / 2, H / 2 - size / 2, size, size);
  ctx.restore();
  void t;
}

// ---------------------------------------------------------------
// 屏幕层：红闪 + 暗角
// ---------------------------------------------------------------
export function drawScreen(ctx, fight, W, H) {
  const f = fight?.flash ?? 0;
  if (f > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,40,80,${Math.min(0.42, f * 0.5)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // 暗角
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(12,0,8,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------
// HUD：双方血条风格的名牌 + 符卡名 + 剩余时间
// ---------------------------------------------------------------
export function drawHud(ctx, fight, W, H) {
  const info = fight?.cardInfo ?? { name: '', idx: 0, n: 6 };
  const total = 60;
  const t = Math.max(0, fight?.t ?? 0);
  const prog = Math.min(1, t / total);
  ctx.save();
  // 顶部：连战总进度条
  // 放在画布血条上方：DOM 的波次牌/材料/计时都在顶部，压在一起会互相打架
  const bw = Math.min(560, W * 0.42), bx = W / 2 - bw / 2, by = H - 96;
  ctx.fillStyle = 'rgba(20,4,16,0.72)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx - 6, by - 6, bw + 12, 22, 11); else ctx.rect(bx - 6, by - 6, bw + 12, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,120,150,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  gr.addColorStop(0, '#ff3050'); gr.addColorStop(0.5, '#ff7bac'); gr.addColorStop(1, '#ffd166');
  ctx.fillStyle = gr;
  ctx.fillRect(bx, by, bw * prog, 10);
  // 剩余秒数
  ctx.fillStyle = '#ffe6ee';
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.ceil(Math.max(0, total - t))}`, W / 2, by + 5);
  // 符卡名（右上滑入）
  if (info.name) {
    ctx.font = 'bold 20px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(info.name).width;
    ctx.fillStyle = 'rgba(20,2,12,0.62)';
    ctx.fillRect(W - tw - 44, 58, tw + 30, 34);
    ctx.fillStyle = 'rgba(255,120,150,0.9)';
    ctx.fillRect(W - tw - 44, 58, 3, 34);
    ctx.fillStyle = '#ffd9e6';
    ctx.fillText(info.name, W - 24, 82);
  }
  ctx.restore();
}

export const _internals = { IMG, loadArt };
