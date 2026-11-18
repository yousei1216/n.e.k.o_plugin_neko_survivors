// ============================================================
// 第二百二十八轮：主菜单底部「猫娘钓场」横向钓鱼
//
// 操作：
//   按住鼠标蓄力 → 松手抛竿 → 等浮漂下沉 → 点击提竿
//   → 按住收线、松手放线，把进度拉满。张力拉爆会断线。
//
// 这里只做 Canvas 表现和即时操作；鱼种随机、鱼篓、金币由
// src/systems/life-state.js 处理，通过 onCast / onCatch 回调交给 UI/main。
// 第二百二十九轮：换成 E:\猫娘姐妹\钓鱼 的像素背景/水面 + 猫娘立绘 + 鱼竿素材。
// 背景和水面按 16:9 原图裁一条 284px 高的宽幅横带；水面先画、背景后画，
// 这样背景里透明的湖面会露出水面层，码头也能盖在水面上。
// ============================================================

import { FISH, getBait, getFish, getRod } from '../data/life.js';

const W = 1000;
const H = 170;
const TAU = Math.PI * 2;

// 背景/水面原图 1672×941；取 y=560 起 284px 高的横带，正好铺满 1000×170。
const SCENE_CROP = { x: 0, y: 530, w: 1672, h: 284 };
// 立绘 1063×1480 / 1062×1480：画到 140px 高，脚踩在码头木板表面上。
// 170px 高的横条里如果角色仍画 160px，脚会贴着画布底，码头面只剩一条边，
// 看起来像浮空；缩到 140px 后脚下还能露出 10 多像素木板。
const CHAR_H = 140;
// 站在码头木板上（用户红圈位置），不再站在最左边的草岸
const CHAR_X = 286;
const CHAR_Y = 8;
const CHAR_SCALE = CHAR_H / 1480;
// 两种姿势里手的位置（原图像素）和鱼竿角度。鱼竿图 2172×724，
// 握把中心约 (190,310)，竿尖约 (2154,330)。
const POSE_FISH = { handX: 770, handY: 575, angle: -0.12 };
// 举杆时鱼竿接近竖直（约 -97°），竿尖竖起并出画；蓄力时本来就不画鱼线。
const POSE_RAISE = { handX: 350, handY: 225, angle: -1.70 };
const ROD_ANCHOR = { x: 190, y: 310 };
const ROD_TIP = { x: 2154, y: 330 };
const ASSET = {
  bg: 'assets/fishing/bg.png',
  water: 'assets/fishing/water.png',
  fishing: 'assets/fishing/char_fishing.png',
  raise: 'assets/fishing/char_raise.png',
  rod: 'assets/fishing/rod.png',
  bobber: 'assets/fishing/bobber.png',
};
// 鱼漂图（941×1672 竖版插画）红白交界在 54.2% 高度，这条线对齐水面
const BOBBER_SPLIT = 0.542;

// 背景游鱼只用稀有度 <= 2 的鱼，避免传说鱼影子频繁晃来晃去稀释稀有感
const SHADOW_FISH = FISH.filter((f) => f.rarity <= 2);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class FishingGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   onCast?: () => {bait?: object, fallback?: boolean},
   *   onHook?: () => (fish: object|null),
   *   onCatch?: (fish?: object) => {added?: boolean, autoSold?: boolean, autoCoins?: number, coins?: number},
   *   onHud?: (hud: object) => void,
   *   onSound?: (name:string) => void,
   * }} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCast = opts.onCast || null;
    this.onHook = opts.onHook || null;
    this.onCatch = opts.onCatch || null;
    this.onHud = opts.onHud || null;
    this.onSound = opts.onSound || null;

    this.state = 'idle'; // idle | charging | cast | wait | bite | reel | landing | result
    this.message = '按住鼠标蓄力，松手抛竿';
    this.power = 0;
    this.castPower = 0;
    this.castT = 0;
    this.waitT = 0;
    this.biteT = 0;
    this.progress = 0;
    this.tension = 0;
    this.reelT = 0;
    this.reeling = false;
    this.pointer = { x: W * 0.72, y: 100 };
    this.hookedFish = null;
    this.qteRarity = 0;
    this.qteDir = 0;
    this.qteTargetDir = 0;
    this.qteTurnT = 0;
    this.qteTurnEvery = 1.45;
    this.qteTurnSpeed = 4.2;
    this.qteSplashT = 0;
    this.resultT = 0;
    this.result = null;
    this.bobberX = 760;
    this.bobberY = 112;
    this.landT = 0;
    this.landFrom = null;
    this.rod = getRod('bamboo');
    this.bait = getBait('dough');
    this.ambientT = 0;
    this.waterT = 0;
    // 第二百三十三轮：背景游鱼改成真实鱼剪影（多鱼种 / 双向 / 远近大小 / 摆尾）
    this.fishShadows = Array.from({ length: 7 }, (_, i) => {
      const f = SHADOW_FISH[(i * 7 + 3) % SHADOW_FISH.length];
      const dir = i % 2 === 0 ? 1 : -1;
      const depth = (i % 3) / 2;            // 0 远 / 0.5 中 / 1 近
      return {
        x: rand(330, 990),
        y: 96 + depth * 46 + rand(-5, 5),
        sp: rand(9, 22) * dir * (0.7 + depth * 0.6),
        id: f.id,
        scale: 0.5 + depth * 0.55,          // 近处更大
        alpha: 0.16 + depth * 0.2,
        phase: rand(0, TAU),
      };
    });
    // 咬钩前游向浮漂的预告鱼（用预抽的鱼种，保证预告与实际一致）
    this.pendingFish = null;
    this.approach = null;
    this.ripples = [];
    this.particles = [];
    this._raf = 0;
    this._last = 0;
    this._hudAt = 0;
    this._destroyed = false;
    this.imgBg = null;
    this.imgWater = null;
    this.imgFishing = null;
    this.imgRaise = null;
    this.imgRod = null;
    this._loadAssets();

    const dpr = Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    // canvas 是否支持 filter（用于把鱼压成剪影）；不支持时降级成椭圆影子
    this._filterOk = (() => {
      try {
        const c = document.createElement('canvas').getContext('2d');
        c.filter = 'brightness(0)';
        return c.filter === 'brightness(0)';
      } catch { return false; }
    })();

    this._onMove = (e) => { this._setPointer(e); };
    this._onDown = (e) => {
      if (e.preventDefault) e.preventDefault();
      this._setPointer(e);
      try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* */ }
      this._pointerDown();
    };
    this._onUp = (e) => {
      if (e.preventDefault) e.preventDefault();
      try { this.canvas.releasePointerCapture?.(e.pointerId); } catch { /* */ }
      this._pointerUp();
    };
    this._onCancel = () => {
      this.reeling = false;
      if (this.state === 'charging') {
        this.state = 'idle';
        this.power = 0;
        this.message = '按住鼠标蓄力，松手抛竿';
        this._emitHud(true);
      }
    };
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onCancel);
    canvas.addEventListener('pointerleave', this._onCancel);
    canvas.style.touchAction = 'none';

    this._loop = this._loop.bind(this);
    this._emitHud(true);
    this._raf = requestAnimationFrame(this._loop);
  }

  _setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    const w = r.width || W;
    const h = r.height || H;
    this.pointer.x = clamp(((e.clientX - r.left) / w) * W, 0, W);
    this.pointer.y = clamp(((e.clientY - r.top) / h) * H, 0, H);
  }

  _loadAssets() {
    const load = (key, src) => {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        this[key] = img;
      } catch { /* 资源失败时保留加载态，不影响玩法逻辑 */ }
    };
    load('imgBg', ASSET.bg);
    load('imgWater', ASSET.water);
    load('imgFishing', ASSET.fishing);
    load('imgRaise', ASSET.raise);
    load('imgRod', ASSET.rod);
    load('imgBobber', ASSET.bobber);
    this.fishSprites = {};
    for (const f of FISH) {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = f.sprite;
        this.fishSprites[f.id] = img;
      } catch { /* */ }
    }
  }

  _ready(img) {
    return !!img && img.complete && img.naturalWidth > 0;
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try {
      this.canvas.removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerdown', this._onDown);
      this.canvas.removeEventListener('pointerup', this._onUp);
      this.canvas.removeEventListener('pointercancel', this._onCancel);
      this.canvas.removeEventListener('pointerleave', this._onCancel);
    } catch { /* */ }
  }

  _sound(name) {
    try { this.onSound?.(name); } catch { /* */ }
  }

  _pointerDown() {
    if (this.state === 'idle') {
      this.state = 'charging';
      this.power = 0;
      this.message = '蓄力中……松手抛竿';
      this._emitHud(true);
      return;
    }
    if (this.state === 'bite') {
      this.hookedFish = this.pendingFish || this.onHook?.() || null;
      this.pendingFish = null;
      this.approach = null;
      this._initReelQte();
      this.state = 'reel';
      this.progress = 0.12;
      this.tension = 0.18;
      this.reelT = 0;
      this.reeling = true;
      this.message = '鱼在挣扎！按住左键，往红箭头的反方向拖';
      this._sound('pickupXp');
      this._emitHud(true);
      return;
    }
    if (this.state === 'reel') {
      this.reeling = true;
    }
  }

  /** 鱼上钩时按品质初始化挣扎 QTE；品质越高，转向越快。 */
  _initReelQte() {
    const rarity = clamp(this.hookedFish?.rarity | 0, 0, 4);
    this.qteRarity = rarity;
    this.qteTurnEvery = Math.max(0.55, 1.45 - rarity * 0.16);
    this.qteTurnSpeed = 4.2 + rarity * 0.7;
    // 左右挣扎更直观：红色箭头基本指向左/右，玩家往反方向拖。
    this.qteDir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.28, 0.28);
    this.qteTargetDir = this.qteDir;
    this.qteTurnT = this.qteTurnEvery;
    this.qteSplashT = 0.08;
    this.qteFlash = 1;      // 转向脉冲（第二百三十四轮）
  }

  _pointerUp() {
    if (this.state === 'charging') {
      this.castPower = this.power;
      this.state = 'cast';
      this.castT = 0.55;
      this.bobberX = 180;
      this.bobberY = 76;
      this.ripples.length = 0;
      this.particles.length = 0;
      const cast = this.onCast?.() || {};
      this.bait = cast.bait || this.bait;
      this.rod = cast.rod || getRod(this.rod?.id || 'bamboo');
      this.message = cast.fallback ? '高级鱼饵用完了，换回面团' : '抛竿！';
      this._sound('click');
      this._emitHud(true);
      return;
    }
    if (this.state === 'reel') {
      this.reeling = false;
    }
  }

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
    this.waterT += dt;
    this._updateFishShadows(dt);
    this._updateEffects(dt);

    if (this.state === 'charging') {
      this.power = Math.min(1, this.power + dt * 0.75);
    } else if (this.state === 'cast') {
      this.castT -= dt;
      if (this.castT <= 0) {
        this.state = 'wait';
        const base = this.bait || getBait('dough');
        this.waitT = rand(base.biteMin, base.biteMax);
        this.bobberX = 700 + this.castPower * 240;
        this.pendingFish = null;
        this.approach = null;
        this.message = '等待鱼咬钩……';
        this._emitHud(true);
      }
    } else if (this.state === 'wait') {
      this.waitT -= dt;
      // 咬钩前 1.5 秒：预抽一条鱼让剪影游向浮漂（onHook 不写存档，可安全预抽）
      if (!this.pendingFish && this.waitT < 1.5) {
        this.pendingFish = this.onHook?.() || null;
        if (this.pendingFish) {
          this.approach = {
            t: 0, dur: 1.5, id: this.pendingFish.id,
            rarity: clamp(this.pendingFish.rarity | 0, 0, 4),
            y: 120, fromX: this.bobberX + 300,
          };
        }
      }
      if (this.waitT <= 0) {
        this.state = 'bite';
        this.biteT = 0.85;
        this.message = '咬钩了！点击提竿';
        this._sound('pickupXp');
        this.ripples.push({ x: this.bobberX, y: 114, r: 6, max: 42, a: 0.8 });
        this._emitHud(true);
      }
    } else if (this.state === 'bite') {
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this._finishMiss('鱼跑掉了……下次早点提竿');
      }
    } else if (this.state === 'reel') {
      this.reelT += dt;
      const rod = this.rod || getRod('bamboo');

      // 鱼每隔一段时间换一个逃跑方向；方向用角速度平滑过渡，不会瞬移。
      this.qteTurnT -= dt;
      if (this.qteTurnT <= 0) {
        this.qteTargetDir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.28, 0.28);
        this.qteTurnT = this.qteTurnEvery;
        this.qteFlash = 1;
        this._qteSplashBurst();
      }
      this.qteDir = this._angleMove(this.qteDir, this.qteTargetDir, this.qteTurnSpeed * dt);
      this.qteFlash = Math.max(0, (this.qteFlash || 0) - dt * 2.8);
      this.qteSplashT -= dt;
      if (this.qteSplashT <= 0) {
        this.qteSplashT = 0.22;
        this._qteSplashBurst();
      }

      const pos = this._reelFishPos(this.ambientT);
      const dx = this.pointer.x - pos.x;
      const dy = this.pointer.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const align = dist > 1
        ? Math.cos(Math.atan2(dy, dx) - (this.qteDir + Math.PI))
        : -1;
      const strength = this.reeling
        ? clamp(align, 0, 1) * clamp((dist - 12) / 70, 0, 1)
        : 0;

      if (strength > 0.12) {
        this.progress += dt * 0.22 * strength * (rod.reel || 1);
        this.tension -= dt * 0.38;
      } else {
        this.progress -= dt * 0.035;
        this.tension += dt * (0.12 + this.qteRarity * 0.018
          + (this.reeling && align < 0 ? 0.05 : 0.02));
      }
      this.progress = clamp(this.progress, 0, 1);
      this.tension = clamp(this.tension, 0, 1.2);
      if (this.tension >= 1) {
        this._finishMiss('鱼挣脱了！要往红箭头的反方向拖');
      } else if (this.progress >= 1) {
        this._startLanding();
      }
      if (this._hudAt === 0 || performance.now() - this._hudAt > 90) this._emitHud();
    } else if (this.state === 'landing') {
      this.landT -= dt;
      this.tension = Math.max(0, this.tension - dt * 0.6);
      if (this.landT <= 0) this._finishCatch();
    } else if (this.state === 'result') {
      this.resultT -= dt;
      if (this.resultT <= 0) {
        this.state = 'idle';
        this.message = '按住鼠标蓄力，松手抛竿';
        this.result = null;
        this.progress = 0;
        this.tension = 0;
        this._emitHud(true);
      }
    }
  }

  /** 收线进度满后，鱼被提到竿尖附近；动画结束才结算。 */
  _startLanding() {
    if (this.state === 'landing') return;
    const pose = this._rodPose(0);
    const tip = this._rodTip(pose.anchorX, pose.anchorY, pose.angle);
    const pos = this._reelFishPos(this.ambientT);
    const fromX = pos.x;
    this.state = 'landing';
    this.landT = 0.75;
    // 从鱼当前（水面附近）的位置起，而不是从竿尖起
    this.landFrom = { x: fromX, y: pos.y };
    this.reeling = false;
    this.message = '收线！鱼要上来了';
    this.ripples.push({ x: fromX, y: 114, r: 10, max: 74, a: 0.9 });
    // 鱼被拽出水面的水花
    for (let i = 0; i < 14; i++) {
      const ang = -Math.PI / 2 + rand(-1.1, 1.1);
      const sp = rand(40, 130);
      this.particles.push({
        x: fromX, y: 112,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(0.25, 0.65), max: 0.65, r: rand(1.3, 2.8),
        color: i % 3 === 0 ? '#ffe9a0' : '#d8f6ff',
      });
    }
    this._sound('pickupXp');
    this._emitHud(true);
  }

  _finishMiss(msg) {
    this.state = 'result';
    this.resultT = 1.25;
    this.result = { miss: true, message: msg };
    this.reeling = false;
    this.hookedFish = null;
    this.pendingFish = null;
    this.approach = null;
    this.qteRarity = 0;
    this.progress = 0;
    this.tension = 0;
    this.message = msg;
    this._sound('error');
    this._emitHud(true);
  }

  _finishCatch() {
    const fish = this.hookedFish;
    const info = this.onCatch?.(fish) || {};
    this.hookedFish = null;
    this.state = 'result';
    this.resultT = 1.8;
    this.reeling = false;
    this.result = { fish, ...info };
    this.message = fish ? '上钩了！' : '空钩……';
    this._sound('pickupMat');
    if (fish) {
      // 第二百三十三轮：收获粒子按稀有度升级 —— 越高越多、颜色越华丽
      const rarity = clamp(fish.rarity | 0, 0, 4);
      const palette = rarity >= 4
        ? ['#fff3a0', '#ff8fd6', '#8fd3ff', '#b98bff', '#ffffff']
        : rarity === 3
          ? ['#ffe36e', '#ffb347', '#fff6c2']
          : rarity === 2
            ? ['#c08bff', '#ffe36e', '#dcc6ff']
            : ['#ffe36e', '#bff6ff', '#dff8ff'];
      const n = 16 + rarity * 7;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const sp = rand(30, 110 + rarity * 26);
        this.particles.push({
          x: this.bobberX, y: 112,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
          life: rand(0.3, 0.8 + rarity * 0.1), max: 0.8 + rarity * 0.1,
          r: rand(1.2, 2.6 + rarity * 0.5),
          color: palette[i % palette.length],
        });
      }
      this.ripples.push({ x: this.bobberX, y: 114, r: 8, max: 90 + rarity * 14, a: 0.9 });
      if (rarity >= 3) {
        // 史诗以上：再来一圈向外扩散的光环
        this.ripples.push({ x: this.bobberX, y: 114, r: 4, max: 150, a: 0.7 });
      }
    }
    this._emitHud(true);
  }

  _updateFishShadows(dt) {
    for (const f of this.fishShadows) {
      f.x += f.sp * dt;
      if (f.x < 240) { f.x = 240; f.sp = Math.abs(f.sp); }
      if (f.x > 980) { f.x = 980; f.sp = -Math.abs(f.sp); }
      f.y += Math.sin(this.ambientT * 0.8 + f.phase) * 2 * dt;
    }
    if (this.approach) {
      this.approach.t += dt;
      if (this.approach.t > this.approach.dur + 0.6) this.approach = null;
    }
  }

  _updateEffects(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 4.5);
      r.a -= dt * 1.1;
      if (r.a <= 0) this.ripples.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 55 * dt;
      p.vx *= 0.98;
    }
  }

  _emitHud(force = false) {
    if (!this.onHud) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!force && now - this._hudAt < 85) return;
    this._hudAt = now;
    try {
      this.onHud({
        state: this.state,
        message: this.message,
        power: this.power,
        progress: this.progress,
        tension: this.tension,
        rod: this.rod,
        bait: this.bait,
        result: this.result,
      });
    } catch { /* */ }
  }

  // ---------------- 绘制 ----------------
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _draw(t) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (!this._drawScene()) {
      ctx.fillStyle = '#17263b';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#cfe8ff';
      ctx.font = '800 14px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('钓场加载中…', W / 2, H / 2);
      return;
    }
    this._drawFishShadows();
    this._drawCharacter(t);
    this._drawRodAndBobber(t);
    if (this.state === 'reel') {
      const pos = this._reelFishPos(t);
      this._drawReelQte(pos.x, pos.y, t);
    }
    this._drawEffects();
    this._drawMessage();
    if (this.state === 'charging') this._drawPowerBar();
    if (this.state === 'reel') this._drawReelBar();
    if (this.state === 'result') this._drawResult();
  }

  /** 水面在下、背景在上：背景透明处露出水面，码头等不透明处盖住水面。 */
  _drawScene() {
    if (!this._ready(this.imgBg) || !this._ready(this.imgWater)) return false;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.imgWater,
      SCENE_CROP.x, SCENE_CROP.y, SCENE_CROP.w, SCENE_CROP.h,
      0, 0, W, H);
    ctx.drawImage(this.imgBg,
      SCENE_CROP.x, SCENE_CROP.y, SCENE_CROP.w, SCENE_CROP.h,
      0, 0, W, H);
    return true;
  }

  _charBob(t) {
    return Math.sin(t * 1.7) * 1.2;
  }

  _drawCharacter(t) {
    const ctx = this.ctx;
    const img = this.state === 'charging' ? this.imgRaise : this.imgFishing;
    if (!this._ready(img)) return;
    const bob = this._charBob(t);
    const w = img.naturalWidth * CHAR_SCALE;
    // 脚下的软阴影，让角色和码头有接触感
    ctx.fillStyle = 'rgba(25, 14, 35, .28)';
    ctx.beginPath();
    ctx.ellipse(CHAR_X + w * 0.5, CHAR_Y + CHAR_H - 2, w * 0.34, 5.5, 0, 0, TAU);
    ctx.fill();
    ctx.drawImage(img, CHAR_X, CHAR_Y + bob, w, CHAR_H);
  }

  /** 当前姿势的手部锚点、鱼竿角度和鱼线起点。 */
  _rodPose(t) {
    const charging = this.state === 'charging';
    const pose = charging ? POSE_RAISE : POSE_FISH;
    let angle = pose.angle;
    if (this.state === 'cast') {
      // 第二百三十四轮：抬杆角从 -0.55 收到 -0.28 —— 原角度会让竿尖冲出画布顶部，
      // 鱼线起点被夹到 y=0，视觉上像从角色头顶/背后甩出来。
      const p = 1 - clamp(this.castT / 0.55, 0, 1);
      angle = -0.28 + p * 0.18;
    } else if (this.state === 'reel') {
      angle = pose.angle + this.tension * 0.18 + Math.sin(t * 12) * 0.008;
    } else if (this.state === 'bite') {
      angle += 0.03;
    }
    const bob = this._charBob(t);
    return {
      pose,
      angle,
      anchorX: CHAR_X + pose.handX * CHAR_SCALE,
      anchorY: CHAR_Y + bob + pose.handY * CHAR_SCALE,
    };
  }

  _rodTip(anchorX, anchorY, angle) {
    const dx = (ROD_TIP.x - ROD_ANCHOR.x) * CHAR_SCALE;
    const dy = (ROD_TIP.y - ROD_ANCHOR.y) * CHAR_SCALE;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: anchorX + dx * c - dy * s, y: anchorY + dx * s + dy * c };
  }

  _angleMove(cur, target, maxStep) {
    const diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
    return cur + clamp(diff, -maxStep, maxStep);
  }

  /** 收线时鱼的位置：从落点慢慢被拉到竿尖；QTE 圈和鱼影都用它。 */
  _reelFishPos(t) {
    const { angle, anchorX, anchorY } = this._rodPose(t);
    const tip = this._rodTip(anchorX, anchorY, angle);
    const pull = clamp(this.progress, 0, 1);
    // 第二百三十五轮：收线终点不再是竿尖（那样像鱼飞到竿上），
    // 而是竿尖正下方、贴近水面的位置 —— 鱼是被拖到岸边，不是被吊到半空。
    const targetX = tip.x - 14;
    const targetY = Math.min(H - 36, tip.y + 58);
    return {
      x: this.bobberX + (targetX - this.bobberX) * pull,
      y: 112 + (targetY - 112) * pull + Math.sin(t * 10) * 3 * (1 - pull * 0.7),
      tip,
    };
  }

  _qteSplashBurst() {
    const pos = this._reelFishPos(this.ambientT);
    const a = this.qteDir;
    const cx = pos.x + Math.cos(a) * 24;
    const cy = pos.y + Math.sin(a) * 12;
    for (let i = 0; i < 4; i++) {
      const ang = a + rand(-0.5, 0.5);
      const sp = rand(18, 64);
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 10,
        life: rand(0.2, 0.5), max: 0.5, r: rand(1, 2.5),
        color: i % 2 ? 'rgba(190, 246, 255, .9)' : 'rgba(255, 220, 120, .9)',
      });
    }
    this.ripples.push({ x: cx, y: cy, r: 5, max: 32, a: 0.65 });
  }

  /** 竿尖在画布外时，把鱼线起点夹到画布边缘，避免线"凭空从半空出现"。 */
  _lineStart(anchor, tip) {
    if (tip.x >= 0 && tip.x <= W && tip.y >= 0 && tip.y <= H) return tip;
    const dx = tip.x - anchor.x;
    const dy = tip.y - anchor.y;
    let t = 1;
    if (tip.y < 0 && dy < 0) t = Math.min(t, (0 - anchor.y) / dy);
    if (tip.y > H && dy > 0) t = Math.min(t, (H - anchor.y) / dy);
    if (tip.x < 0 && dx < 0) t = Math.min(t, (0 - anchor.x) / dx);
    if (tip.x > W && dx > 0) t = Math.min(t, (W - anchor.x) / dx);
    t = clamp(t, 0, 1);
    return { x: anchor.x + dx * t, y: anchor.y + dy * t };
  }

  _drawSky(t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, 90);
    g.addColorStop(0, '#dff5ff');
    g.addColorStop(0.65, '#bfe8f8');
    g.addColorStop(1, '#9ed9ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 远处的云
    ctx.fillStyle = 'rgba(255, 255, 255, .55)';
    for (let i = 0; i < 3; i++) {
      const x = 300 + i * 240 + Math.sin(t * 0.08 + i) * 14;
      const y = 24 + i * 9;
      ctx.beginPath();
      ctx.ellipse(x, y, 50, 12, 0, 0, TAU);
      ctx.ellipse(x + 34, y - 5, 32, 10, 0, 0, TAU);
      ctx.ellipse(x - 30, y + 2, 26, 8, 0, 0, TAU);
      ctx.fill();
    }
    // 太阳
    ctx.fillStyle = 'rgba(255, 244, 190, .75)';
    ctx.beginPath();
    ctx.arc(930, 30, 18, 0, TAU);
    ctx.fill();
  }

  _drawWater(t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 82, 0, H);
    g.addColorStop(0, '#7fd6ea');
    g.addColorStop(0.55, '#48b6d8');
    g.addColorStop(1, '#247fa8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 82, W, H - 82);

    // 水波
    ctx.strokeStyle = 'rgba(220, 255, 255, .28)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = 96 + i * 16 + Math.sin(x * 0.018 + t * 0.9 + i) * 2.5;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 睡莲
    for (const [x, y, r] of [[360, 145, 21], [700, 136, 17], [880, 154, 24]]) {
      ctx.fillStyle = 'rgba(48, 130, 92, .8)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0.4, TAU - 0.4);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 240, 180, .3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  _drawBank(t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 72, 0, H);
    g.addColorStop(0, '#8ed17a');
    g.addColorStop(1, '#4f9e65');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.quadraticCurveTo(110, 60, 176, 86);
    ctx.quadraticCurveTo(210, 104, 196, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, .22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 76);
    ctx.quadraticCurveTo(110, 64, 170, 90);
    ctx.stroke();

    // 草丛
    ctx.strokeStyle = '#3f8a58';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const x = 18 + i * 18;
      const y = 140 + (i % 3) * 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y - 12, x + 10, y - 16);
      ctx.stroke();
    }
  }

  /**
   * 背景游鱼：把真实鱼图标压成剪影（filter: brightness(0)）画在水下。
   * 不支持 filter 的环境自动降级成旧版椭圆影子。
   */
  _drawFishShadows() {
    const ctx = this.ctx;
    for (const f of this.fishShadows) {
      const img = this.fishSprites?.[f.id];
      if (this._ready(img) && this._filterOk !== false) {
        const w = 74 * f.scale;
        ctx.save();
        ctx.translate(f.x, f.y);
        // 原图朝左；向右边游时水平翻转
        ctx.scale(f.sp > 0 ? -1 : 1, 1);
        ctx.rotate(Math.sin(this.ambientT * 2.4 + f.phase) * 0.05);
        ctx.globalAlpha = f.alpha;
        ctx.filter = 'brightness(0) saturate(0)';
        ctx.drawImage(img, -w / 2, -w / 2, w, w);
        ctx.restore();
        continue;
      }
      // 降级：旧椭圆
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#0e4b66';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(-20, -5);
      ctx.lineTo(-20, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    this._drawApproach();
  }

  /** 咬钩前：目标鱼从右侧游向浮漂，给玩家"有大鱼过来了"的期待。 */
  _drawApproach() {
    const a = this.approach;
    if (!a) return;
    const img = this.fishSprites?.[a.id];
    if (!this._ready(img)) return;
    const ctx = this.ctx;
    const p = Math.min(1, a.t / a.dur);
    const ease = 1 - Math.pow(1 - p, 2.2);           // 先快后慢，靠拢浮漂
    const x = a.fromX + (this.bobberX + 16 - a.fromX) * ease;
    const y = a.y + Math.sin(a.t * 3.2) * 2.5;
    const w = 92 + a.rarity * 13;
    const alpha = 0.2 + p * 0.45;
    const pulse = 0.75 + Math.sin(a.t * 5) * 0.25;

    // 鱼影周围先铺一圈光晕，深色水面上才看得出来"有东西靠近"
    if (p > 0.15) {
      ctx.save();
      ctx.globalAlpha = (0.12 + p * 0.3) * pulse;
      const g = ctx.createRadialGradient(x, y, 2, x, y, w * 0.8);
      const hot = a.rarity >= 4 ? 'rgba(255, 232, 150, .85)'
        : a.rarity === 3 ? 'rgba(214, 160, 255, .8)'
          : 'rgba(150, 230, 255, .65)';
      g.addColorStop(0, hot);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, w * 0.8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(a.t * 4.5) * 0.08);
    ctx.globalAlpha = alpha;
    if (this._filterOk !== false) ctx.filter = 'brightness(0) saturate(0)';
    ctx.drawImage(img, -w / 2, -w / 2, w, w);
    ctx.restore();

    // 剪影外再叠一层很淡的青色描边光（提亮轮廓）
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(a.t * 4.5) * 0.08);
    ctx.globalAlpha = 0.1 + p * 0.12;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, -w / 2, -w / 2, w, w);
    ctx.restore();
  }

  _drawCatgirl(t) {
    const ctx = this.ctx;
    const bob = Math.sin(t * 1.7) * 1.2;
    ctx.save();
    ctx.translate(74, 86 + bob);

    // 腿
    ctx.strokeStyle = '#6b5b7a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, 34); ctx.lineTo(-7, 50); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 34); ctx.lineTo(8, 50); ctx.stroke();

    // 裙子
    ctx.fillStyle = '#8fd0ff';
    ctx.beginPath();
    ctx.moveTo(-11, 18);
    ctx.lineTo(11, 18);
    ctx.lineTo(16, 38);
    ctx.lineTo(-16, 38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 身体 / 手臂
    ctx.fillStyle = '#ffe0c8';
    ctx.beginPath();
    ctx.ellipse(0, 14, 8, 10, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ffe0c8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(7, 14);
    ctx.lineTo(22, 20);
    ctx.stroke();

    // 头
    ctx.fillStyle = '#ffe6d2';
    ctx.beginPath();
    ctx.arc(0, -2, 13, 0, TAU);
    ctx.fill();

    // 头发
    ctx.fillStyle = '#6b5b7a';
    ctx.beginPath();
    ctx.arc(0, -4, 14, Math.PI, TAU);
    ctx.lineTo(14, 6);
    ctx.quadraticCurveTo(8, 1, 4, 6);
    ctx.lineTo(-13, 8);
    ctx.closePath();
    ctx.fill();

    // 猫耳
    ctx.fillStyle = '#6b5b7a';
    ctx.beginPath(); ctx.moveTo(-11, -8); ctx.lineTo(-15, -22); ctx.lineTo(-3, -13); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -8); ctx.lineTo(15, -22); ctx.lineTo(3, -13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb8d6';
    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(-12, -18); ctx.lineTo(-6, -13); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(12, -18); ctx.lineTo(6, -13); ctx.closePath(); ctx.fill();

    // 眼睛
    ctx.fillStyle = '#3d2b4a';
    ctx.beginPath(); ctx.arc(-4.5, 0, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5, 0, 1.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#d97a9d';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 4, 3.2, 0.25, Math.PI - 0.25); ctx.stroke();

    // 尾巴
    ctx.strokeStyle = '#6b5b7a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, 30);
    ctx.quadraticCurveTo(-30, 30 + Math.sin(t * 2) * 4, -24, 14);
    ctx.stroke();

    // 鱼竿（从手边伸出）
    ctx.strokeStyle = '#b97945';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, 18);
    ctx.lineTo(84, -34);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 200, .4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(22, 17);
    ctx.lineTo(82, -32);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 鱼线：一条主光 + 一条柔光描边，控制点按状态决定下垂量。
   *   idle/wait 静止 → 明显下垂（重力）
   *   cast 飞行     → 轻微下垂（被甩出去）
   *   reel 收线     → 拉直略上凸，张力越大越粗越亮，快到断裂时发红抖动
   *   bite/landing  → 绷直
   */
  _drawFishingLine(lineStart, bx, by, t) {
    const ctx = this.ctx;
    const len = Math.hypot(bx - lineStart.x, by - lineStart.y);
    let sag = 0;
    let alpha = 0.82;
    let width = 1.2;
    let danger = 0;

    if (this.state === 'wait' || this.state === 'idle') {
      sag = Math.min(24, len * 0.13);      // 向下垂
      alpha = 0.7;
      width = 1.1;
    } else if (this.state === 'cast') {
      sag = Math.min(10, len * 0.05);
      alpha = 0.8;
    } else if (this.state === 'reel') {
      sag = -4;                            // 绷紧，略上凸
      width = 1.25 + this.tension * 1.1;
      alpha = 0.9;
      danger = clamp((this.tension - 0.7) / 0.3, 0, 1);
      // 张力过高：抖动
      if (danger > 0) {
        const jitter = danger * 2.4;
        lineStart = { x: lineStart.x + Math.sin(t * 47) * jitter, y: lineStart.y + Math.cos(t * 53) * jitter };
      }
    } else if (this.state === 'bite') {
      sag = -2;
      alpha = 0.95;
      width = 1.3;
    } else if (this.state === 'landing') {
      sag = -3;
      alpha = 0.92;
    }

    const mx = (lineStart.x + bx) / 2;
    const my = (lineStart.y + by) / 2 + sag;

    // 柔光描边：远处也能看清细线
    ctx.save();
    ctx.strokeStyle = `rgba(226, 250, 255, ${alpha * 0.22})`;
    ctx.lineWidth = width + 1.8;
    ctx.beginPath();
    ctx.moveTo(lineStart.x, lineStart.y);
    ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.stroke();

    // 主线：张力高时由白转红
    if (danger > 0) {
      const g = Math.round(236 - danger * 130);
      const b = Math.round(240 - danger * 150);
      ctx.strokeStyle = `rgba(255, ${g}, ${b}, ${alpha})`;
    } else {
      ctx.strokeStyle = `rgba(240, 255, 255, ${alpha})`;
    }
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(lineStart.x, lineStart.y);
    ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.stroke();
    ctx.restore();
  }

  _drawRodAndBobber(t) {
    const ctx = this.ctx;
    const { angle, anchorX, anchorY } = this._rodPose(t);
    const tip = this._rodTip(anchorX, anchorY, angle);
    const lineStart = this._lineStart({ x: anchorX, y: anchorY }, tip);

    // 鱼竿素材：以握把中心为锚点旋转，握把正好压在两只手上。
    if (this._ready(this.imgRod)) {
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.rotate(angle);
      ctx.scale(CHAR_SCALE, CHAR_SCALE);
      ctx.drawImage(this.imgRod, -ROD_ANCHOR.x, -ROD_ANCHOR.y);
      ctx.restore();
    } else {
      ctx.strokeStyle = '#b97945';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }

    // 举杆蓄力时不画鱼线，真正抛竿后再出现。
    if (this.state === 'charging') return;

    // 鱼线终点：未抛竿时垂在水面；抛竿时从竿尖飞向目标；
    // 收线时浮漂/鱼会随着进度慢慢往角色方向移动。
    let bx = this.bobberX;
    let by = this.bobberY;
    let showBobber = true;
    if (this.state === 'idle') {
      bx = 680;
      by = 140 + Math.sin(t * 2.2) * 1.5;
    } else if (this.state === 'cast') {
      const p = 1 - clamp(this.castT / 0.55, 0, 1);
      const e = 1 - (1 - p) * (1 - p);
      bx = lineStart.x + (this.bobberX - lineStart.x) * e;
      by = lineStart.y + (this.bobberY - lineStart.y) * e - Math.sin(p * Math.PI) * 42;
    } else if (this.state === 'wait' || this.state === 'bite') {
      by = 112 + Math.sin(t * 4) * 2;
      // 有大鱼靠近时浮漂开始轻轻发抖，给玩家"快来咬钩了"的预警
      if (this.state === 'wait' && this.approach) {
        const ap = Math.min(1, this.approach.t / this.approach.dur);
        by += Math.sin(t * 19) * (0.8 + ap * 2.4);
      }
      if (this.state === 'bite') {
        // 咬钩瞬间浮漂猛沉并快速抖动
        const k = Math.min(1, (0.85 - this.biteT) / 0.12);
        by += 5 + k * 8 + Math.sin(t * 32) * 1.6;
      }
    } else if (this.state === 'reel') {
      // 收线收到鱼竿头部，不是收到角色身前：鱼线要沿着伸出去的鱼竿收短。
      const pull = clamp(this.progress, 0, 1);
      const toX = tip.x;
      const toY = tip.y + 5;
      bx = this.bobberX + (toX - this.bobberX) * pull;
      by = 112 + (toY - 112) * pull + Math.sin(t * 10) * 3 * (1 - pull * 0.7);
      showBobber = false;
      const sizeK = 1 + this.qteRarity * 0.1;
      if (pull > 0.08) this._drawStrugglingFish(bx, by + 4, t, (0.8 + pull * 0.35) * sizeK);
    } else if (this.state === 'landing') {
      // 最后只把鱼提到竿尖附近，线始终以竿尖为终点。
      const p = 1 - clamp(this.landT / 0.75, 0, 1);
      const e = 1 - (1 - p) * (1 - p);
      const from = this.landFrom || { x: tip.x - 14, y: 100 };
      // 只提到竿尖下方一点，不飞到竿上
      const toX = tip.x - 14;
      const toY = tip.y + 64;
      bx = from.x + (toX - from.x) * e;
      by = from.y + (toY - from.y) * e - Math.sin(p * Math.PI) * 10;
      showBobber = false;
      // 鱼出水面：从水面拉出一道水花柱
      this._drawLiftSplash(bx, by);
      this._drawStrugglingFish(bx, by, t, 0.95 * (1 + this.qteRarity * 0.1));
    }

    // ---- 第二百三十四轮：鱼线表现 ----
    // 静止时受重力下垂；抛竿飞行时被甩直；收线时绷紧发亮，张力过高转红并抖动。
    this._drawFishingLine(lineStart, bx, by, t);

    if (showBobber) {
      ctx.save();
      ctx.translate(bx, by);
      // 水面接触阴影 + 水痕圈（两个状态都保留，让浮漂"踩"在水面上）
      ctx.fillStyle = 'rgba(16, 44, 64, .3)';
      ctx.beginPath(); ctx.ellipse(0, 6, 8, 2.6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(220, 250, 255, .32)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 6, 10.5, 3.4, 0, 0, TAU); ctx.stroke();

      // 第二百三十五轮：换成用户提供的鱼漂插画（细长竖版）
      if (this._ready(this.imgBobber)) {
        const bh = 42;
        const bw = bh * (this.imgBobber.naturalWidth / this.imgBobber.naturalHeight);
        // 水面在红白交界处；等待时轻微摆动，咬钩时被拽歪
        const sway = this.state === 'idle' || this.state === 'wait'
          ? Math.sin(t * 2.1) * 0.05 : 0;
        const tilt = this.state === 'bite' ? 0.16 : sway;
        ctx.save();
        ctx.translate(0, 2);
        ctx.rotate(tilt);
        ctx.drawImage(this.imgBobber, -bw / 2, -bh * BOBBER_SPLIT, bw, bh);
        // 水面以下那半截蒙一层水色，做出"浸在水里"的层次
        const underTop = 0;
        const underH = bh * (1 - BOBBER_SPLIT);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-bw / 2, underTop, bw, underH);
        ctx.clip();
        ctx.fillStyle = 'rgba(38, 108, 152, .34)';
        ctx.fillRect(-bw / 2, underTop, bw, underH);
        ctx.restore();
        ctx.restore();
      } else {
        // 降级：旧几何鱼漂
        ctx.fillStyle = '#f7fbff';
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff5f6d';
        ctx.beginPath(); ctx.ellipse(0, -3, 6, 5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a3a44';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -16); ctx.stroke();
      }
      ctx.restore();
    }

    if (this.state === 'bite') {
      const bounce = Math.abs(Math.sin(t * 9)) * 4;
      const cy = by - 38 - bounce;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#ff3b5c';
      ctx.beginPath();
      ctx.arc(bx, cy, 12, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, cy, 12, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = '900 17px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, cy + 1);
      ctx.restore();
    }
  }

  /** 鱼被提出水面时，从水面拉起的一道水花柱（画在鱼后面）。 */
  _drawLiftSplash(x, y) {
    const waterY = 112;
    const h = waterY - y;
    if (h <= 6) return;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, waterY, 0, y);
    g.addColorStop(0, 'rgba(238, 255, 255, .9)');
    g.addColorStop(0.55, 'rgba(210, 246, 255, .44)');
    g.addColorStop(1, 'rgba(206, 244, 255, 0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 16, waterY);
    ctx.quadraticCurveTo(x - 7, (waterY + y) / 2, x - 3.5, y + 5);
    ctx.lineTo(x + 3.5, y + 5);
    ctx.quadraticCurveTo(x + 7, (waterY + y) / 2, x + 16, waterY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 收线/上鱼时的黑色鱼影：不暴露鱼种、大小和颜色。 */
  _drawStrugglingFish(x, y, t, scale = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 9) * 0.28);
    ctx.scale(scale, scale);
    // 水下淡青色轮廓，保证黑影子在深色水面上也能看清
    ctx.fillStyle = 'rgba(170, 230, 255, .20)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 21, 9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(8, 13, 21, .94)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-25, -7);
    ctx.lineTo(-22, 0);
    ctx.lineTo(-25, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(220, 255, 255, .55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y + 7, 22 * scale, 5 * scale, 0, 0, TAU);
    ctx.stroke();
  }

  _drawReelQte(x, y, t) {
    const ctx = this.ctx;
    const pulse = Math.sin(t * 6) * 2;
    const flash = clamp(this.qteFlash || 0, 0, 1);
    ctx.save();
    ctx.translate(x, y);

    // 淡暗底：浅色水面上白色同心圆容易糊，垫一层再画
    const bg = ctx.createRadialGradient(0, 0, 8, 0, 0, 52);
    bg.addColorStop(0, 'rgba(8, 26, 42, .26)');
    bg.addColorStop(1, 'rgba(8, 26, 42, 0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, TAU);
    ctx.fill();

    // 外圈：收线进度（绿色，从 12 点顺时针）
    const progR = 47;
    ctx.strokeStyle = 'rgba(255, 255, 255, .16)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, progR, 0, TAU);
    ctx.stroke();
    if (this.progress > 0) {
      ctx.strokeStyle = 'rgba(255, 214, 120, .92)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, progR, -Math.PI / 2, -Math.PI / 2 + TAU * this.progress);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // 内圈：张力环（绿→黄→红，越危险越红）
    const tenR = 41;
    const ten = clamp(this.tension, 0, 1);
    let tenColor;
    if (ten < 0.5) {
      // 安全：从青色渐变到黄色
      const k = ten / 0.5;
      tenColor = `rgba(${Math.round(111 + k * 144)}, ${Math.round(224 + k * 31)}, ${Math.round(255 - k * 153)}, .8)`;
    } else {
      // 危险：从黄色渐变到红色
      const k = (ten - 0.5) / 0.5;
      tenColor = `rgba(255, ${Math.round(255 - k * 150)}, ${Math.round(102 - k * 80)}, .88)`;
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, .12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, tenR, 0, TAU);
    ctx.stroke();
    if (ten > 0.02) {
      ctx.strokeStyle = tenColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, tenR, -Math.PI / 2, -Math.PI / 2 + TAU * ten);
      ctx.stroke();
    }

    // 多个同心圆
    for (const [r, a] of [[40 + pulse, .30], [31, .22], [23, .16]]) {
      ctx.strokeStyle = `rgba(220, 255, 255, ${a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }

    // 转向脉冲：鱼突然换方向时闪一圈
    if (flash > 0.01) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${flash * 0.55})`;
      ctx.lineWidth = 2 + flash * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 34 + (1 - flash) * 12, 0, TAU);
      ctx.stroke();
    }

    // 红色箭头：鱼正在往这个方向逃
    ctx.save();
    ctx.rotate(this.qteDir);
    ctx.strokeStyle = 'rgba(255, 92, 112, .9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(34, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 92, 112, .95)';
    ctx.beginPath();
    ctx.moveTo(45, 0);
    ctx.lineTo(32, -8);
    ctx.lineTo(32, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 绿色弧：玩家要往反方向拖
    ctx.strokeStyle = 'rgba(126, 255, 180, .85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 34, this.qteDir + Math.PI - 0.5, this.qteDir + Math.PI + 0.5);
    ctx.stroke();

    // 当前鼠标拉扯方向
    const dx = this.pointer.x - x;
    const dy = this.pointer.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > 3) {
      const a = Math.atan2(dy, dx);
      const good = Math.cos(a - (this.qteDir + Math.PI)) > 0.15;
      // 拉住时圈内泛光：对了绿、反了红（呼吸式）
      if (this.reeling) {
        const breath = 0.5 + Math.sin(t * 9) * 0.5;
        const rg = ctx.createRadialGradient(0, 0, 4, 0, 0, 32);
        rg.addColorStop(0, good
          ? `rgba(126, 255, 180, ${0.06 + breath * 0.11})`
          : `rgba(255, 108, 108, ${0.06 + breath * 0.13})`);
        rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, TAU);
        ctx.fill();
      }
      ctx.save();
      ctx.rotate(a);
      ctx.strokeStyle = this.reeling
        ? (good ? 'rgba(126, 255, 180, .95)' : 'rgba(255, 120, 120, .95)')
        : 'rgba(255, 255, 255, .35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(Math.min(50, dist), 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawEffects() {
    const ctx = this.ctx;
    for (const r of this.ripples) {
      ctx.strokeStyle = `rgba(220, 255, 255, ${Math.max(0, r.a)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.42, 0, 0, TAU);
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
  }

  _drawMessage() {
    const ctx = this.ctx;
    const text = this.message || '';
    ctx.font = '800 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    const w = Math.max(180, ctx.measureText(text).width + 34);
    const x = W / 2 - w / 2;
    ctx.fillStyle = 'rgba(10, 40, 58, .55)';
    this._roundRect(ctx, x, 8, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#eafcff';
    ctx.fillText(text, W / 2, 26);
  }

  _drawPowerBar() {
    const ctx = this.ctx;
    const x = 40;
    const y = 146;
    const w = 190;
    const h = 12;
    ctx.fillStyle = 'rgba(8, 30, 42, .55)';
    this._roundRect(ctx, x, y, w, h, 6); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#7ef0b0');
    g.addColorStop(0.65, '#ffd166');
    g.addColorStop(1, '#ff6f61');
    ctx.fillStyle = g;
    this._roundRect(ctx, x + 1, y + 1, (w - 2) * this.power, h - 2, 5); ctx.fill();
    ctx.fillStyle = '#eafcff';
    ctx.font = '800 10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('抛竿力度', x, y - 4);
  }

  _drawReelBar() {
    const ctx = this.ctx;
    const x = 420;
    const y = 146;
    const w = 400;
    const h = 9;
    ctx.fillStyle = 'rgba(8, 30, 42, .55)';
    this._roundRect(ctx, x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = '#7ef0b0';
    this._roundRect(ctx, x + 1, y + 1, (w - 2) * this.progress, h - 2, 4); ctx.fill();

    // 张力条（进度条下方）
    ctx.fillStyle = 'rgba(8, 30, 42, .55)';
    this._roundRect(ctx, x, y + 14, w, 6, 3); ctx.fill();
    const tg = ctx.createLinearGradient(x, 0, x + w, 0);
    tg.addColorStop(0, '#8fd3ff');
    tg.addColorStop(0.65, '#ffd166');
    tg.addColorStop(1, '#ff3b5c');
    ctx.fillStyle = tg;
    this._roundRect(ctx, x + 1, y + 15, (w - 2) * Math.min(1, this.tension), 4, 2); ctx.fill();

    ctx.fillStyle = '#eafcff';
    ctx.font = '800 10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`收线 ${Math.round(this.progress * 100)}%　挣脱 ${Math.round(this.tension * 100)}%`, x + w / 2, y - 6);
  }

  _drawResult() {
    const ctx = this.ctx;
    const r = this.result;
    if (!r) return;
    const w = 390;
    const h = 86;
    const x = W / 2 - w / 2;
    const y = 42;
    ctx.fillStyle = 'rgba(255, 255, 255, .94)';
    this._roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = r.fish ? '#ffd166' : '#9fb7c8';
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, w, h, 14); ctx.stroke();

    ctx.textAlign = 'center';
    if (r.fish) {
      const def = getFish(r.fish.id);
      const stars = r.fish.star > 0 ? '★'.repeat(r.fish.star) : '';
      let textX = W / 2;
      const icon = this.fishSprites?.[r.fish.id];
      if (this._ready(icon)) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(icon, x + 14, y + 19, 48, 48);
        ctx.restore();
        textX = W / 2 + 26;
      }
      ctx.fillStyle = def.body || '#ff9a3c';
      ctx.font = '900 17px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(`${def.name} ${stars}`, textX, y + 25);
      ctx.fillStyle = '#35546a';
      ctx.font = '700 12px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(`${r.fish.cm} cm · ${r.fish.value} 金币`, textX, y + 45);
      ctx.fillStyle = r.autoSold ? '#b06bff' : '#2f9e6f';
      ctx.fillText(r.autoSold ? '鱼篓已满，自动折成金币' : '已放入鱼篓', textX, y + 63);
      if (r.coins != null) {
        ctx.fillStyle = '#7a6d8c';
        ctx.font = '700 10px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.fillText(`金币 ${r.coins}`, textX, y + 78);
      }
    } else {
      ctx.fillStyle = '#5f7386';
      ctx.font = '900 16px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(r.message || '鱼跑掉了……', W / 2, y + 42);
      ctx.fillStyle = '#8fa6b8';
      ctx.font = '700 11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('再试一次吧', W / 2, y + 62);
    }
  }
}