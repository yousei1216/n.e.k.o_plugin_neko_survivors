// ============================================================
// 标题页小游戏：猫娘捞金鱼（第二百二十七轮）
//
// 设计目标（用户："左边还空着，我想放个小游戏……时间短还好玩还能得奖"）：
//   · 30 秒一局，5 次纸网，鼠标移动 + 点击，不需要键盘
//   · 普通/黑/黄金三种金鱼，分数越高换的扭蛋券越多
//   · 金鱼会躲纸网，连续捞中加连击分
//   · 纯 Canvas 矢量占位；以后换美术只需要改 drawFish / drawScoop，
//     或者在这里接 sprites，不碰 main.js / ui.js 的玩法接线。
//
// 这个模块不碰存档：结束时通过 onReward(请求券数) 交给 main 做每日上限、
// 写 meta 和刷新标题页券数。这样小游戏可以单独测试/替换。
// ============================================================

const W = 480;
const H = 540;
const TAU = Math.PI * 2;

export const GOLDFISH_DURATION = 30;
export const GOLDFISH_PAPER_MAX = 5;
export const GOLDFISH_DAILY_CAP = 15;

/** 分数 → 本次可申请的扭蛋券（0~5）。50 分 1 张，250 分封顶 5 张。 */
export function goldfishTicketsForScore(score) {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  return Math.min(5, Math.floor(s / 50));
}

const FISH_KINDS = {
  normal: {
    score: 10, speed: 30, radius: 16, rarity: 0,
    body: '#ff8a3d', belly: '#ffd7ad', fin: '#ff6a2e', tail: '#ff6a35',
  },
  black: {
    score: 25, speed: 40, radius: 15, rarity: 1,
    body: '#302b42', belly: '#5c5572', fin: '#8a3f5a', tail: '#6d3550',
  },
  gold: {
    score: 60, speed: 52, radius: 13, rarity: 2,
    body: '#ffd23a', belly: '#fff4b8', fin: '#ffb300', tail: '#ffc107',
    glow: 'rgba(255, 220, 90, .55)',
  },
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }

export class GoldfishScoop {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   onHud?: (hud: {time:number, score:number, paper:number, combo:number, state:string}) => void,
   *   onEnd?: (result: object) => void,
   *   onReward?: (tickets:number) => object,
   *   onSound?: (name:string) => void,
   * }} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHud = opts.onHud || null;
    this.onEnd = opts.onEnd || null;
    this.onReward = opts.onReward || null;
    this.onSound = opts.onSound || null;

    this.state = 'idle';       // idle | playing | ending | result
    this.time = GOLDFISH_DURATION;
    this.paper = GOLDFISH_PAPER_MAX;
    this.score = 0;
    this.fishCount = 0;
    this.combo = 0;

    this.pointer = { x: W * 0.5, y: H * 0.54, moved: false };
    this.fish = [];
    this.spawnQueue = [];
    this.ripples = [];
    this.particles = [];
    this.popups = [];
    this.petals = [];
    this.scoopAnim = 0;
    this.scoopCd = 0;
    this.flash = 0;
    this.ambientT = 0;
    this.endTimer = 0;
    this.result = null;
    this.scoopQte = null;
    this.qteFlashT = 0;
    this.qteFlashKind = '';

    this._raf = 0;
    this._last = 0;
    this._hudAt = 0;
    this._destroyed = false;

    // 固定逻辑分辨率 + DPR 放大，CSS 只负责缩放。这样输入坐标换算简单，
    // 以后换素材也不受面板实际宽度影响。
    const dpr = Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    this._onMove = (e) => {
      const p = this._localPoint(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.moved = true;
    };
    this._onDown = (e) => {
      if (e.preventDefault) e.preventDefault();
      const p = this._localPoint(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.moved = true;
      this._scoop();
    };
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.style.touchAction = 'none';

    this._initAmbient();
    this._spawnInitial();
    this._loop = this._loop.bind(this);
    this._emitHud(true);
    this._raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try {
      this.canvas.removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerdown', this._onDown);
    } catch { /* 已卸载的 DOM 也安全 */ }
  }

  start() {
    if (this._destroyed) return;
    this.state = 'playing';
    this.time = GOLDFISH_DURATION;
    this.paper = GOLDFISH_PAPER_MAX;
    this.score = 0;
    this.fishCount = 0;
    this.combo = 0;
    this.result = null;
    this.endTimer = 0;
    this.scoopAnim = 0;
    this.scoopCd = 0;
    this.flash = 0;
    this.scoopQte = null;
    this.qteFlashT = 0;
    this.qteFlashKind = '';
    this.ripples.length = 0;
    this.particles.length = 0;
    this.popups.length = 0;
    this.spawnQueue.length = 0;
    this._spawnInitial();
    this._sound('buy');
    this._emitHud(true);
  }

  // ---------------- 输入 ----------------
  _localPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const w = r.width || W;
    const h = r.height || H;
    return {
      x: clamp(((e.clientX - r.left) / w) * W, 8, W - 8),
      y: clamp(((e.clientY - r.top) / h) * H, 8, H - 8),
    };
  }

  _sound(name) {
    try { this.onSound?.(name); } catch { /* 声音失败不影响玩法 */ }
  }

  // ---------------- 生成 ----------------
  _initAmbient() {
    this.petals.length = 0;
    for (let i = 0; i < 14; i++) {
      this.petals.push({
        x: rand(28, W - 28), y: rand(30, H - 30),
        r: rand(2.2, 4.6), vy: rand(2, 7), phase: rand(0, TAU),
        alpha: rand(0.16, 0.4),
      });
    }
  }

  _spawnInitial() {
    this.fish.length = 0;
    for (let i = 0; i < 4; i++) this.fish.push(this._spawnFish('normal'));
    for (let i = 0; i < 2; i++) this.fish.push(this._spawnFish('black'));
    this.fish.push(this._spawnFish('gold'));
  }

  _spawnFish(kind) {
    const k = FISH_KINDS[kind] || FISH_KINDS.normal;
    return {
      kind,
      x: rand(58, W - 58),
      y: rand(70, H - 62),
      angle: rand(0, TAU),
      speed: k.speed * rand(0.82, 1.18),
      phase: rand(0, TAU),
      wobble: rand(0, TAU),
      fleeT: 0,
      turnT: rand(0.5, 2.2),
      alive: true,
    };
  }

  _rollRespawnKind() {
    const r = Math.random();
    if (r < 0.58) return 'normal';
    if (r < 0.9) return 'black';
    return 'gold';
  }

  // ---------------- 点击 ----------------
  _scoop() {
    if (this.state === 'qte') { this._resolveScoopQte(); return; }
    if (this.state !== 'playing') return;
    if (this.paper <= 0 || this.scoopCd > 0) return;
    this.scoopCd = 0.32;   // 每次下网有一点动画硬直，防止一秒点完 5 次

    const x = this.pointer.x;
    const y = this.pointer.y;
    this.paper--;
    this.scoopAnim = 1;
    this.ripples.push({ x, y, r: 10, max: 56, alpha: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU);
      const sp = rand(16, 54);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 8,
        life: rand(0.25, 0.55), max: 0.55, r: rand(1, 2.6),
        color: 'rgba(190, 245, 255, .9)',
      });
    }

    let hit = null;
    let best = Infinity;
    for (const f of this.fish) {
      if (!f.alive) continue;
      const k = FISH_KINDS[f.kind];
      const d = Math.hypot(f.x - x, f.y - y);
      const reach = 33 + k.radius * 0.55;
      if (d <= reach && d < best) { best = d; hit = f; }
    }

    if (hit) {
      this._startScoopQte(hit);
    } else {
      this.combo = 0;
      this._sound('click');
      if (this.paper <= 0) this._beginEnd();
    }

    this._emitHud(true);
  }

  /** 捞中鱼后先进入 QTE：指针从左到右，必须在绿色区点击。 */
  _startScoopQte(f) {
    const kind = FISH_KINDS[f.kind] || FISH_KINDS.normal;
    const rarity = kind.rarity | 0;
    const duration = [1.25, 0.95, 0.72][rarity] ?? 1.1;
    const zoneWidth = [0.30, 0.21, 0.14][rarity] ?? 0.25;
    const zoneStart = rand(0.28, Math.max(0.28, 0.70 - zoneWidth));
    this.scoopQte = {
      fish: f, t: 0, duration, zoneStart, zoneWidth, rarity, kind,
    };
    this.state = 'qte';
    this.message = '捞中了！在绿色区域点击';
    this._sound('lock');
    this._emitHud(true);
  }

  _resolveScoopQte() {
    const q = this.scoopQte;
    if (!q) return;
    const p = clamp(q.t / q.duration, 0, 1);
    const ok = p >= q.zoneStart && p <= q.zoneStart + q.zoneWidth;
    this.scoopQte = null;
    this.state = 'playing';
    this.scoopCd = 0.4;
    this.qteFlashT = 0.45;
    this.qteFlashKind = ok ? 'ok' : 'bad';

    if (ok) {
      this._catchFish(q.fish);
      this._sound('levelUp');
      this.popups.push({
        x: q.fish.x, y: q.fish.y - 30, text: '捞到了！', sub: '',
        life: 0.8, max: 0.8, color: '#8fffc0',
      });
    } else {
      this.combo = 0;
      if (q.fish) {
        q.fish.fleeT = 1.2;
        q.fish.angle = rand(0, TAU);
      }
      this._sound('error');
      this.popups.push({
        x: q.fish?.x ?? W / 2, y: (q.fish?.y ?? H / 2) - 24,
        text: '跑掉了…', sub: '', life: 0.85, max: 0.85, color: '#ff8a8a',
      });
      this.ripples.push({ x: q.fish?.x ?? W / 2, y: q.fish?.y ?? H / 2, r: 8, max: 46, alpha: 0.7 });
    }

    this._emitHud(true);
    if (this.paper <= 0) this._beginEnd();
  }

  _catchFish(f) {
    const k = FISH_KINDS[f.kind];
    const bonus = Math.min(20, this.combo * 5);
    const pts = k.score + bonus;
    this.score += pts;
    this.fishCount++;
    this.combo++;
    f.alive = false;
    this.spawnQueue.push(rand(0.55, 1.15));
    this._sound(f.kind === 'gold' ? 'levelUp' : (f.kind === 'black' ? 'pickupXp' : 'pickupMat'));

    this.popups.push({
      x: f.x, y: f.y - 12, text: `+${pts}`,
      sub: this.combo > 1 ? `连击 x${this.combo}` : '',
      life: 0.95, max: 0.95, color: f.kind === 'gold' ? '#ffe36e' : '#fff2cf',
    });
    const color = f.kind === 'gold' ? '255, 220, 90'
      : f.kind === 'black' ? '190, 160, 255' : '255, 170, 110';
    for (let i = 0; i < (f.kind === 'gold' ? 18 : 10); i++) {
      const a = rand(0, TAU);
      const sp = rand(24, f.kind === 'gold' ? 110 : 72);
      this.particles.push({
        x: f.x, y: f.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 12,
        life: rand(0.3, 0.75), max: 0.75, r: rand(1.2, 3.4),
        color: `rgba(${color}, .95)`,
      });
    }
    if (f.kind === 'gold') {
      this.flash = 1;
      this.ripples.push({ x: f.x, y: f.y, r: 8, max: 100, alpha: 0.95 });
    }
    this._emitHud(true);
  }

  _beginEnd() {
    if (this.state !== 'playing') return;
    this.state = 'ending';
    this.endTimer = 0.55;
    this._sound('waveClear');
    this._emitHud(true);
  }

  _finish() {
    if (this.state === 'result') return;
    this.state = 'result';
    const requested = goldfishTicketsForScore(this.score);
    let reward = {
      requested, granted: 0,
      earned: 0, cap: GOLDFISH_DAILY_CAP, remaining: GOLDFISH_DAILY_CAP,
      totalTickets: 0,
    };
    if (this.onReward) {
      try { reward = this.onReward(requested) || reward; } catch { /* 存档失败不影响结算 */ }
    }
    const result = {
      score: this.score,
      fishCount: this.fishCount,
      requested,
      ...reward,
    };
    this.result = result;
    this._sound(reward.granted > 0 ? 'levelUp' : 'click');
    this._emitHud(true);
    try { this.onEnd?.(result); } catch { /* */ }
  }

  // ---------------- 更新 ----------------
  _loop(ts) {
    if (this._destroyed) return;
    this._raf = requestAnimationFrame(this._loop);
    const t = ts / 1000;
    const dt = this._last ? Math.min(0.05, t - this._last) : 0.016;
    this._last = t;
    this._update(dt);
    this._draw(t);
  }

  _update(dt) {
    this.ambientT += dt;
    this.scoopAnim = Math.max(0, this.scoopAnim - dt * 3.2);
    this.scoopCd = Math.max(0, this.scoopCd - dt);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.qteFlashT = Math.max(0, this.qteFlashT - dt);

    if (this.state === 'playing') {
      this.time = Math.max(0, this.time - dt);
      if (this.time <= 0) this._beginEnd();
      this._hudAcc = (this._hudAcc || 0) + dt;
      if (this._hudAcc >= 0.1) { this._hudAcc = 0; this._emitHud(); }
    } else if (this.state === 'qte') {
      if (this.scoopQte) {
        this.scoopQte.t += dt;
        if (this.scoopQte.t >= this.scoopQte.duration) this._resolveScoopQte();
      }
    } else if (this.state === 'ending') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this._finish();
    }

    this._updateSpawns(dt);
    this._updateFish(dt);
    this._updateEffects(dt);
  }

  _updateSpawns(dt) {
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      this.spawnQueue[i] -= dt;
      if (this.spawnQueue[i] <= 0) {
        this.spawnQueue.splice(i, 1);
        if (this.fish.filter((f) => f.alive).length < 8) {
          this.fish.push(this._spawnFish(this._rollRespawnKind()));
        }
      }
    }
    // 移除已经消失很久的鱼，数组不会无限增长
    if (this.fish.length > 24) this.fish = this.fish.filter((f) => f.alive);
  }

  _updateFish(dt) {
    const px = this.pointer.x;
    const py = this.pointer.y;
    for (const f of this.fish) {
      if (!f.alive) continue;
      f.wobble += dt * (4 + f.speed * 0.05);
      if (f.fleeT > 0) {
        f.fleeT -= dt;
      } else {
        const dx = f.x - px;
        const dy = f.y - py;
        const d = Math.hypot(dx, dy);
        const fleeR = f.kind === 'gold' ? 66 : f.kind === 'black' ? 54 : 46;
        if (this.state === 'playing' && d < fleeR && d > 0.01) {
          f.angle = Math.atan2(dy, dx) + Math.sin(this.ambientT * 5 + f.phase) * 0.28;
          f.fleeT = 0.38;
        } else {
          f.turnT -= dt;
          if (f.turnT <= 0) {
            f.angle += rand(-1.5, 1.5);
            f.turnT = rand(0.7, 2.2);
          }
        }
      }
      const sp = f.speed * (f.fleeT > 0 ? 2.05 : 1);
      f.x += Math.cos(f.angle) * sp * dt;
      f.y += Math.sin(f.angle) * sp * dt;

      const padX = 38;
      const padTop = 52;
      const padBottom = H - 44;
      if (f.x < padX) { f.x = padX; f.angle = Math.PI - f.angle; }
      if (f.x > W - padX) { f.x = W - padX; f.angle = Math.PI - f.angle; }
      if (f.y < padTop) { f.y = padTop; f.angle = -f.angle; }
      if (f.y > padBottom) { f.y = padBottom; f.angle = -f.angle; }
    }
  }

  _updateEffects(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 4.5);
      r.alpha -= dt * 1.25;
      if (r.alpha <= 0) this.ripples.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 42 * dt;
      p.vx *= 0.98;
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) { this.popups.splice(i, 1); continue; }
      p.y -= 24 * dt;
    }
    for (const p of this.petals) {
      p.y += p.vy * dt;
      p.x += Math.sin(this.ambientT * 0.8 + p.phase) * 4 * dt;
      if (p.y > H - 26) { p.y = 30; p.x = rand(28, W - 28); }
    }
  }

  _emitHud(force = false) {
    if (!this.onHud) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!force && now - this._hudAt < 85) return;
    this._hudAt = now;
    try {
      this.onHud({
        time: this.time, score: this.score, paper: this.paper,
        combo: this.combo, state: this.state,
      });
    } catch { /* */ }
  }

  // ---------------- 绘制 ----------------
  _draw(t) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this._drawTub(t);
    this._drawWater(t);
    this._drawLilyPads();
    this._drawPetals();
    for (const f of this.fish) if (f.alive) this._drawFish(f);
    this._drawScoop(t);
    this._drawEffects();
    if (this.state === 'qte') this._drawScoopQte();
    if (this.qteFlashT > 0) {
      const a = this.qteFlashT / 0.45;
      ctx.strokeStyle = this.qteFlashKind === 'ok'
        ? `rgba(126, 255, 180, ${a * 0.8})`
        : `rgba(255, 110, 120, ${a * 0.8})`;
      ctx.lineWidth = 7;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 235, 150, ${this.flash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _drawScoopQte() {
    const q = this.scoopQte;
    if (!q) return;
    const ctx = this.ctx;
    const w = 320;
    const h = 18;
    const x = (W - w) / 2;
    const y = H - 78;
    const p = clamp(q.t / q.duration, 0, 1);

    ctx.fillStyle = 'rgba(4, 16, 24, .82)';
    this._roundRect(ctx, x - 12, y - 36, w + 24, 70, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 240, 230, .4)';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, x - 12, y - 36, w + 24, 70, 12);
    ctx.stroke();

    ctx.fillStyle = '#eafcff';
    ctx.font = '800 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('捞中了！在绿色区域点击', W / 2, y - 14);

    ctx.fillStyle = 'rgba(255, 255, 255, .14)';
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    ctx.fillStyle = 'rgba(126, 240, 208, .75)';
    this._roundRect(ctx, x + q.zoneStart * w, y + 2,
      Math.max(4, q.zoneWidth * w), h - 4, 6);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    const mx = x + p * w;
    ctx.fillRect(mx - 2, y - 4, 4, h + 8);
    ctx.shadowColor = 'rgba(255, 255, 255, .8)';
    ctx.shadowBlur = 8;
    ctx.fillRect(mx - 1, y - 3, 2, h + 6);
    ctx.shadowBlur = 0;

    const f = q.fish;
    if (f) {
      ctx.strokeStyle = 'rgba(255, 255, 255, .5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 30, 0, TAU);
      ctx.stroke();
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

  _drawTub(t) {
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#153746');
    bg.addColorStop(0.55, '#0b2635');
    bg.addColorStop(1, '#061722');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 木盆外沿
    this._roundRect(ctx, 9, 9, W - 18, H - 18, 26);
    ctx.fillStyle = '#2a201d';
    ctx.fill();
    ctx.strokeStyle = '#5a4236';
    ctx.lineWidth = 7;
    ctx.stroke();

    // 木纹高光
    ctx.save();
    this._roundRect(ctx, 9, 9, W - 18, H - 18, 26);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 205, 150, .08)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const y = 16 + i * 60 + Math.sin(t * 0.25 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.quadraticCurveTo(W * 0.5, y + 8, W - 10, y);
      ctx.stroke();
    }
    ctx.restore();

    // 水面
    this._roundRect(ctx, 24, 24, W - 48, H - 48, 20);
    ctx.fillStyle = '#082331';
    ctx.fill();
  }

  _drawWater(t) {
    const ctx = this.ctx;
    ctx.save();
    this._roundRect(ctx, 24, 24, W - 48, H - 48, 20);
    ctx.clip();

    const wg = ctx.createRadialGradient(W * 0.5, H * 0.42, 26, W * 0.5, H * 0.52, W * 0.72);
    wg.addColorStop(0, 'rgba(42, 118, 130, .55)');
    wg.addColorStop(0.55, 'rgba(14, 62, 80, .32)');
    wg.addColorStop(1, 'rgba(2, 14, 22, .18)');
    ctx.fillStyle = wg;
    ctx.fillRect(24, 24, W - 48, H - 48);

    // 水波焦散
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#8fe8ef';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      for (let x = 28; x <= W - 28; x += 12) {
        const y = 82 + i * 72 + Math.sin(x * 0.021 + t * 0.75 + i * 1.4) * 10
          + Math.sin(x * 0.043 - t * 0.42) * 4;
        if (x === 28) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 水面边缘的暗角
    ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
    ctx.lineWidth = 12;
    this._roundRect(ctx, 24, 24, W - 48, H - 48, 20);
    ctx.stroke();
    ctx.restore();
  }

  _drawLilyPads() {
    const ctx = this.ctx;
    const pads = [
      { x: 92, y: 150, r: 24, rot: 0.4 },
      { x: 386, y: 408, r: 28, rot: 2.2 },
      { x: 120, y: 438, r: 18, rot: 1.2 },
    ];
    for (const p of pads) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(44, 116, 82, .72)';
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0.36, TAU - 0.36);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 220, 160, .22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawPetals() {
    const ctx = this.ctx;
    for (const p of this.petals) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#ffb8d6';
      ctx.translate(p.x, p.y);
      ctx.rotate(p.phase + this.ambientT * 0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.35, p.r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawFish(f) {
    const ctx = this.ctx;
    const k = FISH_KINDS[f.kind];
    const r = k.radius;
    const wag = Math.sin(f.wobble) * 0.4;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);

    // 水下的影子
    ctx.fillStyle = 'rgba(0, 0, 0, .24)';
    ctx.beginPath();
    ctx.ellipse(-1, r * 0.72, r * 1.28, r * 0.52, 0, 0, TAU);
    ctx.fill();

    // 尾巴
    ctx.save();
    ctx.translate(-r * 1.18, 0);
    ctx.rotate(wag);
    ctx.fillStyle = k.tail;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 1.25, -r * 0.78);
    ctx.lineTo(-r * 0.92, 0);
    ctx.lineTo(-r * 1.25, r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 身体
    if (k.glow) {
      ctx.shadowColor = k.glow;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = k.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.35, r * 0.86, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 肚子
    ctx.fillStyle = k.belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.08, r * 0.24, r * 0.94, r * 0.4, 0, 0, TAU);
    ctx.fill();

    // 侧鳍
    ctx.fillStyle = k.fin;
    ctx.beginPath();
    ctx.ellipse(-r * 0.08, r * 0.12, r * 0.52, r * 0.22, -0.55, 0, TAU);
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.78, -r * 0.2, r * 0.25, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#16121c';
    ctx.beginPath();
    ctx.arc(r * 0.84, -r * 0.2, r * 0.12, 0, TAU);
    ctx.fill();

    // 黄金鱼闪星
    if (f.kind === 'gold') {
      const tw = 0.5 + Math.sin(f.wobble * 1.8) * 0.5;
      ctx.globalAlpha = 0.45 + tw * 0.5;
      ctx.fillStyle = '#fff6b0';
      ctx.beginPath();
      ctx.moveTo(r * 0.4, -r * 1.15);
      ctx.lineTo(r * 0.55, -r * 0.78);
      ctx.lineTo(r * 0.92, -r * 0.62);
      ctx.lineTo(r * 0.55, -r * 0.46);
      ctx.lineTo(r * 0.4, -r * 0.08);
      ctx.lineTo(r * 0.25, -r * 0.46);
      ctx.lineTo(-r * 0.12, -r * 0.62);
      ctx.lineTo(r * 0.25, -r * 0.78);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawScoop(t) {
    const ctx = this.ctx;
    const x = this.pointer.x;
    const y = this.pointer.y;
    const dip = Math.sin(this.scoopAnim * Math.PI) * 0.07;
    const r = 36 * (1 + dip);

    ctx.save();
    // 木柄
    ctx.strokeStyle = '#b97945';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 23);
    ctx.lineTo(x + 69, y + 84);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 220, 170, .35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 20);
    ctx.lineTo(x + 66, y + 80);
    ctx.stroke();

    // 猫爪握住柄尾（占位小猫爪，之后可换猫娘立绘/手部素材）
    this._drawPaw(x + 73, y + 90, 10);

    // 纸网
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = `rgba(225, 255, 255, ${0.14 + Math.sin(this.scoopAnim * Math.PI) * 0.12})`;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(220, 255, 255, .16)';
    ctx.lineWidth = 1;
    for (let i = -34; i <= 34; i += 8) {
      ctx.beginPath(); ctx.moveTo(i, -34); ctx.lineTo(i, 34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-34, i); ctx.lineTo(34, i); ctx.stroke();
    }
    ctx.restore();

    // 竹圈
    ctx.strokeStyle = '#e8bd7a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 248, 220, .55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, -1, r - 3, -2.6, 0.7);
    ctx.stroke();

    // 入水涟漪
    if (this.scoopAnim > 0) {
      ctx.strokeStyle = `rgba(190, 250, 255, ${this.scoopAnim * 0.55})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 4, r * (1.15 + (1 - this.scoopAnim) * 0.25), r * 0.62, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPaw(x, y, s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#ff9dc6';
    ctx.beginPath();
    ctx.ellipse(0, 3, s * 0.78, s * 0.66, 0.2, 0, TAU);
    ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * s * 0.55, -s * 0.45, s * 0.24, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd0e4';
    ctx.beginPath();
    ctx.ellipse(0, 4, s * 0.34, s * 0.26, 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawEffects() {
    const ctx = this.ctx;
    for (const r of this.ripples) {
      ctx.strokeStyle = `rgba(180, 245, 255, ${Math.max(0, r.alpha)})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.55, 0, 0, TAU);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of this.popups) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.font = '900 22px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.shadowColor = 'rgba(0, 0, 0, .55)';
      ctx.shadowBlur = 5;
      ctx.fillText(p.text, p.x, p.y);
      if (p.sub) {
        ctx.fillStyle = '#9ff4ff';
        ctx.font = '800 13px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.fillText(p.sub, p.x, p.y + 18);
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}