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

/**
 * 黑色剪影缓存（第一百八十一轮）：把贴图烘焙成纯黑 alpha 剪影。
 * 用户规格："落地前的两轮飞来飞去把它的影子删了，把贴图变成纯黑然后
 * 半透明（就是让它变成影子，显得本体在高空飞行）。"
 * 只烘焙一次，之后 drawImage 复用；贴图未就绪返回 null。
 */
const _silhouetteCache = new Map();
function silhouetteOf(file) {
  const src = cometImg(file);
  if (!src) return null;
  let e = _silhouetteCache.get(file);
  if (!e) {
    e = { canvas: null };
    try {
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const cctx = c.getContext('2d');
        cctx.drawImage(src, 0, 0);
        cctx.globalCompositeOperation = 'source-in';
        cctx.fillStyle = '#000';
        cctx.fillRect(0, 0, c.width, c.height);
        e.canvas = c;
      }
    } catch { e.canvas = null; }
    _silhouetteCache.set(file, e);
  }
  return e.canvas;
}

/** 预加载：pending 摇中后立刻开始拉图，飞影出场时大概率已就绪 */
export function preloadCometAssets() {
  cometImg('fly.png');
  cometImg('roar.png');
}

// ============================================================
// 轻量合成音（第一百八十一轮）：龙飞呼啸 / 火弹嘶鸣 / 袭击警报
// 素材包里没有这三个音 —— 用共享的 AudioContext 现场合成，
// 每种音自带节流，永不抛错（缺 ctx 就安静跳过）。
// ============================================================
function cometSfx(audio, kind) {
  try {
    const actx = audio?.ctx;
    if (!actx || actx.state === 'closed') return;
    const now = actx.currentTime;
    if (kind === 'whoosh') {
      // 超音速呼啸：白噪声 + 带通中心频率快速上扫 200→2600Hz，0.9s
      const dur = 0.9;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const bp = actx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(220, now);
      bp.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.75);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.34, now + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp); bp.connect(g); g.connect(audio._sfxBus ?? actx.destination);
      src.start(now); src.stop(now + dur);
    } else if (kind === 'bolt') {
      // 火弹嘶鸣：短促下扫噪声 + 尖啸正弦，0.22s（节流由调用方管）
      const dur = 0.22;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const hp = actx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(hp); hp.connect(g); g.connect(audio._sfxBus ?? actx.destination);
      src.start(now); src.stop(now + dur);
      const o = actx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1500, now);
      o.frequency.exponentialRampToValueAtTime(320, now + dur);
      const g2 = actx.createGain();
      g2.gain.setValueAtTime(0.07, now);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g2); g2.connect(audio._sfxBus ?? actx.destination);
      o.start(now); o.stop(now + dur);
    } else if (kind === 'alarm') {
      // 袭击警报：低沉两连鸣（三角波 480→240Hz ×2），带一点不安的颤
      for (let i = 0; i < 2; i++) {
        const o = actx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(480, now + i * 0.42);
        o.frequency.exponentialRampToValueAtTime(236, now + i * 0.42 + 0.34);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, now + i * 0.42);
        g.gain.exponentialRampToValueAtTime(0.16, now + i * 0.42 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.42 + 0.38);
        o.connect(g); g.connect(audio._sfxBus ?? actx.destination);
        o.start(now + i * 0.42); o.stop(now + i * 0.42 + 0.4);
      }
    }
  } catch { /* 合成失败 = 安静，绝不影响演出 */ }
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
      el.volume = 0.6;   // 第一百八十一轮：降到 0.6 —— 耳鸣要先"刺穿"耳朵
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
          // 袭击警报（合成）+ 小小猫娘语音台词（气泡 + 官方 TTS 通道）
          cometSfx(main?.audio, 'alarm');
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
          // 第一百八十一轮：耳鸣先"刺穿"（立即、音量 0.5），BGM 延 0.55s 再进
          try { main?.audio?.play('cometTinnitus'); } catch { /* */ }
          setTimeout(() => { try { this._startBgm(); } catch { /* */ } }, 550);
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
    this._boltSfxT = 0;
    // 超音速呼啸（合成）
    cometSfx(main?.audio, 'whoosh');
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
        // 第一百八十一轮：火球放大 2 倍（参考素材 3.png 的能量弹体量）
        r: 16 + Math.random() * 10,
        t: 0,
        landed: false,
        // 电弧粒子：每颗火球挂 2~3 段随机旋转短线（渲染时展开）
        arcs: Array.from({ length: 2 + (Math.random() * 2 | 0) }, () => ({
          a: Math.random() * Math.PI * 2,
          spin: (Math.random() * 2 - 1) * 7,
          len: 10 + Math.random() * 14,
        })),
      });
      // 火弹嘶鸣（合成，节流 0.28s 防密集吵耳）
      this._boltSfxT = (this._boltSfxT ?? 0) + interval;
      if (this._boltSfxT >= 0.28) {
        this._boltSfxT = 0;
        cometSfx(main?.audio, 'bolt');
      }
    }
  }

  /** 火球落地：小爆炸圈 + 伤害结算（敌我不分真伤） */
  _boltImpact(main, b) {
    this.rings.push({ x: b.x, y: b.landY, r: 0, rMax: 110, t: 0, life: 0.4, warm: true });
    const world = main?.world;
    if (!world) return;
    const R = 110;   // 第一百八十一轮：与放大后的爆炸视觉半径一致
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

    // ---- 地面黑影 ----
    // 第一百八十一轮：两轮高空飞过的**影子删了**（用户："把贴图变成纯黑
    // 然后半透明……显得本体在高空飞行"——剪影本身就是影子，地面投影
    // 反而暴露"飞得很低"）。只保留俯冲（dive）的影子 —— 那是冲着地面来
    // 的，投影有压迫感。
    if (diving) {
      const k = Math.min(1, this.t / T_DIVE);
      const margin = this.half + 260;
      const sx = this.dir * (this.half - (this.t / T_DIVE) * (this.half + 200));
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
        // 落地爆：白核 + 红橙能量涌 + 大半径（第一百八十一轮 60→110）
        const k = b.t / 0.45;
        ctx.globalAlpha = 1 - k;
        const rad = 110 * (0.4 + k * 0.9);
        const g = ctx.createRadialGradient(b.x, b.landY, 0, b.x, b.landY, rad);
        g.addColorStop(0, 'rgba(255,252,230,1)');
        g.addColorStop(0.35, 'rgba(255,190,70,0.9)');
        g.addColorStop(0.7, 'rgba(255,90,30,0.6)');
        g.addColorStop(1, 'rgba(255,40,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.landY, rad, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 下落能量弹（第一百八十一轮重做，参考素材 3.png）：
        //   白/黄高亮核心 + 红色外围能量光环 + 环绕电弧短线 + 长拖尾
        const tl = Math.min(150, b.vy * 0.2);
        // 拖尾：粗、红橙渐变、圆头
        const tg = ctx.createLinearGradient(b.x, b.y - tl, b.x, b.y + b.r);
        tg.addColorStop(0, 'rgba(255,60,20,0)');
        tg.addColorStop(0.6, 'rgba(255,120,40,0.55)');
        tg.addColorStop(1, 'rgba(255,200,90,0.85)');
        ctx.strokeStyle = tg;
        ctx.lineWidth = b.r * 1.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - tl);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // 外围红色能量光环
        const halo = ctx.createRadialGradient(b.x, b.y, b.r * 0.3, b.x, b.y, b.r * 2.2);
        halo.addColorStop(0, 'rgba(255,120,50,0.5)');
        halo.addColorStop(1, 'rgba(255,40,20,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        // 白/黄高亮核心
        const core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        core.addColorStop(0, 'rgba(255,255,240,1)');
        core.addColorStop(0.55, 'rgba(255,230,140,0.95)');
        core.addColorStop(1, 'rgba(255,150,60,0.4)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        // 环绕电弧短线（随机旋转，亮红）
        ctx.strokeStyle = 'rgba(255,170,80,0.85)';
        ctx.lineWidth = 2;
        for (const a of (b.arcs ?? [])) {
          a.a += a.spin * 0.016;
          const r1 = b.r * 1.4;
          const x1 = b.x + Math.cos(a.a) * r1;
          const y1 = b.y + Math.sin(a.a) * r1;
          const x2 = b.x + Math.cos(a.a + 0.5) * (r1 + a.len);
          const y2 = b.y + Math.sin(a.a + 0.5) * (r1 + a.len);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
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
      // 第一百八十一轮：高空航线再抬高一点（"飞的太低了"）
      x = this.dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2;
      y = -this.half * 0.55 + Math.sin(this.age * 2.2) * 50;
    }
    const speedAngle = diving
      ? Math.atan2(this.cy - (-this.half * 0.42), this.cx - this.dir * (this.half + 200))
      : (this.dir > 0 ? 0 : Math.PI);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(speedAngle + Math.PI / 2);   // 素材头朝上 → 转到速度方向
    const w = diving ? 400 : 380;
    if (diving) {
      // 俯冲：本体显形（彩色贴图）
      if (img) {
        const h = w * (img.height / img.width);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
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
    } else {
      // 两轮高空飞过：纯黑半透明剪影（离屏烘焙，本体在高空的观感）
      const sil = silhouetteOf('fly.png');
      ctx.globalAlpha = 0.45;
      if (sil) {
        const h = w * (sil.height / sil.width);
        ctx.drawImage(sil, -w / 2, -h / 2, w, h);
      } else if (img) {
        const h = w * (img.height / img.width);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(-w / 2, -w * 0.18);
        ctx.lineTo(-w / 2, w * 0.18);
        ctx.closePath();
        ctx.fill();
      }
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

  /** 起飞：向上加速离场 + 尾焰（尺寸与落地吼叫一致 —— 用户报"落地后
   *  很大，起飞变小了"的穿帮；初尺寸统一 460，远去再用 scale 缩小） */
  _drawTakeoff(ctx) {
    const img = cometImg('fly.png');
    const k = this.t / T_TAKEOFF;
    const x = this.cx;
    const y = this.cy - 120 - k * k * (this.half + 400);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI);   // 头朝上
    const w = 460 * (1 - k * 0.25);   // 初始与落地吼叫同宽，飞远渐缩
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

    // ---- 全屏白闪（boom）：纯白覆盖，alpha 1→0 —— 条纹暗幕删了
    //（用户："白屏效果是条纹效果的，再调调"）----
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = '#fff7e8';
      ctx.fillRect(0, 0, W, H);
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
