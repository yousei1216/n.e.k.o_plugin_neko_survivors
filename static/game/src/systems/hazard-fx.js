// ============================================================
// 危险地形绘制（第二百零二轮 → 第二百零三轮形状重做 → 第二百零四轮性能优化）
//
// 全部实时矢量绘制（不烘进贴图）：带动画、亮度可控，且「画在哪 = 判定在哪」同源（见 data/hazards.js）。
// 第二百零三轮（用户："不管是毒池，还是岩浆池，还是冰面全都是圆形绘制太怪了"）：
//   · 毒池 = 大片暗绿沼泽（深处混暗紫剧毒）+ 零星落脚石（石头上不中毒）
//   · 熔岩 = 纵向熔岩河（暗红是冷却的固定岩浆，亮黄亮红的条纹顺着河道往下淌，像刚流过）
//   · 雪   = 薄雪（大面积、轻微减速）+ 厚雪堆（小块、减速多）+ 空中缓缓飘雪；冰面 = 带棱角的不规则冰块
// 做法：同种类的所有多边形并成一条 Path2D（nonzero 填充 = 并集），沿外轮廓描边，再 clip 到并集里画内部动画，
// 所以重叠 / 跨图案接缝处不会出现内部描边或透明度叠加。画在世界坐标系里，压在拾取物 / 实体之下、地形墙之上。
//
// 第二百零四轮（用户："新地图帧数下降严重…怎么不降低效果的情况下优化下帧数表现？然后我发现有些冰啊岩浆啊毒池啊
//   画出地图很多，是否是地图外也有太多的原因？"）：
//   实测（1280×800，dpr 1）：没有危险地形的图 6.1ms/帧，加了之后 12~14ms/帧，地面层就吃掉 7ms。
//   逐项关掉发现不是"哪个图元贵"，而是**每帧对大范围复杂路径做太多次描边 / 填充 / 裁剪**（每次约 1ms）。
//   于是改成两层：
//   1. **静态层**：轮廓、底色、泥斑 / 暗壳 / 雪粒 / 冰体、落脚石、传送带履带 —— 这些只跟世界坐标有关、
//      和相机、时间都无关，所以把整张竞技场一次性烘到 2400×2400 的离屏画布，每帧只贴视口那一块（1 次 drawImage）。
//      缓存也只有竞技场大小 —— 顺带解决"危险地形画到地图外"（以前暗角先画，地形后画就盖出去了）。
//   2. **动画层**：冒泡 / 熔岩亮斑与流纹 / 雪花闪烁 / 冰面扫光 / 传送带箭头 —— 只画这些小的、会动的东西。
//      因为它们都是小图元，按 zone 逐个画即可；发光 / 暗色底这些都烘在静态层里，不再每帧重算。
//   另外：熔岩亮斑用一次性烘焙的径向渐变精灵（原来每帧 createRadialGradient），流纹改成精灵而不是每帧描边几百段线。
// ============================================================
import { polyInside } from '../data/hazards.js';

const TAU = Math.PI * 2;

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 多边形（扁平坐标）→ Path2D。smooth=true 用中点二次曲线抹圆（沼泽 / 熔岩 / 雪），false 保留棱角（冰） */
function zonePath(z, smooth) {
  const key = smooth ? '_Ps' : '_Pj';
  if (z[key]) return z[key];
  const p = z.p, n = p.length / 2, P = new Path2D();
  if (!smooth) {
    P.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) P.lineTo(p[i * 2], p[i * 2 + 1]);
    P.closePath();
  } else {
    const mx = (i) => (p[(i % n) * 2] + p[((i + 1) % n) * 2]) / 2, my = (i) => (p[(i % n) * 2 + 1] + p[((i + 1) % n) * 2 + 1]) / 2;
    P.moveTo(mx(n - 1), my(n - 1));
    for (let i = 0; i < n; i++) P.quadraticCurveTo(p[i * 2], p[i * 2 + 1], mx(i), my(i));
    P.closePath();
  }
  z[key] = P;
  return P;
}
function unionPath(list, smooth) {
  const U = new Path2D();
  for (const z of list) U.addPath(zonePath(z, smooth));
  return U;
}
function bounds(list, V) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const z of list) { if (z.x0 < x0) x0 = z.x0; if (z.y0 < y0) y0 = z.y0; if (z.x1 > x1) x1 = z.x1; if (z.y1 > y1) y1 = z.y1; }
  return { x0: Math.max(x0, V.x0), y0: Math.max(y0, V.y0), x1: Math.min(x1, V.x1), y1: Math.min(y1, V.y1) };
}

// ---------------- 纹理贴片：启动时烘一次，之后整层一次 fill ----------------
const _tex = Object.create(null);
function tex(name, w, h, paint) {
  let c = _tex[name];
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  _tex[name] = c;
  return c;
}
/** 给贴片取平铺图案（同一个 canvas 只创建一次 CanvasPattern） */
function pat(ctx, c) {
  return c._pat || (c._pat = ctx.createPattern(c, 'repeat'));
}
/** 无缝斑点：同一个图形在 9 宫格偏移下各画一遍，平铺后接缝看不见 */
function wrapBlob(x, w, h, cx, cy, rx, ry, rot, col) {
  x.fillStyle = col;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const px = cx + i * w, py = cy + j * h;
      if (px + rx < 0 || px - rx > w || py + ry < 0 || py - ry > h) continue;
      x.beginPath(); x.ellipse(px, py, rx, ry, rot, 0, TAU); x.fill();
    }
  }
}

/** 沼泽浮渣 + 小浮萍（150px 一格） */
const mudTex = () => tex('mud', 150, 150, (x, w, h) => {
  x.fillStyle = '#26421f'; x.fillRect(0, 0, w, h);          // 底色烘进贴片：一次 fill 搞定「底色 + 泥斑」
  wrapBlob(x, w, h, 44, 52, 44, 25, 0.5, 'rgba(18,40,16,0.44)');
  wrapBlob(x, w, h, 116, 118, 38, 22, -0.8, 'rgba(16,36,14,0.42)');
  wrapBlob(x, w, h, 112, 34, 32, 18, 1.9, 'rgba(98,132,48,0.2)');
  wrapBlob(x, w, h, 26, 126, 30, 17, 2.6, 'rgba(98,132,48,0.19)');
  wrapBlob(x, w, h, 74, 88, 24, 14, 0.2, 'rgba(120,152,58,0.14)');
  for (let i = 0; i < 6; i++) {
    wrapBlob(x, w, h, 12 + hash(i, 1) * 130, 14 + hash(i, 2) * 130, 3.4 + hash(i, 3) * 2.6, 1.8 + hash(i, 4) * 1.2, hash(i, 5) * 3, i % 2 ? 'rgba(150,170,70,0.3)' : 'rgba(170,196,90,0.24)');
  }
});
/** 剧毒深处（70px 一格） */
const deepTex = () => tex('deep', 70, 70, (x, w, h) => {
  x.fillStyle = '#3b1c52'; x.fillRect(0, 0, w, h);
  wrapBlob(x, w, h, 18, 20, 20, 12, 0.4, 'rgba(96,42,130,0.5)');
  wrapBlob(x, w, h, 50, 52, 18, 10, -0.9, 'rgba(24,8,34,0.45)');
  wrapBlob(x, w, h, 54, 16, 12, 7, 1.6, 'rgba(120,60,160,0.34)');
});
/** 熔岩暗壳（80px 一格，竖长条） */
const crustTex = () => tex('crust', 80, 80, (x, w, h) => {
  x.fillStyle = '#6a1a10'; x.fillRect(0, 0, w, h);          // 暗红底色 = 冷却的固定岩浆
  wrapBlob(x, w, h, 16, 22, 8, 24, 0, 'rgba(30,8,6,0.6)');
  wrapBlob(x, w, h, 52, 56, 10, 26, 0, 'rgba(92,24,14,0.5)');
  wrapBlob(x, w, h, 70, 8, 6, 20, 0, 'rgba(30,8,6,0.5)');
});
/** 薄雪：细碎雪粒 + 浅蓝阴影（160px 一格：格子大一点，平铺不容易看出重复） */
const thinTex = () => tex('thin', 160, 160, (x, w, h) => {
  x.fillStyle = 'rgba(242,248,255,0.7)'; x.fillRect(0, 0, w, h);   // 半透明的薄雪底
  for (let i = 0; i < 16; i++) {
    const white = hash(i, 21) > 0.36;
    const rx = 4 + hash(i, 22) * 9, ry = 1.6 + hash(i, 23) * 1.9;
    wrapBlob(x, w, h, 6 + hash(i, 24) * 148, 6 + hash(i, 25) * 148, rx, ry, hash(i, 26) * 3,
      white ? 'rgba(255,255,255,0.36)' : 'rgba(150,180,214,0.18)');
  }
});
/** 厚雪：白团 + 蓝灰阴影（168px 一格，9 团错落） */
const thickTex = () => tex('thick', 168, 168, (x, w, h) => {
  x.fillStyle = 'rgba(246,250,255,0.93)'; x.fillRect(0, 0, w, h);
  const lump = (cx, cy, r) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const px = cx + i * w, py = cy + j * h;
      if (px + r * 1.2 < 0 || px - r * 1.2 > w || py + r < 0 || py - r > h) continue;
      x.fillStyle = 'rgba(120,150,192,0.2)';
      x.beginPath(); x.ellipse(px + 3, py + 5, r, r * 0.55, 0.15, 0, TAU); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.78)';
      x.beginPath(); x.ellipse(px - 2, py - 2, r * 0.9, r * 0.5, 0.15, 0, TAU); x.fill();
    }
  };
  for (let i = 0; i < 9; i++) {
    lump(12 + hash(i, 31) * 144, 12 + hash(i, 32) * 144, 10 + hash(i, 33) * 10);
  }
});
/** 熔岩亮斑精灵（一次性径向渐变 + 椭圆遮罩，之后只 drawImage） */
const lavaBlob = () => tex('lavaBlob', 160, 200, (x, w, h) => {
  const g = x.createRadialGradient(80, 100, 3, 80, 100, 100);
  g.addColorStop(0, 'rgba(255,220,100,0.72)');
  g.addColorStop(0.45, 'rgba(255,120,30,0.4)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.beginPath(); x.ellipse(80, 100, 80, 100, 0, 0, TAU); x.fill();
});
/**
 * 熔岩流纹贴片：竖向三段亮带（红 / 橙 / 黄 对齐），整张贴片按时间平移 = 往下淌。
 * 用 fill(并集) 而不是「裁剪 + 一层层画」，因为实测复杂裁剪下每个小图元都要重算遮罩，
 * 72 个流纹精灵在裁剪里要 3ms，而一次图案 fill 只要 1ms 左右，还天然不会溢出河道。
 */
const streakTex = () => tex('streak', 300, 400, (x, w, h) => {
  x.lineCap = 'round';
  const N = 7;
  for (let i = 0; i < N; i++) {
    const cx = (i + 0.5) * (w / N) + (hash(i, 3) - 0.5) * (w / N) * 0.4;
    const len = 150 + hash(i, 7) * 180, y0 = hash(i, 11) * h;
    for (let k = -1; k <= 1; k++) {          // 纵向无缝：跨上下的也画一份
      const y = y0 + k * h;
      x.strokeStyle = '#e24014'; x.globalAlpha = 0.42; x.lineWidth = 7;
      x.beginPath(); x.moveTo(cx, y); x.lineTo(cx, y + len); x.stroke();
      x.strokeStyle = '#ff8c28'; x.globalAlpha = 0.62; x.lineWidth = 4.2;
      x.beginPath(); x.moveTo(cx, y + len * 0.15); x.lineTo(cx, y + len); x.stroke();
      x.strokeStyle = '#ffe882'; x.globalAlpha = 0.9; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx, y + len * 0.38); x.lineTo(cx, y + len); x.stroke();
    }
  }
});

// ---------------- 静态层：每帧直接画（层数已经压到最少，不做世界缓存） ----------------
// 曾经试过把整张竞技场烘到 2400×2400 离屏画布：每帧只剩一次 drawImage，但换图时要烘约 150ms
// （背景每波都会换），波次切换会卡一下 —— 不划算。现在改成每层只有「一次图案 fill + 一条描边」。
function drawStatic(ctx, hz, V, lite) {
  const zs = hz.zones;
  const of = (k, f) => zs.filter((z) => z.k === k && (!f || f(z)));
  snowStatic(ctx, of('snow', (z) => !z.thick), of('snow', (z) => z.thick), V, lite);
  iceStatic(ctx, of('ice'), V, lite);
  beltsStatic(ctx, zs);
  poisonStatic(ctx, of('poison'), V, lite);
  lavaStatic(ctx, of('lava'), V, lite);
}

export function drawHazards(ctx, hz, camera, t, lite = false) {
  if (!hz || !hz.zones.length) return;
  const half = hz.half || 1200;
  const hw = camera.viewW / 2, hh = camera.viewH / 2;
  const vx0 = Math.max(camera.cx - hw, -half), vx1 = Math.min(camera.cx + hw, half);
  const vy0 = Math.max(camera.cy - hh, -half), vy1 = Math.min(camera.cy + hh, half);
  if (vx0 >= vx1 || vy0 >= vy1) return;
  const V = { x0: vx0, y0: vy0, x1: vx1, y1: vy1 };
  const vis = [];
  for (const z of hz.zones) {
    if (z.x1 < vx0 || z.x0 > vx1 || z.y1 < vy0 || z.y0 > vy1) continue;
    vis.push(z);
  }
  if (!vis.length) return;
  ctx.save();
  // 裁到「视口 ∩ 竞技场」：暗角在世界边界之前就画了，不裁的话危险地形会盖到地图外面
  ctx.beginPath(); ctx.rect(vx0, vy0, vx1 - vx0, vy1 - vy0); ctx.clip();
  drawStatic(ctx, hz, V, lite);
  drawAnim(ctx, hz, vis, V, t, lite);
  ctx.restore();
}

// ---------------- 动画层：只画会动的小东西 ----------------
function drawAnim(ctx, hz, vis, V, t, lite) {
  const of = (k, f) => vis.filter((z) => z.k === k && (!f || f(z)));
  if (!lite) snowfall(ctx, hz.id, V, t);
  poisonAnim(ctx, of('poison'), V, t, lite);
  lavaAnim(ctx, of('lava'), V, t, lite);
  snowAnim(ctx, of('snow', (z) => !z.thick), of('snow', (z) => z.thick), V, t);
  iceAnim(ctx, of('ice'), t);
  beltsAnim(ctx, vis, t);
}

// ---------------- 毒池 ----------------
function poisonStatic(ctx, list, V, lite) {
  if (!list.length) return;
  const shallow = list.filter((z) => !z.deep), deep = list.filter((z) => z.deep);
  // 第二百零四轮性能：底色已烘进贴片，每层只留「一次 fill + 一条描边」。
  // 原来这里有 2 条宽描边 + 底色 fill + 贴片 fill + 剧毒 3 层 + 加法混合辉光 = 8 次大面积绘制，
  // 实测一条 13px 描边扫过整片沼泽就要 5ms，现在全图只剩 2 次。
  ctx.lineJoin = 'round';
  if (shallow.length) {
    const Us = unionPath(shallow, true);
    ctx.fillStyle = lite ? '#26421f' : pat(ctx, mudTex());
    ctx.fill(Us);
    ctx.strokeStyle = '#182410'; ctx.lineWidth = 10; ctx.stroke(Us);
  }
  // 深处剧毒：暗紫（更疼）
  if (deep.length) {
    const Ud = unionPath(deep, true);
    ctx.fillStyle = lite ? '#3b1c52' : pat(ctx, deepTex());
    ctx.fill(Ud);
    ctx.strokeStyle = 'rgba(20,6,30,0.9)'; ctx.lineWidth = 8; ctx.stroke(Ud);
  }
  // 落脚石（同一块石头可能被多块多边形引用，去重）
  const seen = new Set();
  for (const z of list) {
    if (!z.h) continue;
    for (const s of z.h) {
      if (s.cx < V.x0 - 60 || s.cx > V.x1 + 60 || s.cy < V.y0 - 60 || s.cy > V.y1 + 60) continue;
      const k = s.cx * 7.31 + s.cy;
      if (seen.has(k)) continue;
      seen.add(k);
      stoneBody(ctx, s, lite);
    }
  }
}

function poisonAnim(ctx, list, V, t, lite) {
  if (!list.length) return;
  const rippled = new Set();                 // 同一块石头可能被多块多边形引用，涟漪只画一次
  for (const z of list) {
    const deep = !!z.deep;
    if (z.x1 < V.x0 || z.x0 > V.x1 || z.y1 < V.y0 || z.y0 > V.y1) continue;
    const B = { x0: Math.max(z.x0, V.x0), y0: Math.max(z.y0, V.y0), x1: Math.min(z.x1, V.x1), y1: Math.min(z.y1, V.y1) };
    const D = deep ? 44 : 64, thr = deep ? 0.5 : 0.62;
    const p = z.p;
    for (let i = Math.floor(B.x0 / D); i <= Math.floor(B.x1 / D); i++) {
      for (let j = Math.floor(B.y0 / D); j <= Math.floor(B.y1 / D); j++) {
        const h = hash(i + (deep ? 70 : 11), j + (deep ? 70 : 5));
        if (h < thr) continue;
        const px = i * D + hash(j + 2, i) * D, py = j * D + hash(i + 7, j) * D;
        if (!polyInside(p, px, py)) continue;                  // 只画在水里的，不用整片裁剪
        const ph = (t * (deep ? 0.25 + h * 0.2 : 0.22 + h * 0.18) + h * 13) % 1;
        if (ph < 0.7) {
          const r = deep ? 1.4 + ph * 3.6 : 1.5 + ph * 5;
          ctx.fillStyle = deep ? `rgba(190,120,230,${0.6 * (1 - ph)})` : `rgba(170,200,90,${0.55 * (1 - ph * 0.6)})`;
          ctx.beginPath(); ctx.arc(px, py - (deep ? ph * 6 : 0), r, 0, TAU); ctx.fill();
        } else if (!deep && !lite) {
          const q = (ph - 0.7) / 0.3;
          ctx.strokeStyle = `rgba(190,220,120,${0.5 * (1 - q)})`; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(px, py, 4 + q * 12, 0, TAU); ctx.stroke();
        }
      }
    }
    // 落脚石涟漪
    if (!lite && z.h) {
      for (const s of z.h) {
        if (s.cx < V.x0 - 60 || s.cx > V.x1 + 60 || s.cy < V.y0 - 60 || s.cy > V.y1 + 60) continue;
        const sk = s.cx * 7.31 + s.cy;
        if (rippled.has(sk)) continue;
        rippled.add(sk);
        const R = s.r * 1.05, sd = s.cx * 0.013 + s.cy * 0.007;
        const ph = (t * 0.35 + hash(sd, 3)) % 1;
        ctx.strokeStyle = `rgba(190,220,140,${0.35 * (1 - ph)})`; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.ellipse(s.cx, s.cy + 2, R * (1.05 + ph * 0.3), R * (0.95 + ph * 0.26), 0, 0, TAU); ctx.stroke();
      }
    }
  }
}

/** 一块落脚石（静态部分）：不规则的灰石 + 苔藓 + 暗影 */
function stoneBody(ctx, s, lite) {
  const spr = stoneSprite(s);
  const D = s.r * 2.4;
  ctx.drawImage(spr, s.cx - D / 2, s.cy - D / 2, D, D);   // 暗影已经烘在精灵里
}

/** 落脚石精灵：按位置散列取 6 种形状之一，烘一次之后每块石头只是一次 drawImage（原来每块一个裁剪 + 渐变） */
function stoneSprite(s) {
  const v = Math.floor(hash(s.cx * 0.013 + s.cy * 0.007, 5) * 6) % 6;
  return tex('stone' + v, 128, 128, (x) => {
    const C = 64, R = 46;
    const pts = [], n = 9, sd = v * 1.7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + hash(sd, i) * 0.35, r = R * (0.82 + 0.3 * hash(i, sd + 1));
      pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r * 0.9]);
    }
    const path = () => {
      x.beginPath();
      x.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
      for (let i = 0; i < n; i++) { const q = pts[(i + 1) % n]; x.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + q[0]) / 2, (pts[i][1] + q[1]) / 2); }
      x.closePath();
    };
    x.save();
    x.translate(4, 7); x.globalAlpha = 0.5; x.fillStyle = '#050a04'; path(); x.fill();
    x.restore();
    const g = x.createLinearGradient(C - R, C - R, C + R * 0.6, C + R);
    g.addColorStop(0, 'rgba(176,182,170,0.95)'); g.addColorStop(0.55, 'rgba(112,118,108,0.9)'); g.addColorStop(1, 'rgba(48,52,46,0.95)');
    x.fillStyle = g; path(); x.fill();
    x.lineWidth = 2; x.strokeStyle = '#23271f'; x.stroke();
    x.save();
    path(); x.clip();
    x.fillStyle = 'rgba(70,120,50,0.55)';
    for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(C + (hash(sd, i + 5) - 0.4) * R, C + (hash(i, sd + 8) - 0.3) * R * 0.8, R * 0.28, R * 0.14, hash(i, sd) * 3, 0, TAU); x.fill(); }
    x.strokeStyle = 'rgba(20,24,18,0.5)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(C - R * 0.5, C - R * 0.1); x.lineTo(C - R * 0.1, C + R * 0.1); x.lineTo(C + R * 0.25, C - R * 0.2); x.stroke();
    x.restore();
  });
}

// ---------------- 熔岩 ----------------
function lavaStatic(ctx, list, V, lite) {
  if (!list.length) return;
  const U = unionPath(list, true);
  ctx.lineJoin = 'round';
  ctx.fillStyle = lite ? '#6a1a10' : pat(ctx, crustTex());      // 暗红底色 + 暗壳（同一张贴片，一次 fill）
  ctx.fill(U);
  ctx.strokeStyle = '#2a0b06'; ctx.lineWidth = 9; ctx.stroke(U);
}

function lavaAnim(ctx, list, V, t, lite) {
  if (!list.length) return;
  const U = unionPath(list, true), spr = lavaBlob();
  // 亮色流纹：一张贴片整体下移 + fill(并集) —— 一次填充，天然只落在河道里
  const st = pat(ctx, streakTex());
  st.setTransform(new DOMMatrix([1, 0, 0, 1, 0, (t * 58) % 400]));
  ctx.fillStyle = st;
  ctx.fill(U);
  // 刚淌过的亮色熔岩斑（大块的亮橙 / 亮黄，缓慢下移）——软光斑，不裁剪
  for (const z of list) {
    if (z.x1 < V.x0 || z.x0 > V.x1 || z.y1 < V.y0 || z.y0 > V.y1) continue;
    const B = { x0: Math.max(z.x0, V.x0), y0: Math.max(z.y0, V.y0), x1: Math.min(z.x1, V.x1), y1: Math.min(z.y1, V.y1) };
    const p = z.p;
    if (!lite) {
      const Q = 125;
      for (let i = Math.floor(B.x0 / Q) - 1; i <= Math.floor(B.x1 / Q) + 1; i++) {
        for (let j = Math.floor(B.y0 / Q) - 2; j <= Math.floor(B.y1 / Q) + 1; j++) {
          const h = hash(i + 55, j + 8);
          if (h < 0.46) continue;
          const px = i * Q + hash(j, i + 1) * Q, py = j * Q + hash(i + 2, j) * Q + (t * (14 + h * 14)) % Q;
          if (!polyInside(p, px, py)) continue;
          const rw = 18 + h * 14, rh = 55 + h * 42;
          ctx.drawImage(spr, px - rw, py - rh, rw * 2, rh * 2);
        }
      }
      // 火星
      const D = 56;
      for (let i = Math.floor(B.x0 / D); i <= Math.floor(B.x1 / D); i++) {
        for (let j = Math.floor(B.y0 / D); j <= Math.floor(B.y1 / D); j++) {
          const h = hash(i + 90, j + 3);
          if (h < 0.74) continue;
          const ph = (t * (0.4 + h * 0.3) + h * 17) % 1;
          ctx.fillStyle = `rgba(255,226,130,${0.85 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(i * D + hash(j, i + 2) * D, j * D + hash(i, j + 6) * D - ph * 5, 1.4 + ph * 4, 0, TAU); ctx.fill();
        }
      }
    }
  }
}

// ---------------- 雪 ----------------
function snowStatic(ctx, thin, thick, V, lite) {
  // 第二百零四轮性能：雪层同样把「底色 + 雪粒」烘进一张贴片，一层只剩 fill + 一条描边
  if (thin.length) {
    const U = unionPath(thin, true);
    ctx.lineJoin = 'round';
    ctx.fillStyle = lite ? 'rgba(240,247,254,0.6)' : pat(ctx, thinTex());
    ctx.fill(U);
    if (!lite) { ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(236,245,253,0.18)'; ctx.stroke(U); }
  }
  if (thick.length) {
    const U = unionPath(thick, true);
    ctx.lineJoin = 'round';
    ctx.fillStyle = lite ? 'rgba(244,249,255,0.9)' : pat(ctx, thickTex());
    ctx.fill(U);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(150,176,208,0.7)'; ctx.stroke(U);
  }
}

function snowAnim(ctx, thin, thick, V, t) {
  for (const [list, D, seed, col] of [[thin, 96, 200, '255,255,255'], [thick, 78, 300, '200,230,255']]) {
    for (const z of list) {
      if (z.x1 < V.x0 || z.x0 > V.x1 || z.y1 < V.y0 || z.y0 > V.y1) continue;
      const B = { x0: Math.max(z.x0, V.x0), y0: Math.max(z.y0, V.y0), x1: Math.min(z.x1, V.x1), y1: Math.min(z.y1, V.y1) };
      const p = z.p;
      for (let i = Math.floor(B.x0 / D); i <= Math.floor(B.x1 / D); i++) {
        for (let j = Math.floor(B.y0 / D); j <= Math.floor(B.y1 / D); j++) {
          const h = hash(i + seed, j + 5);
          if (h < 0.62) continue;
          const px = i * D + hash(j, i) * D, py = j * D + hash(i, j + 3) * D;
          if (!polyInside(p, px, py)) continue;
          const tw = 0.5 + 0.5 * Math.sin(t * 2.2 + h * 30);
          ctx.fillStyle = `rgba(${col},${0.85 * tw})`;
          ctx.fillRect(px - 1, py - 1, 2, 2);
        }
      }
    }
  }
}

// ---------------- 冰面 ----------------
function iceStatic(ctx, list, V, lite) {
  for (const z of list) {
    const P = zonePath(z, false);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3c6a94'; ctx.lineWidth = 7; ctx.stroke(P);
    ctx.strokeStyle = '#8fc4e6'; ctx.lineWidth = 3; ctx.stroke(P);
    if (lite) { ctx.fillStyle = 'rgba(176,226,250,0.85)'; ctx.fill(P); continue; }
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    const g = ctx.createLinearGradient(z.x0, z.y0, z.x1, z.y1);
    g.addColorStop(0, 'rgba(236,251,255,0.96)'); g.addColorStop(0.5, 'rgba(160,214,244,0.92)'); g.addColorStop(1, 'rgba(104,166,214,0.94)');
    ctx.fillStyle = g; ctx.fill(P);
    ctx.save(); ctx.clip(P);
    const sd = z.cx * 0.009 + z.cy * 0.013;
    const facets = w * h > 26000 ? 7 : 4;
    for (let i = 0; i < facets; i++) {
      const px = z.x0 + hash(sd, i) * w, py = z.y0 + hash(i, sd + 2) * h, r = 18 + hash(i, sd + 4) * 36;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.28)' : 'rgba(70,130,186,0.22)';
      ctx.beginPath(); ctx.moveTo(px, py - r);
      for (let k = 1; k < 5; k++) { const a = -Math.PI / 2 + (k / 5) * TAU + hash(i, k + sd) * 0.6, rr = r * (0.6 + 0.6 * hash(k, i + sd)); ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.8); }
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      let a = hash(sd, i + 9) * TAU, x = z.x0 + hash(i, sd + 6) * w, y = z.y0 + hash(sd, i + 5) * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { a += (hash(i, k + sd) - 0.5) * 1.2; x += Math.cos(a) * 22; y += Math.sin(a) * 22; ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.restore();
  }
}

function iceAnim(ctx, list, t) {
  for (const z of list) {
    const P = zonePath(z, false);
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    const sd = z.cx * 0.009 + z.cy * 0.013;
    const span = w + h, sweep = ((t * 0.1 + hash(sd, 1)) % 1) * span * 1.4 - span * 0.2;
    ctx.save();
    ctx.clip(P);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.translate(z.x0 + sweep, z.y0); ctx.rotate(-0.6);
    ctx.fillRect(-8, -span, 16, span * 3);
    ctx.restore();
  }
}

// ---------------- 飘雪：屏幕里缓缓落下的雪花（只在冰川图） ----------------
function snowfall(ctx, id, V, t) {
  if (id !== 'glacier') return;
  const W = V.x1 - V.x0, H = V.y1 - V.y0;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  for (let i = 0; i < 70; i++) {
    const sp = 18 + hash(i, 2) * 26, sw = Math.sin(t * 0.7 + i) * 14;
    const x = V.x0 + ((hash(i, 1) * W + sw + t * 8) % W + W) % W;
    const y = V.y0 + ((hash(i, 3) * H + t * sp) % H);
    ctx.beginPath(); ctx.arc(x, y, 0.9 + hash(i, 4) * 1.5, 0, TAU); ctx.fill();
  }
}

// ---------------- 传送带 ----------------
function beltsStatic(ctx, zs) {
  for (const z of zs) {
    if (z.k !== 'belt') continue;
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    ctx.fillStyle = '#14171d';
    ctx.fillRect(z.x0, z.y0, w, h);
    ctx.fillStyle = '#262b34';
    ctx.fillRect(z.x0 + 3, z.y0 + 3, w - 6, h - 6);
    const horiz = Math.abs(z.dx) > 0;
    ctx.fillStyle = '#d9a920';
    const stripe = 14;
    if (horiz) {
      for (let x = Math.floor(z.x0 / (stripe * 2)) * stripe * 2; x < z.x1; x += stripe * 2) {
        ctx.fillRect(x, z.y0, stripe, 4); ctx.fillRect(x + stripe, z.y1 - 4, stripe, 4);
      }
    } else {
      for (let y = Math.floor(z.y0 / (stripe * 2)) * stripe * 2; y < z.y1; y += stripe * 2) {
        ctx.fillRect(z.x0, y, 4, stripe); ctx.fillRect(z.x1 - 4, y + stripe, 4, stripe);
      }
    }
  }
}

function beltsAnim(ctx, zs, t) {
  for (const z of zs) {
    if (z.k !== 'belt') continue;
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    const horiz = Math.abs(z.dx) > 0;
    const gap = 46, off = (t * 105) % gap;
    ctx.save();
    ctx.beginPath(); ctx.rect(z.x0, z.y0, w, h); ctx.clip();
    ctx.strokeStyle = 'rgba(242,201,76,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (horiz) {
      const cy = (z.y0 + z.y1) / 2, s = Math.min(h * 0.28, 14), dir = z.dx;
      const start = Math.floor(z.x0 / gap) * gap + (dir > 0 ? off : gap - off) - gap;
      for (let x = start; x < z.x1 + gap; x += gap) {
        ctx.moveTo(x - dir * s * 0.7, cy - s); ctx.lineTo(x + dir * s * 0.7, cy); ctx.lineTo(x - dir * s * 0.7, cy + s);
      }
    } else {
      const cx = (z.x0 + z.x1) / 2, s = Math.min(w * 0.28, 14), dir = z.dy;
      const start = Math.floor(z.y0 / gap) * gap + (dir > 0 ? off : gap - off) - gap;
      for (let y = start; y < z.y1 + gap; y += gap) {
        ctx.moveTo(cx - s, y - dir * s * 0.7); ctx.lineTo(cx, y + dir * s * 0.7); ctx.lineTo(cx + s, y - dir * s * 0.7);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}