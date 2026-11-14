// ============================================================
// 第二百零八轮：隐藏 Boss —— 旧区的落幕（魂系 PvP 老ass）
//
// 用户规格（原文摘录）：
//   "就在第十波隐藏打完大排档椅子继续他的战斗……来自黑暗之魂3的恶臭pvp玩家流派的代表"
//   "魂5站在场地中间偏上的位置，小镰刀在右侧飘着……把武器横在身前，慢慢发出暗紫色的光芒，
//    附魔期间全程无敌，然后开始战斗"
//   P1：小镰刀快速戳击 + 偶尔扔3~5个屎块，落地爆炸生成5秒毒雾，持续掉血的中毒buff
//   P2：换环印骑士直剑并附火，连续大范围横斩；偶尔放出5个灵魂结晶块（碰到受伤消失，5秒后追踪射出）
//   P3：左法兰短剑 + 右法兰大剑；前冲插地、绕圈横扫、高跳竖劈；连发弩高频射击；偶尔阳光之枪；
//       偶尔切回小镰刀/直剑，但更快
//   特殊：血量低于50%可能逃跑翻滚、切宠爱戒指（头顶闪烁 2~3 次/秒，一次回0.5%，持续3~5秒）
//   翻滚：前半段无敌，角色图旋转一圈；击倒玩家会绕2圈下指嘲讽并丢屎块；被救起则中断嘲讽后跳
//   伤害 5% 真伤 + 2 额外真伤；屎块毒 2% 真伤（至少1点）持续5秒；全程禁用玩家自身回血
//
// 骨架照抄维吉尔战：主循环 STATE.SOUL5 分支 + world.update 照推（noSpawn 停刷怪），
// Boss 是 enemies 数组里的隐身实体（玩家武器正常索敌输出），演出层自绘。
// ============================================================
import { Enemy } from '../entities/enemy.js';
import { TAU, clamp } from '../core/math.js';
import { audio } from './audio.js';

// ---- 数值 ----
export const SOUL5_MAX_HP = 88000;       // 比大排档椅子（66666）更厚
export const HIT_FRAC = 0.05;            // 每击 5% 玩家最大生命真伤
export const HIT_FLAT = 2;               // 额外 2 点真伤
export const HIT_CD = 0.2;               // 受击内置 CD
export const POISON_FRAC = 0.02;         // 中毒每跳 2% 最大生命（至少 1 点）
export const POISON_TIME = 5;            // 中毒持续 5 秒
export const POISON_TICK = 1;            // 每秒一跳
export const ARENA = { cx: 0, cy: -40, hw: 560, hh: 360 };
const BGM_FILE = 'assets/soul5/bgm.ogg';
// 入场：0-3s 黑屏 → 3-6s 场地淡入 → 6-9s 小镰刀附魔（全程无敌）→ 开战
const INTRO_BLACK_END = 3;
const INTRO_SCENE_END = 6;
const INTRO_END = 9;

const IMG_FILES = {
  boss: 'assets/soul5/boss.png',
  scythe: 'assets/soul5/scythe.png',
  dung: 'assets/soul5/dung.png',
  ring: 'assets/soul5/ring.png',
  rkgs: 'assets/soul5/rkgs.png',
  farron_gs: 'assets/soul5/farron_gs.png',
  farron_ss: 'assets/soul5/farron_ss.png',
  crossbow: 'assets/soul5/crossbow.png',
  crystal: 'assets/soul5/crystal.png',
  sunlight: 'assets/soul5/sunlight.png',
  arena: 'assets/soul5/arena.png',
  backdrop: 'assets/soul5/backdrop.jpg',
};

const TAU_ = Math.PI * 2;
const rnd = () => Math.random();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Soul5Fight {
  constructor(main, { onDone } = {}) {
    this.main = main;
    this.onDone = onDone;
    this.over = false;
    this.t = 0;
    this.introT = 0;
    this.state = 'intro';        // intro | idle | act | roll | taunt | backstep | heal | pause | win
    this.stateT = 0;
    this.phase = 1;
    this.spdMul = 1;             // 技能频率/速度（P2 ×1.15，P3 ×1.35）
    this.hitCd = 0;
    this.edgeFlash = 0;
    this.whiteFlash = 0;
    this.invuln = true;          // 入场无敌
    this.lockAccum = 0;          // 常驻锁血：每累计 2500 伤害无敌一下
    this._hpLast = 0;
    this.attackCd = 0.6;
    this.rollCd = 2.5;
    this.healCd = 14;
    this.tauntCd = 0;
    this.lastAct = '';
    this.act = null;
    this.weapon = 'scythe';      // scythe | rkgs | farron | crossbow
    this.weaponGlow = 0;         // 附魔强度 0..1
    this.face = 1;               // 朝向（-1 左 / 1 右）
    this.bx = 0;
    this.by = ARENA.cy - 40;
    this.bob = 0;

    // 弹幕 / 场地物件
    this.pies = [];              // 屎块（抛物线）
    this.clouds = [];            // 毒雾
    this.crystals = [];          // 环绕结晶块
    this.bolts = [];             // 弩箭
    this.spears = [];            // 阳光之枪
    this.slashes = [];           // 刀光（纯视觉 + 判定时间窗）
    this.spin = null;            // 大风车
    this.ringFlash = 0;          // 宠爱戒指闪烁计时
    this.ringHealAcc = 0;
    this.healDur = 0;
    this._sfx = new Map();   // 武器音效模板（cloneNode 允许重叠）
    this.slam = null;            // 高跳竖劈
    this.dash = null;            // 前冲

    // 贴图（缺失时全部回落到程序绘图）
    this.images = {};
    if (typeof Image !== 'undefined') {
      for (const k in IMG_FILES) {
        try { const im = new Image(); im.src = IMG_FILES[k]; this.images[k] = im; } catch { /* */ }
      }
    }
    // BGM
    this._bgm = null;
    this._bgmStarted = false;
    try {
      if (typeof Audio !== 'undefined') {
        this._bgm = new Audio(BGM_FILE);
        this._bgm.preload = 'auto';
        this._bgm.volume = 0.85;
        this._bgm.loop = true;
      }
    } catch { /* */ }

    // Boss 实体（隐身，位置每帧同步）
    const def = {
      id: 'soul5', name: '旧区的落幕', bossName: '旧区的落幕',
      hp: SOUL5_MAX_HP, radius: 46, speed: 0, damage: 0,
      xp: 0, materials: 0, boss: true,
    };
    const w = main.world;
    this.boss = new Enemy(def, this.bx, this.by,
      { hp: 1, bossHp: 1, damage: 1, speed: 1, xp: 1, materials: 1, bulletRange: 1 },
      main.world.rng ?? main.rng);
    this.boss.speed = 0;
    this.hpMax = SOUL5_MAX_HP;
    {
      const k = (w.players?.().length ?? 1) - 1;
      if (k > 0) {
        this.hpMax = Math.round(SOUL5_MAX_HP * (1 + 0.45 * k));
        this.boss.maxHp = this.hpMax;
        this.boss.hp = this.hpMax;
      }
    }
    this._hpLast = this.boss.hp;
    this.boss.flandreHidden = true;
    this.boss.bossPhase.invulnTimer = 0;
    this.boss.bossPhase.gatesUsed = { 2: true, 3: true };
    this.boss.bossPhase.update = () => 0;
    // 自管无敌：入场 / 翻滚前半段 / 转阶段 / 嘲讽
    const realTake = this.boss.takeDamage.bind(this.boss);
    this.boss.takeDamage = (amount, opts) => {
      // 注意返回形状要和 Enemy.takeDamage 一致：world 结算会用 res.dealt 出伤害数字，
      // 少了这个字段就会在 boss 身上飘一个 "undefined"。
      if (this.over || this.invuln) {
        return { blocked: true, dodged: false, dealt: 0, killed: false, dmg: 0, reason: 'soul5', gated: 0 };
      }
      return realTake(amount, opts);
    };
    w.enemies.add(this.boss);
    this.bx = this.boss.x;
    this.by = this.boss.y;
  }

  // ---------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------
  getDisplayTimer() { return null; }

  finish(outcome) {
    if (this.over) return;
    this.over = true;
    this.invuln = true;
    try { this._bgm?.pause(); } catch { /* */ }
    this._clearBullets();
    this.onDone?.(outcome);
  }

  update(dtReal) {
    if (this.over) return;
    this.t += dtReal;
    this.edgeFlash = Math.max(0, this.edgeFlash - dtReal * 2.4);
    this.whiteFlash = Math.max(0, this.whiteFlash - dtReal * 3);
    this.hitCd = Math.max(0, this.hitCd - dtReal);
    this.attackCd = Math.max(0, this.attackCd - dtReal);
    this.rollCd = Math.max(0, this.rollCd - dtReal);
    this.healCd = Math.max(0, this.healCd - dtReal);
    this.tauntCd = Math.max(0, this.tauntCd - dtReal);
    if (this._bgm) this._bgm.muted = !audio.enabled;
    this.bob = Math.sin(this.t * 2.2) * 3;

    // 入场演出
    if (this.state === 'intro') {
      this.introT += dtReal;
      if (this.introT >= INTRO_BLACK_END && !this._bgmStarted) {
        try { if (this._bgm) { this._bgm.currentTime = 0; this._bgm.play().catch(() => {}); } this._bgmStarted = true; } catch { /* */ }
      }
      // 6-9s：小镰刀附魔（暗紫光）；附魔全程无敌
      this.weaponGlow = this.introT <= INTRO_SCENE_END ? 0 : Math.min(1, (this.introT - INTRO_SCENE_END) / 2);
      if (this.introT >= INTRO_END) {
        this.state = 'idle';
        this.stateT = 0;
        this.invuln = false;
        this.weaponGlow = 1;
        this.attackCd = 0.8;
        this.rollCd = 2.2;
        // 附魔结束 → 允许攻击（入场演出期间 noAttack 由 main 置 true）
        try { this.main.player.noAttack = false; } catch { /* */ }
      }
      this._syncBoss();
      return;
    }

    // 阶段推进（66% / 33%）
    const ratio = this.boss.hp / this.boss.maxHp;
    if (this.phase === 1 && ratio <= 0.66) this._enterPhase(2);
    else if (this.phase === 2 && ratio <= 0.33) this._enterPhase(3);

    // 常驻锁血：累计 2500 伤害 → 短暂无敌，避免高 DPS 跳过阶段
    if (this.boss.hp < this._hpLast) {
      this.lockAccum += this._hpLast - this.boss.hp;
      if (this.lockAccum >= 2500) {
        this.lockAccum = 0;
        this.invuln = true;
        this._lockT = 0.45 + this.phase * 0.1;
      }
    }
    this._hpLast = this.boss.hp;
    if (this._lockT > 0) {
      this._lockT -= dtReal;
      if (this._lockT <= 0) this.invuln = false;
    }
    if (this.boss.hp <= 0 && !this.over) { this._win(); return; }

    this._tickPoison(dtReal);
    this._tickWeaponGlow(dtReal);
    this._tickProjectiles(dtReal);

    // 玩家倒地 → 嘲讽（每 8 秒最多一次）
    const downed = this._downedPlayer();
    if (downed && this.state !== 'taunt' && this.state !== 'backstep' && this.tauntCd <= 0) {
      this._startTaunt(downed);
    }

    switch (this.state) {
      case 'idle': this._tickIdle(dtReal); break;
      case 'act': this._tickAct(dtReal); break;
      case 'roll': this._tickRoll(dtReal); break;
      case 'taunt': this._tickTaunt(dtReal); break;
      case 'backstep': this._tickBackstep(dtReal); break;
      case 'heal': this._tickHeal(dtReal); break;
      case 'pause': this._tickPause(dtReal); break;
      case 'win': break;
      default: break;
    }
    this._syncBoss();
  }

  /** 武器音效（assets/soul5/sfx_*.ogg，cloneNode 允许重叠） */
  _se(name, vol = 0.45) {
    try {
      if (typeof Audio === 'undefined') return;
      let tpl = this._sfx.get(name);
      if (!tpl) {
        tpl = new Audio(`assets/soul5/${name}`);
        tpl.preload = 'auto';
        this._sfx.set(name, tpl);
      }
      const v = tpl.cloneNode();
      v.volume = vol * (audio.enabled ? 1 : 0);
      v.play().catch(() => { /* 自动播放被拦就安静 */ });
    } catch { /* */ }
  }

  _syncBoss() {
    this.boss.x = this.bx;
    this.boss.y = this.by;
    const p = this._nearestPlayer();
    if (p) this.face = p.x >= this.bx ? 1 : -1;
  }

  _clearBullets() {
    this.pies.length = 0;
    this.clouds.length = 0;
    this.crystals.length = 0;
    this.bolts.length = 0;
    this.spears.length = 0;
    this.slashes.length = 0;
    this.orbit = null;
    this.slam = null;
    this.dash = null;
  }

  // ---------------------------------------------------------
  // 玩家 / 伤害
  // ---------------------------------------------------------
  _players() {
    const list = this.main.world?.players?.() ?? [this.main.player];
    return list.filter((p) => p && !p.dead);
  }

  _nearestPlayer() {
    let best = null, bd = 1e9;
    for (const p of this._players()) {
      if (p.downed) continue;
      const d = Math.hypot(p.x - this.bx, p.y - this.by);
      if (d < bd) { bd = d; best = p; }
    }
    return best ?? this._players()[0] ?? null;
  }

  _downedPlayer() {
    for (const p of this._players()) if (p.downed && !p.dead) return p;
    return null;
  }

  /** 单次命中：5% 最大生命 + 2 点固定真伤，无视无敌帧（与维吉尔同口径） */
  _hitPlayer(p, mul = 1) {
    if (this.hitCd > 0 || !p || p.dead || p.downed) return false;
    p.takeDamage(0, this.bx, this.by, {
      ignoreIFrames: true,
      fixedDamage: p.maxHp * HIT_FRAC * mul + HIT_FLAT,
      noMiss: true,
    });
    this.hitCd = HIT_CD;
    this.edgeFlash = 0.45;
    return true;
  }

  _hitInArc(range, arcDeg, mul = 1) {
    const p = this._nearestPlayer();
    if (!p) return;
    const d = Math.hypot(p.x - this.bx, p.y - this.by);
    if (d > range) return;
    const ang = Math.atan2(p.y - this.by, p.x - this.bx);
    const front = Math.atan2(this.face, 0);
    let diff = Math.abs(ang - front);
    while (diff > Math.PI) diff = Math.abs(diff - TAU_);
    if (diff > (arcDeg * Math.PI) / 360) return;
    this._hitPlayer(p, mul);
  }

  _poison(p) {
    if (!p) return;
    p.soul5Poison = { t: POISON_TIME, tick: 0 };
  }

  _tickPoison(dt) {
    for (const p of this._players()) {
      const ps = p.soul5Poison;
      if (!ps || ps.t <= 0) { if (ps) p.soul5Poison = null; continue; }
      ps.t -= dt;
      ps.tick += dt;
      if (ps.tick >= POISON_TICK) {
        ps.tick -= POISON_TICK;
        p.takeDamage(0, this.bx, this.by, {
          ignoreIFrames: true,
          fixedDamage: Math.max(1, p.maxHp * POISON_FRAC),
          noMiss: true,
        });
      }
      if (ps.t <= 0) p.soul5Poison = null;
    }
  }

  // ---------------------------------------------------------
  // 阶段
  // ---------------------------------------------------------
  _enterPhase(n) {
    this.phase = n;
    this.spdMul = n === 2 ? 1.15 : 1.35;
    this.weapon = n === 2 ? 'rkgs' : 'farron';
    this.weaponGlow = 0;
    this.state = 'pause';
    this.stateT = 0;
    this.pauseDur = 2.2;
    this.invuln = true;
    this._clearBullets();
    this.boss.bossPhase.invulnTimer = this.pauseDur;
    this.whiteFlash = 0.5;
  }

  _tickPause(dt) {
    this.stateT += dt;
    this.boss.bossPhase.invulnTimer = Math.max(0, this.pauseDur - this.stateT);
    // 换武器 → 附魔渐亮
    this.weaponGlow = Math.min(1, this.stateT / 1.2);
    if (this.stateT >= this.pauseDur) {
      this.state = 'idle';
      this.stateT = 0;
      this.invuln = false;
      this.attackCd = 0.5;
      this.weaponGlow = 1;
    }
  }

  _tickWeaponGlow(dt) {
    if (this.state !== 'pause' && this.state !== 'intro') this.weaponGlow = Math.min(1, this.weaponGlow + dt * 0.5);
  }

  // ---------------------------------------------------------
  // 待机 / 行动选择
  // ---------------------------------------------------------
  _tickIdle(dt) {
    this.stateT += dt;
    const p = this._nearestPlayer();
    if (!p) return;
    // 站位：与玩家保持 90~150（手短，主动贴脸）
    const dx = p.x - this.bx, dy = p.y - this.by;
    const d = Math.hypot(dx, dy) || 1;
    const want = 165;   // 立绘很大，站远一点别把玩家盖住（戳击 150 刚好够得着）
    const spd = 200 * this.spdMul;
    if (d > want + 25) {
      this.bx += (dx / d) * spd * dt;
      this.by += (dy / d) * spd * dt;
    } else if (d < want - 35) {
      this.bx -= (dx / d) * spd * 0.7 * dt;
      this.by -= (dy / d) * spd * 0.7 * dt;
    } else {
      // 侧向绕一点，别和玩家完全重合
      this.bx += (-dy / d) * spd * 0.45 * dt;
      this.by += (dx / d) * spd * 0.45 * dt;
    }
    this._clampToArena();

    // 低于 50%：偶尔逃跑回血
    if (this.boss.hp / this.boss.maxHp < 0.5 && this.healCd <= 0 && rnd() < 0.5) {
      this._startHeal();
      return;
    }
    // 翻滚接近/拉开
    if (this.rollCd <= 0 && rnd() < 0.25) {
      const away = d < 70;
      this._startRoll(away ? -1 : 1);   // 太近就拉开，否则滚向玩家
      return;
    }
    if (this.attackCd <= 0) this._selectAction();
  }

  _selectAction() {
    const pool = this.phase === 1
      ? ['poke', 'poke', 'poke', 'dung']
      : this.phase === 2
        ? ['flame5', 'flame5', 'crystals', 'poke']
        : ['orbit', 'flame5', 'crossbow', 'sunlight', 'poke', 'dung'];
    let id = pool[(rnd() * pool.length) | 0];
    if (id === this.lastAct && pool.length > 1 && rnd() < 0.5) id = pool[(rnd() * pool.length) | 0];
    this.lastAct = id;
    this._startAct(id);
  }

  _startAct(id) {
    this.state = 'act';
    this.stateT = 0;
    const spd = this.spdMul;
    // 第二百一十二轮：直剑 5 连斩 5.4s / 法兰大风车 4s / 连发弩 3 组三连射 2s（对齐音效）
    this.act = {
      id, t: 0, spd,
      dur: id === 'poke' ? 0.9 / spd : id === 'dung' ? 1.0 / spd
        : id === 'flame5' ? 5.7 : id === 'orbit' ? 4.6
        : id === 'crystals' ? 1.2 : id === 'crossbow' ? 2.0 : 1.2,
      fired: 0, hit: 0,
      plant: null, orbit: null, phaseT: 0,
    };
    if (id === 'crossbow') this.weapon = 'crossbow';
    else if (id === 'orbit') this.weapon = 'farron';
    else if (id === 'flame5') this.weapon = this.phase === 3 ? 'farron' : 'rkgs';
    else if (id === 'poke' || id === 'dung') this.weapon = 'scythe';
    this.slashSfxT = 0;
  }

  _tickAct(dt) {
    const a = this.act;
    if (!a) { this.state = 'idle'; return; }
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);

    switch (a.id) {
      case 'poke': {
        // 三段快速戳击：用图片底部（刃）朝目标捅
        const marks = [0.22, 0.5, 0.78];
        if (a.hit < marks.length && k >= marks[a.hit]) {
          a.hit++;
          this._hitInArc(155, 130, 1);
          this._se('sfx_scythe.ogg', 0.32);
          const p = this._nearestPlayer();
          const ang = p ? Math.atan2(p.y + (p.hitOY ?? 0) - this.by, p.x - this.bx) : this.aim;
          this.slashes.push({
            kind: 'stab', x: this.bx + Math.cos(ang) * 30, y: this.by - 20 + Math.sin(ang) * 30,
            ang, t: 0, dur: 0.2,
          });
        }
        break;
      }
      case 'dung': {
        if (a.hit === 0 && k >= 0.35) {
          a.hit = 1;
          const n = 3 + ((rnd() * 3) | 0);   // 3~5 块
          const p = this._nearestPlayer();
          if (p) {
            for (let i = 0; i < n; i++) {
              const spread = (i - (n - 1) / 2) * 46;
              this.pies.push({
                x: this.bx, y: this.by - 20, z: 0,
                tx: p.x + spread + (rnd() - 0.5) * 30, ty: p.y + (rnd() - 0.5) * 24,
                t: 0, dur: 0.55,
              });
            }
          }
        }
        break;
      }
      case 'flame5': {
        // 五连火焰斩：5 个伤害点（约 1.05 秒一刀，对齐音效总长 5~6 秒）
        const marks = [0.12, 0.29, 0.46, 0.63, 0.8];
        if (a.hit < marks.length && k >= marks[a.hit]) {
          a.hit++;
          const big = a.hit === 5;
          this._hitInArc(big ? 265 : 240, big ? 260 : 250, big ? 1.15 : 1);
          if (a.hit === 1) this._se('sfx_sword.ogg', 0.6);   // ogg 自带 5 段，只播一次
          this.slashes.push({ kind: 'wide', x: this.bx, y: this.by - 20, t: 0, dur: big ? 0.45 : 0.34, r: big ? 265 : 240, big, dir: a.hit % 2 ? 1 : -1 });
          if (big) this.whiteFlash = Math.max(this.whiteFlash, 0.25);
        }
        break;
      }
      case 'crystals': {
        if (a.hit === 0 && k >= 0.45) {
          a.hit = 1;
          this._spawnCrystals();
        }
        break;
      }
      case 'orbit': {
        // 法兰大剑：插地（短剑不动）→ 角色绕大半圈挥大剑 → 左一圈右一圈 → 高跳竖劈
        // 攻击 3 次（左圈 / 右圈 / 竖劈），总长约 4 秒
        if (!a.plant && a.t >= 0.18) {
          a.plant = { x: this.bx, y: this.by };
          this._se('sfx_farron.ogg', 0.6);   // ogg 自带 3 段攻击，只播一次
        }
        if (a.plant) {
          const t0 = 0.2, seg = 1.75, R = 150;
          if (a.t >= t0 && a.t < t0 + seg * 2) {
            const idx = a.t < t0 + seg ? 0 : 1;
            const u = (a.t - t0 - idx * seg) / seg;
            const dir = idx === 0 ? 1 : -1;
            const phi0 = idx === 0 ? -Math.PI / 2 : Math.PI / 2;
            const phi = phi0 + dir * u * TAU_;
            this.bx = a.plant.x + Math.cos(phi) * R;
            this.by = a.plant.y + Math.sin(phi) * R;
            this._clampToArena();
            this.orbit = { cx: a.plant.x, cy: a.plant.y, r: R, phi, dir };
            if (!a[`c${idx}`] && u >= 0.5) {
              a[`c${idx}`] = true;
              this.slashes.push({ kind: 'orbit', x: a.plant.x, y: a.plant.y, t: 0, dur: 0.6, r: R + 120, dir });
              for (const p of this._players()) {
                if (p.downed) continue;
                if (Math.hypot(p.x - a.plant.x, p.y - a.plant.y) < R + 140) this._hitPlayer(p);
              }
            }
          } else if (!a.slammed && a.t >= t0 + seg * 2) {
            a.slammed = true;
            this.orbit = null;
            const p = this._nearestPlayer();
            this.slam = { t: 0, dur: 0.6, x: p?.x ?? this.bx, y: p?.y ?? this.by, hit: 0 };
          }
        }
        break;
      }
      case 'crossbow': {
        // 三组三连射（每组 3 箭、一次音效），一共 9 箭
        const bursts = [0.15, 0.47, 0.79];
        for (let b = a.fired; b < bursts.length; b++) {
          if (k < bursts[b]) break;
          a.fired = b + 1;
          this._se('sfx_crossbow.ogg', 0.42);
          const p = this._nearestPlayer();
          if (p) {
            const base = Math.atan2(p.y + (p.hitOY ?? 0) - (this.by - 30), p.x - this.bx);
            for (let i = 0; i < 3; i++) {
              const ang = base + (i - 1) * 0.07 + (rnd() - 0.5) * 0.03;
              this.bolts.push({ x: this.bx, y: this.by - 30, vx: Math.cos(ang) * 780, vy: Math.sin(ang) * 780, life: 1.6 });
            }
          }
        }
        break;
      }
      case 'sunlight': {
        if (a.hit === 0 && k >= 0.5) {
          a.hit = 1;
          const p = this._nearestPlayer();
          if (p) this.spears.push({ x: this.bx, y: this.by - 60, tx: p.x, ty: p.y, t: 0, dur: 0.42, ang: Math.atan2(p.y - this.by + 60, p.x - this.bx), seed: rnd() * 10 });
        }
        break;
      }
      default: break;
    }

    // 前冲位移
    if (this.dash) {
      this.dash.t += dt;
      this.bx += this.dash.vx * dt;
      this.by += this.dash.vy * dt;
      this._clampToArena();
      if (this.dash.t >= this.dash.dur) this.dash = null;
    }

    if (a.t >= a.dur) {
      this.state = 'idle';
      this.stateT = 0;
      this.act = null;
      this.orbit = null;
      this.attackCd = (this.phase === 3 ? 0.22 : 0.45) / this.spdMul;
    }
  }

  _clampToArena() {
    // 立绘很高（foot 在 by+30、头顶在 by-150），上边多留一点，别让头跑出屏幕
    this.bx = clamp(this.bx, ARENA.cx - ARENA.hw + 80, ARENA.cx + ARENA.hw - 80);
    this.by = clamp(this.by, ARENA.cy - ARENA.hh + 175, ARENA.cy + ARENA.hh - 60);
  }

  // ---------------------------------------------------------
  // 翻滚 / 嘲讽 / 回血
  // ---------------------------------------------------------
  /** dir = +1 朝玩家滚，-1 远离玩家滚 */
  _startRoll(dir) {
    const p = this._nearestPlayer();
    let ax = this.face, ay = 0;
    if (p) {
      const dx = p.x - this.bx, dy = p.y - this.by, d = Math.hypot(dx, dy) || 1;
      ax = (dx / d) * dir; ay = (dy / d) * dir;
    }
    this.state = 'roll';
    this.stateT = 0;
    this.roll = { t: 0, dur: 0.6, vx: ax * 520, vy: ay * 520, ang: 0 };
    this.weaponGlow = 1;
  }

  _tickRoll(dt) {
    const r = this.roll;
    if (!r) { this.state = 'idle'; return; }
    r.t += dt;
    // 前半段无敌
    this.invuln = r.t < r.dur * 0.5;
    const p = this._nearestPlayer();
    const before = p ? Math.hypot(p.x - this.bx, p.y - this.by) : 1e9;
    this.bx += r.vx * dt;
    this.by += r.vy * dt;
    const after = p ? Math.hypot(p.x - this.bx, p.y - this.by) : 1e9;
    // 别从玩家身上碾过去（否则大立绘会把玩家整个盖住）
    if (p && after < 95 && after < before) { this.bx -= r.vx * dt; this.by -= r.vy * dt; r.t = r.dur; }
    this._clampToArena();
    r.ang = (r.t / r.dur) * TAU_;      // 角色图旋转一圈
    if (r.t >= r.dur) {
      this.invuln = false;
      this.roll = null;
      this.state = 'idle';
      this.stateT = 0;
      this.rollCd = 2.2 + rnd() * 2.5;
    }
  }

  _startTaunt(downed) {
    this.state = 'taunt';
    this.stateT = 0;
    this.tauntTarget = downed;
    this.tauntDur = 1.4;
    this.tauntCd = 8;
    this.tauntSpin = 0;
    this.invuln = true;                // 嘲讽全程无敌（体面）
    this._clearBullets();
  }

  _tickTaunt(dt) {
    this.stateT += dt;
    this.tauntSpin = (this.stateT / this.tauntDur) * TAU_ * 2;   // 转两圈
    const d = this.tauntTarget;
    if (d && (!d.downed || d.dead)) {
      // 被救起 → 后跳中断
      this._startBackstep();
      return;
    }
    if (this.stateT >= this.tauntDur) {
      // 往倒地玩家位置丢一块屎
      if (d) {
        this.pies.push({ x: this.bx, y: this.by - 20, z: 0, tx: d.x, ty: d.y, t: 0, dur: 0.5 });
      }
      this.invuln = false;
      this.state = 'idle';
      this.stateT = 0;
      this.tauntTarget = null;
      this.attackCd = 0.5;
    }
  }

  _startBackstep() {
    this.state = 'backstep';
    this.stateT = 0;
    this.invuln = true;
    const p = this.tauntTarget ?? this._nearestPlayer();
    if (p) {
      const dx = this.bx - p.x, dy = this.by - p.y, d = Math.hypot(dx, dy) || 1;
      this.backV = { x: (dx / d) * 700, y: (dy / d) * 700 };
    } else this.backV = { x: 0, y: -700 };
    this.tauntTarget = null;
  }

  _tickBackstep(dt) {
    this.stateT += dt;
    this.bx += this.backV.x * dt;
    this.by += this.backV.y * dt;
    this._clampToArena();
    if (this.stateT >= 0.4) {
      this.invuln = false;
      this.state = 'idle';
      this.stateT = 0;
    }
  }

  _startHeal() {
    this.state = 'heal';
    this.stateT = 0;
    this.healDur = 3 + rnd() * 2;     // 3~5 秒
    this.ringFlash = 0;
    this.ringHealAcc = 0;
    this.healCd = 16;
    this._clearBullets();
    this.invuln = false;               // 回血期间不是无敌的（不然太赖）
    // 往远离玩家的方向跑
    const p = this._nearestPlayer();
    if (p) {
      const dx = this.bx - p.x, dy = this.by - p.y, d = Math.hypot(dx, dy) || 1;
      this.healDir = { x: dx / d, y: dy / d };
    } else this.healDir = { x: 0, y: 1 };
  }

  _tickHeal(dt) {
    this.stateT += dt;
    const p = this._nearestPlayer();
    if (p) {
      // 边跑边翻滚
      this.bx += this.healDir.x * 260 * dt;
      this.by += this.healDir.y * 260 * dt;
      this._clampToArena();
      if (this.rollCd <= 0) { this.rollCd = 1.2; this.invuln = false; }
    }
    // 宠爱戒指：一秒闪 2~3 次，一次回 1%（第二百一十五轮：0.5% → 1%）
    this.ringFlash += dt;
    if (this.ringFlash >= 0.4) {
      this.ringFlash -= 0.4;
      const heal = this.boss.maxHp * 0.01;
      this.boss.hp = Math.min(this.boss.maxHp, this.boss.hp + heal);
      this.ringHealAcc += heal;
    }
    if (this.stateT >= this.healDur) {
      this.state = 'idle';
      this.stateT = 0;
      this.attackCd = 0.4;
      this.ringFlash = 0;
    }
  }

  // ---------------------------------------------------------
  // 弹幕 / 场地物件
  // ---------------------------------------------------------
  _spawnCrystals() {
    this.crystals = [];
    for (let i = 0; i < 5; i++) {
      this.crystals.push({
        ang: (i / 5) * TAU_ + rnd() * 0.3,
        dist: 110 + rnd() * 20,
        t: 0, life: 5, live: true, vx: 0, vy: 0, fired: false,
      });
    }
  }

  _tickProjectiles(dt) {
    const players = this._players();
    // 屎块：抛物线落地 → 毒雾
    for (let i = this.pies.length - 1; i >= 0; i--) {
      const b = this.pies[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.z = Math.sin(k * Math.PI) * 90;
      b.x = b.x + (b.tx - b.x) * Math.min(1, dt * 6);
      b.y = b.y + (b.ty - b.y) * Math.min(1, dt * 6);
      if (b.t >= b.dur) {
        this.pies.splice(i, 1);
        this.clouds.push({ x: b.tx, y: b.ty, t: 0, dur: 5, r: 96, seed: rnd() * 100 });
        this.slashes.push({ kind: 'boom', x: b.tx, y: b.ty, t: 0, dur: 0.3, r: 80 });
      }
    }
    // 毒雾：站在里面 → 中毒（出雾后余毒 5 秒）
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      for (const p of players) {
        if (p.downed) continue;
        if (Math.hypot(p.x - c.x, p.y - c.y) < c.r) this._poison(p);
      }
      if (c.t >= c.dur) this.clouds.splice(i, 1);
    }
    // 结晶块：环绕 5 秒 → 追踪射出
    for (const c of this.crystals) {
      if (!c.live) continue;
      c.t += dt;
      if (c.t >= c.life && !c.fired) {
        c.fired = true;
        // 找最近玩家，一口气射出
        let target = null, bd = 1e9;
        for (const p of players) {
          if (p.downed) continue;
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < bd) { bd = d; target = p; }
        }
        const ang = target ? Math.atan2(target.y - c.y, target.x - c.x) : rnd() * TAU_;
        c.vx = Math.cos(ang) * 460;
        c.vy = Math.sin(ang) * 460;
        c.life = 2.2;
      }
      if (c.fired) {
        c.x = (c.x ?? this.bx) + c.vx * dt;
        c.y = (c.y ?? this.by) + c.vy * dt;
        c.life -= dt;
        if (c.life <= 0) c.live = false;
        for (const p of players) {
          if (p.downed) continue;
          if (Math.hypot(p.x - c.x, p.y - c.y) < 26) {
            if (this._hitPlayer(p)) c.live = false;
          }
        }
      } else {
        c.x = this.bx + Math.cos(c.ang) * c.dist;
        c.y = this.by - 30 + Math.sin(c.ang) * c.dist * 0.7;
        // 碰到玩家受伤并消失
        for (const p of players) {
          if (p.downed) continue;
          if (Math.hypot(p.x - c.x, p.y - c.y) < 24) {
            if (this._hitPlayer(p)) c.live = false;
          }
        }
      }
    }
    this.crystals = this.crystals.filter((c) => c.live);
    // 弩箭
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;
      for (const p of players) {
        if (p.downed) continue;
        if (Math.hypot(p.x - b.x, p.y + (p.hitOY ?? 0) - b.y) < 24) {
          if (this._hitPlayer(p)) hit = true;
        }
      }
      if (hit || b.life <= 0) this.bolts.splice(i, 1);
    }
    // 阳光之枪：飞行 → 落点爆炸
    for (let i = this.spears.length - 1; i >= 0; i--) {
      const s = this.spears[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      s.x = s.x + (s.tx - s.x) * Math.min(1, dt * 10);
      s.y = s.y + (s.ty - s.y) * Math.min(1, dt * 10);
      if (k >= 1) {
        this.spears.splice(i, 1);
        this.whiteFlash = 0.35;
        this.slashes.push({ kind: 'sunburst', x: s.tx, y: s.ty, t: 0, dur: 0.5, r: 130, seed: (s.seed ?? 0) });
        for (const p of players) {
          if (p.downed) continue;
          if (Math.hypot(p.x - s.tx, p.y - s.ty) < 120) this._hitPlayer(p);
        }
      }
    }
    // 大风车：绕圈横扫两段
    if (this.spin) {
      const sp = this.spin;
      sp.t += dt;
      const half = sp.dur / 2;
      const stage = sp.t < half ? 0 : 1;
      if (sp.hit <= stage) {
        sp.hit = stage + 1;
        for (const p of players) {
          if (p.downed) continue;
          if (Math.hypot(p.x - this.bx, p.y - this.by) < 250) this._hitPlayer(p);
        }
        this.slashes.push({ kind: 'spin', x: this.bx, y: this.by - 20, t: 0, dur: 0.55, r: 250, dir: stage === 0 ? 1 : -1 });
        this.edgeFlash = 0.4;
      }
    }
    // 高跳竖劈
    if (this.slam) {
      const s = this.slam;
      s.t += dt;
      if (s.t >= s.dur * 0.7 && s.hit === 0) {
        s.hit = 1;
        this.bx = s.x; this.by = s.y;
        this._clampToArena();
        this.slashes.push({ kind: 'slam', x: s.x, y: s.y, t: 0, dur: 0.45, r: 150 });
        for (const p of players) {
          if (p.downed) continue;
          if (Math.hypot(p.x - s.x, p.y - s.y) < 150) this._hitPlayer(p, 1.2);
        }
        this.edgeFlash = 0.5;
      }
      if (s.t >= s.dur) this.slam = null;
    }
    // 刀光计时
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.t += dt;
      if (s.t >= s.dur) this.slashes.splice(i, 1);
    }
  }

  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    this.invuln = true;
    this.whiteFlash = 0.8;
    this._clearBullets();
    this._bgm?.pause?.();
    setTimeout(() => this.finish('beat'), 900);
  }

  // ---------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------
  _alphaIn() {
    if (this.state !== 'intro') return 1;
    if (this.introT < INTRO_BLACK_END) return 0;
    return Math.min(1, (this.introT - INTRO_BLACK_END) / (INTRO_SCENE_END - INTRO_BLACK_END));
  }

  /** 场地层（世界坐标）：背景板 → 竞技场地面 → 场外压暗与红色光点 */
  renderArena(ctx, camera) {
    const { cx, cy, hw, hh } = ARENA;
    const vw = camera.viewW ?? 1600, vh = camera.viewH ?? 900;
    const a = this._alphaIn();
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 全屏背景板（铺满视口，压暗、不喧宾夺主）
    const bd = this.images.backdrop;
    if (bd && bd.complete && bd.naturalWidth) {
      const s = Math.max(vw / bd.naturalWidth, vh / bd.naturalHeight);
      const w = bd.naturalWidth * s, h = bd.naturalHeight * s;
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(bd, camera.cx - w / 2, camera.cy - h / 2, w, h);
      ctx.globalAlpha = a;
    } else {
      ctx.fillStyle = '#0b0810';
      ctx.fillRect(camera.cx - vw / 2, camera.cy - vh / 2, vw, vh);
    }

    // 场外压暗（方形场地挖洞）
    ctx.beginPath();
    ctx.rect(camera.cx - vw / 2 - 8, camera.cy - vh / 2 - 8, vw + 16, vh + 16);
    ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.clip('evenodd');
    ctx.fillStyle = 'rgba(5,3,9,0.78)';
    ctx.fill();
    // 场外飘着的红色余烬（薪王场地的火星）
    for (let i = 0; i < 42; i++) {
      const seed = i * 12.9898;
      const ph = (this.t * (0.05 + (i % 7) * 0.01) + (i * 0.137)) % 1;
      let x = cx - hw - 260 + ((seed * 9301) % (hw * 2 + 520));
      x = Math.abs(x - cx) > hw ? x : cx + (i % 2 ? 1 : -1) * (hw + 40 + ((seed * 77) % 220));
      const y = cy + hh - ph * (hh * 2 + 260);
      const al = 0.25 + 0.35 * Math.sin(this.t * 1.7 + i);
      ctx.fillStyle = `rgba(255,90,40,${Math.max(0, al) * 0.8})`;
      ctx.beginPath(); ctx.arc(x, y, 1.6 + (i % 3) * 0.9, 0, TAU_); ctx.fill();
    }
    ctx.restore();

    // 竞技场地面
    const im = this.images.arena;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2); ctx.clip();
    if (im && im.complete && im.naturalWidth) {
      const s = Math.max((hw * 2) / im.naturalWidth, (hh * 2) / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.globalAlpha = a;
      ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
      // 整体压暗一点，别抢弹幕
      ctx.fillStyle = 'rgba(8,5,12,0.35)';
      ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    } else {
      ctx.fillStyle = '#2a2230';
      ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    }
    // 场地边框：暗紫发光
    ctx.globalAlpha = a * (0.5 + 0.2 * Math.sin(this.t * 1.6));
    ctx.strokeStyle = 'rgba(150,90,220,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.restore();
  }

  /** 世界层：Boss / 武器 / 弹幕 / 特效 */
  renderWorld(ctx, camera) {
    const a = this._alphaIn();
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 毒雾（在 boss 之下）
    for (const c of this.clouds) {
      const k = Math.min(1, c.t / 0.6) * Math.min(1, (c.dur - c.t) / 0.8);
      ctx.save();
      ctx.globalAlpha = a * 0.55 * Math.max(0, k);
      const g = ctx.createRadialGradient(c.x, c.y, 6, c.x, c.y, c.r);
      g.addColorStop(0, 'rgba(120,70,160,0.75)');
      g.addColorStop(0.55, 'rgba(80,40,110,0.45)');
      g.addColorStop(1, 'rgba(50,25,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU_); ctx.fill();
      // 冒泡
      for (let i = 0; i < 7; i++) {
        const ph = (this.t * 0.6 + i * 0.37 + c.seed) % 1;
        ctx.fillStyle = `rgba(170,120,210,${0.35 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(c.x + Math.sin(i * 2.1 + c.seed) * c.r * 0.55, c.y - ph * 30 + Math.cos(i) * 12, 2 + ph * 5, 0, TAU_);
        ctx.fill();
      }
      ctx.restore();
    }

    // 屎块 / 结晶块 / 弩箭 / 阳光之枪
    for (const b of this.pies) {
      const img = this.images.dung;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(b.x, b.ty + 6, 16, 6, 0, 0, TAU_); ctx.fill();
      if (img && img.complete && img.naturalWidth) {
        const h = 32, w = h * (img.naturalWidth / img.naturalHeight);
        ctx.drawImage(img, b.x - w / 2, b.y - b.z - h, w, h);
      } else {
        ctx.fillStyle = '#6b4a2a';
        ctx.beginPath(); ctx.arc(b.x, b.y - b.z, 12, 0, TAU_); ctx.fill();
      }
      ctx.restore();
    }
    // 灵魂结晶块：蓝色发光结晶（自绘，参考用户给的图片效果）
    for (const c of this.crystals) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(c.x, c.y);
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 6 + c.ang);
      // 外辉光
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 42 * pulse);
      g.addColorStop(0, 'rgba(160,230,255,0.75)');
      g.addColorStop(0.5, 'rgba(70,150,255,0.35)');
      g.addColorStop(1, 'rgba(40,90,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 42 * pulse, 0, TAU_); ctx.fill();
      // 结晶本体：拉长的六棱
      ctx.rotate(c.fired ? Math.atan2(c.vy, c.vx) + Math.PI / 2 : this.t * 1.4 + c.ang);
      const cg = ctx.createLinearGradient(-12, -26, 12, 26);
      cg.addColorStop(0, 'rgba(235,252,255,0.98)');
      cg.addColorStop(0.45, 'rgba(110,205,255,0.95)');
      cg.addColorStop(1, 'rgba(40,110,235,0.9)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(10, -8); ctx.lineTo(7, 16); ctx.lineTo(0, 26);
      ctx.lineTo(-7, 16); ctx.lineTo(-10, -8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(190,240,255,0.95)'; ctx.lineWidth = 1.6; ctx.stroke();
      // 内部棱面
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, 20); ctx.moveTo(-8, -6); ctx.lineTo(0, 2); ctx.lineTo(8, -6); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(3.2, -2); ctx.lineTo(0, 12); ctx.lineTo(-3.2, -2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (const b of this.bolts) {
      const ang = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.globalAlpha = a;
      // 第二百一十五轮：弩箭加大（原 26px 细线太小，几乎看不见）
      // 箭杆 + 铁箭头 + 尾羽，长度 ~52px
      ctx.strokeStyle = '#e6d6ac'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,95,60,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(12, 0); ctx.stroke();
      // 尾羽
      ctx.fillStyle = '#b8443c';
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-32, -6); ctx.lineTo(-22, -1.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-32, 6); ctx.lineTo(-22, 1.5); ctx.closePath(); ctx.fill();
      // 箭头
      ctx.fillStyle = '#fff2c0';
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(9, -7); ctx.lineTo(12, 0); ctx.lineTo(9, 7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,120,0.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(21, 0); ctx.lineTo(12, 5); ctx.stroke();
      ctx.restore();
    }
    // 阳光之枪：金色雷电长枪 + 拖尾（自绘，参考图片的黄色闪电）
    for (const s of this.spears) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter';
      // 拖尾光带
      const tg = ctx.createLinearGradient(-120, 0, 10, 0);
      tg.addColorStop(0, 'rgba(255,200,60,0)');
      tg.addColorStop(0.6, 'rgba(255,220,90,0.35)');
      tg.addColorStop(1, 'rgba(255,250,190,0.85)');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.moveTo(-200, -6); ctx.lineTo(10, -2.5); ctx.lineTo(10, 2.5); ctx.lineTo(-200, 6); ctx.closePath(); ctx.fill();
      // 枪身：锯齿闪电
      const jag = (seed, len, amp) => {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          pts.push([-len * (1 - t), Math.sin(seed + i * 2.7 + this.t * 20) * amp * (1 - t)]);
        }
        return pts;
      };
      // 光晕（沿枪身，不是一颗球）
      const sg = ctx.createLinearGradient(-190, 0, 20, 0);
      sg.addColorStop(0, 'rgba(255,200,60,0)');
      sg.addColorStop(0.5, 'rgba(255,210,80,0.22)');
      sg.addColorStop(1, 'rgba(255,245,180,0.5)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.ellipse(-85, 0, 125, 16, 0, 0, TAU_); ctx.fill();
      for (const [w, col, amp] of [[16, 'rgba(255,190,40,0.28)', 26], [7, 'rgba(255,228,100,0.8)', 17], [2.6, 'rgba(255,255,240,0.98)', 9]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'miter';
        ctx.beginPath();
        const pts = jag(s.seed ?? 1, 230, amp);
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const q of pts) ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      // 分叉闪电
      for (let b = 0; b < 3; b++) {
        const by = (b - 1) * 7;
        const bx0 = -120 + b * 24;
        ctx.strokeStyle = 'rgba(255,235,130,0.55)'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(bx0, by);
        ctx.lineTo(bx0 - 18, by - 14 - b * 4);
        ctx.lineTo(bx0 - 30, by - 6 - b * 5);
        ctx.stroke();
      }
      // 枪尖
      ctx.fillStyle = 'rgba(255,250,210,0.95)';
      ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(2, -9); ctx.lineTo(2, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 刀光
    for (const s of this.slashes) this._drawSlash(ctx, s);

    // 法兰大风车：地上插着的短剑 + 轨迹圆
    if (this.orbit) {
      const o = this.orbit;
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = 'rgba(255,170,80,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 12]);
      ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, TAU_); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      const sImg = this.images.farron_ss;
      if (sImg && sImg.complete && sImg.naturalWidth) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(o.cx, o.cy);
        ctx.rotate(-0.5);
        const H2 = 66, W2 = H2 * (sImg.naturalWidth / sImg.naturalHeight) * 0.8;
        ctx.drawImage(sImg, -W2 * 0.5, -H2 * 0.28, W2, H2);
        ctx.restore();
      }
    }

    // Boss（翻滚旋转 / 嘲讽旋转）
    this._drawBoss(ctx);

    // 宠爱戒指（头顶闪烁）
    if (this.state === 'heal') this._drawRing(ctx);
    ctx.restore();
  }

  _drawSlash(ctx, s) {
    const k = Math.min(1, s.t / s.dur);
    const fade = 1 - k;
    ctx.save();
    if (s.kind === 'stab') {
      // 小镰刀冲刺：紫光长条 + 尖端（用户："小镰刀看不出来他是攻击了"）
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.globalCompositeOperation = 'lighter';
      const len = 55 + 75 * k;
      for (const [w, col] of [[12, 'rgba(150,70,255,0.22)'], [5, 'rgba(195,130,255,0.75)'], [1.8, 'rgba(248,230,255,0.95)']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * fade + 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(len, 0); ctx.stroke();
      }
      ctx.fillStyle = `rgba(225,190,255,${fade})`;
      ctx.beginPath(); ctx.arc(len, 0, 3 + 5 * k, 0, TAU_); ctx.fill();
      // 小火星
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU_ + s.t * 8;
        ctx.fillStyle = `rgba(210,160,255,${0.6 * fade})`;
        ctx.beginPath(); ctx.arc(len + Math.cos(a) * 8, Math.sin(a) * 8, 1.6, 0, TAU_); ctx.fill();
      }
    } else if (s.kind === 'wide' || s.kind === 'spin') {
      // 火焰大横斩 / 大风车：从角色到弧线的整片扇形（剑身扫过的面都有光）+ 亮边 + 火星
      const dir = s.dir ?? 1;
      const r = s.r;
      const half = s.big ? Math.PI / 2 : 0.8;         // 最后一击 = 半圆
      const a0 = -1.1 + k * 2.2;
      ctx.translate(s.x, s.y);
      ctx.rotate(dir > 0 ? a0 : Math.PI - a0);
      ctx.globalCompositeOperation = 'lighter';
      // 扇形柔光：从角色身前往外铺满，弱化"只有一条弧"的廉价感
      const g2 = ctx.createRadialGradient(0, 0, 14, 0, 0, r);
      g2.addColorStop(0, 'rgba(255,120,30,0)');
      g2.addColorStop(0.5, 'rgba(255,115,25,0.1)');
      g2.addColorStop(0.88, 'rgba(255,180,70,0.26)');
      g2.addColorStop(1, 'rgba(255,225,140,0.42)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, -half, half); ctx.closePath(); ctx.fill();

      // 刀光带
      for (const [w, col] of [
        [r * 0.34, 'rgba(255,60,8,0.2)'],
        [r * 0.2, 'rgba(255,110,20,0.42)'],
        [r * 0.09, 'rgba(255,175,60,0.68)'],
        [r * 0.035, 'rgba(255,245,200,0.9)'],
      ]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * (0.92 + 0.08 * Math.sin(this.t * 21));
        ctx.beginPath(); ctx.arc(0, 0, r * 0.78, -half, half); ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255,252,225,${0.95 * fade})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.93, -half * 0.95, half * 0.95); ctx.stroke();

      // 剑身本体的亮线：从角色手里一直延伸到刃尖（整把剑都有伤害感）
      const lead = -half + 2 * half * Math.min(1, k * 1.15);
      ctx.strokeStyle = `rgba(255,238,190,${0.85 * fade})`;
      ctx.lineWidth = s.big ? 8 : 5.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(lead) * r * 0.96, Math.sin(lead) * r * 0.96); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,240,${0.9 * fade})`; ctx.lineWidth = s.big ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(lead) * r * 0.96, Math.sin(lead) * r * 0.96); ctx.stroke();
      // 刃尖光斑
      ctx.fillStyle = `rgba(255,250,225,${0.9 * fade})`;
      ctx.beginPath(); ctx.arc(Math.cos(lead) * r * 0.96, Math.sin(lead) * r * 0.96, s.big ? 15 : 9, 0, TAU_); ctx.fill();

      // 沿弧线的火星 + 火舌尖刺
      for (let i = 0; i < 18; i++) {
        const a = -half + (i / 17) * (2 * half);
        const rr = r * (0.72 + 0.18 * ((i % 3) / 2) + 0.05 * Math.sin(this.t * 9 + i));
        ctx.fillStyle = `rgba(255,${160 + (i % 3) * 35},60,${0.8 * fade})`;
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.4 + (i % 3) * 1.3, 0, TAU_); ctx.fill();
      }
      for (let i = 0; i < 11; i++) {
        const a = -half + (i / 10) * (2 * half);
        const len = (10 + 9 * Math.sin(this.t * 15 + i * 1.7)) * fade;
        ctx.strokeStyle = `rgba(255,${130 + (i % 3) * 30},40,${0.55 * fade})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94);
        ctx.lineTo(Math.cos(a) * (r * 0.94 + len), Math.sin(a) * (r * 0.94 + len));
        ctx.stroke();
      }
      // 最后一击：外圈半圆闪光
      if (s.big) {
        ctx.strokeStyle = `rgba(255,240,190,${0.9 * fade})`;
        ctx.lineWidth = 6 * fade + 2;
        ctx.beginPath(); ctx.arc(0, 0, r * (0.95 + 0.08 * k), -half, half); ctx.stroke();
      }
    } else if (s.kind === 'orbit') {
      // 法兰大剑画大圈：整圈火环扫过
      ctx.translate(s.x, s.y);
      ctx.globalCompositeOperation = 'lighter';
      const start = s.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      const sweep = s.dir * Math.PI * 1.7 * Math.min(1, k * 2.2);
      for (const [w, col] of [[36, 'rgba(255,60,10,0.16)'], [20, 'rgba(255,120,25,0.3)'], [8, 'rgba(255,190,70,0.55)'], [3, 'rgba(255,250,210,0.9)']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * (0.85 + 0.15 * fade);
        ctx.beginPath(); ctx.arc(0, 0, s.r, start, start + sweep, s.dir < 0); ctx.stroke();
      }
      for (let i = 0; i < 20; i++) {
        const a = start + sweep * (i / 19);
        ctx.fillStyle = `rgba(255,${150 + (i % 3) * 30},50,${0.8 * fade})`;
        ctx.beginPath(); ctx.arc(Math.cos(a) * s.r, Math.sin(a) * s.r, 2 + (i % 3), 0, TAU_); ctx.fill();
      }
    } else if (s.kind === 'slam') {
      // 高跳竖劈：竖直光柱 + 地面冲击环
      ctx.translate(s.x, s.y);
      ctx.globalCompositeOperation = 'lighter';
      const pg = ctx.createLinearGradient(0, -300, 0, 60);
      pg.addColorStop(0, 'rgba(255,200,90,0)');
      pg.addColorStop(0.7, `rgba(255,170,70,${0.35 * fade})`);
      pg.addColorStop(1, `rgba(255,245,200,${0.75 * fade})`);
      ctx.fillStyle = pg;
      ctx.fillRect(-26 * fade - 8, -300, 52 * fade + 16, 360);
      ctx.strokeStyle = 'rgba(255,160,60,0.9)'; ctx.lineWidth = 9 * fade + 3;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.35 + k * 0.8), 0, TAU_); ctx.stroke();
      ctx.fillStyle = `rgba(255,210,130,${0.28 * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.3 + k * 0.75), 0, TAU_); ctx.fill();
    } else if (s.kind === 'boom') {
      ctx.translate(s.x, s.y);
      ctx.fillStyle = `rgba(120,180,80,${0.4 * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.5 + k * 0.8), 0, TAU_); ctx.fill();
    } else if (s.kind === 'sunburst') {
      // 阳光之枪落点：金黄爆闪 + 放射状雷电
      ctx.translate(s.x, s.y);
      ctx.globalCompositeOperation = 'lighter';
      // 爆闪：中心亮核 + 外环（不是一整块白饼）
      const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, s.r * (0.32 + k * 0.5));
      gg.addColorStop(0, `rgba(255,255,240,${0.85 * fade})`);
      gg.addColorStop(0.4, `rgba(255,220,120,${0.4 * fade})`);
      gg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.32 + k * 0.5), 0, TAU_); ctx.fill();
      ctx.strokeStyle = `rgba(255,240,170,${0.8 * fade})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.35 + k * 0.75), 0, TAU_); ctx.stroke();
      // 放射状雷电（折线更凶）
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * TAU_ + (s.seed ?? 0);
        const len = s.r * (0.55 + k * 1.0) * (0.6 + ((i * 37) % 10) / 14);
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,255,235,0.95)' : 'rgba(255,215,80,0.85)';
        ctx.lineWidth = i % 3 === 0 ? 2.6 : 1.6;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let q = 1; q <= 5; q++) {
          const rr = (len * q) / 5;
          const side = (q % 2 ? 1 : -1) * (1 - k) * (10 + q * 3);
          ctx.lineTo(Math.cos(ang) * rr + Math.sin(ang) * side, Math.sin(ang) * rr - Math.cos(ang) * side);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawBoss(ctx) {
    const img = this.images.boss;
    const h = 132;   // 第二百一十轮：整体缩小（用户：魂5 boss 整体太大了）
    const w = img && img.complete && img.naturalWidth ? h * (img.naturalWidth / img.naturalHeight) : 150;
    let rot = 0;
    if (this.state === 'roll' && this.roll) rot = this.roll.ang * (this.face);
    else if (this.state === 'taunt') rot = this.tauntSpin * this.face;
    ctx.save();
    // 高跳竖劈：立绘先升空再砸下
    const jump = this.slam ? Math.sin(Math.min(1, this.slam.t / (this.slam.dur * 0.7)) * Math.PI) * 110 : 0;
    ctx.translate(this.bx, this.by + this.bob - jump);
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 26, 52, 16, 0, 0, TAU_); ctx.fill();
    // 翻滚 / 嘲讽旋转：绕自身中心转
    if (rot) { ctx.translate(0, -h * 0.4); ctx.rotate(rot); ctx.translate(0, h * 0.4); }
    if (img && img.complete && img.naturalWidth) {
      // 受击闪白
      if (this.whiteFlash > 0.05) {
        ctx.globalAlpha = Math.min(1, this.whiteFlash);
        ctx.drawImage(img, -w / 2, -h + 30, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(img, -w / 2, -h + 30, w, h);
    } else {
      ctx.fillStyle = '#6b6b74';
      ctx.fillRect(-46, -h + 30, 92, h);
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.arc(0, -h + 64, 34, 0, TAU_); ctx.fill();
    }

    // 附魔辉光（小镰刀暗紫 / 直剑火焰 / 法兰白）—— 画在武器底下
    const glowCol = this.weapon === 'scythe' ? '168,90,255' : this.weapon === 'rkgs' ? '255,140,60' : '220,220,255';
    const gx = this.face * 52, gy = -h * 0.52;
    if (this.weaponGlow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(gx, gy, 4, gx, gy, 64);
      g.addColorStop(0, `rgba(${glowCol},${0.35 * this.weaponGlow})`);
      g.addColorStop(1, `rgba(${glowCol},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gx, gy, 64, 0, TAU_); ctx.fill();
      ctx.restore();
    }

    // 武器（boss 本体局部坐标，永远贴在手上）
    this._drawWeapon(ctx, gx, gy);

    ctx.restore();

    // 阳光之枪读条预警（世界坐标）
    if (this.state === 'act' && this.act && this.act.id === 'sunlight' && this.act.hit === 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 20);
      ctx.strokeStyle = 'rgba(255,220,120,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.bx, this.by - 30, 40 + this.act.t * 30, 0, TAU_); ctx.stroke();
      ctx.restore();
    }
  }

  /** 按 alpha 染色的武器副本：附魔只让武器像素本身发光（不是一颗紫球） */
  _tinted(key, color) {
    const img = this.images[key];
    if (!img || !img.complete || !img.naturalWidth) return null;
    this._tints = this._tints || {};
    const k = `${key}|${color}`;
    if (this._tints[k]) return this._tints[k];
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color;
      x.fillRect(0, 0, c.width, c.height);
      this._tints[k] = c;
      return c;
    } catch { return null; }
  }

  /** 每种武器的握柄位置（图片归一化坐标）：绕它旋转才是"挥武器"而不是转魔法棒 */
  static GRIP = {
    scythe: [0.72, 0.03], rkgs: [0.5, 0.02], farron_gs: [0.5, 0.02],
    farron_ss: [0.28, 0.16], crossbow: [0.5, 0.62],
  };

  /**
   * 武器的当前姿势：{ ang, tx, ty, ghosts }
   * ang = 绕握柄的旋转；tx/ty = 世界坐标位移（突刺的前冲）；ghosts = 残影数量
   */
  _weaponPose() {
    // 武器的"剑身/刃"在图片底部（本地 +Y）。让它指向目标：ang = aim - π/2。
    const p = this._nearestPlayer();
    const aim = p ? Math.atan2((p.y + (p.hitOY ?? 0)) - (this.by - 80), p.x - this.bx) : (this.face > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.aim = aim;
    const base = aim - Math.PI / 2;
    let ang = base, tx = 0, ty = 0, ghosts = 0;
    if (this.state === 'intro') {
      // 入场附魔：横持在身前
      ang = this.face > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    } else if (this.orbit) {
      // 法兰大风车：大剑指向圆外（短剑在圆心）
      ang = this.orbit.phi - Math.PI / 2;
      ghosts = 3;
    } else if (this.state === 'act' && this.act) {
      const a = this.act;
      const k = Math.min(1, a.t / a.dur);
      if (a.id === 'poke') {
        const kk = (k * 3) % 1;
        const lunge = Math.sin(Math.min(1, kk / 0.55) * Math.PI);
        ang = base + 0.12 - lunge * 0.08;
        tx = Math.cos(aim) * (10 + lunge * 34);
        ty = Math.sin(aim) * (10 + lunge * 34);
        ghosts = lunge > 0.45 ? 1 : 0;
      } else if (a.id === 'flame5') {
        // 五连斩：每段起手 → 挥出 → 收刀
        const kk = (k * 5) % 1;
        let sw;
        if (kk < 0.22) sw = -1.0 * (kk / 0.22);
        else if (kk < 0.62) sw = -1.0 + ((kk - 0.22) / 0.4) * 2.2;
        else sw = 1.2 - ((kk - 0.62) / 0.38) * 1.4;
        ang = base + sw;
        ghosts = 3;
      } else if (a.id === 'crossbow') {
        // 第二百一十五轮：弩的射击头在图片的"底部偏左"，不是本地 +Y。
        // 图片里的枪口方向约 3π/4（左下），减去它才能让弩口真正对着玩家。
        ang = aim - Math.PI * 0.75; tx = Math.cos(aim) * 6; ty = Math.sin(aim) * 6;
      } else {
        ang = base;
      }
      // 高跳竖劈：举刀 → 劈下
      if (this.slam) {
        const sk = Math.min(1, this.slam.t / this.slam.dur);
        const sw = sk < 0.55 ? -1.35 * (sk / 0.55) : -1.35 + ((sk - 0.55) / 0.45) * 2.6;
        ang = base + sw; ghosts = 2;
      }
    } else if (this.state === 'taunt') {
      ang = base + this.tauntSpin;
      ghosts = 2;
    } else if (this.state === 'roll' && this.roll) {
      ang = base + this.roll.ang;
    }
    return { ang, tx, ty, ghosts, aim };
  }

  _drawWeapon(ctx, gx, gy) {
    const key = this.weapon === 'scythe' ? 'scythe' : this.weapon === 'rkgs' ? 'rkgs' : this.weapon === 'crossbow' ? 'crossbow' : 'farron_gs';
    const img = this.images[key];
    const H = key === 'scythe' ? 122 : key === 'farron_gs' ? 145 : key === 'rkgs' ? 156 : 100;   // 直剑 +20%
    const W = img && img.complete && img.naturalWidth ? H * (img.naturalWidth / img.naturalHeight) : 16;
    const grip = Soul5Fight.GRIP[key] ?? [0.5, 0.9];
    const pose = this._weaponPose();
    const px = gx + pose.tx, py = gy + pose.ty;
    const pulse = 0.6 + 0.25 * Math.sin(this.t * 6);
    const drawImg = (src, ang, alpha, comp) => {
      if (!src) return;
      ctx.save();
      ctx.globalCompositeOperation = comp;
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.drawImage(src, -grip[0] * W, -grip[1] * H, W, H);
      ctx.restore();
    };

    // ---- 挥动残影（直剑橙 / 镰刀紫）：沿挥动方向错开几帧 ----
    if (pose.ghosts && this.weaponGlow > 0.02) {
      const tintGhost = this._tinted(key, key === 'scythe' ? '#a86bff' : key === 'rkgs' ? '#ff7a1a' : '#dfe6ff');
      if (tintGhost) {
        for (let i = pose.ghosts; i >= 1; i--) {
          const a = pose.ang - this.face * 0.13 * i;
          drawImg(tintGhost, a, 0.16 * this.weaponGlow * (1 - i / (pose.ghosts + 1)), 'lighter');
        }
      }
    }

    // ---- 本体 ----
    if (img && img.complete && img.naturalWidth) drawImg(img, pose.ang, 1, 'source-over');
    else drawImg(null, pose.ang, 1, 'source-over');

    // ---- 附魔：同轮廓染色叠加 ----
    if (this.weaponGlow > 0.02) {
      const col = key === 'scythe' ? '#c07bff' : key === 'rkgs' ? '#ff8a2a' : null;
      if (col) {
        const tint = this._tinted(key, col);
        if (tint) drawImg(tint, pose.ang, Math.min(1, this.weaponGlow * (pulse + 0.35)), 'lighter');
      }
      if (key === 'rkgs') {
        const core = this._tinted('rkgs', '#ffe08a');
        if (core) drawImg(core, pose.ang, Math.min(1, this.weaponGlow * (0.6 + 0.2 * Math.sin(this.t * 9))), 'lighter');
        // 沿剑身的火舌（局部坐标：从握柄往剑尖）
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pose.ang);
        ctx.globalCompositeOperation = 'lighter';
        // 整条剑身包一层火光（三层：外焰 / 内焰 / 白心）
        const L = grip[1] * H;
        const flick = 0.85 + 0.15 * Math.sin(this.t * 17);
        for (const [lw, col] of [[13 * flick, 'rgba(255,90,20,0.35)'], [7 * flick, 'rgba(255,150,40,0.6)'], [3, 'rgba(255,240,190,0.9)']]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.quadraticCurveTo(Math.sin(this.t * 7) * 3, -L * 0.55, 0, -L + 2);
          ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const ph = (this.t * 1.6 + i * 0.11) % 1;
          const y = -grip[1] * H + ph * H * 0.9;
          const x = Math.sin(this.t * 6 + i * 2.1) * W * 0.32;
          ctx.fillStyle = `rgba(255,${145 + (i % 3) * 35},45,${0.85 * (1 - ph) * this.weaponGlow})`;
          ctx.beginPath(); ctx.arc(x, y, 1.5 + (1 - ph) * 3.6, 0, TAU_); ctx.fill();
        }
        ctx.restore();
      }
      if (key === 'scythe') {
        // 镰刀刃口的紫光：在刃的一侧描一条紫色光边
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pose.ang);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(200,140,255,${0.5 * this.weaponGlow})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(-grip[0] * W + W * 0.5, -grip[1] * H + H * 0.52, W * 0.34, -0.4, 2.2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // P3 左手法兰短剑（第二百一十五轮：用局部坐标贴在左手边，不再叠加
    // 世界坐标 this.bx —— 之前会画到 2×bx 的位置，Boss 一移动短剑就"飞走"）
    if (this.weapon === 'farron' && !this.orbit) {
      const sImg = this.images.farron_ss;
      if (sImg && sImg.complete && sImg.naturalWidth) {
        const H2 = 60, W2 = H2 * (sImg.naturalWidth / sImg.naturalHeight) * 0.8;
        const g2 = Soul5Fight.GRIP.farron_ss;
        ctx.save();
        ctx.translate(-this.face * 34, gy + 16);
        ctx.rotate(this.face * (0.5 + 0.12 * Math.sin(this.t * 3)));
        ctx.drawImage(sImg, -g2[0] * W2, -g2[1] * H2, W2, H2);
        ctx.restore();
      }
    }
  }

  _drawRing(ctx) {
    const img = this.images.ring;
    const blink = Math.sin(this.t * (Math.PI * 2 * 2.5)) > 0 ? 1 : 0.25;   // 2.5 次/秒
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.globalCompositeOperation = 'lighter';
    const y = this.by - 330 + this.bob;
    if (img && img.complete && img.naturalWidth) {
      const H = 52, W = H * (img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, this.bx - W / 2, y, W, H);
    } else {
      ctx.strokeStyle = 'rgba(255,220,120,0.95)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(this.bx, y + 20, 18, 0, TAU_); ctx.stroke();
    }
    ctx.restore();
  }

  /** 屏幕层：入场黑幕 / 受击红边 / 白闪 */
  renderScreen(ctx, W, H) {
    if (this.state === 'intro') {
      const t = this.introT;
      let black = 0;
      if (t < INTRO_BLACK_END) black = Math.min(1, t / (INTRO_BLACK_END * 0.9));
      else if (t < INTRO_SCENE_END + 0.6) black = Math.max(0, 1 - (t - INTRO_BLACK_END) / 2.6);
      // 附魔阶段：轻微暗紫压角
      if (t >= INTRO_SCENE_END && t < INTRO_END) black = Math.min(0.35, black + 0.12);
      if (black > 0.004) {
        ctx.save();
        ctx.fillStyle = `rgba(2,1,6,${black})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
    if (this.whiteFlash > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.whiteFlash) * 0.85})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (this.edgeFlash > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(120,0,40,0)');
      g.addColorStop(1, `rgba(120,0,40,${0.5 * this.edgeFlash})`);
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}