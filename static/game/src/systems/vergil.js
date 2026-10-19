// ============================================================
// 第一百四十一轮：正式 Boss 战 —— 大排档椅子·维吉尔
// ============================================================
// 三阶段表演型 Boss。用户规格：
//  · 伤害固定 5% maxHp 纯真伤、无视无敌帧（player.takeDamage 的
//    ignoreIFrames + fixedDamage，第一百四十轮已实装）、0.2s 受击内置 CD。
//  · 五个技能：三连追身刀波（追踪+旋摆变向）、冲刺斩、AOE 拉回、
//    球形次元斩、大招·满屏次元斩（timeScale=0.05 + Bury the Light @2:00）。
//  · 阶段：P1 (>66%) / P2 (33%~66%, ×1.1) / P3 (≤33%, ×1.3)。
//    P3 转阶段立刻放大招；之后四技能轮转，10 秒冷却再放大招；
//    第二次大招**不重置 BGM 进度**（继续播）。
//  · 平时游荡，底部（头）始终朝向玩家。
// 骨架照抄芙兰战：主循环 STATE.VERGIL 分支 + world.update 照推（noSpawn
// 停刷怪），Boss 是 enemies 数组里的隐身实体（玩家武器正常索敌输出）。
// ============================================================

import { Enemy } from '../entities/enemy.js';
import { TAU } from '../core/math.js';
import { audio } from './audio.js';
import {
  drawCrescent, drawZigzagBlade, drawDashSlash, drawAoeRing, drawRift,
  drawUltVeil, spawnShatter, drawShards, drawEdgeFlash, distToSegment,
} from './dmc-blades.js';

// ---- 数值 ----
export const VERGIL_MAX_HP = 50000;   // 141 轮再改：正式 Boss 血量 5 万
export const HIT_FRAC = 0.05;        // 每击 5% 玩家最大生命的固定真伤
export const HIT_CD = 0.2;           // 受击内置 CD（防一帧多刀秒杀）
export const ULT_CD = 10;            // P3 大招冷却（真实秒，收刀起算）
export const FIGHT_TIME = 90;        // 限时：90 秒内没打死什么都不给
export const ARENA = { cx: 0, cy: -80, hw: 560, hh: 500 };   // 与芙兰同规格
const BGM_FILE = 'assets/bgm/bury_the_light.ogg';
const BGM_START_AT = 120;            // P3 大招："直接从2分钟开始播放"
// 入场演出（将近 10 秒）：0-3s 黑屏 → 3-6s 场地+背对图淡入（BGM 从 0 秒起）
// → 6-9s 静止（BGM 前奏）→ 9s 背对消失、椅子在原像素点出现、开战
const INTRO_BLACK_END = 3;
const INTRO_SCENE_END = 6;
const INTRO_END = 9;

const SKILL_ORDER = ['triple', 'dash', 'aoe', 'sphere'];

export class VergilFight {
  constructor(main, { onDone }) {
    this.main = main;
    this.onDone = onDone;
    this.over = false;
    this.t = 0;                      // 真实秒表（AI 节奏全用它）
    this.timeScale = 1;              // 大招时 0.05（全场慢动作）

    // Boss 实体（隐身，位置每帧同步，武器正常打它）
    const def = {
      id: 'vergil_chair', name: '大…大排档椅子？！？！',
      bossName: '大…大排档椅子？！？！',   // 哥特血条读 def.bossName
      hp: VERGIL_MAX_HP, radius: 52, speed: 0, damage: 0,
      xp: 0, materials: 0, boss: true,
    };
    const w = main.world;
    this.boss = new Enemy(def, 0, -200,
      { hp: 1, bossHp: 1, damage: 1, speed: 1, xp: 1, materials: 1, bulletRange: 1 },
      main.world.rng ?? main.rng);
    this.boss.speed = 0;
    this.boss.flandreHidden = true;              // 渲染层隐身（演出层自绘椅子）
    // 焊死普通 Boss 的阶段推进机器 + 清掉登场无敌（同芙兰，见 flandre.js）——
    // 不清的话玩家全程打不动他（义眼实机抓到的"免疫"）。
    // 第一百四十二轮：入场演出期间 hitbox 关闭（复用阶段锁通道，
    // invulnTimer>0 时 takeDamage 全 blocked）—— 用户反馈 2："boss在开始
    // 战斗前就受到伤害了，改成在大排档boss出现才开启hitbox"。
    // intro 结束（背对剪影消失、本尊现身那一刻）再清零开打。
    this.boss.bossPhase.invulnTimer = 999;
    this.boss.bossPhase.gatesUsed = { 2: true, 3: true };
    this.boss.bossPhase.update = () => 0;
    w.enemies.add(this.boss);

    // AI 状态
    this.phase = 1;
    this.spdMul = 1;                 // 技能频率/速度倍率：P2 1.1、P3 1.3
    this.state = 'intro';            // intro(入场演出) | wander(站桩) | cast | ult | pause | win
    this.stateT = 0;
    this.introT = 0;                 // 入场演出计时（0→9s）
    this.timeLeft = FIGHT_TIME;      // 90 秒限时
    this.pauseDur = 1.0;             // pause 状态时长（收刀 1s / P3 转阶段 5s）
    this.bgmFade = 0;                // >0 时 BGM 音量线性淡出（P3 转阶段 5s）
    this.ultBgmLocked = false;       // P3 大招后 BGM 完全交给演出（大招不再碰）
    this.castGap = 1.0;              // 不攻击空档 ≤1s（随时在砍人）
    this.skillIdx = 0;               // 四技能轮转指针
    this.ultCd = 0;                  // P3 大招冷却（只在 P3 倒数）
    this.ultCount = 0;
    this.bx = 0; this.by = -260;     // 椅子锚点（世界坐标）
    this.chairFacing = Math.PI / 2;  // 朝向：平时不转，只有冲刺斩/大招转向
    // 141 轮改：维吉尔是站桩装逼剑客 —— 删除游荡，平时纹丝不动（只剩
    // 呼吸浮动），位置只随技能位移（冲刺斩瞬移 / 球裂后撤 / 收刀回中央）

    // 演出对象
    this.waves = [];                 // 三连齐射直线月牙（141 轮改：不追踪直冲）
    this.trails = [];                // 冲刺斩路径刀痕（月牙残影，可带滑出速度）
    this.aoeBlades = [];             // AOE 拉回圈内的随机半月刀波（可命中）
    this.dashes = [];                // 冲刺斩残影线 {x1,y1,x2,y2,t,life}
    this.slashBars = [];             // 冲刺斩横贯刀光 {y,t,life}
    this.aoe = null;                 // {r,mode,st}
    this.rifts = [];                 // 球形裂缝 telegraph {x,y,st,dur,fired}
    this.radials = [];               // 裂缝爆射的放射折线 {cx,cy,a,len,t,life,seed}
    this.ultBlades = [];             // 满屏折线刀光
    this.veil = 0;                   // 大招暗幕强度
    this.shards = [];                // 玻璃碎片
    this.whiteFlash = 0;
    this.edgeFlash = 0;
    this.hitCd = 0;                  // 玩家受击内置 CD
    this.chairVisible = false;       // 入场演出期间椅子隐藏（9s 时在原像素点出现）
    this.chairImg = new Image();
    // 演出素材放 assets/boss/（不进 assets/enemies/ —— 那里被贴图清单
    // 系统扫描，非清单文件会挂 sprite/eye 检查，见第一百四十一轮回归）
    this.chairImg.src = 'assets/boss/vergil_chair.png';
    // 入场演出：大排档背对剪影（大小与 Boss 相当，9s 时与椅子换位）
    this.silImg = new Image();
    this.silImg.src = 'assets/boss/vergil_silhouette.png';
    // 战斗场地背景（大排档椅子背景，画在 ARENA 方形内，芙兰同款位置；
    // 放 assets/boss/ 演出素材目录 —— backgrounds 目录被 assets-check
    // 要求与 backgrounds.js 的 id 全匹配，演出专用图不进轮换池）
    this.arenaImg = new Image();
    this.arenaImg.src = 'assets/boss/vergil_arena.jpg';

    // BGM（独立 <audio>，绕开 playScene 的场景池）
    this._bgm = null;
    this._bgmStarted = false;
    try {
      if (typeof Audio !== 'undefined') {
        this._bgm = new Audio(BGM_FILE);
        this._bgm.preload = 'auto';
        this._bgm.volume = 0.85;
      }
    } catch { /* 环境不支持就安静 */ }
    this._seEls = new Map();         // 技能音效模板（cloneNode 播放）
  }

  /**
   * 技能音效（assets/sfx/{name}.ogg，cloneNode 允许重叠）。
   * 次元斩.ogg → vergil_ult；攻击2.ogg → vergil_aoe；攻击1.ogg → vergil_atk。
   */
  _se(name, vol = 0.5) {
    try {
      if (typeof Audio === 'undefined') return;
      let tpl = this._seEls.get(name);
      if (!tpl) {
        tpl = new Audio(`assets/sfx/${name}.ogg`);
        tpl.preload = 'auto';
        this._seEls.set(name, tpl);
      }
      const v = tpl.cloneNode();
      v.volume = vol;
      v.muted = !audio.enabled;
      v.play().catch(() => { /* 自动播放被拦就安静 */ });
    } catch { /* */ }
  }

  spd() { return this.spdMul; }

  /**
   * HUD 顶部倒计时（纯显示，同芙兰战 getDisplayTimer 通道）——
   * 90 秒限时倒数。此前波次计时冻结在 30（用户反馈 2）。
   */
  getDisplayTimer() {
    return { label: '斩', left: Math.max(0, this.timeLeft), total: FIGHT_TIME };
  }

  /** 结算入口（胜利 / 失败都走这里，幂等） */
  finish(outcome) {
    if (this.over) return;
    this.over = true;
    try { this._bgm?.pause(); } catch { /* */ }
    this.onDone?.(outcome);
  }

  // ---------------------------------------------------------
  // 每帧更新（真实秒 dtReal；世界/玩家由 main 用 timeScale 慢放）
  // ---------------------------------------------------------
  update(dtReal) {
    if (this.over) return;
    this.t += dtReal;
    const p = this.main.player;
    this.hitCd = Math.max(0, this.hitCd - dtReal);
    this.edgeFlash = Math.max(0, this.edgeFlash - dtReal * 2.2);
    this.whiteFlash = Math.max(0, this.whiteFlash - dtReal * 2.6);
    if (this._bgm) this._bgm.muted = !audio.enabled;
    // 阶段锁血倒计时（bossPhase.update 被焊死，递减由本类代跑）
    if (this.boss.bossPhase.invulnTimer > 0) {
      this.boss.bossPhase.invulnTimer = Math.max(0, this.boss.bossPhase.invulnTimer - dtReal);
    }

    // ---- 入场演出（将近 10 秒）----
    if (this.state === 'intro') {
      this.introT += dtReal;
      // 3s：新场景淡入的同时，Bury the Light 从 0 秒开始正常播
      if (this.introT >= INTRO_BLACK_END && !this._bgmStarted) {
        try {
          if (this._bgm) { this._bgm.currentTime = 0; this._bgm.play().catch(() => {}); }
          this._bgmStarted = true;
        } catch { /* */ }
      }
      // 9s：背对剪影消失 → 椅子在同一像素点出现 → 开战
      if (this.introT >= INTRO_END) {
        this.state = 'wander';
        this.stateT = 0;
        this.chairVisible = true;
        p.noAttack = false;              // 演出结束恢复攻击
        // hitbox 与血条此刻开启（用户反馈 2）
        this.boss.bossPhase.invulnTimer = 0;
      }
      return;                            // 演出期间不跑 AI/技能
    }

    // ---- 90 秒限时：没打死就收刀离场，什么都不给 ----
    this.timeLeft -= dtReal;
    if (this.timeLeft <= 0) { this.finish('timeout'); return; }

    // ---- P3 转阶段演出：BGM 5 秒淡出；锁血结束那一刻放大招 + 音量瞬回 ----
    if (this.bgmFade > 0) {
      this.bgmFade = Math.max(0, this.bgmFade - dtReal);
      try { if (this._bgm) this._bgm.volume = 0.85 * (this.bgmFade / 5); } catch { /* */ }
    }
    if (this.phase === 3 && !this._p3UltFired
        && this.state === 'pause' && this.pauseDur >= 5
        && this.boss.bossPhase.invulnTimer <= 0 && this.bgmFade <= 0) {
      // 锁血（5 秒）结束的那一刻：音量瞬间恢复 100%、直接从 2 分钟开始播
      this._p3UltFired = true;
      this.ultBgmLocked = true;          // 之后大招不再碰 BGM 任何设置
      try {
        if (this._bgm) { this._bgm.volume = 0.85; this._bgm.currentTime = BGM_START_AT; }
      } catch { /* */ }
      this._startUlt();
    }

    // ---- 阶段切换（血量门槛，切阶段清屏 + 短缓冲）----
    if (this.phase === 1 && this.boss.hp <= VERGIL_MAX_HP * 0.66) this._enterPhase(2);
    else if (this.phase === 2 && this.boss.hp <= VERGIL_MAX_HP * 0.33) this._enterPhase(3);

    // ---- 玩家死亡 → 结算 ----
    if (p.dead) { this.finish('death'); return; }
    // ---- Boss 被打死 → 胜利演出 ----
    if (this.boss.dead || this.boss.hp <= 0) { this._win(); return; }

    // ---- AI 状态机 ----
    this.stateT += dtReal;
    if (this.state === 'wander') {
      this._idle();
      if (this.stateT >= this.castGap / this.spd() && !this.over) {
        this._pickSkill();
      }
    } else if (this.state === 'cast') {
      this._idle();
      this._tickCast(dtReal);
    } else if (this.state === 'ult') {
      this._tickUlt(dtReal);
    } else if (this.state === 'pause') {
      // 收刀停顿（默认 1s）/ P3 转阶段（5s，配合 BGM 淡出与锁血）
      if (this.stateT >= this.pauseDur) { this.state = 'wander'; this.stateT = 0; }
    } else if (this.state === 'win') {
      if (this.stateT >= 1.4) this.finish('beat');
    }

    // ---- 直线月牙推进（141 轮改：速度翻倍、不追踪、直直冲出去）----
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      wv.t += dtReal;
      if (wv.t >= wv.life) { this.waves.splice(i, 1); continue; }
      wv.x += Math.cos(wv.angle) * wv.speed * dtReal;
      wv.y += Math.sin(wv.angle) * wv.speed * dtReal;
      if (!p.dead && Math.hypot(p.x - wv.x, p.y - wv.y) < wv.r * 0.55) {
        if (this._hitPlayer()) wv.t = wv.life;
      }
    }

    // ---- 冲刺路径刀痕（月牙残影，可带滑出速度）----
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dtReal;
      tr.x += (tr.vx ?? 0) * dtReal;
      tr.y += (tr.vy ?? 0) * dtReal;
      if (tr.t >= tr.life) this.trails.splice(i, 1);
    }

    // ---- AOE 拉回圈内的随机半月刀波（碰到玩家算一次伤害）----
    if (this.aoe && this.aoe.mode === 'hold') {
      this.aoe.spawnT = (this.aoe.spawnT ?? 0) + dtReal;
      if (this.aoe.spawnT >= 0.075) {          // 141 轮再改：数量翻倍
        this.aoe.spawnT = 0;
        const a = Math.random() * TAU;
        const rr = this.aoe.r * (0.15 + Math.random() * 0.75);
        this.aoeBlades.push({
          x: this.aoe.x + Math.cos(a) * rr,
          y: this.aoe.y + Math.sin(a) * rr,
          angle: Math.random() * TAU,
          t: 0, life: 0.55,
        });
      }
    }
    for (let i = this.aoeBlades.length - 1; i >= 0; i--) {
      const ab = this.aoeBlades[i];
      ab.t += dtReal;
      if (ab.t >= ab.life) { this.aoeBlades.splice(i, 1); continue; }
      if (!p.dead && Math.hypot(p.x - ab.x, p.y - ab.y) < 20) {
        this._hitPlayer();
      }
    }

    // ---- 冲刺斩条带判定 ----
    for (let i = this.slashBars.length - 1; i >= 0; i--) {
      const b = this.slashBars[i];
      b.t += dtReal;
      if (b.t >= b.life) { this.slashBars.splice(i, 1); continue; }
      if (!p.dead && b.armed && Math.abs(p.y - b.y) < 26) this._hitPlayer();
    }
    for (let i = this.dashes.length - 1; i >= 0; i--) {
      const d = this.dashes[i];
      d.t += dtReal;
      if (d.t >= d.life) this.dashes.splice(i, 1);
    }

    // ---- AOE 拉回 ----
    if (this.aoe) {
      const a = this.aoe;
      a.st += dtReal;
      if (a.mode === 'grow') {
        a.r = a.maxR * Math.min(1, a.st / 0.35) ** 0.6;
        if (a.st >= 0.35) { a.mode = 'hold'; a.st = 0; }
      } else if (a.mode === 'hold') {
        if (a.st >= 0.5) { a.mode = 'collapse'; a.st = 0; }
      } else if (a.mode === 'collapse') {
        a.r = a.maxR * Math.max(0, 1 - a.st / 0.12);
        if (a.st >= 0.12) {
          // 收缩瞬间：还在圈里的玩家被吸住挨一刀
          if (!p.dead && Math.hypot(p.x - a.x, p.y - a.y) < a.maxR * 0.85) {
            this._hitPlayer();
          }
          a.done = true;
        }
      }
      if (a.done) this.aoe = null;
    }

    // ---- 球形次元斩 ----
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const rf = this.rifts[i];
      rf.st += dtReal;
      if (!rf.fired && rf.st >= rf.dur) {
        rf.fired = true;
        this._se('vergil_atk', 0.6);
        for (let k = 0; k < 10; k++) {
          this.radials.push({
            cx: rf.x, cy: rf.y,
            a: (k / 10) * TAU + Math.random() * 0.5,
            len: 500 + Math.random() * 80,
            t: 0, life: 0.32, seed: (Math.random() * 1e9) | 0,
          });
        }
        this.whiteFlash = Math.max(this.whiteFlash, 0.35);
      }
      if (rf.st >= rf.dur + 0.15) this.rifts.splice(i, 1);
    }
    for (let i = this.radials.length - 1; i >= 0; i--) {
      const rb = this.radials[i];
      rb.t += dtReal;
      if (rb.t >= rb.life) { this.radials.splice(i, 1); continue; }
      // 射线从裂缝向外推进的当前头端
      const prog = Math.min(1, rb.t / 0.2);
      const x2 = rb.cx + Math.cos(rb.a) * rb.len * prog;
      const y2 = rb.cy + Math.sin(rb.a) * rb.len * prog;
      if (!p.dead && distToSegment(p.x, p.y, rb.cx, rb.cy, x2, y2) < 13) {
        this._hitPlayer();
      }
    }

    // ---- 满屏刀光（大招期间，真实秒表）----
    for (let i = this.ultBlades.length - 1; i >= 0; i--) {
      const b = this.ultBlades[i];
      b.t += dtReal;
      if (b.t >= b.life) { this.ultBlades.splice(i, 1); continue; }
      if (!p.dead && distToSegment(p.x, p.y, b.x1, b.y1, b.x2, b.y2) < 13) {
        this._hitPlayer();
      }
    }
  }

  /** 扣血：5% maxHp 固定真伤，无视无敌帧；0.2s 内置 CD 收在函数里 */
  _hitPlayer() {
    if (this.hitCd > 0) return false;
    const p = this.main.player;
    if (p.dead) return false;
    p.takeDamage(0, this.bx, this.by, {
      ignoreIFrames: true,
      fixedDamage: p.maxHp * HIT_FRAC,
      noMiss: true,
    });
    this.hitCd = HIT_CD;
    this.edgeFlash = 0.5;
    return true;
  }

  _enterPhase(n) {
    this.phase = n;
    this.spdMul = n === 2 ? 1.1 : n === 3 ? 1.3 : 1;
    // 切阶段：清屏 + **5 秒锁血**（借用普通 Boss 的阶段锁通道：invulnTimer>0
    // 时 takeDamage 全 blocked + 血条 🔒 视觉；递减由本类 update 代跑）
    this.boss.bossPhase.invulnTimer = 5;
    this.waves.length = 0;
    this.rifts.length = 0;
    this.radials.length = 0;
    this.aoe = null;
    this.state = 'wander';
    this.stateT = -0.8;                        // 0.8s 缓冲再开始放技能
    // 141 轮再改：转阶段不弹播报（用户："血条下面那个播报去掉"）
    if (n === 3) {
      // P3 演出：5 秒静止（BGM 音量 5 秒内 100%→0%，boss 停止攻击），
      // 锁血结束的那一刻由 update 触发大招 + 音量瞬回 100%@2:00
      this.state = 'pause';
      this.stateT = 0;
      this.pauseDur = 5;
      this.bgmFade = 5;
      this.ultCd = 0;
    }
  }

  /** 站桩待机：不移动不转向（呼吸浮动在渲染层），只同步实体坐标 */
  _idle() {
    this.boss.x = this.bx;
    this.boss.y = this.by;
  }

  _pickSkill() {
    // P3：大招冷却好了就先放大招；否则四技能轮转
    if (this.phase === 3) {
      this.ultCd -= (this.castGap / this.spd());
      if (this.ultCd <= 0) { this._startUlt(); return; }
    }
    const name = SKILL_ORDER[this.skillIdx % SKILL_ORDER.length];
    this.skillIdx++;
    this.state = 'cast';
    this.stateT = 0;
    this.skill = { name, st: 0, fired: 0 };
  }

  _tickCast(dtReal) {
    const sk = this.skill;
    if (!sk) { this.state = 'wander'; this.stateT = 0; return; }
    sk.st += dtReal;
    const p = this.main.player;
    const spd = this.spd();

    if (sk.name === 'triple') {
      // 141 轮终版：3 个刀波一组齐射，**连用 3 次 = 一共甩 9 个波**。
      // 每 0.2s 一轮，每轮扇形 ±0.2rad 三道，直线快冲（无追踪无旋摆）。
      const roundGap = 0.2 / spd;
      const rounds = Math.min(3, Math.floor(sk.st / roundGap) + 1);
      while (sk.fired < rounds) {
        const base = Math.atan2(p.y - this.by, p.x - this.bx);
        for (const off of [-0.2, 0, 0.2]) {
          this.waves.push({
            x: this.bx, y: this.by, angle: base + off,
            speed: 530 * spd, r: 46, t: 0, life: 2.2,
          });
        }
        this._se('vergil_atk', 0.5);
        sk.fired++;
      }
      if (sk.st > roundGap * 3 + 0.2) this._endCast();
    } else if (sk.name === 'dash') {
      if (!sk.dashed && sk.st >= 0.25 / spd) {
        sk.dashed = true;
        // 转向（冲刺斩是转向时机之一）
        this.chairFacing = Math.atan2(p.y - this.by, p.x - this.bx);
        // 瞬移到玩家面前（玩家与旧位之间 70px 处）
        const dx = this.bx - p.x, dy = this.by - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = p.x + (dx / d) * 70, ny = p.y + (dy / d) * 70;
        this.dashes.push({ x1: this.bx, y1: this.by, x2: nx, y2: ny, t: 0, life: 0.3 });
        // 141 轮改：路径上每 55px 一道月牙刀痕 —— 表示他瞬移了多远
        const gap = 55;
        const n = Math.max(1, Math.floor(d / gap));
        const dir = Math.atan2(-dy, -dx);            // 刀口朝冲刺方向
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1);
          this.trails.push({
            x: this.bx + dx * t, y: this.by + dy * t,
            angle: dir,
            t: i * 0.03, life: 0.5,
          });
        }
        // 141 轮再改：闪现路径**两侧**再划过几个半月弯弧 ——
        // 沿路径两侧错位布置，刀口向两侧斜挑，并向外滑出（挥砍感）
        for (const side of [-1, 1]) {
          for (let i = 1; i <= Math.max(2, n - 1); i++) {
            const t = i / (Math.max(2, n - 1) + 1);
            const px = -dy / d, py = dx / d;         // 路径法线
            const off = side * (46 + Math.random() * 26);
            this.trails.push({
              x: this.bx + dx * t + px * off,
              y: this.by + dy * t + py * off,
              angle: dir + side * (0.9 + Math.random() * 0.5),
              vx: px * side * 90, vy: py * side * 90,   // 向两侧滑出
              t: i * 0.03 + 0.05, life: 0.55,
            });
          }
        }
        this.bx = nx; this.by = ny;
        this.boss.x = nx; this.boss.y = ny;
        // 横贯屏幕的横向刀光（以玩家所在高度为准）
        const halfW = this.main.camera.viewW;
        this.slashBars.push({ y: p.y, x: this.main.camera.cx, halfW, t: 0, life: 0.22, armed: true });
        this._se('vergil_atk', 0.6);
        this.whiteFlash = Math.max(this.whiteFlash, 0.3);
      }
      if (sk.st > 0.7 / spd) this._endCast();
    } else if (sk.name === 'aoe') {
      if (!sk.started && sk.st >= 0.1) {
        sk.started = true;
        this.aoe = { x: this.bx, y: this.by, r: 0, maxR: 520, mode: 'grow', st: 0 };
        this._se('vergil_aoe', 0.6);       // 攻击2.ogg：AOE 拉回
      }
      if (sk.st > (0.1 + 0.35 + 0.5 + 0.12 + 0.3) / Math.sqrt(spd)) this._endCast();
    } else if (sk.name === 'sphere') {
      // 【球形次元斩】（普通技能，≠大招）：连放 5 次裂缝 —— 每 0.5s 一道，
      // 2.5s 总计，放完休息 1 秒（一切动作静止）。只后撤一次。
      if (!sk.retreated && sk.st >= 0.05) {
        sk.retreated = true;
        const dx = this.bx - p.x, dy = this.by - p.y;
        const d = Math.hypot(dx, dy) || 1;
        this.bx += (dx / d) * 90;
        this.by += (dy / d) * 90;
        this.boss.x = this.bx; this.boss.y = this.by;
      }
      const gap = 0.5 / spd;
      const should = Math.min(5, Math.floor(sk.st / gap) + 1);
      while (sk.fired < should) {
        sk.fired++;
        // 141 轮再改：第 1/3/5 斩瞄玩家当前位置；第 2 斩留在第 1 斩位置、
        // 第 4 斩留在第 3 斩位置（奇数更新落点，偶数复用）
        if (sk.fired % 2 === 1) sk.lastSpot = { x: p.x, y: p.y };
        this.rifts.push({ x: sk.lastSpot.x, y: sk.lastSpot.y, st: 0, dur: 0.3, fired: false });
        this._se('vergil_atk', 0.5);
      }
      if (sk.st > gap * 5 + 0.4) {
        this._endCast();
        // 连放结束 → 维吉尔收势休息 1 秒
        this.state = 'pause';
        this.stateT = 0;
      }
    }
  }

  _endCast() {
    this.state = 'wander';
    this.stateT = 0;
    this.skill = null;
  }

  // ---- 【大招】满屏次元斩 —— "大招"这个词专指它（会减慢时间的那个）：
  // timeScale=0.05 + Bury the Light + 5 连快闪 + 收刀碎屏 + 停顿 1 秒。
  // 普通技能池里的"球形次元斩"（sphere）是另一个技能，别搞混。----
  _startUlt() {
    const p = this.main.player;
    this.state = 'ult';
    this.stateT = 0;
    this.ultCount++;
    this.timeScale = 0.05;            // 全场慢动作（用户硬性要求）
    this.chairVisible = false;        // 时停消失
    this._ultWaveN = 0;               // 已爆发的连数（0..5）
    this._ultWaveT = 0;
    // 大招是转向时机
    this.chairFacing = Math.atan2(p.y - this.by, p.x - this.bx);
    this._se('vergil_ult', 0.85);     // 次元斩.ogg
    // BGM：P3 大招（_p3UltFired）由转阶段演出直接操控过；此后
    // **大招不再碰 BGM 任何设置**（用户："之后不变bgm任何设置"）。
    if (!this.ultBgmLocked) {
      try {
        if (this._bgm) {
          if (!this._bgmStarted) {
            this._bgm.currentTime = BGM_START_AT;
            this._bgm.play().catch(() => { /* 自动播放被拦就安静 */ });
            this._bgmStarted = true;
          } else if (this._bgm.paused) {
            this._bgm.play().catch(() => { /* */ });
          }
        }
      } catch { /* */ }
    }
  }

  _tickUlt(dtReal) {
    const cam = this.main.camera;
    // 蓄力 0.3s → 10 连（141 轮再改：次数时间双翻倍 —— 每 0.18s 一连、
    // 每连 8 道、刀光稍留）→ 收刀 → 停顿 1s
    const CHARGE = 0.3, GAP = 0.18, COMBOS = 10;
    if (this.stateT >= CHARGE && this._ultWaveN < COMBOS) {
      if (!this._ultWaveT) this._ultWaveT = 0;
      this._ultWaveT += dtReal;
      while (this._ultWaveT >= GAP && this._ultWaveN < COMBOS) {
        this._ultWaveT -= GAP;
        this._ultWaveN++;
        this.veil = Math.min(1, this.veil + 0.11);
        const vw = cam.viewW, vh = cam.viewH;
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * TAU;
          const ox = cam.cx + (Math.random() - 0.5) * vw;
          const oy = cam.cy + (Math.random() - 0.5) * vh;
          const half = Math.hypot(vw, vh) * 0.62;
          this.ultBlades.push({
            x1: ox - Math.cos(a) * half, y1: oy - Math.sin(a) * half,
            x2: ox + Math.cos(a) * half, y2: oy + Math.sin(a) * half,
            seed: (Math.random() * 1e9) | 0, t: 0, life: 0.2,
          });
        }
      }
    }
    if (this._ultWaveN >= COMBOS && this.timeScale < 1) {
      // 收刀：恢复时间、瞬移屏幕中央、白闪 + 碎屏
      this.timeScale = 1;
      this.veil = 0;
      this._ultWaveT = 0;
      this.chairVisible = true;
      this.bx = cam.cx; this.by = cam.cy - 60;
      this.boss.x = this.bx; this.boss.y = this.by;
      this.whiteFlash = 1;
      this._shatterBig(cam.cx, cam.cy - 60);
      if (this.phase === 3) this.ultCd = ULT_CD;    // 10 秒后再来一次
      // 收刀停顿复位为默认 1 秒（P3 转阶段曾把它设成 5）
      this.pauseDur = 1.0;
      // 5 连结束 → boss 停顿 1 秒一切动作（喘息收刀）
      this.state = 'pause';
      this.stateT = 0;
    }
  }

  /**
   * 满屏大碎裂（141 轮：收刀碎屏放大到接近半屏）——
   * 以 (x,y) 为中心、半屏半径内面积均匀撒 26 个爆点，每点 2 片大块碎片。
   */
  _shatterBig(x, y) {
    const R = this.main.camera.viewH * 0.5;    // ≈ 半屏
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * R;
      spawnShatter(this.shards, x + Math.cos(a) * rr, y + Math.sin(a) * rr,
        2, 1.4, 1.3);
    }
  }

  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    this.stateT = 0;
    this.timeScale = 1;
    this.veil = 0;
    this.waves.length = 0;
    this.ultBlades.length = 0;
    this.rifts.length = 0;
    this.radials.length = 0;
    this.trails.length = 0;
    this.aoeBlades.length = 0;
    this.slashBars.length = 0;
    this.dashes.length = 0;
    this.chairVisible = true;
    this.whiteFlash = 1;
    this._shatterBig(this.bx, this.by);
    this.main.ui.toast('大…大排档椅子？！？！碎了', 'good', 4000);
  }

  // ---------------------------------------------------------
  // 渲染（renderer.render 挂点）
  // ---------------------------------------------------------

  /**
   * 场地背景层（世界坐标系，画在游戏背景之上、一切实体之下 ——
   * renderer 在背景缓存之后单独调用）。
   * 1) ARENA 方形内画大排档椅子背景图（芙兰同款位置），透明度随入场
   *    演出 3→6 秒从 0→1；
   * 2) 全屏压暗底 + 场地挖洞 —— 用户反馈 1："背景没有全黑"。维吉尔战
   *    期间场地外一律近黑，只留方形场地亮着（贴图保持原亮度）。
   */
  renderArena(ctx, camera) {
    const { cx, cy, hw, hh } = ARENA;
    // ---- 全屏压暗底，方形场地挖洞（evenodd）----
    ctx.save();
    ctx.beginPath();
    const vw = camera.viewW ?? 1600, vh = camera.viewH ?? 900;
    ctx.rect(camera.cx - vw / 2 - 8, camera.cy - vh / 2 - 8, vw + 16, vh + 16);
    ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.clip('evenodd');
    ctx.fillStyle = 'rgba(4,4,10,0.9)';
    ctx.fill();
    ctx.restore();

    // ---- 场地内的大排档背景图 ----
    const img = this.arenaImg;
    if (!img.complete || !img.naturalWidth) return;
    // 淡入曲线：0-3s 全黑看不到；3-6s 0→1；之后常驻
    const t = this.state === 'intro' ? this.introT : 99;
    if (t < INTRO_BLACK_END) return;
    const alpha = this.state === 'intro'
      ? Math.min(1, (t - INTRO_BLACK_END) / (INTRO_SCENE_END - INTRO_BLACK_END))
      : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    // clip 方形场地（芙兰同款）
    ctx.beginPath();
    ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.clip();
    // cover 拉伸：短边贴满
    const scale = Math.max((hw * 2) / img.naturalWidth, (hh * 2) / img.naturalHeight);
    const w2 = img.naturalWidth * scale, h2 = img.naturalHeight * scale;
    ctx.drawImage(img, cx - w2 / 2, cy - h2 / 2, w2, h2);
    ctx.restore();
  }

  /** 世界层：椅子、刀波、光圈、裂缝、冲刺残影（世界坐标系） */
  renderWorld(ctx, camera) {
    // 入场演出：大排档背对剪影（Boss 大小，站在椅子将出现的位置）
    if (this.state === 'intro' && this.silImg.complete && this.silImg.naturalWidth) {
      const t = this.introT;
      if (t >= INTRO_BLACK_END && t < INTRO_END) {
        const alpha = Math.min(1, (t - INTRO_BLACK_END) / (INTRO_SCENE_END - INTRO_BLACK_END));
        const img = this.silImg;
        const h = 130;                        // 与 Boss 椅子（120）相当
        const w2 = h * (img.naturalWidth / img.naturalHeight);
        ctx.save();
        ctx.globalAlpha = alpha * 0.92;
        ctx.drawImage(img, this.bx - w2 / 2, this.by - h + 6, w2, h);
        ctx.restore();
      }
    }

    // 椅子本体
    if (this.chairVisible && this.chairImg.complete && this.chairImg.naturalWidth) {
      // 141 轮改：平时**不转向**（装逼剑客站桩），朝向只在冲刺斩/大招时更新
      const a = this.chairFacing;
      const img = this.chairImg;
      const h = 120;
      const w2 = h * (img.naturalWidth / img.naturalHeight);
      ctx.save();
      // 影子
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(this.bx, this.by + 6, w2 * 0.42, 12, 0, 0, TAU);
      ctx.fill();
      ctx.translate(this.bx, this.by);
      // 蓄力/大招时轻微浮动
      const hover = this.state === 'ult' ? -14 : Math.sin(this.t * 2.2) * 3;
      ctx.translate(0, hover);
      ctx.rotate(a - Math.PI / 2);              // 图片底部(+y) 指向玩家
      ctx.drawImage(img, -w2 / 2, -h + 6, w2, h);
      // 底部"头"的青色描边光
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(89,242,255,${0.3 + (this.state === 'cast' ? 0.25 : 0)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w2 / 2, 4);
      ctx.lineTo(w2 / 2, 4);
      ctx.stroke();
      ctx.restore();
    }

    // 三连齐射直线月牙
    for (const wv of this.waves) {
      const k = Math.min(1, (1 - wv.t / wv.life) * 3);
      drawCrescent(ctx, wv.x, wv.y, wv.angle, wv.r, k);
    }

    // 冲刺路径刀痕（中线直刀痕 + 两侧斜挑滑出的月牙，141 轮再改）
    for (const tr of this.trails) {
      const k = Math.min(1, (1 - tr.t / tr.life) * 2.2);
      drawCrescent(ctx, tr.x, tr.y, tr.angle, tr.vx ? 34 : 26, k * 0.85);
    }

    // AOE 圈内随机半月刀波
    for (const ab of this.aoeBlades) {
      const k = Math.min(1, (1 - ab.t / ab.life) * 2);
      drawCrescent(ctx, ab.x, ab.y, ab.angle, 30, k * 0.9);
    }

    // 冲刺残影线
    for (const d of this.dashes) {
      const k = 1 - d.t / d.life;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(160,240,255,${0.4 * k})`;
      ctx.lineWidth = 10 * k + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
      ctx.stroke();
      ctx.restore();
    }

    // 冲刺斩横贯刀光
    for (const b of this.slashBars) {
      const k = 1 - b.t / b.life;
      drawDashSlash(ctx, this.main.camera.cx, b.y, b.halfW, k);
    }

    // AOE 光圈
    if (this.aoe) {
      drawAoeRing(ctx, this.aoe.x, this.aoe.y, this.aoe.r,
        1, this.aoe.mode);
    }

    // 球形裂缝 + 放射折线
    for (const rf of this.rifts) {
      const prog = rf.st / rf.dur;
      drawRift(ctx, rf.x, rf.y, 60 - 26 * Math.min(1, prog), 0.5 + prog * 0.5);
    }
    for (const rb of this.radials) {
      const k = 1 - rb.t / rb.life;
      const prog = Math.min(1, rb.t / 0.2);
      const x2 = rb.cx + Math.cos(rb.a) * rb.len * prog;
      const y2 = rb.cy + Math.sin(rb.a) * rb.len * prog;
      drawZigzagBlade(ctx, rb.cx, rb.cy, x2, y2, rb.seed, k);
    }

    // 满屏刀光（世界系画，屏幕外延展足够覆盖）
    for (const b of this.ultBlades) {
      const k = 1 - b.t / b.life;
      drawZigzagBlade(ctx, b.x1, b.y1, b.x2, b.y2, b.seed, k);
    }

    // 玻璃碎片
    drawShards(ctx, this.shards, 1 / 60);
  }

  /** 屏幕层：暗幕、红边、白闪、入场黑幕（屏幕坐标系，W×H）。血条走官方哥特条。 */
  renderScreen(ctx, W, H) {
    // 入场演出黑幕：0-3s 淡到全黑（旧场景消失）；3-6.5s 黑幕同步淡出，
    // 让大排档场地/背对剪影从黑里浮现（淡入淡出同时进行）
    if (this.state === 'intro') {
      const t = this.introT;
      let black = 0;
      if (t < INTRO_BLACK_END) black = t / INTRO_BLACK_END;
      else if (t < INTRO_SCENE_END + 0.5) black = Math.max(0, 1 - (t - INTRO_BLACK_END) / 3.5);
      if (black > 0.005) {
        ctx.save();
        ctx.fillStyle = `rgba(2,2,8,${black})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      return;                            // 演出期间不画演出层其余内容
    }
    // 大招暗幕（屏幕系）
    if (this.veil > 0.01) drawUltVeil(ctx, W, H, this.veil);
    // 受击红边
    drawEdgeFlash(ctx, W, H, this.edgeFlash);
    // 白闪
    if (this.whiteFlash > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.whiteFlash) * 0.92})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}
