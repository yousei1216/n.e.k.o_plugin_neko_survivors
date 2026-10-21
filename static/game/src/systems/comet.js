// ============================================================
// comet.js — 天彗龙乱入（第一百八十轮）：随机天灾演出事件
//
// 用户原话："这是一个特殊的袭击事件，相当于全新事件。从第六回合开始，
// 触发概率为10%，每回合只判定一次，第七回合15%，第八20%以此类推。
// 袭击一整局只会触发一次。触发过一次后就不再触发。"
//
// 设计：独立状态机（phase + t 驱动），视觉/音频/伤害全在本文件，
// 主循环只调 update + 两个 draw，保持干净（用户工程要求）。
//
// 时间轴（用户规格）：
//   pending  回合开始 5s（横幅前摇）
//   banner   右下角小地图上方横幅滑入 0.3s → 停 3s → 滑出；出现瞬间
//            小小猫娘语音「天上好像有什么东西来了？！」（官方 TTS 通道）
//   gap1     横幅消失后再 2s
//   fly1     超音速飞影横穿（方向随机）+ 地面黑影 + 红色炮弹火雨
//   gap2     1.2s
//   fly2     反向再飞一次，火雨密度翻倍
//   gap3     2.5s
//   dive     0.5s 俯冲地图中心
//   boom     全屏白闪 + 震动 + 冲击波（70% 地图范围）+ 耳鸣 + 切天彗龙
//            BGM；伤害在此刻结算（敌我不分真伤）
//   roar     站姿吼叫 3s：声波环 + 吼叫.ogg + 全场眩晕不刷怪
//   takeoff  起飞.ogg，播完龙消失；BGM 保留至回合结束
//
// 伤害（用户规格，真伤、下限 1——"都是收益"绝不直接炸死玩家）：
//   炮弹   玩家 -20% 当前生命（hp 至少剩 1）；敌人 -20% maxHp - 500
//   大爆炸 玩家 -70% 当前生命（hp 至少剩 1）；敌人 -70% maxHp - 3000
// ============================================================

import { WORLD_SIZE } from '../data/terrain.js';

// ---- 阶段时长（秒）----
const T_PENDING = 5.0;
const T_BANNER_IN = 0.3;
const T_BANNER_HOLD = 3.0;
const T_BANNER_OUT = 0.3;
const T_GAP1 = 2.0;
const T_FLY = 1.6;          // 单次横穿
const T_GAP2 = 1.2;
const T_GAP3 = 2.5;
const T_DIVE = 0.5;
const T_BOOM = 0.9;         // 白闪+冲击波总时长
const T_ROAR = 3.0;
const T_TAKEOFF = 1.6;

// ---- 伤害数值（用户规格）----
const BOLT_PLAYER_PCT = 0.2;    // 炮弹：玩家 20% 当前生命
const BOLT_ENEMY_PCT = 0.2;     // 炮弹：敌人 20% maxHp
const BOLT_ENEMY_FLAT = 500;
const BOOM_PLAYER_PCT = 0.7;    // 大爆炸：玩家 70% 当前生命
const BOOM_ENEMY_PCT = 0.7;     // 大爆炸：敌人 70% maxHp
const BOOM_ENEMY_FLAT = 3000;

// ---- 贴图懒加载（芙兰背景同款模式：失败静默，绝不阻塞）----
const _imgCache = new Map();
function cometImg(file) {
  let e = _imgCache.get(file);
  if (!e) {
    e = { img: null, failed: false };
    try {
      if (typeof Image !== 'undefined') {
        const im = new Image();
        im.onload = () => { e.img = im; };
        im.onerror = () => { e.failed = true; };
        im.src = `./assets/comet/${file}`;
      } else {
        e.failed = true;   // Node 测试环境
      }
    } catch { e.failed = true; }
    _imgCache.set(file, e);
  }
  return e.img && !e.failed ? e.img : null;
}
/** 预加载：pending 摇中后立刻开始拉图，飞影出场时大概率已就绪 */
export function preloadCometAssets() {
  cometImg('fly.png');
  cometImg('roar.png');
}

export class CometDisaster {
  constructor() {
    this.phase = 'idle';       // idle/pending/banner/gap1/fly1/gap2/fly2/gap3/dive/boom/roar/takeoff/done
    this.t = 0;                // 当前阶段计时
    this.age = 0;              // 事件总时长（演出用）
    this.fired = false;        // 全局限一次（一局游戏）
    this.pending = false;      // 本回合摇中了，等 5s 前摇
    this.dir = 1;              // 飞影方向：1 = 从左往右
    this.cx = 0;               // 地图中心（boom 落点）
    this.cy = 0;
    this.shake = 0;            // 屏幕震动强度（px），renderer 每帧衰减
    this.flash = 0;            // 全屏白闪 alpha
    this.bolts = [];           // 火雨粒子 {x,y,vy,r,t,life,landed}
    this.rings = [];           // 冲击波/声波环 {x,y,r,rMax,t,life,warm}
    this.trail = [];           // 飞影彗尾 {x,y,t,life,r}
    this.half = WORLD_SIZE / 2;
    this._bgm = null;          // 天彗龙 BGM 独立元素（不进 audio 的场景通道）
  }

  // ---------------------------------------------------------
  // 触发判定
  // ---------------------------------------------------------
  /**
   * 每回合开始调一次（main._beginWave）。
   * 概率：第 6 波 10%，之后每波 +5%（wave1-based：0.05×(wave-4)）。
   * 全局只触发一次；已触发/已在本局飞过 → 永不再摇。
   * @param {number} wave 1-based 波数
   * @param {object} rng  本局随机源（保持种子一致性）
   * @param {boolean} force 测试按钮强制触发
   */
  roll(wave, rng, force = false) {
    if (this.fired || this.pending || this.phase !== 'idle') return false;
    const p = Math.min(1, 0.05 * (wave - 4));
    const hit = force || (rng?.next?.() ?? Math.random()) < p;
    if (hit) {
      this.pending = true;
      this.t = 0;
      preloadCometAssets();
    }
    return hit;
  }

  /** 暂停菜单测试按钮：下一个 5s 前摇后必出 */
  forceTrigger(wave) {
    return this.roll(wave, null, true);
  }

  /** 回合结束（main._endWave）：停 BGM、复位到可摇状态 */
  onWaveEnd() {
    this.pending = false;
    this.stopBgm();
    if (this.phase !== 'idle' && this.phase !== 'done') this.phase = 'done';
  }

  /** 开新局（main.startRun）：全局限一次标记复位 */
  resetRun() {
    this.fired = false;
    this.pending = false;
    this.phase = 'idle';
    this.t = 0;
    this.stopBgm();
  }

  // ---------------------------------------------------------
  // BGM（独立元素：不劫持 audio 的场景通道，回合结束显式停）
  // ---------------------------------------------------------
  _ensureBgm() {
    if (this._bgm) return this._bgm;
    const Ctor = (typeof window !== 'undefined' && window.Audio)
      || (typeof Audio !== 'undefined' ? Audio : null);
    if (!Ctor) return null;
    try {
      const el = new Ctor('assets/sfx/comet_bgm.ogg');
      el.loop = true;
      el.volume = 0.75;
      this._bgm = el;
    } catch { this._bgm = null; }
    return this._bgm;
  }

  _startBgm() {
    const el = this._ensureBgm();
    if (!el) return;
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放拦/文件缺 */ });
    } catch { /* 忽略 */ }
  }

  stopBgm() {
    try {
      if (this._bgm) { this._bgm.pause(); }
    } catch { /* 忽略 */ }
  }

  // ---------------------------------------------------------
  // 主更新（main._updatePlaying 每帧调）
  // @returns {boolean} roar 眩晕期间 true —— main 据此冻结世界（不刷怪/
  //                    敌人静止/波次计时暂停），玩家照常可动
  // ---------------------------------------------------------
  update(dt, main) {
    if (this.phase === 'idle' && !this.pending) return false;
    this.t += dt;
    this.age += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2);

    // 粒子推进（任何阶段都跑，让火雨余烬自然落完）
    for (const b of this.bolts) {
      b.t += dt;
      if (!b.landed) {
        b.y += b.vy * dt;
        b.vy += 900 * dt;          // 重力加速下坠
        if (b.y >= b.landY) {
          b.landed = true;
          b.t = 0;
          this._boltImpact(main, b);
        }
      }
    }
    this.bolts = this.bolts.filter((b) => b.t < (b.landed ? 0.45 : 12));
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
    for (const s of this.trail) s.t += dt;
    this.trail = this.trail.filter((s) => s.t < s.life);

    switch (this.phase) {
      case 'idle': // pending 前摇（回合开始后 5s）
        if (this.t >= T_PENDING) {
          this.pending = false;
          this.fired = true;
          this.phase = 'banner';
          this.t = 0;
          this.cx = 0; this.cy = 0;   // 地图中心（世界原点）
          this.dir = (main?.rng?.next?.() ?? Math.random()) < 0.5 ? 1 : -1;
          // 小小猫娘语音台词（气泡 + 官方 TTS 通道）
          try { main?._nekoSay?.('天上好像有什么东西来了？！'); } catch { /* */ }
        }
        return false;

      case 'banner':
        if (this.t >= T_BANNER_IN + T_BANNER_HOLD + T_BANNER_OUT) {
          this.phase = 'gap1'; this.t = 0;
        }
        return false;

      case 'gap1':
        if (this.t >= T_GAP1) { this.phase = 'fly1'; this.t = 0; this._beginFly(main, false); }
        return false;

      case 'fly1':
        this._tickFly(main, false);
        if (this.t >= T_FLY) { this.phase = 'gap2'; this.t = 0; }
        return false;

      case 'gap2':
        if (this.t >= T_GAP2) { this.phase = 'fly2'; this.t = 0; this._beginFly(main, true); }
        return false;

      case 'fly2':
        this._tickFly(main, true);
        if (this.t >= T_FLY) { this.phase = 'gap3'; this.t = 0; }
        return false;

      case 'gap3':
        if (this.t >= T_GAP3) { this.phase = 'dive'; this.t = 0; }
        return false;

      case 'dive':
        if (this.t >= T_DIVE) {
          this.phase = 'boom'; this.t = 0;
          this.shake = 18;
          this.flash = 1;
          this.rings.push({ x: this.cx, y: this.cy, r: 0, rMax: this.half * 0.7, t: 0, life: T_BOOM, warm: true });
          try { main?.audio?.play('cometTinnitus'); } catch { /* */ }
          this._startBgm();
          this._dealBoom(main);
        }
        return false;

      case 'boom':
        if (this.t >= T_BOOM) {
          this.phase = 'roar'; this.t = 0;
          this.rings.push({ x: this.cx, y: this.cy - 90, r: 0, rMax: 420, t: 0, life: 0.8, warm: false });
          try { main?.audio?.play('cometRoarVoice'); } catch { /* */ }
        }
        return true;   // boom 期间世界也别动（白闪里什么都看不清）

      case 'roar':
        // 吼叫声波环：每 0.9s 一圈
        if (this.rings.length < 3 && this.t > (this.rings.length + 1) * 0.9) {
          this.rings.push({ x: this.cx, y: this.cy - 90, r: 0, rMax: 420, t: 0, life: 0.8, warm: false });
        }
        if (this.t >= T_ROAR) {
          this.phase = 'takeoff'; this.t = 0;
          try { main?.audio?.play('cometTakeoff'); } catch { /* */ }
        }
        return true;   // 眩晕：不刷怪、敌人静止、波次计时暂停（用户防秒杀规格）

      case 'takeoff':
        if (this.t >= T_TAKEOFF) { this.phase = 'done'; this.t = 0; }
        return false;   // 龙已起飞，世界恢复（BGM 保留到回合结束）

      default:
        return false;
    }
  }

  // ---------------------------------------------------------
  // 飞影与火雨
  // ---------------------------------------------------------
  _beginFly(main, second) {
    this.dir = second ? -this.dir : ((main?.rng?.next?.() ?? Math.random()) < 0.5 ? 1 : -1);
    this._boltAcc = 0;
    this._lastT = this.t;
  }

  _tickFly(main, second) {
    // 彗尾粒子（本体的红色拖尾）——渲染时按 dir 定头向
    if (Math.random() < 0.9) {
      const k = this.t / T_FLY;
      const margin = this.half + 260;
      const x = this.dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2;
      const y = -this.half * 0.45 + Math.sin(this.age * 2.2) * 60;   // 高空近似直线微摆
      this.trail.push({ x, y, t: 0, life: 0.5, r: 26 });
    }
    // 火雨：第一遍每 0.12s 一颗，第二遍密度翻倍
    const interval = second ? 0.06 : 0.12;
    this._boltAcc = (this._boltAcc ?? 0) + dt2(this);
    while (this._boltAcc >= interval) {
      this._boltAcc -= interval;
      const sx = (Math.random() * 2 - 1) * this.half * 0.85;
      this.bolts.push({
        x: sx + (Math.random() * 2 - 1) * 120,
        y: -this.half * 0.5,
        landY: (Math.random() * 2 - 1) * this.half * 0.9,
        vy: 620 + Math.random() * 380,
        r: 9 + Math.random() * 8,
        t: 0,
        landed: false,
      });
    }
  }

  /** 火球落地：小爆炸圈 + 伤害结算（敌我不分真伤） */
  _boltImpact(main, b) {
    this.rings.push({ x: b.x, y: b.landY, r: 0, rMax: 70, t: 0, life: 0.4, warm: true });
    const world = main?.world;
    if (!world) return;
    const R = 70;
    // 玩家：20% 当前生命真伤，血量最少剩 1（绝不直接炸死）
    for (const p of (world.players?.() ?? [])) {
      if (!p || p.dead) continue;
      if (Math.hypot(p.x - b.x, p.y - b.landY) <= R + p.radius) {
        const dmg = Math.max(1, Math.round(p.hp * BOLT_PLAYER_PCT));
        p.hp = Math.max(1, p.hp - dmg);
        p.invuln = Math.max(p.invuln ?? 0, 0.4);
        try {
          world.fx?.damageText?.(p.x, p.y - p.radius - 12, `-${dmg}`, true, '#ff8866');
        } catch { /* */ }
      }
    }
    // 敌人：20% maxHp + 500 真伤
    for (const e of world.enemies?.items ?? []) {
      if (!e || e.dead) continue;
      if (Math.hypot(e.x - b.x, e.y - b.landY) <= R + e.radius) {
        const dmg = Math.round(e.maxHp * BOLT_ENEMY_PCT) + BOLT_ENEMY_FLAT;
        try { e.takeDamage(dmg, { pierceArmor: true }); } catch { /* */ }
      }
    }
  }

  /** 中心大爆炸：70% 当前/最大生命真伤（用户规格） */
  _dealBoom(main) {
    const world = main?.world;
    if (!world) return;
    const R = this.half * 0.7;
    for (const p of (world.players?.() ?? [])) {
      if (!p || p.dead) continue;
      if (Math.hypot(p.x - this.cx, p.y - this.cy) <= R + p.radius) {
        const dmg = Math.max(1, Math.round(p.hp * BOOM_PLAYER_PCT));
        p.hp = Math.max(1, p.hp - dmg);
        p.invuln = Math.max(p.invuln ?? 0, 0.6);
        try { world.fx?.damageText?.(p.x, p.y - p.radius - 12, `-${dmg}`, true, '#ff5544'); } catch { /* */ }
      }
    }
    for (const e of world.enemies?.items ?? []) {
      if (!e || e.dead) continue;
      if (Math.hypot(e.x - this.cx, e.y - this.cy) <= R + e.radius) {
        const dmg = Math.round(e.maxHp * BOOM_ENEMY_PCT) + BOOM_ENEMY_FLAT;
        try { e.takeDamage(dmg, { pierceArmor: true }); } catch { /* */ }
      }
    }
  }

  // ---------------------------------------------------------
  // 渲染 · 世界层（黑影/龙/火雨/冲击波/龙吼）—— 相机变换内调用
  // ---------------------------------------------------------
  drawWorld(ctx) {
    if (this.phase === 'idle' || this.phase === 'done') return;
    const flying = this.phase === 'fly1' || this.phase === 'fly2';
    const diving = this.phase === 'dive';
    const roaring = this.phase === 'roar';
    const taking = this.phase === 'takeoff';

    // ---- 地面黑影（飞影/俯冲期间的高空投影）----
    if (flying || diving) {
      const k = Math.min(1, this.t / T_FLY);
      const margin = this.half + 260;
      let sx;
      if (diving) sx = this.dir * (this.half - (this.t / T_DIVE) * (this.half + 200));
      else sx = this.dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2;
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, -this.half * 0.42 + 60, 130, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- 火雨 ----
    for (const b of this.bolts) {
      ctx.save();
      if (b.landed) {
        const k = b.t / 0.45;
        ctx.globalAlpha = 1 - k;
        const g = ctx.createRadialGradient(b.x, b.landY, 0, b.x, b.landY, 60 * (0.5 + k));
        g.addColorStop(0, 'rgba(255,240,180,0.95)');
        g.addColorStop(0.5, 'rgba(255,120,40,0.7)');
        g.addColorStop(1, 'rgba(255,40,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.landY, 60 * (0.5 + k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 下落火球 + 长拖尾
        const tl = Math.min(90, b.vy * 0.12);
        const g = ctx.createLinearGradient(b.x, b.y - tl, b.x, b.y + b.r);
        g.addColorStop(0, 'rgba(255,60,20,0)');
        g.addColorStop(1, 'rgba(255,200,90,0.95)');
        ctx.strokeStyle = g;
        ctx.lineWidth = b.r * 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - tl);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- 彗尾粒子 ----
    for (const s of this.trail) {
      const k = 1 - s.t / s.life;
      ctx.save();
      ctx.globalAlpha = k * 0.8;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * (1 + (1 - k)));
      g.addColorStop(0, 'rgba(255,170,60,0.9)');
      g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 + (1 - k)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- 天彗龙本体 ----
    if (flying || diving) this._drawDragon(ctx, diving);
    if (roaring) this._drawRoar(ctx);
    if (taking) this._drawTakeoff(ctx);

    // ---- 冲击波 / 声波环 ----
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = r.rMax * (1 - Math.pow(1 - k, 2.2));   // easeOut
      ctx.save();
      ctx.globalAlpha = (1 - k) * (r.warm ? 0.85 : 0.6);
      ctx.strokeStyle = r.warm
        ? (k < 0.35 ? '#ffffff' : '#ff6a3c')
        : 'rgba(255,220,210,0.95)';
      ctx.lineWidth = r.warm ? Math.max(1, 20 * (1 - k)) : Math.max(1, 10 * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 飞行/俯冲的龙：fly.png 顶端是头 → 旋转让头对准速度方向 */
  _drawDragon(ctx, diving) {
    const img = cometImg('fly.png');
    const k = Math.min(1, this.t / (diving ? T_DIVE : T_FLY));
    const margin = this.half + 260;
    let x, y;
    if (diving) {
      // 从当前边缘俯冲到中心
      const sx = this.dir * (this.half + 200);
      x = sx + (this.cx - sx) * k;
      y = -this.half * 0.42 + (this.cy - (-this.half * 0.42)) * k;
    } else {
      x = this.dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2;
      y = -this.half * 0.45 + Math.sin(this.age * 2.2) * 60;
    }
    const speedAngle = diving
      ? Math.atan2(this.cy - (-this.half * 0.42), this.cx - this.dir * (this.half + 200))
      : (this.dir > 0 ? 0 : Math.PI);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(speedAngle + Math.PI / 2);   // 素材头朝上 → 转到速度方向
    const w = diving ? 340 : 300;
    if (img) {
      const h = w * (img.height / img.width);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      // 贴图未就绪：锐角三角保底（红黑渐变）
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#3a0000');
      g.addColorStop(1, '#ff3020');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(-w / 2, -w * 0.18);
      ctx.lineTo(-w / 2, w * 0.18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 站姿吼叫：roar.png 默认头朝左；飞来方向向右则水平翻转 */
  _drawRoar(ctx) {
    const img = cometImg('roar.png');
    ctx.save();
    ctx.translate(this.cx, this.cy);
    // 落地缓冲：纵向 0.9 → 1
    const k = Math.min(1, this.t / 0.35);
    ctx.scale(1, 0.9 + 0.1 * k);
    if (this.dir > 0) ctx.scale(-1, 1);   // 从右往左飞来 → 头朝右（翻转默认朝左的头）
    const w = 460;
    if (img) {
      const h = w * (img.height / img.width);
      ctx.drawImage(img, -w / 2, -h, w, h);   // 脚踩地面
    } else {
      ctx.fillStyle = '#2a1015';
      ctx.fillRect(-w / 2, -300, w, 300);
    }
    ctx.restore();
  }

  /** 起飞：向上加速离场 + 尾焰 */
  _drawTakeoff(ctx) {
    const img = cometImg('fly.png');
    const k = this.t / T_TAKEOFF;
    const x = this.cx;
    const y = this.cy - 120 - k * k * (this.half + 400);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI);   // 头朝上
    const w = 340 * (1 - k * 0.35);
    if (img) {
      const h = w * (img.height / img.width);
      ctx.globalAlpha = 1 - k * 0.5;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    // 尾焰
    ctx.save();
    ctx.globalAlpha = 0.75 * (1 - k);
    const g = ctx.createRadialGradient(x, y + 60, 0, x, y + 60, 120);
    g.addColorStop(0, 'rgba(255,220,120,0.9)');
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y + 60, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------
  // 渲染 · 屏幕层（横幅/白闪/撕裂暗纹）—— 屏幕坐标系调用
  // ---------------------------------------------------------
  drawScreen(ctx, W, H) {
    if (this.phase === 'idle' || this.phase === 'done') return;

    // ---- 全屏白闪（boom）----
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = '#fff7e8';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // ---- 屏幕撕裂暗纹（boom 期间 20 条错位暗条，轻量"扭曲"）----
    if (this.phase === 'boom') {
      const k = this.t / T_BOOM;
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - k);
      ctx.fillStyle = '#1a0505';
      const band = H / 20;
      for (let i = 0; i < 20; i++) {
        const off = Math.sin(this.age * 40 + i * 1.7) * 26 * (1 - k);
        ctx.fillRect(off, i * band, W, band * 0.6);
      }
      ctx.restore();
    }

    // ---- ？？？袭击横幅（右下角小地图上方）----
    if (this.phase === 'banner') {
      const bw = Math.min(300, W * 0.34);
      const bh = 52;
      const restX = W - bw - 142;        // 小地图（x0 = W-130）左上方
      const restY = H - 150;
      let x, alpha = 1;
      if (this.t < T_BANNER_IN) {
        const k = this.t / T_BANNER_IN;
        const eb = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);  // easeOutBack
        x = W + (restX - W) * eb;
        alpha = Math.min(1, k * 2);
      } else if (this.t < T_BANNER_IN + T_BANNER_HOLD) {
        x = restX;
      } else {
        const k = (this.t - T_BANNER_IN - T_BANNER_HOLD) / T_BANNER_OUT;
        x = restX + (W + bw - restX) * (k * k);
        alpha = 1 - k;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      // 底板：深暗红圆角矩形 + 亮金细边 + 外发光
      ctx.shadowColor = '#ffcc00';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#4a0000';
      this._roundRect(ctx, x, restY, bw, bh, 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      this._roundRect(ctx, x, restY, bw, bh, 10);
      ctx.stroke();
      // 左侧红色警告三角
      ctx.fillStyle = '#ff3020';
      const tx = x + 26, ty = restY + bh / 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty - 13);
      ctx.lineTo(tx - 12, ty + 10);
      ctx.lineTo(tx + 12, ty + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4a0000';
      ctx.fillRect(tx - 1.5, ty - 5, 3, 8);
      ctx.fillRect(tx - 1.5, ty + 5, 3, 3);
      // 文字：粗体白字黑描边
      ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText('？？？ 袭击', x + 52, restY + bh / 2 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('？？？ 袭击', x + 52, restY + bh / 2 + 1);
      ctx.restore();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// 火雨累积用的辅助（保持 _tickFly 签名简单）
function dt2(self) {
  const d = self._lastT === undefined ? 0 : self.t - self._lastT;
  self._lastT = self.t;
  return Math.max(0, d);
}
