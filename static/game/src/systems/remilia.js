// ============================================================
// 蕾米莉亚终演出 —— 超长 boss 连战的中段（第二百零三轮）
//
// 用户："芙兰不是最后有个70秒固定演出吗？最后一张卡是弹幕的心脏，30秒到了的时候芙兰就输了，然后进入万圣节双猫。
//       现在加个30秒到了，蕾米直接飞进来，bgm切蕾米的，然后芙兰从抱腿动画换回飞行动画，两个人一起攻击玩家，
//       并且不只是单纯待在屏幕上半，而是飞来飞去，一个在左一个就在右，一个在上一个就在下。
//       让蕾米芙兰继续无敌演出60秒，然后接上双猫的90秒。来个超长的boss连战好了。
//       这60秒可以自由发挥顺带挑战我们屏幕的弹幕极限，2个人怎么飞，射什么弹，怎么射全部交给你自由发挥。"
//
// 结构：黑屏换场 → 蕾米飞入 + 芙兰从抱腿换成飞行（演出 2.5s）→ 六段符卡 54s → 双人升空退场 3.5s = 60s → 接万圣节双猫。
// 两人都没有 hitbox（纯演出，和万圣节双猫同口径）；弹幕每发 10% 真实伤害，走 Player.remiliaHit。
//
// 素材：remilia-assets/sprites/remilia_00..23.png（24 帧，NC 版 stg6enm2.anm 拆出）
//   00-07 待机浮空 / 08-09 瞬移模糊 / 10-13 施法抬手 / 14-19 咏唱变体 /
//   20-21 纯蝙蝠翼展开（无身体，叠在背后做蓄力）/ 22-23 侧身
// 六段符卡取自蕾米莉亚真·实战卡（ecldata5.ecl，id 103-117）：
//   天罰「スターオブヴァニティーズ」/ 神罰「幼きデーモンロード」/ 冥符「紅色の冥界」/
//   獄符「千本の針の山」/ 紅符「スカーレットシュート」/「レッドマジック」
//   （月符 Silent Selene / 日符 Royal Flare / 賢者の石 是帕秋莉的卡，按要求不用。）
// ============================================================
import { TAU } from '../core/math.js';
import { audio } from './audio.js';
import { RNG } from '../core/rng.js';

// ---- 场地：与万圣节双猫同一块宽屏，连战换场时不会有"场地突然变小"的割裂 ----
export const REMILIA_ARENA = { cx: 0, cy: 40, hw: 640, hh: 330 };

export const REMILIA_INTRO = 2.5;      // 蕾米飞入 + 芙兰起身
export const REMILIA_OUTRO = 3.5;      // 双人升空退场
export const REMILIA_CARDS = 54;       // 六段符卡总时长
export const REMILIA_TOTAL = REMILIA_INTRO + REMILIA_CARDS + REMILIA_OUTRO;   // 60s

// ---- 24 帧分工（见头注）----
export const REMI_IDLE = [0, 1, 2, 3, 4, 5, 6, 7];
export const REMI_BLUR = [8, 9];
export const REMI_CAST = [10, 11, 12, 13];
export const REMI_CHANT = [14, 15, 16, 17, 18, 19];
export const REMI_WING = [20, 21];
export const REMI_SIDE = [22, 23];

// ---- 芙兰的贴图位（沿用敌人贴图表里的 4 个常态帧 + 抱腿帧）----
export const FLAN_FLY = ['flandre', 'flandre_idle2', 'flandre_idle3', 'flandre_idle4'];
export const FLAN_SIT = ['flandre_sit', 'flandre_sit2', 'flandre_sit3'];

/** 六段符卡：每段 { id, name, dur, tick } —— tick 里只发弹/推进节拍，位置统一由 _moveBosses 管 */
const CARDS = [
  {
    id: 'vanity',
    name: '天罰「スターオブヴァニティーズ」',
    dur: 8,
    // 四臂十字，每臂 5 发小组；基础角连续旋转（原作角度变量 +0.2/次 的味道，这里放大一点更好看）
    tick(dt) {
      const st = this.st;
      st.base = (st.base ?? 0) + dt * 0.62;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.95) {
        st.acc -= 0.95;
        const b = this.posOf('remilia');
        for (let arm = 0; arm < 4; arm++) {
          const a0 = st.base + (arm * TAU) / 4;
          for (let i = 0; i < 4; i++) {
            const a = a0 + (i - 1.5) * 0.13;
            this.shot(b.x, b.y, a, 150, {
              color: i % 2 ? '#ff3050' : '#ffe0ea', radius: 7, hitRadius: 5, shape: 'orb', range: 1500,
            });
          }
        }
        audio.play('flandreShot');
      }
      this.flanRing(dt, 1.7, 20, 125, '#ff7f9f', 6);
    },
  },
  {
    id: 'demonlord',
    name: '神罰「幼きデーモンロード」',
    dur: 9,
    // 三束慢速旋转弹列：随机起点角 + 固定角速（0.9 / -0.7 / 1.3 rad/s），速度 30 / 60 / 90
    tick(dt) {
      const st = this.st;
      st.cols = st.cols ?? [
        { a: this.rng.next() * TAU, w: 0.9, spd: 30, col: '#ff3050', r: 6 },
        { a: this.rng.next() * TAU, w: -0.7, spd: 60, col: '#ffb0c8', r: 5 },
        { a: this.rng.next() * TAU, w: 1.3, spd: 90, col: '#ffd9e6', r: 4.5 },
      ];
      for (const c of st.cols) c.a += c.w * dt;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.3) {
        st.acc -= 0.3;
        const b = this.posOf('remilia');
        for (const c of st.cols) {
          for (const off of [-0.05]) {
            const jitter = (this.rng.next() * 2 - 1) * 0.06;
            this.shot(b.x, b.y, c.a + off + jitter, c.spd, { color: c.col, radius: c.r, hitRadius: c.r * 0.62, shape: 'rice', range: 1600 });
          }
        }
      }
      this.flanFan(dt, 0.9, 7, 0.42, 210, '#ff7f9f', 5.5);
      this.flanRing(dt, 3.0, 22, 100, '#ffd166', 5.5);
    },
  },
  {
    id: 'netherworld',
    name: '冥符「紅色の冥界」',
    dur: 9,
    // 双向对旋螺旋：两条从她身侧反向旋转的弹链，速度 108 起、带轻微加速
    tick(dt) {
      const st = this.st;
      st.th = (st.th ?? 0) + dt * 1.5;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.12) {
        st.acc -= 0.12;
        const b = this.posOf('remilia');
        for (const side of [-1, 1]) for (const k of [0, 0.14]) {
          const a = Math.PI / 2 + side * (st.th + k) * 0.62;
          this.shot(b.x + side * 34, b.y, a, 108, {
            color: side < 0 ? '#ff3050' : '#c81e3c', radius: 6, hitRadius: 4.4, shape: 'orb', range: 1700,
            decel: -55, floorSpeed: 210,
          });
        }
      }
      this.flanRing(dt, 1.4, 16, 150, '#ffd166', 5);
    },
  },
  {
    id: 'needle',
    name: '獄符「千本の針の山」',
    dur: 9,
    // 八发一组扇形，扫射角快速左右摆动（±1.9 rad/s），细长针弹
    tick(dt) {
      const st = this.st;
      st.sweep = (st.sweep ?? -0.9) + dt * 1.9 * (st.dir ?? 1);
      if (st.sweep > 0.9) { st.sweep = 0.9; st.dir = -1; }
      if (st.sweep < -0.9) { st.sweep = -0.9; st.dir = 1; }
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.26) {
        st.acc -= 0.26;
        const b = this.posOf('remilia');
        const base = Math.PI / 2 + st.sweep;
        for (let i = 0; i < 9; i++) {
          const a = base + (i - 4) * 0.11;
          this.shot(b.x, b.y, a, 205, { color: i % 2 ? '#ff3050' : '#ffb0c8', radius: 5.4, hitRadius: 3.6, shape: 'blade', range: 1700 });
        }
        audio.play('flandreShot');
      }
      this.flanFan(dt, 1.2, 7, 0.3, 230, '#ffd9e6', 5);
    },
  },
  {
    id: 'shoot',
    name: '紅符「スカーレットシュート」',
    dur: 9,
    // 九发高速直视连发（原作 6.2px/帧 ≈ 372px/s），每 0.85 秒一次齐射，越到后面越密
    tick(dt, T) {
      const st = this.st;
      const period = T > 5 ? 0.55 : 0.85;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= period) {
        st.acc -= period;
        const b = this.posOf('remilia');
        const p = this.main.player;
        const aim = Math.atan2(p.y - b.y, p.x - b.x);
        for (let i = 0; i < 11; i++) {
          const a = aim + (i - 5) * 0.05;
          this.shot(b.x, b.y, a, 372, { color: '#ff3050', radius: 6, hitRadius: 4.2, shape: 'orb', range: 1900 });
        }
        // 齐射同时甩一圈慢环，逼人保持移动
        const rb = this.rng.next() * TAU;
        for (let i = 0; i < 12; i++) this.shot(b.x, b.y, rb + (i * TAU) / 12, 130, { color: '#ffb0c8', radius: 5.5, hitRadius: 3.6, range: 1700 });
        audio.play('flandreShot');
      }
      this.flanFan(dt, 0.95, 5, 0.26, 260, '#ff7f9f', 5.5);
    },
  },
  {
    id: 'redmagic',
    name: '「レッドマジック」',
    dur: 10,
    // 最终奥义：旋转五臂大环 + 从场地外向内收束的红环 + 芙兰的星形波前，收尾全屏一红
    tick(dt, T) {
      const st = this.st;
      st.base = (st.base ?? 0) + dt * 0.85;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.7) {
        st.acc -= 0.7;
        const b = this.posOf('remilia');
        for (let arm = 0; arm < 5; arm++) {
          const a0 = st.base + (arm * TAU) / 6;
          for (let i = 0; i < 4; i++) {
            const a = a0 + (i - 1.5) * 0.08;
            this.shot(b.x, b.y, a, 175, { color: i % 2 ? '#ff3050' : '#ffd9e6', radius: 7, hitRadius: 5, shape: 'orb', range: 1800 });
          }
        }
      }
      st.in = (st.in ?? 0) + dt;
      if (st.in >= 2.1) {
        st.in -= 2.1;
        const b = this.posOf('remilia');
        const n = 24, base = this.rng.next() * TAU;
        for (let i = 0; i < n; i++) {
          const a = base + (i * TAU) / n;
          const R = 720;
          // 从场地外朝圆心收束（视觉上是"红雾从四周压进来"）
          this.shot(b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI, 150, {
            color: '#c81e3c', radius: 6.5, hitRadius: 4.6, shape: 'rice', range: 1100,
          });
        }
      }
      this.flanStar(dt, 1.3, '#ffd166');
      this.flanRing(dt, 1.8, 18, 170, '#ff7f9f', 5.5);
    },
  },
];

export class RemiliaFight {
  /**
   * @param main 游戏实例（读 world/player/camera/fx）
   * @param opts { chain?:boolean, onDone?(outcome), test?:number }
   */
  constructor(main, opts = {}) {
    this.main = main;
    this.onDone = opts.onDone || (() => {});
    this.over = false;
    this.outcome = null;
    this.timeScale = 1;
    this.t = -(opts.chain ? 3 : 1.2);     // 负值 = 黑屏换场（与万圣节同口径）
    this.rng = main?.world?.rng?.fork?.(0x5e9e77e) ?? new RNG(0x5e9e77e);

    this.arena = REMILIA_ARENA;
    // 两人各占一个位置：蕾米 = 主角，芙兰 = 对角（一左一右、一上一下）
    this.b = {
      remilia: { x: REMILIA_ARENA.cx + 520, y: REMILIA_ARENA.cy - 420, frame: 0, ft: 0, cast: 0, alpha: 0, wing: 0, side: 1 },
      flandre: { x: REMILIA_ARENA.cx - 520, y: REMILIA_ARENA.cy + 180, spriteId: FLAN_SIT[0], ft: 0, alpha: 1, wing: 0, side: -1, rising: 0 },
    };
    this.orbit = 0;
    this.orbitSpeed = 0.55;
    this.cardIdx = -1;
    this.cardT = 0;
    this.st = {};
    this.cutin = 0;          // cut-in 立绘余时（秒）
    this.flash = 0;          // 全屏白/红闪
    this.shake = 0;
    this.splits = [];        // 蝙蝠群演出粒子（纯视觉，渲染层画）
    this.timeLeft = REMILIA_TOTAL;
    this.bgmOn = false;
    this._buildBats();
    if (opts.test) this.t = Math.max(this.t, 0.01);
  }

  /** 蝙蝠群：绕场飞的小黑影（纯视觉，不判定） */
  _buildBats() {
    this.bats = [];
    for (let i = 0; i < 26; i++) {
      this.bats.push({
        a: this.rng.next() * TAU,
        r: 0.45 + this.rng.next() * 0.75,
        spd: 0.35 + this.rng.next() * 0.75,
        ph: this.rng.next() * TAU,
        s: 0.55 + this.rng.next() * 0.7,
      });
    }
  }

  // ---------------------------------------------------------------
  get phase() {
    if (this.t < 0) return 'blackout';
    if (this.t < REMILIA_INTRO) return 'intro';
    if (this.t < REMILIA_INTRO + REMILIA_CARDS) return 'cards';
    return 'outro';
  }

  /** 当前段（0..5），intro 时是 -1 */
  get card() { return this.cardIdx; }

  /** 某个角色的世界坐标 */
  posOf(who) { return this.b[who] ?? this.b.remilia; }

  /**
   * 双人镜像走位：
   * 蕾米在椭圆上按 this.orbit 取点，芙兰取对角（+π）—— 天然满足"一个在左另一个就在右、一个在上另一个就在下"。
   * 再叠一点的垂直呼吸，让两人像在"飞"而不是沿轨道滑。
   */
  _moveBosses(dt) {
    const A = this.arena;
    const ph = this.phase;
    if (ph === 'blackout') return;
    const R = this.b.remilia, F = this.b.flandre;
    // 段落推进：越到后面转得越快、半径越大（压迫感递增）
    const prog = ph === 'cards' ? Math.min(1, Math.max(0, (this.t - REMILIA_INTRO) / REMILIA_CARDS)) : 0;
    this.orbitSpeed = 0.5 + prog * 0.55;
    this.orbit += dt * this.orbitSpeed;
    const rx = A.hw * (0.6 + prog * 0.09);
    const ry = A.hh * (0.52 + prog * 0.07);

    let tx, ty, fx, fy;
    if (ph === 'intro') {
      // 蕾米从右上飞入；芙兰原地起身
      const u = Math.min(1, Math.max(0, this.t / REMILIA_INTRO));
      const e = 1 - (1 - u) * (1 - u);
      tx = A.cx + (1 - e) * 640;
      ty = A.cy - 300 - (1 - e) * 260;
      fx = A.cx - 300;
      fy = A.cy + 130;
      R.alpha = Math.min(1, u * 1.6);
      F.rising = u;
    } else if (ph === 'outro') {
      const u = Math.min(1, Math.max(0, (this.t - REMILIA_INTRO - REMILIA_CARDS) / REMILIA_OUTRO));
      tx = R.x; ty = R.y - u * u * 620;
      fx = F.x; fy = F.y - u * u * 720;
      R.alpha = 1 - u * 0.85;
      F.alpha = 1 - u * 0.85;
    } else {
      tx = A.cx + Math.cos(this.orbit) * rx;
      ty = A.cy + Math.sin(this.orbit) * ry * 0.62 - 40 + Math.sin(this.orbit * 2.1) * 26;
      fx = A.cx + Math.cos(this.orbit + Math.PI) * rx;
      fy = A.cy + Math.sin(this.orbit + Math.PI) * ry * 0.62 - 40 + Math.sin(this.orbit * 2.1 + Math.PI) * 26;
      // 正戏两人必须完全不透明（alpha 初值 0 是给飞入渐显用的；只在 intro 里置 1 的话，
      // 任何跳过 intro 的路径——测试直接改 t、读档、调试——都会让蕾米一直隐形）
      R.alpha = 1;
      F.alpha = 1;
    }
    // 平滑跟随（飞的感觉，不是瞬移）；intro 段蕾米自己从外面飞进来，别被 lerp 拉回
    const k = ph === 'intro' ? 1 : Math.min(1, dt * 3.2);
    R.x += (tx - R.x) * k;
    R.y += (ty - R.y) * k;
    F.x += (fx - F.x) * (ph === 'intro' ? Math.min(1, dt * 2.2) : k);
    F.y += (fy - F.y) * (ph === 'intro' ? Math.min(1, dt * 2.2) : k);

    // 帧动画：施法段用施法帧，其余待机；cut-in 期间用咏唱
    R.ft += dt;
    const casting = ph === 'cards';
    const pool = this.cutin > 0 ? REMI_CHANT : casting ? REMI_CAST : REMI_IDLE;
    R.frame = pool[Math.floor(R.ft / 0.11) % pool.length];
    // 蓄力时背后的纯蝙蝠翼（20/21）+ 呼吸
    R.wing = ph === 'cards' ? 0.55 + 0.45 * Math.sin(this.t * 2.4) : 0.25;
    // 芙兰：intro 前半还是抱腿，后半起身换飞行帧
    F.ft += dt;
    const fly = ph !== 'intro' || F.rising > 0.55;
    const fpool = fly ? FLAN_FLY : FLAN_SIT;
    F.spriteId = fpool[Math.floor(F.ft / (fly ? 0.24 : 0.3)) % fpool.length];
    F.wing = fly ? 0.6 + 0.4 * Math.sin(this.t * 2.8 + 1) : 0.2;
  }

  // ---------------------------------------------------------------
  // 发弹原语
  // ---------------------------------------------------------------
  shot(x, y, angle, speed, opts = {}) {
    const w = this.main?.world;
    if (!w) return null;
    // 弹量硬顶：与芙兰战同一预算（桌面 1200 / 自动降档见 FlandreFight._adaptCap；这里取常量上限）
    if (w.enemyBullets.items.length >= 1100) return null;
    return w.spawnEnemyBullet({
      x, y, angle, speed,
      damage: 0,
      radius: opts.radius ?? 6,
      hitRadius: opts.hitRadius ?? (opts.radius ?? 6) * 0.62,
      color: opts.color ?? '#ff3050',
      range: opts.range ?? 1600,
      shape: opts.shape ?? 'orb',
      decel: opts.decel ?? 0,
      floorSpeed: opts.floorSpeed ?? 0,
      remilia: true,
    });
  }

  /** 芙兰的环形弹（从她自己的位置放） */
  flanRing(dt, period, n, speed, color, r) {
    const st = this.st;
    st.fr = (st.fr ?? 0) + dt;
    if (st.fr < period) return;
    st.fr -= period;
    const b = this.posOf('flandre');
    const base = this.rng.next() * TAU;
    for (let i = 0; i < n; i++) this.shot(b.x, b.y, base + (i * TAU) / n, speed, { color, radius: r, hitRadius: r * 0.6, range: 1700 });
  }

  /** 芙兰的瞄准扇 */
  flanFan(dt, period, n, spread, speed, color, r) {
    const st = this.st;
    st.ff = (st.ff ?? 0) + dt;
    if (st.ff < period) return;
    st.ff -= period;
    const b = this.posOf('flandre');
    const p = this.main.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * (spread / Math.max(1, n - 1));
      this.shot(b.x, b.y, a, speed, { color, radius: r, hitRadius: r * 0.6, shape: 'rice', range: 1800 });
    }
  }

  /** 芙兰的星形波前（五角星轮廓，带星门缺口 —— 她的禁弹签名） */
  flanStar(dt, period, color) {
    const st = this.st;
    st.fs = (st.fs ?? 0) + dt;
    if (st.fs < period) return;
    st.fs -= period;
    const b = this.posOf('flandre');
    const p = this.main.player;
    const rot = this.rng.next() * TAU;
    const NB = 44;
    const towards = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < NB; i++) {
      const th = rot + (i * TAU) / NB;
      let d = th - towards;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < 0.28) continue;          // 星门：留一条可钻的缝
      this.shot(b.x, b.y, th, 165, { color, radius: 5.6, hitRadius: 3.4, shape: 'star', range: 1900 });
    }
  }

  // ---------------------------------------------------------------
  update(dtReal) {
    if (this.over) return;
    const dt = dtReal * this.timeScale;
    const before = this.t;
    this.t += dt;
    if (this.t < 0) return;      // 黑屏换场期间只走计时

    if (!this.bgmOn) {
      this.bgmOn = true;
      // 用户："bgm切蕾米的" —— 亡き王女の為のセプテット
      audio.playScene?.('remilia');
    }

    // 视觉衰减
    this.cutin = Math.max(0, this.cutin - dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 2.4);

    this._moveBosses(dt);

    // 段落推进
    if (this.phase === 'cards') {
      const rel = this.t - REMILIA_INTRO;
      let acc = 0, idx = 0;
      for (let i = 0; i < CARDS.length; i++) {
        if (rel < acc + CARDS[i].dur) { idx = i; break; }
        acc += CARDS[i].dur;
        idx = i;
      }
      if (idx !== this.cardIdx) {
        this.cardIdx = idx;
        this.st = {};                        // 每段独立状态
        this.cutin = 0.62;                   // cut-in 立绘闪一下
        this.flash = 0.3;
        this.shake = 1;
        audio.play('spellCard');
      }
      const c = CARDS[idx];
      this.cardT = rel - acc;
      try { c.tick.call(this, dt, this.cardT); } catch { /* 单段异常不影响整场 */ }
      this.timeLeft = Math.max(0, REMILIA_TOTAL - this.t);
    } else if (this.phase === 'intro') {
      this.timeLeft = REMILIA_TOTAL - this.t;
    } else if (this.phase === 'outro') {
      this.timeLeft = 0;
      if (this.t >= REMILIA_TOTAL) this.finish('done');
    }

    // 蝙蝠群
    for (const bt of this.bats) bt.a += dt * bt.spd;

    // 玩家全灭 → 演出结束（挑战失败，回商店整备）
    const team = this.main?.world?.players?.() ?? [this.main?.player];
    // 注意是 pl.downed（倒地**属性**）—— pl.down 是方法，恒为真，会把每帧都判成团灭。
    if (team.every((pl) => !pl || pl.dead || pl.downed) && this.t > REMILIA_INTRO) {
      this.finish('death');
    }
    void before;
  }

  finish(outcome) {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    try { this.onDone(outcome); } catch { /* 结算异常不影响主循环 */ }
  }

  /** 供渲染层：当前段的卡名与进度 */
  get cardInfo() {
    if (this.cardIdx < 0) return { name: '', idx: 0, n: CARDS.length };
    return { name: CARDS[this.cardIdx].name, idx: this.cardIdx, n: CARDS.length };
  }
}

export const REMILIA_CARDS_INFO = CARDS.map((c) => ({ id: c.id, name: c.name, dur: c.dur }));
