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
    this.spin = null;
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
    const want = 150;   // 立绘很大，站远一点别把玩家盖住（戳击 150 刚好够得着）
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
        ? ['slash', 'slash', 'crystals', 'poke']
        : ['spin', 'slash', 'crossbow', 'sunlight', 'poke', 'dung'];
    let id = pool[(rnd() * pool.length) | 0];
    if (id === this.lastAct && pool.length > 1 && rnd() < 0.5) id = pool[(rnd() * pool.length) | 0];
    this.lastAct = id;
    this._startAct(id);
  }

  _startAct(id) {
    this.state = 'act';
    this.stateT = 0;
    const spd = this.spdMul;
    this.act = {
      id, t: 0, spd,
      dur: id === 'poke' ? 0.9 / spd : id === 'dung' ? 1.0 / spd : id === 'slash' ? 1.25 / spd
        : id === 'crystals' ? 1.2 : id === 'spin' ? 2.2 : id === 'crossbow' ? 1.6 / spd : 1.2,
      fired: 0, hit: 0,
    };
    if (id === 'crossbow') this.weapon = 'crossbow';
    else if (id === 'spin' || id === 'slash') this.weapon = this.phase === 3 ? 'farron' : 'rkgs';
    else if (id === 'poke' || id === 'dung') this.weapon = 'scythe';
  }

  _tickAct(dt) {
    const a = this.act;
    if (!a) { this.state = 'idle'; return; }
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);

    switch (a.id) {
      case 'poke': {
        // 三段快速戳击
        const marks = [0.22, 0.5, 0.78];
        if (a.hit < marks.length && k >= marks[a.hit]) {
          a.hit++;
          this._hitInArc(150, 120, 1);
          this.slashes.push({ kind: 'stab', x: this.bx + this.face * 55, y: this.by - 30, ang: this.face > 0 ? 0 : Math.PI, t: 0, dur: 0.18 });
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
      case 'slash': {
        // 连续两段大范围横斩
        const marks = [0.3, 0.62];
        if (a.hit < marks.length && k >= marks[a.hit]) {
          a.hit++;
          this._hitInArc(230, 220, 1);
          this.slashes.push({ kind: 'wide', x: this.bx, y: this.by - 20, ang: this.face > 0 ? 0 : Math.PI, t: 0, dur: 0.26, r: 220 });
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
      case 'spin': {
        // 前冲 → 插地 → 左一圈右一圈 → 高跳竖劈
        if (a.hit === 0 && k >= 0.15) {
          a.hit = 1;
          const p = this._nearestPlayer();
          if (p) {
            const dx = p.x - this.bx, dy = p.y - this.by, d = Math.hypot(dx, dy) || 1;
            this.dash = { t: 0, dur: 0.22, vx: (dx / d) * 620, vy: (dy / d) * 620 };
          }
        }
        if (a.hit === 1 && k >= 0.4) {
          a.hit = 2;
          this.spin = { t: 0, dur: 1.0, dir: 1, hit: 0 };
        }
        if (a.hit === 2 && this.spin && this.spin.t >= this.spin.dur) {
          a.hit = 3;
          this.spin = null;
          const p = this._nearestPlayer();
          this.slam = { t: 0, dur: 0.55, x: p?.x ?? this.bx, y: p?.y ?? this.by, hit: 0 };
        }
        break;
      }
      case 'crossbow': {
        // 1.6s 内 9 发瞄准弩箭
        const shots = 9;
        const due = Math.floor(k * shots);
        while (a.fired < due) {
          a.fired++;
          const p = this._nearestPlayer();
          if (p) {
            const ang = Math.atan2(p.y - (this.by - 30), p.x - this.bx) + (rnd() - 0.5) * 0.06;
            this.bolts.push({ x: this.bx, y: this.by - 30, vx: Math.cos(ang) * 780, vy: Math.sin(ang) * 780, life: 1.6 });
          }
        }
        break;
      }
      case 'sunlight': {
        if (a.hit === 0 && k >= 0.5) {
          a.hit = 1;
          const p = this._nearestPlayer();
          if (p) this.spears.push({ x: this.bx, y: this.by - 60, tx: p.x, ty: p.y, t: 0, dur: 0.42, ang: Math.atan2(p.y - this.by + 60, p.x - this.bx) });
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
    // 宠爱戒指：一秒闪 2~3 次，一次回 0.5%
    this.ringFlash += dt;
    if (this.ringFlash >= 0.4) {
      this.ringFlash -= 0.4;
      const heal = this.boss.maxHp * 0.005;
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
        this.slashes.push({ kind: 'sunburst', x: s.tx, y: s.ty, t: 0, dur: 0.45, r: 120 });
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
          if (Math.hypot(p.x - this.bx, p.y - this.by) < 260) this._hitPlayer(p);
        }
        this.slashes.push({ kind: 'spin', x: this.bx, y: this.by - 20, t: 0, dur: 0.5, r: 250, dir: stage === 0 ? 1 : -1 });
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
        const h = 46, w = h * (img.naturalWidth / img.naturalHeight);
        ctx.drawImage(img, b.x - w / 2, b.y - b.z - h, w, h);
      } else {
        ctx.fillStyle = '#6b4a2a';
        ctx.beginPath(); ctx.arc(b.x, b.y - b.z, 12, 0, TAU_); ctx.fill();
      }
      ctx.restore();
    }
    for (const c of this.crystals) {
      const img = this.images.crystal;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(c.x, c.y);
      ctx.rotate(this.t * 1.2 + c.ang);
      if (img && img.complete && img.naturalWidth) {
        const h = 42, w = h * (img.naturalWidth / img.naturalHeight);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = 'rgba(150,220,255,0.9)';
        ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(10, 0); ctx.lineTo(0, 16); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    for (const b of this.bolts) {
      const ang = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#d8c8a0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.fillStyle = '#fff2c0';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(7, -4); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (const s of this.spears) {
      const img = this.images.sunlight;
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(s.ang + Math.PI / 2);
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter';
      if (img && img.complete && img.naturalWidth) {
        const h = 150, w = h * (img.naturalWidth / img.naturalHeight);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = 'rgba(255,230,120,0.9)';
        ctx.fillRect(-4, -60, 8, 120);
      }
      ctx.restore();
    }

    // 刀光
    for (const s of this.slashes) this._drawSlash(ctx, s);

    // Boss（翻滚旋转 / 嘲讽旋转）
    this._drawBoss(ctx);

    // 宠爱戒指（头顶闪烁）
    if (this.state === 'heal') this._drawRing(ctx);
    ctx.restore();
  }

  _drawSlash(ctx, s) {
    const k = s.t / s.dur;
    const fade = 1 - k;
    ctx.save();
    ctx.globalAlpha = fade;
    if (s.kind === 'stab') {
      ctx.translate(s.x, s.y); ctx.rotate(s.ang);
      ctx.strokeStyle = 'rgba(190,140,255,0.9)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(90, 0); ctx.stroke();
    } else if (s.kind === 'wide' || s.kind === 'spin') {
      const dir = s.dir ?? 1;
      const r = s.r;
      const a0 = -0.9 + k * 1.8;
      ctx.translate(s.x, s.y);
      ctx.rotate(dir > 0 ? a0 : Math.PI - a0);
      ctx.strokeStyle = 'rgba(255,150,60,0.9)';
      ctx.lineWidth = 14 * fade + 4;
      ctx.beginPath(); ctx.arc(0, 0, r, -0.5, 0.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,235,160,0.85)';
      ctx.lineWidth = 5 * fade + 2;
      ctx.beginPath(); ctx.arc(0, 0, r, -0.45, 0.45); ctx.stroke();
    } else if (s.kind === 'slam') {
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = 'rgba(255,120,60,0.9)'; ctx.lineWidth = 10 * fade + 3;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.35 + k * 0.75), 0, TAU_); ctx.stroke();
      ctx.fillStyle = `rgba(255,200,120,${0.25 * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.3 + k * 0.7), 0, TAU_); ctx.fill();
    } else if (s.kind === 'boom') {
      ctx.translate(s.x, s.y);
      ctx.fillStyle = `rgba(120,180,80,${0.4 * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.5 + k * 0.8), 0, TAU_); ctx.fill();
    } else if (s.kind === 'sunburst') {
      ctx.translate(s.x, s.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,235,150,${0.55 * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, s.r * (0.3 + k * 0.8), 0, TAU_); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TAU_;
        ctx.strokeStyle = `rgba(255,240,170,${0.7 * fade})`; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * 10, Math.sin(ang) * 10);
        ctx.lineTo(Math.cos(ang) * s.r * (0.4 + k), Math.sin(ang) * s.r * (0.4 + k)); ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawBoss(ctx) {
    const img = this.images.boss;
    const h = 180;
    const w = img && img.complete && img.naturalWidth ? h * (img.naturalWidth / img.naturalHeight) : 150;
    let rot = 0;
    if (this.state === 'roll' && this.roll) rot = this.roll.ang * (this.face);
    else if (this.state === 'taunt') rot = this.tauntSpin * this.face;
    ctx.save();
    ctx.translate(this.bx, this.by + this.bob);
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

  _drawWeapon(ctx, gx, gy) {
    const key = this.weapon === 'scythe' ? 'scythe' : this.weapon === 'rkgs' ? 'rkgs' : this.weapon === 'crossbow' ? 'crossbow' : 'farron_gs';
    const img = this.images[key];
    // 动作角度：戳/斩/转
    let ang = this.face > 0 ? -0.35 : Math.PI + 0.35;
    let reach = 1;
    if (this.state === 'act' && this.act) {
      const k = Math.min(1, this.act.t / this.act.dur);
      if (this.act.id === 'poke' || this.act.id === 'slash') ang = (this.face > 0 ? -0.9 + k * 1.6 : Math.PI + 0.9 - k * 1.6);
    }
    if (this.spin) ang += this.t * 22;
    if (this.state === 'taunt') ang += this.tauntSpin;
    if (this.state === 'roll' && this.roll) ang += this.roll.ang;
    if (this.state === 'heal') reach = 0.6;

    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(ang);
    ctx.scale(this.face, 1);
    if (img && img.complete && img.naturalWidth) {
      const H = key === 'scythe' ? 150 : key === 'farron_gs' ? 190 : key === 'rkgs' ? 175 : 135;
      const W = H * (img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, -W * 0.22, -H * 0.5, W, H);
    } else {
      ctx.fillStyle = '#cfd2e0';
      ctx.fillRect(-6, -80, 12, 160);
    }
    ctx.restore();

    // P3 左手法兰短剑
    if (this.weapon === 'farron') {
      const sImg = this.images.farron_ss;
      ctx.save();
      ctx.translate(-this.face * 40, gy + 26);
      ctx.rotate(ang * -0.6);
      ctx.scale(this.face, 1);
      if (sImg && sImg.complete && sImg.naturalWidth) {
        const H = 110, W = H * (sImg.naturalWidth / sImg.naturalHeight);
        ctx.drawImage(sImg, -W * 0.22, -H * 0.5, W, H);
      }
      ctx.restore();
    }
    // 火焰附魔（环印骑士直剑）
    if (this.weapon === 'rkgs' && this.weaponGlow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const ph = (this.t * 2 + i * 0.37) % 1;
        const fx = gx + Math.cos(ang) * (20 + ph * 70) * this.face;
        const fy = gy + Math.sin(ang) * (20 + ph * 70) - ph * 20;
        ctx.fillStyle = `rgba(255,${140 + (i % 3) * 30},40,${0.5 * (1 - ph) * this.weaponGlow})`;
        ctx.beginPath(); ctx.arc(fx, fy, 5 + ph * 7, 0, TAU_); ctx.fill();
      }
      ctx.restore();
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