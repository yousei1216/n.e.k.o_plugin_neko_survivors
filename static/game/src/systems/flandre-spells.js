// 芙兰新符卡脚本（第一百八十五轮 · 版本 B）。覆盖 flandre.js 里同名的旧符卡；没列在这里的继续用旧的。
//
// 用户："不用 100% 还原但是能看出来是'她'的感觉就行……你有更华丽的弹幕写法就用……
//       如果做到特别好看不留弹缝都行，毕竟有小小猫娘 15 秒一次的消弹，让玩家学会资源管理也行。"
//
// 设计原则（每张卡都遵守，tools/_spell-sim.mjs 量化验证）：
//   1. 判定远小于视觉：hitRadius = 视觉半径 × 0.6（视觉参数书 §0-8）。
//   2. 有"读得懂的结构"：螺旋丝线 / 网格笼 / 带缺口的环 / 星形波前 —— 玩家看一眼知道往哪躲。
//   3. 30 秒内会躲的 AI 被击中约 1~3 次；原地不动的人被击中 ≥10 次（逼人移动）。
//   4. 全部走 dt 累加，不用帧数取模；视觉随机只用 f.rnd()（游戏 RNG 流保持确定性）。
//   5. 发射器可视体写进 sp.st.vis（kind: 'glow'），渲染层画成发光球。
import { ARENA } from './flandre-consts.js';

const TAU = Math.PI * 2;
const C = {
  magenta: '#E050F0', blue: '#4060FF', red: '#FF3040', white: '#FFF2F4', gold: '#FFE060',
  mint: '#30E080', cyan: '#60E8E8', violet: '#A060FF', pink: '#FF80C0', sky: '#5fd4ff',
};
const RAINBOW = ['#FF4040', '#FFA040', '#FFE040', '#60FF60', '#40E0FF', '#A060FF', '#FF40C0'];
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 发一颗弹：判定半径缩到视觉的 60%，其余透传给 f.emit */
function shot(f, x, y, angle, speed, color, shape, r, extra) {
  f.emit({ x, y, angle, speed, color, shape, radius: r, hitRadius: r * 0.6, ...extra });
}
/** 规范化角度差到 [-π, π] */
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
/** 发射器可视体（渲染层 kind:'glow'） */
const glow = (x, y, r, color, age, a = 1) => ({ x, y, r, color, age, a, kind: 'glow' });

export const NEW_SPELLS = {
  // ============================================================
  // 禁忌「Cranberry Trap」· 糖丝
  // 她瞬移，每次落点放出两颗发光的"糖球"，各自甩出 3 条彩色糖丝（大珠 + 小米粒交替的珠链），
  // 两球转向相反、丝线互相穿插成蛛网；糖球寿命尽时炸成一圈金色星星。
  // 结构读法：丝线之间有大片空地（螺旋臂间距大），站在两条丝线中间、随丝线外推慢慢挪。
  // ============================================================
  cranberry: {
    tick(sp, dt, f) {
      const st = sp.st, k = clamp01(sp.t / sp.dur);
      st.tp = (st.tp ?? 99) + dt;
      if (st.tp >= 5.2) {
        st.tp = 0;
        f.teleportBoss();
        st.flip = -(st.flip ?? -1);
        st.ems = [-1, 1].map((side, i) => ({
          x: f.bx + side * 95, y: f.by + (f.rnd() - 0.5) * 70, dir: st.flip * (i ? -1 : 1),
          rot: f.rnd() * TAU, acc: 0, age: 0, ring: 0, bead: 0,
        }));
      }
      for (const em of st.ems ?? []) {
        em.age += dt;
        const life = 5.0;
        if (em.age > life) continue;
        em.rot += dt * lerp(1.05, 1.5, k) * em.dir;
        em.acc += dt;
        const step = lerp(0.2, 0.15, k);                 // 珠距 ≈ 速度 × step ≈ 28~36px
        while (em.acc >= step) {
          em.acc -= step; em.bead++;
          for (let arm = 0; arm < 3; arm++) {
            const a = em.rot + (arm * TAU) / 3;
            if (em.bead % 2 === 0) shot(f, em.x, em.y, a, 150, C.magenta, 'orb', 6.5);
            else shot(f, em.x, em.y, a, 150, C.blue, 'rice', 4.2);
          }
        }
        em.ring += dt;
        if (em.ring >= 2.5) {
          em.ring -= 2.5;
          const base = f.rnd() * TAU;
          for (let i = 0; i < 14; i++) shot(f, em.x, em.y, base + (i * TAU) / 14, 105, C.gold, 'star', 5.5);
        }
      }
      // 本体：慢速瞄准米弹扇，防止在丝线缝里站桩
      st.aim = (st.aim ?? 0) + dt;
      if (st.aim >= lerp(1.9, 1.4, k)) {
        st.aim = 0;
        f.fan(f.bx, f.by, f.aim(f.bx, f.by), 5, 30, 200, C.pink, 5, 'rice', { hitRadius: 3 });
      }
      st.vis = (st.ems ?? []).filter((e) => e.age < 5.0).map((e) => glow(e.x, e.y, 13, C.magenta, e.age, Math.min(1, (5.0 - e.age) / 0.5)));
    },
  },

  // ============================================================
  // 禁忌「笼中鸟 Kagome Kagome」· 网格笼
  // 发射器从四边飞过：横向飞过的在头顶一路"洒"下一排向下漂的绿珠，纵向飞过的在侧边洒出一列横漂的绿珠。
  // 一排一列叠在一起，场上渐渐织成一座会移动的格子笼；每格的珠距留出可钻的缝。
  // 金色大玉偶尔从笼外飘进来当"鸟"，追着你走。
  // ============================================================
  kagome: {
    tick(sp, dt, f) {
      const st = sp.st, k = clamp01(sp.t / sp.dur);
      const L = ARENA.cx - ARENA.hw, R = ARENA.cx + ARENA.hw, T = ARENA.cy - ARENA.hh, B = ARENA.cy + ARENA.hh;
      st.fl = st.fl ?? [];
      st.spawn = (st.spawn ?? 99) + dt;
      if (st.spawn >= lerp(2.0, 1.5, k)) {
        st.spawn = 0; st.n = (st.n ?? 0) + 1;
        const horizontal = st.n % 2 === 1;
        const rev = f.rnd() < 0.5;
        const spd = 330;
        if (horizontal) {
          st.fl.push({ h: true, x: rev ? R + 20 : L - 20, y: T + 24, vx: rev ? -spd : spd, vy: 0, acc: 0, dirShot: Math.PI / 2, phase: f.rnd() });
        } else {
          st.fl.push({ h: false, x: rev ? R - 24 : L + 24, y: T - 20, vx: 0, vy: spd, acc: 0, dirShot: rev ? Math.PI : 0, phase: f.rnd() });
        }
      }
      const gap = lerp(36, 32, k);                       // 珠距（px）；模拟器：46px→13发/秒笼子织不起来，30px/1.6s→AI 被打 8 次必死，取中间
      for (const e of st.fl) {
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.acc += Math.hypot(e.vx, e.vy) * dt;
        while (e.acc >= gap) {
          e.acc -= gap;
          shot(f, e.x, e.y, e.dirShot, 92, (st.n + Math.floor(e.x / 97)) % 5 === 0 ? C.gold : C.mint, 'orb', 6);
        }
      }
      st.fl = st.fl.filter((e) => e.x > L - 80 && e.x < R + 80 && e.y > T - 80 && e.y < B + 80);
      // "鸟"：金色大玉从笼外慢速追人
      st.bird = (st.bird ?? 0) + dt;
      if (st.bird >= 3.6) {
        st.bird = 0;
        const a = f.aim(f.bx, f.by);
        f.emit({ x: f.bx, y: f.by, angle: a, speed: 120, color: C.gold, shape: 'orb', radius: 11, hitRadius: 6, range: 1100 });
        f.fan(f.bx, f.by, a, 7, 40, 190, C.mint, 5, 'rice', { hitRadius: 3 });
      }
      st.vis = st.fl.map((e) => glow(e.x, e.y, 10, C.mint, f.t));
    },
  },

  // ============================================================
  // 禁忌「恋之迷宫 Maze of Love」· 缺口环
  // 每隔一小会儿从她身上扩出一圈完整的青色光环——只缺一个口；缺口一次比一次转得远，
  // 连成一条螺旋的"迷宫通道"，通道会慢慢变窄。圈内另有一条蓝色米弹螺旋缓缓旋出。
  // 结构读法：永远朝缺口走；缺口总在你方向 ±35° 以内，别贪心去追上一个缺口。
  // ============================================================
  maze: {
    tick(sp, dt, f) {
      const st = sp.st, k = clamp01(sp.t / sp.dur);
      st.ring = (st.ring ?? 0.6) + dt;
      st.gapAng = st.gapAng ?? f.aim(f.bx, f.by);
      const interval = lerp(1.3, 0.92, k);
      if (st.ring >= interval) {
        st.ring = 0; st.n = (st.n ?? 0) + 1;
        const N = 84, gapN = Math.round(lerp(9, 6, k));   // 模拟器：54 发/圈时 530px 处弹距 ~62px，AI 随便钻，加密到 84 让缺口真正有意义
        // 缺口：以玩家方向为基准偏 ±35°，且每圈绕向翻转，形成蛇形通道
        st.gapAng = f.aim(f.bx, f.by) + (f.rnd() - 0.5) * 1.9;   // ±54°：缺口常常不在你正前方，站桩会被打
        const fast = st.n % 4 === 0;                       // 每 4 圈一圈"快环"：先快后缓，追上前一圈压缩通道
        for (let i = 0; i < N; i++) {
          const th = (i * TAU) / N + st.gapAng + Math.PI / N;
          if (Math.abs(angDiff(th, st.gapAng)) < (gapN / 2) * (TAU / N)) continue;
          shot(f, f.bx, f.by, th, fast ? 210 : 128, fast ? C.sky : C.cyan, 'orb', 5.5, fast ? { decel: 90, floorSpeed: 110 } : undefined);
        }
      }
      // 内圈蓝米弹螺旋（3 臂，不密，作为"路标"并逼人别贴着她站）
      st.rot = (st.rot ?? 0) + dt * 1.7;
      st.spi = (st.spi ?? 0) + dt;
      while (st.spi >= 0.16) {
        st.spi -= 0.16;
        for (let arm = 0; arm < 3; arm++) shot(f, f.bx, f.by, st.rot + (arm * TAU) / 3, 96, C.blue, 'rice', 4.4);
      }
      st.vis = [glow(f.bx, f.by, 15, C.cyan, f.t)];
    },
  },

  // ============================================================
  // 禁弹「Starbow Break」· 星虹
  // 一颗颗五角星形的"波前"从她和两侧的星点扩散出来：星尖跑得快、凹处跑得慢，所以形状一直保持是星；
  // 颜色按方向分成彩虹 7 段。每个波前都在你的方向上留一道"星门"（缺口）——凹处正对着你时最宽。
  // ============================================================
  starbow: {
    tick(sp, dt, f) {
      const st = sp.st, k = clamp01(sp.t / sp.dur);
      st.beat = (st.beat ?? 0.5) + dt;
      const interval = lerp(0.95, 0.65, k);
      if (st.beat >= interval) {
        st.beat = 0; const n = (st.n = (st.n ?? 0) + 1);
        const o = n % 3 === 0
          ? { x: f.bx, y: f.by }
          : { x: ARENA.cx + (n % 2 ? -1 : 1) * 330, y: ARENA.cy - 140 };
        const rot = f.rnd() * TAU, points = 5, inner = 0.46;
        // 星形多边形顶点：偶数下标为尖(1)，奇数为凹(inner)
        const V = [];
        for (let i = 0; i < points * 2; i++) { const a = rot + (i * Math.PI) / points; const rr = i % 2 ? inner : 1; V.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
        const towards = Math.atan2(f.P.y - o.y, f.P.x - o.x);
        const NB = 60, gate = 0.3;
        for (let i = 0; i < NB; i++) {
          const th = (i * TAU) / NB + rot + Math.PI / NB;
          if (Math.abs(angDiff(th, towards)) < gate) continue;   // 星门
          // 射线与星形边的交点半径 → 速度比
          const dx = Math.cos(th), dy = Math.sin(th);
          let rr = 1;
          for (let j = 0; j < V.length; j++) {
            const P = V[j], Q = V[(j + 1) % V.length], Ex = Q[0] - P[0], Ey = Q[1] - P[1];
            const den = dx * Ey - dy * Ex;
            if (Math.abs(den) < 1e-9) continue;
            const r = (P[0] * Ey - P[1] * Ex) / den, u = (P[0] * dy - P[1] * dx) / den;
            if (r > 0 && u >= 0 && u <= 1) { rr = r; break; }
          }
          const sector = Math.floor((((th - rot) % TAU) + TAU) % TAU / TAU * RAINBOW.length);
          shot(f, o.x, o.y, th, 150 * rr, RAINBOW[sector], 'star', 5.6, { range: 640 });
        }
      }
      // 本体补射：慢速瞄准大玉，鼓励移动而非站桩
      st.big = (st.big ?? 0) + dt;
      if (st.big >= 3.4) {
        st.big = 0;
        f.emit({ x: f.bx, y: f.by, angle: f.aim(f.bx, f.by), speed: 105, color: C.violet, shape: 'orb', radius: 10, hitRadius: 5.5, range: 1000 });
      }
      st.vis = [glow(f.bx, f.by, 14, C.gold, f.t)];
    },
  },
};
