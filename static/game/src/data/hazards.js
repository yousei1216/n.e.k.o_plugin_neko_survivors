// ============================================================
// 危险地形（第二百零二轮 · 新地图）
//
// 用户："毒池地图…很多毒池子区域进去中毒减速。持续掉血还走不动的感觉。然后火山岩浆地图和雪地
//   冰冻地图…火山岩浆就是踩上去掉血更多不减速，冰冻地图的雪比较厚的地方减速玩家和敌人，
//   冰块地区会滑行之类的。你有更好的地图想法也可以设计。"
//
// 和 terrain.js 的区别：障碍物（terrain）是**墙**，挡路；危险区（hazard）是**地面效果**，走得进去、
// 进去了有后果。坐标同样用「图案内归一化 0~1，按 BG_TILE 平铺」，数据在 hazard-zones.js（由
// tools/make-bg-hazard.py 生成），渲染在 systems/hazard-fx.js，生效在 world.updateHazards。
//
// 第二百零三轮（形状重做）：用户："不管是毒池，还是岩浆池，还是冰面全都是圆形绘制太怪了…毒池都是一大片一大片的，
//   里面浮动着几块石头用来踩，大部分地方都无法落脚。岩浆…竖条条那种流下去的效果而不是一个一个圈。冰也是，雪也是都太圆了"
//   → 危险区改成**多边形**（{k,g,p:[x,y,...],h:[[cx,cy,r],...]}）：p = 归一化轮廓（逆/顺时针均可），h = 「石头孤岛」
//   （毒池里可以落脚的安全点，脚底圆心落在 h 内就不算泡在毒里）。熔岩是纵向的长河（周期性，跨图案接缝连续）。
//   圆形（cx,cy,r）与矩形（传送带）仍支持，旧数据不用改。
//
// 六种地面：
//   poison  毒池   玩家 ×0.5 速 + 每 0.8s 扣 2% 最大生命（至少 1 点，离开后余毒 1.2s）；敌人 ×0.55 速（精英/中 Boss 减半）
//   lava    熔岩   玩家**不减速**，每 0.5s 扣 3.5% 最大生命（至少 1.5 点，真伤，吃不到护甲）；普通怪每秒被烧 6% 最大生命
//   snow    厚雪   玩家 ×0.62 速，敌人 ×0.65 速
//   ice     冰面   玩家惯性滑行（松开方向键也会往前滑）；敌人不受影响
//   belt    传送带 把站在上面的人和怪一起往 (dx,dy) 方向推 105px/s（Boss 减半）
// ============================================================
import { HAZARD_ZONES } from './hazard-zones.js';
import { BG_TILE, WORLD_SIZE } from './terrain.js';

export const HAZARD_KINDS = {
  poison: { name: '毒池', pSlow: 0.5, eSlow: 0.55, pTick: 0.8, pPct: 0.02, pMin: 1, linger: 1.2, color: '#7ddc4a' },
  lava: { name: '熔岩', pSlow: 1, eSlow: 1, pTick: 0.5, pPct: 0.035, pMin: 1.5, ePctPerSec: 0.06, color: '#ff7a2a' },
  snow: { name: '厚雪', pSlow: 0.62, eSlow: 0.65, color: '#e8f2fb' },
  // 第二百零三轮：薄雪（大面积、只轻微拖慢）/ 剧毒深处（暗紫，更疼更黏）
  snowThin: { name: '薄雪', pSlow: 0.86, eSlow: 0.88, color: '#f0f6fc' },
  poisonDeep: { name: '剧毒', pSlow: 0.42, eSlow: 0.48, pTick: 0.6, pPct: 0.04, pMin: 1.5, linger: 1.4, color: '#a55ae0' },
  ice: { name: '冰面', slide: 2.0, color: '#aee4fa' },
  belt: { name: '传送带', push: 105, color: '#f2c94c' },
};

/** 有危险区的地图 id */
export const HAZARD_MAP_IDS = Object.keys(HAZARD_ZONES);

const CELL = 128;
const key = (i, j) => i * 100003 + j;

/**
 * 展开成世界坐标的危险区（只保留与竞技场相交的），并建一个 128px 的空间桶供 O(1) 查询。
 * 出生点 (0,0) 周围 170px 内的危险区整个撤掉：开局 / 每波开头玩家站在原点，不能一出生就泡在毒里。
 */
export function expandHazards(bgId, worldSize = WORLD_SIZE) {
  const zs = HAZARD_ZONES[bgId];
  if (!zs) return null;
  const half = worldSize / 2;
  const span = Math.ceil(half / BG_TILE) + 1;
  const out = [];
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const ox = i * BG_TILE, oy = j * BG_TILE;
      for (const z of zs) {
        let w;
        if (z.p) {
          const p = new Array(z.p.length);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
          for (let q = 0; q < z.p.length; q += 2) {
            const x = ox + z.p[q] * BG_TILE, y = oy + z.p[q + 1] * BG_TILE;
            p[q] = x; p[q + 1] = y; sx += x; sy += y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          if (x1 <= -half || x0 >= half || y1 <= -half || y0 >= half) continue;
          const n = p.length / 2;
          w = { k: z.k, g: z.g, deep: z.deep ? 1 : 0, thick: z.thick ? 1 : 0, p, x0, y0, x1, y1, cx: sx / n, cy: sy / n, h: (z.h || []).map((s) => ({ cx: ox + s[0] * BG_TILE, cy: oy + s[1] * BG_TILE, r: s[2] * BG_TILE })) };
          w.poly = true;
          if (polyInside(p, 0, 0) || polyDist2(p, 0, 0) < 170 * 170) continue;
        } else if (z.cx != null) {
          w = { k: z.k, g: z.g, cx: ox + z.cx * BG_TILE, cy: oy + z.cy * BG_TILE, r: z.r * BG_TILE };
          if (w.cx + w.r <= -half || w.cx - w.r >= half || w.cy + w.r <= -half || w.cy - w.r >= half) continue;
          if (Math.hypot(w.cx, w.cy) < w.r + 170) continue;
          w.x0 = w.cx - w.r; w.y0 = w.cy - w.r; w.x1 = w.cx + w.r; w.y1 = w.cy + w.r;
        } else {
          w = { k: z.k, g: z.g, x0: ox + z.x0 * BG_TILE, y0: oy + z.y0 * BG_TILE, x1: ox + z.x1 * BG_TILE, y1: oy + z.y1 * BG_TILE, dx: z.dx, dy: z.dy };
          if (w.x1 <= -half || w.x0 >= half || w.y1 <= -half || w.y0 >= half) continue;
          if (w.x0 < 170 && w.x1 > -170 && w.y0 < 170 && w.y1 > -170) continue;
        }
        out.push(w);
      }
    }
  }
  const cells = new Map();
  for (const z of out) {
    const i0 = Math.floor(z.x0 / CELL), i1 = Math.floor(z.x1 / CELL);
    const j0 = Math.floor(z.y0 / CELL), j1 = Math.floor(z.y1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let a = cells.get(k);
      if (!a) { a = []; cells.set(k, a); }
      a.push(z);
    }
  }
  // 第二百零四轮：half 给渲染用（危险地形只画到竞技场内，别糊到场外暗角上）
  return { id: bgId, zones: out, cells, half };
}

/**
 * 点 (x,y) 脚下踩着什么。返回 {kind, zone} 或 null。
 * 多种叠在一起时优先级：lava > poison > ice > snow > belt（先伤人的先算）。
 * @param {number} [pad] 把单位半径的一部分算进去（脚底判定，传 radius*0.4 左右）
 */
/** 射线法：点是否在多边形内（p = 扁平 [x,y,x,y,...]） */
export function polyInside(p, x, y) {
  let c = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** 点到多边形边的最短距离平方 */
export function polyDist2(p, x, y) {
  let best = Infinity;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = p[j], ay = p[j + 1], bx = p[i], by = p[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return best;
}
const PRI = { lava: 5, poison: 4, ice: 3, snow: 2, belt: 1 };
export function hazardAt(hz, x, y, pad = 0) {
  if (!hz) return null;
  const arr = hz.cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
  if (!arr) return null;
  let best = null;
  for (const z of arr) {
    let inside;
    if (z.poly) {
      if (x < z.x0 - pad || x > z.x1 + pad || y < z.y0 - pad || y > z.y1 + pad) continue;
      inside = polyInside(z.p, x, y) || (pad > 0 && polyDist2(z.p, x, y) <= pad * pad);
      if (inside && z.h.length) {
        for (const s of z.h) { const dx = x - s.cx, dy = y - s.cy; if (dx * dx + dy * dy <= s.r * s.r) { inside = false; break; } }
      }
    } else if (z.cx != null) {
      const dx = x - z.cx, dy = y - z.cy, rr = z.r + pad;
      inside = dx * dx + dy * dy <= rr * rr;
    } else {
      inside = x >= z.x0 - pad && x <= z.x1 + pad && y >= z.y0 - pad && y <= z.y1 + pad;
    }
    // 同种叠放时「更狠的」赢：剧毒盖住普通毒池、厚雪盖住薄雪（第二百零三轮）
    if (inside && (!best || PRI[z.k] * 2 + (z.deep || z.thick ? 1 : 0) > PRI[best.k] * 2 + (best.deep || best.thick ? 1 : 0))) best = z;
  }
  return best;
}

/**
 * 第二百零三轮：冰系武器冻出来的地面不再是正圆（用户："冰系武器冻的地面也是圆形，也改改"）。
 * 一块冰是「拉长 + 旋转 + 边缘起伏」的不规则冰板，画和判定共用这个半径函数（seed = 每块冰自己的随机数）。
 * ang 是世界坐标系里相对冰心的角度。
 */
export function iceBlobRadius(seed, r, ang) {
  const a = ang - seed;                               // 以长轴方向为基准
  const e = 1 + 0.42 * Math.cos(2 * a);               // 长轴 ×1.42 / 短轴 ×0.58
  const w = 1 + 0.16 * Math.sin(3 * a + seed * 2.7) + 0.1 * Math.sin(5 * a + seed * 5.1) + 0.06 * Math.sin(8 * a + seed);
  return r * 0.86 * e * w;
}
