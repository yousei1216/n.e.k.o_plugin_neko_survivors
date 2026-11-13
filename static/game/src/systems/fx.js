// ============================================================
// 视觉特效系统
// 所有特效都是短生命周期的轻量对象，由渲染器统一绘制。
// 占位阶段用几何图形表现，之后换成贴图不影响调用点。
//
// ---- 第九轮：攻击特效"打击感"升级（用户反馈）----
// 用户原话："我们的攻击特效太素了，你可以找一些特效效果换上吗？
//            让近战看起来有一些打击感，远程武器的弹幕也华丽一点。
//            找找看或者不行生生图看看。"
//
// 选型：**继续走程序化 canvas，不引入贴图**。理由：
//   1. 特效是每帧随机生成的（角度/长度/随机火花），贴图反而做不出这种变化；
//   2. 这个项目的设计原则是"贴图永远是可选增强"，特效是核心手感，不该依赖资源；
//   3. 一张 1024 的爆炸图缩到 256 再当特效，放大后糊，还不如矢量画得干净。
// 所以这里加的是**表现手法**：多层叠加、加色混合、拖影、冲击碎片、蓄力预警。
// ============================================================

import { TAU } from '../core/math.js';
// 第一百六十二轮：移动端性能档位（桌面 MOBILE=false，maxItems 仍为 240）
import { MOBILE, MOBILE_TUNE } from '../core/mobile.js';

// ---- 第三十九轮：玩家特效透明度 ----
// 用户原话："增加个暂停菜单的设置选项，让玩家可拖动"玩家特效"条来调整
// 自己攻击的透明度。从0到100%自由调整。不然噩梦难度的无限模式敌人弹幕
// 太密集了，玩家攻击速度也很快，导致看不清敌人弹幕，让玩家可以在这种
// 时候拉动自己攻击的效果透明度看清敌人弹幕。"
// playerAlpha 0~1，渲染端按它缩放**带 player 标记**的特效/子弹；
// 敌人弹幕和预警几何不受影响。暂停菜单滑条（ui.showPause）改它并持久化。
export const fxSettings = { playerAlpha: 1 };

export const FX_TYPE = {
  SLASH: 'slash', THRUST: 'thrust', SPIN: 'spin', BEAM: 'beam',
  NOVA: 'nova', EXPLOSION: 'explosion', CHAIN: 'chain',
  SPARKLE: 'sparkle', DAMAGE_TEXT: 'damage_text', RING: 'ring',
  HIT: 'hit',
  // ---- 第九轮新增 ----
  IMPACT: 'impact',       // 近战命中：放射碎片 + 白闪（打击感的核心）
  SHOCKWAVE: 'shockwave', // 冲击波：比 nova 更"钝"的压缩环，配重击
  SHARD: 'shard',         // 碎片：带旋转和重力的碎屑
  // ---- 第二百轮 A1 新增 ----
  MUZZLE: 'muzzle',       // 枪口闪光：开火瞬间的锥形火光 + 白核
  FLAME: 'flame',         // 第二百零一轮：喷射雾（火焰 / 冰霜喷射器的扇形粒子）
  CRACKS: 'cracks',       // 地裂：重击落点放射状裂纹 + 尘环（铁锤/战锤）
};

export class FXSystem {
  constructor() {
    this.items = [];
    // 第十轮性能调整：400 → 240。
    //
    // 基准实测（test/perf-fx-bench.mjs，每帧 10 次命中的后期负载）：
    //   上限 150 → 6.0 ms/帧   上限 400 → 19.1 ms/帧   无上限 → 31.3 ms/帧
    // 60fps 的总预算只有 16.7ms，所以 400 是**超预算**的。
    //
    // 240 是折中：仍然远高于正常战斗的同屏特效数（实测峰值约 60~90），
    // 只有在"后期极高攻速 + 暴击碎片"这种极端情况下才会触顶，
    // 而那时玩家本来也看不清多出来的特效。
    // 移动端降档（MOBILE=false 桌面恒 240，行为不变）
    this.maxItems = MOBILE ? MOBILE_TUNE.FX_MAX_ITEMS : 240;
    // 供测试断言"特效真的被创建了"用
    this.stats = { created: 0, dropped: 0 };
  }

  _push(fx) {
    if (this.items.length >= this.maxItems) {
      // 第十轮性能修正：原来用 shift() 丢最老的，但 shift 是 O(n) ——
      // 后期一秒几十次命中，等于每帧都在搬 400 个元素。
      //
      // 改成"用最新的覆盖最老的"（O(1)）。视觉上没有区别：
      // 溢出时本来就是"扔一个旧的、加一个新的"，扔哪个几乎看不出来，
      // 但省掉的是实打实的数组搬移。
      let oldest = 0;
      for (let i = 1; i < this.items.length; i++) {
        if (this.items[i].t > this.items[oldest].t) oldest = i;
      }
      this.items[oldest] = fx;
      this.stats.dropped++;
      this.stats.created++;
      return;
    }
    this.items.push(fx);
    this.stats.created++;
  }

  clear() { this.items.length = 0; }

  update(dt) {
    if (this._swCool > 0) this._swCool -= dt;
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const fx = arr[i];
      fx.t += dt;
      if (fx.t >= fx.life) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
  }

  // ---------------- 具体特效 ----------------

  /**
   * 近战挥砍。
   *
   * 第九轮升级：从"一条弧"变成**三层弧**（外发光 / 主刃 / 内高光），
   * 并且刃宽随进度收窄，做出"划过去"的速度感。
   * 原来的单层弧看起来像一根静止的线，没有挥动的感觉。
   *
   * `extra`（第三十九轮）：调用方附加字段，玩家攻击传 `{ player: true }`，
   * 渲染端据此应用"玩家特效"透明度。
   */
  slash(x, y, angle, range, arcDeg, color, extra = null) {
    this._push({
      type: FX_TYPE.SLASH, x, y, angle, range, arcDeg,
      color: color ?? '#ffffff', t: 0, life: 0.22, ...extra,
    });
    // 第一百三十九轮 C：切割火星。F 轮细调（用户："在刀光扫过的路径上
    // 随机生成 3-4 个快速消散的白色火星"）—— 沿弧洒 4 粒白色 sparkle
    //（小亮点、命短、消散快），另保留 2 粒碎屑增加质感层次。
    const rad = (arcDeg * Math.PI / 180);
    for (let i = 0; i < 4; i++) {
      const ma = angle + (Math.random() - 0.5) * rad * 0.85;
      const pr = range * (0.62 + Math.random() * 0.32);
      this.sparkle(x + Math.cos(ma) * pr, y + Math.sin(ma) * pr, '#ffffff', 1, extra);
    }
    const ma2 = angle + (Math.random() - 0.5) * rad * 0.7;
    this.shards(x + Math.cos(ma2) * range * 0.8, y + Math.sin(ma2) * range * 0.8,
      8, '#cfefff', 2, extra);
  }

  thrust(x, y, ex, ey, width, color, extra = null) {
    this._push({
      type: FX_TYPE.THRUST, x, y, ex, ey, width,
      color: color ?? '#ffffff', t: 0, life: 0.18, ...extra,
    });
  }

  spin(x, y, range, color, extra = null) {
    this._push({
      type: FX_TYPE.SPIN, x, y, range,
      color: color ?? '#ffffff', t: 0, life: 0.3, ...extra,
    });
  }

  beam(x, y, ex, ey, width, color, extra = null) {
    this._push({
      type: FX_TYPE.BEAM, x, y, ex, ey, width,
      color: color ?? '#ffffff', t: 0, life: 0.2, ...extra,
    });
  }

  nova(x, y, radius, color, extra = null) {
    // 第一百三十九轮 C：铃铛音波环的伴飞粒子 —— 金色小音符 / 猫爪印，
    // 渲染端（NOVA case）按各自的扩散进度画在环边缘并随环淡出。
    const notes = [];
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      notes.push({
        a: (i / n) * Math.PI * 2 + Math.random() * 0.8,
        sp: 0.8 + Math.random() * 0.3,
        ch: Math.random() < 0.75 ? '🎵' : '🐾',
        size: 15 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 5,
      });
    }
    this._push({
      type: FX_TYPE.NOVA, x, y, radius, notes,
      color: color ?? '#ffffff', t: 0, life: 0.38, ...extra,
    });
  }

  explosion(x, y, radius, color, extra = null) {
    this._push({
      type: FX_TYPE.EXPLOSION, x, y, radius,
      color: color ?? '#ff9f68', t: 0, life: 0.42, ...extra,
    });
    // 第九轮：爆炸额外甩出碎片，让"炸开"有实体感（碎片继承调用方标记）
    this.shards(x, y, radius, color ?? '#ff9f68', 6, extra);
  }

  chain(points, color, extra = null) {
    this._push({
      type: FX_TYPE.CHAIN, points: points.map((p) => ({ ...p })),
      color: color ?? '#ffe066', t: 0, life: 0.24, ...extra,
    });
  }

  sparkle(x, y, color, count = 1, extra = null) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = 20 + Math.random() * 60;
      this._push({
        type: FX_TYPE.SPARKLE,
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        color: color ?? '#ffffff', t: 0, life: 0.4, size: 2 + Math.random() * 3,
        ...extra,
      });
    }
  }

  // ---- 第二百零一轮：状态特效（点燃火星 / 冰晶雾 / 冰爆）----
  // 复用 SPARKLE（带初速的小圆点）：火星向上飘、冰晶缓缓下沉。
  emberOn(x, y, r, count = 1) {
    for (let i = 0; i < count; i++) {
      this._push({
        type: FX_TYPE.SPARKLE,
        x: x + (Math.random() - 0.5) * r * 1.4, y: y + (Math.random() - 0.2) * r * 0.8,
        vx: (Math.random() - 0.5) * 18, vy: -34 - Math.random() * 34,
        color: Math.random() < 0.4 ? '#ffd166' : '#ff6a2a', t: 0, life: 0.5, size: 2 + Math.random() * 2.2,
      });
    }
  }

  frostOn(x, y, r) {
    this._push({
      type: FX_TYPE.SPARKLE,
      x: x + (Math.random() - 0.5) * r * 1.6, y: y + (Math.random() - 0.5) * r,
      vx: (Math.random() - 0.5) * 12, vy: 10 + Math.random() * 16,
      color: Math.random() < 0.5 ? '#e6f7ff' : '#8fd9f0', t: 0, life: 0.6, size: 1.6 + Math.random() * 2,
    });
  }

  /** 冻结 / 解冻的冰爆：一圈淡蓝碎片 + 白环 */
  iceBurst(x, y, r, small = false) {
    this.shards(x, y, r * 0.9, '#bfeaff', small ? 4 : 7, { player: true });
    this.ring(x, y, r * (small ? 1.1 : 1.4), '#dff6ff', 0.3, { player: true });
  }

  /** 第二百零一轮：喷射雾。一次开火 = 一条特效（内含若干预生成的粒子），渲染端按 t 推进 */
  flame(x, y, angle, range, arcDeg, mode = 'fire', extra = null) {
    const n = MOBILE ? 4 : 8;
    const ps = [];
    const arc = arcDeg * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      ps.push({
        da: (Math.random() - 0.5) * arc * 0.85,
        sp: 0.5 + Math.random() * 0.5,
        sz: 5 + Math.random() * 6,
      });
    }
    this._push({
      type: FX_TYPE.FLAME, x, y, angle, range, mode, ps,
      t: 0, life: 0.3, ...extra,
    });
  }

  hit(x, y, color, extra = null) {
    this._push({
      type: FX_TYPE.HIT, x, y,
      color: color ?? '#ffffff', t: 0, life: 0.16, ...extra,
    });
  }

  // ---------------- 第九轮新增：打击感三件套 ----------------

  /**
   * 近战命中冲击。这是"打击感"最主要的来源。
   *
   * 做法参考格斗游戏的 hit-spark：
   *   - 一圈短促的放射线（星芒），表示"被砸中了"
   *   - 中心一个快速膨胀又消失的白核
   *   - 可选地甩出碎片
   *
   * @param {number} x @param {number} y
   * @param {number} [power] 0~1，越重击越大（暴击/重武器传 1）
   * @param {string} [color]
   * @param {number} [angle] 命中方向，星芒会朝这个方向偏一点
   */
  impact(x, y, power = 0.5, color = '#ffffff', angle = null, extra = null) {
    const p = Math.max(0, Math.min(1, power));
    this._push({
      type: FX_TYPE.IMPACT, x, y, power: p,
      angle: angle ?? Math.random() * TAU,
      rays: 6 + Math.round(p * 6),
      color, t: 0, life: 0.13 + p * 0.09, ...extra,
    });
    // 重击额外给一圈冲击波
    // 第二百轮 A1：AOE 一下砸中十几只时，每个命中各放一圈加色冲击波会叠成一团白。
    // 加 0.12s 冷却，同一时刻只保留一圈。
    if (p > 0.6 && !(this._swCool > 0)) {
      this._swCool = 0.12;
      this.shockwave(x, y, 30 + p * 60, color, 0.34, extra);
    }
  }

  /** 冲击波：一圈又粗又钝的压缩环，配重击/爆炸 */
  shockwave(x, y, radius, color = '#ffffff', life = 0.34, extra = null) {
    this._push({
      type: FX_TYPE.SHOCKWAVE, x, y, radius,
      color, t: 0, life, ...extra,
    });
  }

  /**
   * 碎片：带旋转和轻微重力的碎屑，落地感来源。
   *
   * 第九轮修正：碎片**从半径的一半处出生**，而不是全挤在正中心。
   * 起因是像素探针发现的：爆炸会先画白热核心再画碎片，
   * 而碎片如果都从 (x,y) 出发，在前 1/4 生命里正好糊在核心上，
   * 把最亮的那一下完全盖住（视觉模型因此连续两次说"没有白色核心"，
   * 但量像素时单独画爆炸中心确实是 255,255,255）。
   * 给一个初始外移量，碎片一出生就散开，闪光就露出来了。
   *
   * @param {number} count
   */
  shards(x, y, radius, color = '#ffffff', count = 5, extra = null) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = radius * (0.9 + Math.random() * 1.6);
      const ox = Math.cos(a) * radius * (0.35 + Math.random() * 0.4);
      const oy = Math.sin(a) * radius * (0.35 + Math.random() * 0.4);
      this._push({
        type: FX_TYPE.SHARD,
        x, y, ox, oy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        spin: (Math.random() - 0.5) * 22,
        rot: Math.random() * TAU,
        size: radius * (0.10 + Math.random() * 0.14),
        color, t: 0, life: 0.32 + Math.random() * 0.24, ...extra,
      });
    }
  }

  // 第二百轮 A2：伤害数字可读性。
  // 旧版：同一位置反复命中时数字原地竖直上飘，互相叠成一团看不清。
  // 现在：① 每个数字轮流占 5 个横向槽位 + 随机抖动，向两侧抛物线散开；
  //       ② 字号随数值对数增长（小伤害小字、大伤害大字，暴击再放大）；
  //       ③ 出现瞬间"弹出"放大再回落；④ 文字类提示（MISS/格挡/+N）不放大。
  /** 枪口闪光（第二百轮 A1）：开火瞬间在枪口喷一团锥形火光 */
  muzzle(x, y, angle, color = '#ffffff', size = 1, extra = null) {
    this._push({
      type: FX_TYPE.MUZZLE, x, y, angle, size,
      color, t: 0, life: 0.1, ...extra,
    });
  }

  /**
   * 地裂（第二百轮 A1）：重击落点的放射状裂纹 + 一圈向外推的尘环。
   * 裂纹的随机形状在创建时一次生成（渲染每帧不能重新随机，会抖）。
   */
  cracks(x, y, radius, color = '#ffffff', extra = null) {
    const n = 9 + Math.floor(Math.random() * 3);
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (Math.random() - 0.5) * 0.35;
      const len = radius * (0.55 + Math.random() * 0.5);
      // 每条裂纹 3 段折线，段间有侧向抖动
      const pts = [];
      let px = 0, py = 0;
      for (let s = 1; s <= 3; s++) {
        const aa = a + (Math.random() - 0.5) * 0.5;
        const d = len / 3;
        px += Math.cos(aa) * d; py += Math.sin(aa) * d;
        pts.push([px, py]);
      }
      lines.push(pts);
    }
    this._push({
      type: FX_TYPE.CRACKS, x, y, radius, lines,
      color, t: 0, life: 0.55, ...extra,
    });
    // 尘：沿落点外圈甩几粒碎屑，比单纯圆环更有"砸地"的体积感
    this.shards(x, y, radius * 0.55, color, 5, extra);
  }

  damageText(x, y, value, isCrit = false, color = null) {
    const isNum = typeof value === 'number';
    const n = isNum ? Math.max(0, Math.round(value)) : 0;
    this._dtSlot = ((this._dtSlot ?? 0) + 1) % 5;
    const slot = this._dtSlot - 2;                       // -2..2
    const vx = slot * 16 + (Math.random() - 0.5) * 14;   // 向两侧散开
    // 数值越大字越大：n=10→1.0，n=100→1.25，n=1000→1.5（封顶）
    const mag = isNum ? Math.min(1.5, 0.75 + Math.log10(n + 10) * 0.25) : 1;
    this._push({
      type: FX_TYPE.DAMAGE_TEXT,
      x: x + (Math.random() - 0.5) * 8,
      y: y - 8,
      vx,
      vy: -78 - Math.random() * 26,
      mag,
      text: isNum ? String(n) : String(value),
      isCrit,
      color: color ?? (isCrit ? '#ffc857' : '#ffffff'),
      t: 0, life: isCrit ? 0.9 : 0.72,
    });
  }

  ring(x, y, radius, color, life = 0.5, extra = null) {
    this._push({
      type: FX_TYPE.RING, x, y, radius,
      // 第一百三十九轮 E：破碎虚线圈的随机起角（每圈碎口位置不同）
      seed: Math.random() * Math.PI * 2,
      color: color ?? '#ffffff', t: 0, life, ...extra,
    });
  }
}