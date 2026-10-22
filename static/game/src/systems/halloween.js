// 第四十九轮同款精神续作 —— 第一百八十四轮：万圣节双猫（巧克力 & 香草）
// 素材与弹幕规格来自 Rabi-Ribi 万圣节 DLC 拆包（隔壁会话 Ghidra 逆向 +
// ASSET-GUIDE）：30+30 张切帧（choco_h / vanilla_h）、bgm13.ogg（
// Mischievous Masquerade）、hill_a 秋山背景。
//
// 设计（用户逐条拍板）：
//  · 纯演出 boss：排在芙兰后面出场，芙兰撤场 3 秒黑屏换背景，场景变亮
//    后放 BGM。她们没有 hitbox、不进敌人索敌列表，玩家武器打不到
//    —— "打也是到点，不打也是到点"，演完即胜。
//  · 伪横版：原版是宽屏，场地用宽矩形不画正方形；玩家的"只有头"猫娘
//    在横版背景前走位毫无违和。
//  · 弹幕伤害：每发 10% 真伤（无视护甲），战斗期间回血无效 —— 用户：
//    "做成每发弹幕10%真伤不给回血和护甲看看"。
//  · 时长：全部招式演完 ≈100 秒，不设固定秒数，演完离场即胜。
//  · 原版弹速单位是 px/帧@60fps —— 全部 ×60 换成 px/s（RECON-SPEC）。
import { TAU } from '../core/math.js';
import { audio } from './audio.js';
import { CHOCO_FRAMES, VANILLA_FRAMES } from './halloween-frames.js';

// ---- 场地（宽屏，用户："移动场地可以大点，原版就是宽屏，我们不用画正方形限制"）----
export const ARENA = { cx: 0, cy: 40, hw: 640, hh: 330 };
// 双猫悬浮位（屏幕上半部，左右对称；y 基线 + Math.sin 浮动在 draw/update 里加）
export const CAT_Y = ARENA.cy - ARENA.hh + 120;
export const CAT_X_OFF = 270;

// 弹速换算：原版 px/帧 @60fps → px/s
const V = (framesPerPx) => framesPerPx * 60;

// 每发弹幕真伤 = 玩家 maxHp × 10%（用户拍板的测试口径）
export const HALLOWEEN_HIT_FRAC = 0.10;
export const HALLOWEEN_HIT_INVULN = 0.8;

// ---- 帧图懒加载（芙兰背景同款模式：失败静默，绝不阻塞）----
// 行映射（ASSET-GUIDE 启发式，线性编号 = 精灵表行优先）：
//   0-9 待机循环 / 10-20 施法+攻击 / 21-24 小动作 / 25-27 终结技 / 28-29 出场
const IDLE_F = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const CAST_F = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const FINISH_F = [25, 26, 27];
const IMG = {};
function loadFrames() {
  for (const [key, prefix] of [['choco', 'choco_h'], ['vanilla', 'vanilla_h']]) {
    for (let i = 0; i < 30; i++) {
      const id = `${key}_${i}`;
      if (IMG[id]) continue;
      try {
        const img = new Image();
        img.src = `assets/boss/halloween/${prefix}_${String(i).padStart(2, '0')}.png`;
        IMG[id] = img;   // 加载失败 onerror 时 naturalWidth === 0，draw 跳过走占位
      } catch { /* 忽略 */ }
    }
  }
}
loadFrames();

export class HalloweenFight {
  static ARENA = ARENA;
  constructor(main, opts = {}) {
    this.main = main;
    this.onDone = opts.onDone || (() => {});
    this.over = false;
    this.t = -(opts.chain ? 3 : 1.2);   // 黑屏换场 3 秒（芙兰衔接）/ 测试直入 1.2 秒
    this.timeScale = 1;
    this.outcome = null;
    // 双猫演出状态
    this.cats = {
      choco: { x: ARENA.cx - CAT_X_OFF, y: CAT_Y, cast: 0, frame: 0, ft: 0 },
      vanilla: { x: ARENA.cx + CAT_X_OFF, y: CAT_Y + 26, cast: 0, frame: 0, ft: 0 },
    };
    this.merged = true;          // 开场"合并猫"，第 5 节分裂成双猫
    this.splitFx = 0;
    this.phaseIdx = 0;           // 当前 section 下标
    this.phaseT = 0;             // section 内局部时间
    this._emit = 0;              // 通用发射计时器
    this._alt = 0;               // 双猫交替旗
    this._orbit = 0;             // 激光旋转角
    this.waves = [];             // 激光束（{x,y,angle,rot,t,life,who}）
    this.pumpkins = [];          // 南瓜（投影点 + 落地计时）
    this.timeLeft = 0;           // UI 显示：剩余演出秒数
    this._buildTimeline();
  }

  /** 演出时间轴 —— 每节 {name, dur, tick(dt, T)}，顺序执行，跑完 outro 即胜 */
  _buildTimeline() {
    this.sections = [
      { name: 'intro', dur: 4.5, tick: (dt) => this._tickIntro(dt) },
      { name: 'ring', dur: 6, tick: (dt) => this._tickRing(dt) },
      { name: 'fan', dur: 7, tick: (dt, T) => this._tickFan(dt, T) },
      { name: 'wall', dur: 6, tick: (dt) => this._tickWall(dt) },
      { name: 'pumpkin', dur: 8, tick: (dt) => this._tickPumpkin(dt) },
      { name: 'split', dur: 6, tick: (dt) => this._tickSplit(dt) },
      { name: 'alt_ring', dur: 10, tick: (dt) => this._tickAltRing(dt) },
      { name: 'laser', dur: 10, tick: (dt) => this._tickLaser(dt) },
      { name: 'claw', dur: 7, tick: (dt) => this._tickClaw(dt) },
      { name: 'candy', dur: 7, tick: (dt) => this._tickCandy(dt) },
      { name: 'rage', dur: 12, tick: (dt) => this._tickRage(dt) },
    ];
    this.totalShow = this.sections.reduce((a, s) => a + s.dur, 0) + 5;   // + outro
    this.timeLeft = this.totalShow;
  }

  get phase() { return this.phaseIdx >= 6 ? 3 : this.phaseIdx >= 2 ? 2 : 1; }

  /** 当前双猫的演出位置（分裂前重叠居中） */
  _catPos(who) {
    if (!this.merged) return this.cats[who];
    return { x: ARENA.cx, y: CAT_Y + 10 };
  }

  // ---- 弹幕发射：全部走 world.spawnEnemyBullet，halloween 标记走 10% 真伤 ----
  _shot(x, y, angle, speedPxFrame, opts = {}) {
    const w = this.main.world;
    if (w.enemyBullets.items.length > 650) return;   // 弹幕上限（芙兰 750 同级）
    w.spawnEnemyBullet({
      x, y, angle, speed: V(speedPxFrame),
      damage: 0,                       // 伤害走 halloweenHit 真伤通道，damage 不用
      radius: opts.radius ?? 7,
      color: opts.color ?? '#ff9f43',
      range: opts.range ?? 900,
      shape: opts.shape ?? 'orb',
      halloween: true,
    });
  }

  _catShot(who, angle, speed, opts) {
    const p = this._catPos(who);
    this._shot(p.x, p.y + 20, angle, speed, opts);
  }

  /** 环形弹：起始角随机，N 发均分（RECON-SPEC：RandomInt(0,359)、angle = base + i*360/N） */
  _ring(who, n, speed, color) {
    const base = Math.floor(Math.random() * 360) * Math.PI / 180;
    for (let i = 0; i < n; i++) this._catShot(who, base + (i * TAU / n), speed, { color });
  }

  /** 三重对称扇：X 偏移 ±48/±96/±144 三对（RECON-SPEC 原值），向下扇 */
  _fan(who) {
    const px = this._catPos(who);
    for (const off of [-144, -96, -48, 48, 96, 144]) {
      const x = px.x + off;
      const dy = ARENA.cy + ARENA.hh - px.y;
      this._shot(x, px.y + 20, Math.atan2(dy, 0) + off * 0.0006, 2.0, { color: '#e056fd' });
    }
  }

  /** 直线弹墙：沿角度 56.16px/步 × 18.52 步，4 波 × 2 发（RECON-SPEC） */
  _wall(who, angle) {
    const px = this._catPos(who);
    const step = 56.16, steps = 18;
    for (let wv = 0; wv < 4; wv++) {
      setTimeout(() => {
        if (this.over) return;
        for (const perp of [-1, 1]) {
          const a = angle + perp * Math.PI / 2;
          for (let i = -steps / 2; i <= steps / 2; i++) {
            const sx = px.x + Math.cos(a) * step * i, sy = px.y + Math.sin(a) * step * i;
            if (Math.abs(sx - ARENA.cx) < ARENA.hw + 60 && Math.abs(sy - ARENA.cy) < ARENA.hh + 60) {
              this._shot(sx, sy, angle, 2.2, { color: '#fd79a8', shape: 'longball' });
            }
          }
        }
      }, wv * 550);
    }
  }

  /** 南瓜炸弹：抛物线落点 → 十字爆风（伪横版灵魂：下落可预判，横走可躲） */
  _pumpkin() {
    const x = ARENA.cx + (Math.random() * 2 - 1) * (ARENA.hw - 80);
    const y = ARENA.cy + (Math.random() * 2 - 1) * (ARENA.hh - 70);
    this.pumpkins.push({ x, y, t: 1.1, boom: 0 });
  }

  // ============================================================
  // 时间轴各节
  // ============================================================
  _tickIntro(dt) {
    // 登场：合并猫浮现（画层做 alpha 渐入），偶尔丢一颗环形弹当预告
    this._emit += dt;
    if (this._emit > 1.4) { this._emit = 0; this._ring('choco', 8, 2.4, '#ffa502'); }
  }

  _tickRing(dt) {
    this._emit += dt;
    if (this._emit > 1.15) { this._emit = 0; this._ring('choco', 12 + this.phase * 2, 3.0, '#ffa502'); }
  }

  _tickFan(dt) {
    this._emit += dt;
    if (this._emit > 1.05) {
      this._emit = 0;
      this._fan(this._alt % 2 ? 'vanilla' : 'choco');
      this._alt++;
    }
  }

  _tickWall(dt) {
    this._emit += dt;
    if (this._emit > 2.4) {
      this._emit = 0;
      const a = (Math.random() < 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.3;
      this._wall(this._alt % 2 ? 'vanilla' : 'choco', a);
      this._alt++;
    }
  }

  _tickPumpkin(dt) {
    this._emit += dt;
    if (this._emit > 0.55) { this._emit = 0; this._pumpkin(); }
  }

  _tickSplit(dt) {
    // 分裂演出：前 2.5s 合并猫闪烁蓄力 → 拆成双猫（保留原版 25% HP 拆分
    // 的结构神韵，改成纯演出节点 —— 用户拍板纯演出不打血）
    if (this.merged && this.phaseT > 2.5) {
      this.merged = false;
      this.splitFx = 0.6;
      try { audio.play?.('bossKill'); } catch { /* */ }
    }
  }

  _tickAltRing(dt) {
    this._emit += dt;
    if (this._emit > 1.0) {
      this._emit = 0;
      this._ring(this._alt % 2 ? 'vanilla' : 'choco', 14, 3.2, this._alt % 2 ? '#7efff5' : '#ff9f43');
      this._alt++;
    }
  }

  _tickLaser(dt) {
    // 双猫旋转扫射激光：每束绕自身缓慢旋转，持续扫过场地（玩家找角速度差）
    this._emit += dt;
    if (this._emit > 2.2) {
      this._emit = 0;
      const who = this._alt % 2 ? 'vanilla' : 'choco';
      this.waves.push({ ...this._catPos(who), angle: Math.random() * TAU, rot: (Math.random() < 0.5 ? 1 : -1) * 0.9, t: 3.4, life: 3.4, who });
      this._alt++;
      try { audio.play?.('flandreLaser'); } catch { /* */ }
    }
    for (const b of this.waves) {
      b.angle += b.rot * dt;
      // 激光伤害走 halloweenHit 同款 10% 真伤：判定 = 玩家到射线垂距
      for (const pl of this.main.world.players()) {
        if (!pl || pl.dead || pl.downed || pl.invuln > 0 || pl.halloweenHit == null) continue;
        const dx = pl.x - b.x, dy = pl.y - b.y;
        const proj = dx * Math.cos(b.angle) + dy * Math.sin(b.angle);
        if (proj <= 0) continue;
        const perp = Math.abs(-dx * Math.sin(b.angle) + dy * Math.cos(b.angle));
        if (perp < 26) pl.halloweenHit(b.x, b.y);
      }
    }
    this.waves = this.waves.filter((b) => (b.t -= dt) > 0);
  }

  _tickClaw(dt) {
    // 追踪猫爪：慢速追踪弹（转向速率有限，走位拉扯可以甩掉）
    this._emit += dt;
    if (this._emit > 1.2) {
      this._emit = 0;
      const who = this._alt % 2 ? 'vanilla' : 'choco';
      const px = this._catPos(who);
      const target = this.main.world.players().find((pl) => pl && !pl.dead && !pl.downed);
      if (target) {
        const base = Math.atan2(target.y - px.y, target.x - px.x);
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.35;
          const b = { x: px.x, y: px.y + 20, vx: Math.cos(a) * V(1.1), vy: Math.sin(a) * V(1.1), t: 6, life: 6 };
          (this._claws ??= []).push(b);
        }
      }
      this._alt++;
    }
    for (const c of (this._claws ?? [])) {
      const target = this.main.world.players().find((pl) => pl && !pl.dead && !pl.downed);
      if (target) {
        const want = Math.atan2(target.y - c.y, target.x - c.x);
        const cur = Math.atan2(c.vy, c.vx);
        let da = want - cur;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const turn = Math.max(-2.2 * dt, Math.min(2.2 * dt, da));   // 转向速率上限
        const sp = Math.hypot(c.vx, c.vy);
        const na = cur + turn;
        c.vx = Math.cos(na) * sp; c.vy = Math.sin(na) * sp;
      }
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.t -= dt;
      if (Math.random() < 0.55) this._shot(c.x, c.y, Math.random() * TAU, 0.4, { color: '#c8a2ff', radius: 5 });
    }
    this._claws = (this._claws ?? []).filter((c) => c.t > 0
      && Math.abs(c.x - ARENA.cx) < ARENA.hw + 80 && Math.abs(c.y - ARENA.cy) < ARENA.hh + 80);
  }

  _tickCandy(dt) {
    // 糖果雨：随机落下，落地弹跳两下（垂直速度 ×-0.55，水平保留）
    this._emit += dt;
    if (this._emit > 0.3) {
      this._emit = 0;
      const x = ARENA.cx + (Math.random() * 2 - 1) * (ARENA.hw - 40);
      this._candies ??= [];
      this._candies.push({ x, y: ARENA.cy - ARENA.hh - 20, vx: (Math.random() - 0.5) * 160, vy: 60, bounces: 2, t: 7, color: ['#ff6b6b', '#feca57', '#1dd1a1', '#54a0ff'][(Math.random() * 4) | 0] });
    }
    const floor = ARENA.cy + ARENA.hh;
    for (const c of (this._candies ?? [])) {
      c.vy += 900 * dt;   // 伪横版重力
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.y > floor && c.bounces > 0) {
        c.y = floor; c.vy = -c.vy * 0.55; c.bounces--;
      }
      if (c.y > floor && c.bounces <= 0) {
        // 落定炸开 4 向小弹
        for (let i = 0; i < 4; i++) this._shot(c.x, c.y, i * Math.PI / 2 + Math.PI / 4, 2.0, { color: c.color, radius: 5 });
        c.t = 0;
      }
      c.t -= dt;
    }
    this._candies = (this._candies ?? []).filter((c) => c.t > 0);
  }

  _tickRage(dt) {
    // 狂暴合奏：环形 + 扇 + 南瓜雨三线叠加，1.3× 节奏（BGM 高潮对齐这里）
    this._emit += dt;
    const k = 1 / 1.3;
    if (this._emit > 1.15 * k) { this._emit = 0; this._ring(this._alt % 2 ? 'vanilla' : 'choco', 18, 3.6, '#ff4757'); this._alt++; }
    this._fanT = (this._fanT ?? 0) + dt;
    if (this._fanT > 1.4 * k) { this._fanT = 0; this._fan('choco'); this._fan('vanilla'); }
    this._pkT = (this._pkT ?? 0) + dt;
    if (this._pkT > 0.7 * k) { this._pkT = 0; this._pumpkin(); }
  }

  // ============================================================
  update(dtReal) {
    if (this.over) return;
    const dt = dtReal * this.timeScale;
    this.t += dt;

    // 黑屏换场：t<0 期间只走计时（渲染层按 t 画黑幕），t 过 0 的瞬间
    // 场景变亮 + BGM 起（用户："bgm也是场景变亮之后放"）
    if (this.t < 0) return;
    if (!this._bgmOn) {
      this._bgmOn = true;
      try { audio.playScene?.('halloween'); } catch { /* */ }
    }

    // 南瓜落地/爆风
    for (const pk of this.pumpkins) {
      if (pk.t > 0) {
        pk.t -= dt;
        if (pk.t <= 0) {
          pk.boom = 0.35;
          for (let i = 0; i < 4; i++) {
            this._shot(pk.x, pk.y, i * Math.PI / 2, 3.0, { color: '#ff7f50', radius: 8, range: 420 });
          }
        }
      } else if (pk.boom > 0) {
        pk.boom -= dt;
        // 爆风持续判定：十字线附近 30px 内的玩家吃 10% 真伤
        for (const pl of this.main.world.players()) {
          if (!pl || pl.dead || pl.downed || pl.invuln > 0 || pl.halloweenHit == null) continue;
          const dx = pl.x - pk.x, dy = pl.y - pk.y;
          if ((Math.abs(dx) < 30 || Math.abs(dy) < 30) && Math.hypot(dx, dy) < 210) pl.halloweenHit(pk.x, pk.y);
        }
      }
    }
    this.pumpkins = this.pumpkins.filter((pk) => pk.t > 0 || pk.boom > 0);

    // 时间轴推进
    if (this.phaseIdx < this.sections.length) {
      const sec = this.sections[this.phaseIdx];
      const step = Math.min(dt, sec.dur - this.phaseT);
      sec.tick.call(this, dt, this.t);
      this.phaseT += step;
      if (this.phaseT >= sec.dur) { this.phaseIdx++; this.phaseT = 0; this._emit = 0; }
      this.timeLeft = Math.max(0, this.totalShow - this.t);
    } else {
      // outro：收招挥手 → 飞向月亮离场 → 胜利
      this.outroT = (this.outroT ?? 0) + dt;
      this.cats.choco.y = CAT_Y - this.outroT * 130;
      this.cats.vanilla.y = CAT_Y + 26 - this.outroT * 150;
      this.cats.choco.x += 60 * dt; this.cats.vanilla.x += 90 * dt;
      if (this.outroT > 4.2) this.finish('beat');
      return;
    }

    // 帧动画推进（待机/施法循环；狂暴期固定攻击帧）
    for (const who of ['choco', 'vanilla']) {
      const c = this.cats[who];
      c.ft += dt;
      const casting = this.phaseIdx >= 1;
      const frames = casting && this.phaseIdx >= 10 ? CAST_F : casting ? [10, 11, 12, 13] : IDLE_F;
      if (c.ft > 0.14) { c.ft = 0; c.frame = frames[(frames.indexOf(c.frame) + 1) % frames.length] ?? frames[0]; }
    }

    // 玩家全队失去战斗力 → 战败
    const team = this.main.world?.players?.() ?? [this.main.player];
    if (team.every((pl) => !pl || pl.dead || pl.downed)) { this.finish('death'); }

    // 素材加载诊断（v0.3.88 热修：用户实测"没素材，默认几何猫" ——
    // 60 帧切图若有 404/被代理拦截，开战 5 秒后把失败数直接报出来，
    // 一眼定位是静态资源问题还是代码问题）
    this._assetCheckT = (this._assetCheckT ?? 0) + dt;
    if (this._assetCheckT > 5 && !this._assetChecked) {
      this._assetChecked = true;
      let ok = 0;
      for (let i = 0; i < 30; i++) {
        for (const k of ['choco', 'vanilla']) {
          const img = IMG[`${k}_${i}`];
          if (img && img.complete && img.naturalWidth > 0) ok++;
        }
      }
      if (ok < 60) {
        console.warn(`[halloween] 素材只加载 ${ok}/60 —— 检查 assets/boss/halloween/ 是否同步`);
        try { this.main.ui.toast(`万圣节素材缺失（${ok}/60）——请 Ctrl+F5 强刷或检查 assets 同步`, 'bad', 8000); } catch { /* */ }
      }
    }
  }

  finish(outcome) {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    try { audio.stopMusic(); } catch { /* */ }
    this.onDone(outcome);
  }

  /** 立绘帧图片（渲染层用） */
  frameImg(who, frame) {
    const img = IMG[`${who}_${frame}`];
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  frames(who) { return who === 'choco' ? CHOCO_FRAMES : VANILLA_FRAMES; }
}
