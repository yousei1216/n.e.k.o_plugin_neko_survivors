// ============================================================
// neko-pilot.js — 猫娘代打大脑（第一百六十五轮）
//
// 用户原话："那你的新版，猫娘可以自己玩游戏了吗？她能做到1-20回合
// 通关噩梦难度吗？如果不可以，尝试让她可以"
//
// 设计：NekoAgent 是"手脚"（getGameState/doAction/setPuppetMode），
// 这里是"大脑"——一个每帧决策的状态机，只用公开原语 + 少量只读状态：
//
//   playing  → 战斗走位：有远程武器就风筝（威胁向量逃离＋中心拉力防
//              出界＋拾取吸引）；全近战才贴脸输出
//   vergil   → 环绕维吉尔保持 240~360 距离（近了吃居合、远了打不着）；
//              就算 90 秒打不死，活着撑到结算也算过
//   level_up → 打分选卡（伤害>攻速>血量>暴击…，前 5 波血量加权）
//   shop     → 优先买远程武器（早期定风筝基调），再补 afford 道具，
//              然后 _beginWave(+1) 推进（战利品留给防洪闸折价）
//   result   → 20 波且活着 = 通关（_endRun(true)）；否则重开
//              （maxAttempts 次内自动重来，全灭才放弃）
//
// 健壮性同 NekoAgent 契约：tick 永不抛错；大脑崩溃只影响代打，
// 绝不拖垮游戏主循环。
// ============================================================

/** 选卡打分表：属性 id → 权重（噩梦通关的稳健成长序）
 *  luna 基础 10 血 —— 血量/移速/护甲是风筝流的生命线，权重给足 */
const STAT_SCORE = {
  damage: 10, attackSpeed: 8, maxHp: 10, critChance: 6, moveSpeed: 7,
  armor: 6, critDamage: 4, hpRegen: 5, lifesteal: 4, luck: 4,
  harvesting: 3, pickupRange: 2, dodge: 5,
};

// ---- 第一百六十六轮：接管/交还的切换语音（用户点名要的"三五句"）----
// 通过 game._nekoSay 播报（气泡 + TTS，插件桥模式下走官方语音通道）
const TAKEOVER_LINES = [
  '要人家帮你玩了吗～', '把键盘交给我吧喵！', '看好了，人家的走位～',
  '放心交给我，喵！', '嘿嘿，轮到我上场啦～',
];
const HANDOVER_LINES = [
  '诶，要你亲自出马了吗？', '好吧好吧，键盘还你喵～', '那你要加油哦！',
  '人家打得不好吗…喵', '主人的手痒了吧～',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)] ?? arr[0];

export class NekoPilot {
  constructor() {
    this.on = false;
    this.win = false;
    this.gaveUp = false;
    this.attempt = 0;
    this.maxAttempts = 3;
    this.characterId = 'yui';
    this.difficulty = 'nightmare';
    this.startedAt = 0;
    this._aimT = 0;          // 走位节流（帧计）
    this._events = [];       // 战报
  }

  /** 战报（探针/宿主读取） */
  get report() {
    return {
      on: this.on, win: this.win, gaveUp: this.gaveUp,
      attempt: this.attempt, maxAttempts: this.maxAttempts,
      difficulty: this.difficulty,
      events: this._events.slice(-200),
    };
  }

  _log(text) {
    this._events.push({ t: Date.now(), text });
    try { console.log(`[neko-pilot] ${text}`); } catch { /* */ }
  }

  /**
   * 开打：设难度 → 开局 → 键盘接管（防人类干扰）。
   * @param {object} g  游戏实例（window.__game）
   * @param {object} [opts] { difficulty, characterId, maxAttempts }
   */
  start(g, opts = {}) {
    // ---- 第一百七十轮：entity 模式（pilot2 驱动 P2 队友）----
    // 不重开局、不抢键盘、不挂光环（双 0buff 实验）；P2 已由 main 的
    // startRun(duo) 创建好，这里只是"接管她的大脑"。
    if (opts.entity) {
      this.entity = opts.entity;
      this.on = true;
      this.win = false;
      this.gaveUp = false;
      this._lastPush = -999;
      this._events = [];
      this._hpSnapshot = null;
      this._tgt = null; this._lastX = null; this._lastY = null; this._stuckN = 0;
      this._log(`P2 猫娘上线：${opts.entity.characterId}（双 0buff 实验）`);
      return true;
    }
    // 难度默认跟当前选角界面选的难度走（用户从选角界面点"猫娘帮你玩"
    // 时期望打的就是选中的难度，不是写死的噩梦）
    this.entity = null;
    this.difficulty = opts.difficulty ?? g?.difficultyId ?? 'nightmare';
    this.characterId = opts.characterId ?? 'luna';
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.on = true;
    this.win = false;
    this.gaveUp = false;
    this.attempt = 1;
    // ---- 第一百七十四轮：同回合重试计数（团灭重试 5 次上限）
    this._retryWave = null;
    this._retryN = 0;
    this._lastPush = -999;
    this._events = [];
    this.startedAt = Date.now();
    this._hpSnapshot = null;   // 新局满血，无快照
    this._tgt = null; this._lastX = null; this._lastY = null; this._stuckN = 0;
    try {
      if (this.difficulty && typeof g.setDifficulty === 'function' && g.difficultyId !== this.difficulty) {
        g.setDifficulty(this.difficulty);
      }
      g.ui?.clearOverlay?.();
      g.startRun(this.characterId);
      globalThis.NekoAgent?.setPuppetMode?.(true);
      this._log(`代打开始：${this.characterId} · ${this.difficulty} · 最多 ${this.maxAttempts} 次尝试`);
      g._nekoSay?.(pick(TAKEOVER_LINES));
    } catch (e) {
      this._log(`开局失败：${e?.message ?? e}`);
      this.on = false;
    }
    return this.on;
  }

  /**
   * 中途接管（暂停菜单切换开）：不重开局，就地接手当前局面。
   */
  adopt(g) {
    this.on = true;
    this.win = false;
    this.gaveUp = false;
    this.attempt = Math.max(1, this.attempt);
    this._lastPush = -999;
    this._events = this._events || [];
    this.startedAt = this.startedAt || Date.now();
    // 第一百六十八轮：交出瞬间快照血量**比例** —— 代打期间光环回复拉满
    // 也不能带走：切回来时按比例还原，堵死"切猫娘回满血再切回来 = 不死"
    // 的漏洞。光环回血只服务于她自己活着。
    try { if (g?.player) this._hpSnapshot = g.player.hp / Math.max(1, g.player.maxHp); } catch { /* */ }
    this._tgt = null; this._lastX = null; this._lastY = null; this._stuckN = 0;
    try {
      globalThis.NekoAgent?.setPuppetMode?.(true);
      this._log(`代打中途接管（第 ${(g?.waveIndex ?? 0) + 1} 波）`);
      g?._nekoSay?.(pick(TAKEOVER_LINES));
    } catch { /* */ }
    return true;
  }

  /** 停止代打，控制权立刻还给玩家 */
  stop(g) {
    this.on = false;
    try { globalThis.NekoAgent?.setPuppetMode?.(false); } catch { /* */ }
    try {
      if (g?.player) {
        // 还原交出时的血量比例（第一百六十八轮防漏洞，见 adopt）
        if (this._hpSnapshot != null) {
          g.player.hp = Math.max(1, Math.round(this._hpSnapshot * g.player.maxHp));
          this._hpSnapshot = null;
        }
        g.player.pilotBuff = false;
        // 轻量/第三档光环一并清（第一百七十/一七一轮）
        g.player.pilotLite = false;
        g.player.pilotTough = false;
        g.player._pilotMagnet = 0;
        g.player._pilotIframe = 0;
        g.player._pilotEarly = false;
        g.player.agentMoveTarget = null;   // 清掉她的移动意图，别拽着玩家走
      }
    } catch { /* */ }
    this._tgt = null; this._lastX = null; this._lastY = null; this._stuckN = 0;
    try { g?._nekoSay?.(pick(HANDOVER_LINES)); } catch { /* */ }
    this._log('代打结束，控制权交还玩家');
  }

  /** 每帧决策入口（NekoAgent._tick 里调用，永远不抛） */
  tick(g) {
    if (!this.on || !g) return;
    try {
      // ---- 第一百七十轮：实体参数化（2P）----
      // entity 模式（pilot2）：this.entity 是队友 P2 —— 不重开局、
      // 不抢键盘、不挂任何光环（双 0buff 实验）、不处理结算
      //（双死判负由 main），P2 倒地时原地待救援。
      const p = this.entity ?? g.player;
      if (!p) return;
      if (this.entity) {
        if (p.dead || p.downed) return;   // 倒地等救援，AI 不动作
        if (g.state === 'result') return; // 结算交给 P1 的 pilot
        if (p.pendingLevelUps > 0) {
          // P2 升级自动化（不走选卡 UI）：简化包 = 生存向 +6 上限/+8% 伤害
          p.pendingLevelUps--;
          p.stats.addFlat('maxHp', 6);
          p.stats.addPct('damage', 8);
          p.stats.dirty = true;
          p.heal(6);
          this._log('P2 升级：+6 生命上限 / +8% 伤害（自动）');
        }
      }

      // ---- 卡墙检测 ----
      // 有移动目标但 ~0.3s 位移 <0.6px = 撞墙了 —— 侧移 90° 绕行。
      // （agentMoveTarget 是直线走位，遇地形障碍会顶死在墙上）
      if (p && this._lastX != null) {
        const moved = Math.hypot(p.x - this._lastX, p.y - this._lastY);
        if (moved < 0.6 && p.agentMoveTarget) {
          if (++this._stuckN > 18) {
            const t = p.agentMoveTarget;
            const dx = t.x - p.x, dy = t.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            // 第一百七十一轮修复：直设实体自己的 agentMoveTarget ——
            // 走全局 doAction 会把指令打到 g.player（P1）头上，
            // 这就是 v0.3.48"AI 控制了 1p、2p 挂机"的根因
            p.agentMoveTarget = { x: p.x - (dy / d) * 130, y: p.y + (dx / d) * 130 };
            this._stuckN = 0;
            this._lastX = p.x; this._lastY = p.y;
            return;
          }
        } else this._stuckN = 0;
        this._lastX = p.x; this._lastY = p.y;
      } else if (p) { this._lastX = p.x; this._lastY = p.y; }

      // ---- 光环调度（第一百七十一轮重构）----
      // · pilotBuff  全套（锁1+回复）—— 单机默认
      // · pilotLite  磁吸400 + 前3波减伤40% —— 探针 __altbuff
      // · pilotTough 全图磁吸 + 无敌帧2s + 前3波减伤50% —— 探针 __buff3
      // · duo 且无 __buff3：双 0buff（2P 实验基准）；duo 且 __buff3：
      //   两只都挂 pilotTough（用户："单ai不行就双ai一起玩"）
      {
        const duo = window.__duo || g.__duo;
        const buff3 = window.__buff3 || g.__buff3;
        const nobuff = window.__nobuff || g.__nobuff;
        const crew = this.entity ? [this.entity] : (g.players?.() ?? [g.player]);
        for (const ent of crew) {
          if (!ent || ent.dead) continue;
          if (nobuff || (duo && !buff3)) {
            ent.pilotBuff = false; ent.pilotLite = false; ent.pilotTough = false;
            ent._pilotMagnet = 0; ent._pilotIframe = 0; ent._pilotEarly = false;
          } else if (buff3) {
            ent.pilotBuff = false; ent.pilotLite = false; ent.pilotTough = true;
            ent._pilotEarly = (g.waveIndex ?? 0) < 3;
            ent._pilotMagnet = 99999;   // 全图吸附
            ent._pilotIframe = 2.0;
          } else if (!this.entity) {
            ent.pilotBuff = true; ent.pilotLite = false; ent.pilotTough = false;
            if (ent.hp > 0) {
              // ≈12/s —— 刻意压到"围殴+维吉尔真伤连击"能击穿的水位：
              // 用户要"输了也挺有趣，但不能真的一局都赢不了"，留死亡窗口
              ent.hp = Math.min(ent.maxHp, ent.hp + 0.4);
            }
          } else {
            ent.pilotBuff = false; ent.pilotLite = false; ent.pilotTough = false;
          }
        }
      }
      switch (g.state) {
        case 'playing': this._combat(g, false, p); break;
        case 'vergil': this._combat(g, true, p); break;
        case 'flandre': this._combat(g, true, p); break;   // 芙兰战同款环绕（20 波后挑战）
        case 'level_up': this._pickUpgrade(g, p); break;
        case 'shop': this._nextWave(g, p); break;
        case 'result': if (!this.entity) this._settle(g); break;
        default: break; // title/char_select/paused 等不动作
      }
    } catch { /* 决策异常不许影响游戏 */ }
  }

  // ---------------------------------------------------------
  // 战斗走位
  // ---------------------------------------------------------
  _combat(g, vergilMode, ent) {
    const p = ent ?? g.player;
    if (!p || p.dead) return;
    // 节流：每 4 帧重算一次目标（~0.13s）——太慢会被噩梦怪海围死
    if (++this._aimT % 4 !== 1) return;

    const world = g.world;
    const half = world?.halfSize ?? 700;
    const lowHp = p.maxHp > 0 && p.hp / p.maxHp < 0.6;   // 6 成血就开始怂
    const threatR = lowHp ? 430 : 310;      // 残血更怂：警戒圈加大
    const fleeMag = lowHp ? 300 : 210;

    const enemies = world?.enemies?.items;
    let fleeX = 0, fleeY = 0, nearest = null, nearestD = Infinity;
    if (Array.isArray(enemies)) {
      for (const e of enemies) {
        if (!e || e.dead || e.isChest) continue;
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < nearestD) { nearestD = d; nearest = e; }
        // 弹幕怪的警戒圈更大（子弹飞得远）
        const R = e.def?.behavior === 'bullet' ? threatR + 120 : threatR;
        if (d < R) {
          const w = 1 - d / R;
          fleeX += (dx / d) * w;
          fleeY += (dy / d) * w;
        }
      }
      // 包围逃逸：加权和会被多方向抵消（=站桩等死被围死，实测 4-6 波
      // 全这么死的）—— 最近怪的完整权重单独主导，保证永远在"离开
      // 最危险方向"的路上
      if (nearest && nearestD < threatR) {
        const ux = (p.x - nearest.x) / (nearestD || 1);
        const uy = (p.y - nearest.y) / (nearestD || 1);
        fleeX += ux * 1.1;
        fleeY += uy * 1.1;
      }
    }

    // ---- 第一百七十一轮：救援优先 ----
    // duo 下队友倒地：自己安全（最近怪 >350，不扛伤）就第一时间跑去
    // 队友身边 —— 武器弹穿过倒地队友即救援。危险时照常风筝（两个人
    // 都倒了这回合就输了），队友身边就是最好的复活点。
    if (g.__duo && nearestD > 350) {
      const mate = (ent === g.player || !ent) ? g.world?.player2 : g.player;
      if (mate && mate.downed && !mate.dead) {
        // 直设自己的 agentMoveTarget（同上，不走全局 doAction）
        p.agentMoveTarget = { x: mate.x + 30, y: mate.y + 20 };
        return;
      }
    }

    // 只要有"非近战"武器就风筝（ranged/element/turret 都算）；
    // 全近战则保持攻击半径环绕输出
    let hasRanged = false;
    try {
      hasRanged = (p.weapons || []).some((w) => {
        const k = w?.def?.kind;
        return k === 'ranged' || k === 'element' || k === 'turret';
      });
    } catch { /* */ }

    let tx, ty;
    if (vergilMode) {
      // 维吉尔战：环绕保持 240~360（近了躲不开居合，远了打不着）。
      // 就算武器够不着、90 秒耗完，活着本身就是过关。
      const b = world?.vergilFight?.boss;
      if (b && !b.dead) {
        const dx = p.x - b.x, dy = p.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 240) { tx = p.x + (dx / d) * 180; ty = p.y + (dy / d) * 180; }
        else if (d > 360) { tx = b.x + (dx / d) * 300; ty = b.y + (dy / d) * 300; }
        else { // 环绕切向移动，不吃直线弹幕
          tx = p.x + (-dy / d) * 140; ty = p.y + (dx / d) * 140;
        }
      } else { tx = p.x; ty = p.y; }
    } else if (!hasRanged && nearest && nearestD < 200) {
      // 近战：只对"落单"怪环绕输出（200 内 ≤3 只）；被围殴立刻转逃跑。
      // 环绕半径 70 = 猫爪类武器攻击边缘 —— 打得到怪、碰撞吃不到。
      let crowd = 0;
      if (Array.isArray(enemies)) {
        for (const e of enemies) {
          if (!e || e.dead || e.isChest) continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) < 200) crowd++;
        }
      }
      if (crowd <= 3) {
        const d = nearestD || 1;
        if (d > 95) {
          tx = nearest.x + (p.x - nearest.x) / d * 70;
          ty = nearest.y + (p.y - nearest.y) / d * 70;
        } else {
          // 切向环绕 + 拉回 70 半径
          const ux = (p.x - nearest.x) / d, uy = (p.y - nearest.y) / d;
          tx = p.x + (-uy) * 70 + ux * (70 - d) * 0.6;
          ty = p.y + (ux) * 70 + uy * (70 - d) * 0.6;
        }
      } else {
        tx = p.x + fleeX * fleeMag;
        ty = p.y + fleeY * fleeMag;
      }
    } else {
      const hasThreat = (fleeX !== 0 || fleeY !== 0);
      if (hasThreat) {
        // 风筝：逃离威胁（旋转 ~34° 走弧线 —— 纯直线逃跑会被直线弹幕
        // 追上，弧线让每发子弹都差一点）+ 场心拉力 + 拾取吸引
        // 第一百六十九轮：逃跑方向锥（<45°、<180px）内有**安全掉落**
        // （自身离怪 >200）就直奔顺路吃 —— 吸附机制，逃跑不白跑
        const rot = 0.6 * (this._orbitDir ??= (Math.random() < 0.5 ? 1 : -1));
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const rfX = fleeX * cosR - fleeY * sinR;
        const rfY = fleeX * sinR + fleeY * cosR;
        const distC = Math.hypot(p.x, p.y);
        const pullC = Math.max(0, distC - half * 0.78) / 160;
        const onPath = this._pickupOnPath(g, p, rfX, rfY);
        if (onPath) {
          tx = onPath.x; ty = onPath.y;
        } else {
          tx = p.x + rfX * fleeMag - p.x * 0.1 * pullC + this._pickupPull(g, p, 'x') * 0.5;
          ty = p.y + rfY * fleeMag - p.y * 0.1 * pullC + this._pickupPull(g, p, 'y') * 0.5;
        }
      } else if (nearest && nearestD > 500) {
        // 第一百六十九轮：真安全（最近怪 >500）才离巡逻圈去捡漏 ——
        // 只捡自身离怪 >220 的安全掉落；阈值定 500 而不是 350：
        // 教训 —— 350 就判定"安全"会主动走向怪（无光环实测波 1 送头）
        const pk = this._safePickup(g, p, 620);
        if (pk) {
          tx = pk.x; ty = pk.y;
        } else {
          this._orbit = (this._orbit ?? Math.random() * 6.283) + 0.3;
          tx = Math.cos(this._orbit) * half * 0.72;
          ty = Math.sin(this._orbit) * half * 0.72;
        }
      } else {
        // 安全期绝不站桩：贴边绕场巡逻（0.72×半场）—— 怪从场内刷，
        // 场边一侧永远只有半个方向的怪，幸存者类的经典遛怪位。
        // 场心拉力 dead-zone 同步放大到 0.78，巡逻圈不被拽回。
        this._orbit = (this._orbit ?? Math.random() * 6.283) + 0.3;
        const px = Math.cos(this._orbit) * half * 0.72;
        const py = Math.sin(this._orbit) * half * 0.72;
        const pk = this._nearestPickup(g, p);
        tx = pk ? pk.x * 0.6 + px * 0.4 : px;
        ty = pk ? pk.y * 0.6 + py * 0.4 : py;
      }
    }
    // ---- 走位平滑（低通 + 迟滞）----
    // 威胁向量帧间微小变化 → 目标点左右横跳（实测"鬼畜般高速抖动"）。
    // 新目标先和旧目标按 4:6 混合；混合后位移 <26px 就不更新 —— 角色继续
    // 朝旧目标走，只有真正有意义的方向变化才会改道。
    let mix = this._tgt
      ? { x: tx * 0.4 + this._tgt.x * 0.6, y: ty * 0.4 + this._tgt.y * 0.6 }
      : { x: tx, y: ty };
    // ---- 第一百七十二轮：刷怪预告避让 ----
    // 用户："知道哪里提前刷了就不过去，不知道一刷新就来个亲嘴。"
    // world.spawnWarnings = 1 秒后落地成怪的位置 —— 目标点若落在某个
    // 警告的 240px 危险半径内，就沿"远离警告"方向把落点推出去，
    // 宁可多走两步也不站到刷新点上。
    try {
      const warns = g.world?.spawnWarnings;
      if (Array.isArray(warns) && warns.length) {
        for (const w of warns) {
          const dx = mix.x - w.x, dy = mix.y - w.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 240) {
            const push = (240 - d) + 60;   // 推出危险半径再多让 60px
            mix = { x: mix.x + (dx / d) * push, y: mix.y + (dy / d) * push };
          }
        }
      }
    } catch { /* 预告列表异常不影响走位 */ }
    if (this._tgt && Math.hypot(mix.x - this._tgt.x, mix.y - this._tgt.y) < 26) return;
    this._tgt = mix;
    // 直设实体自己的 agentMoveTarget（第一百七十一轮修复，不走全局 doAction）
    p.agentMoveTarget = { x: mix.x, y: mix.y };
  }

  /** 420 内最近拾取物（巡逻时顺路捡） */
  _nearestPickup(g, p) {
    try {
      const items = g.world?.pickups?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = 420;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bestD) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 第一百六十九轮：安全掉落 —— 范围内且自身离最近怪 >220 的掉落 */
  _safePickup(g, p, maxD) {
    try {
      const items = g.world?.pickups?.items;
      const enemies = g.world?.enemies?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = maxD;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d >= bestD) continue;
        let minE = Infinity;
        if (Array.isArray(enemies)) {
          for (const e of enemies) {
            if (!e || e.dead || e.isChest) continue;
            const ed = Math.hypot(it.x - e.x, it.y - e.y);
            if (ed < minE) minE = ed;
          }
        }
        if (minE > 220) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 第一百六十九轮：吸附 —— 逃跑方向锥（夹角 <45°、距离 <180）内的
   *  安全掉落（自身离怪 >200），逃跑路上顺路吃 */
  _pickupOnPath(g, p, dirX, dirY) {
    try {
      const m = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / m, uy = dirY / m;
      const items = g.world?.pickups?.items;
      const enemies = g.world?.enemies?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = 180;
      for (const it of items) {
        if (!it || it.dead) continue;
        const dx = it.x - p.x, dy = it.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 1 || d > 180) continue;
        if ((dx * ux + dy * uy) / d <= 0.7 || d >= bestD) continue;
        let minE = Infinity;
        if (Array.isArray(enemies)) {
          for (const e of enemies) {
            if (!e || e.dead || e.isChest) continue;
            const ed = Math.hypot(it.x - e.x, it.y - e.y);
            if (ed < minE) minE = ed;
          }
        }
        if (minE > 200) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 最近的拾取物对走位的吸引（只追 420 内的，弱权重） */
  _pickupPull(g, p, axis) {
    try {
      const items = g.world?.pickups?.items;
      if (!Array.isArray(items)) return 0;
      let best = null, bestD = 420;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bestD) { bestD = d; best = it; }
      }
      if (!best) return 0;
      return (best[axis] - p[axis]) * 0.25;
    } catch { return 0; }
  }

  // ---------------------------------------------------------
  // 选卡：打分制
  // ---------------------------------------------------------
  _pickUpgrade(g, ent) {
    // entity 模式（P2）不走选卡 UI：升级在 tick 里自动应用
    if (this.entity) return;
    const opts = Array.isArray(g.currentUpgradeOptions) ? g.currentUpgradeOptions : [];
    if (opts.length === 0) return;
    const early = (g.waveIndex ?? 0) < 4;   // 前 4 波：见血必选（噩梦 10 血基底扛不住）
    let bestI = 0, bestS = -Infinity;
    opts.forEach((o, i) => {
      let s = 0;
      for (const [k, v] of Object.entries(o?.mods || {})) {
        s += (STAT_SCORE[k] ?? 2) * Math.abs(Number(v) || 1) * 0.2;
      }
      for (const [k, v] of Object.entries(o?.pct || {})) {
        let w = STAT_SCORE[k] ?? 2;
        if (k === 'maxHp' && early) w *= 1.8;
        s += w * (Number(v) || 0);
      }
      // 血量选项绝对优先：maxHp 是加法（+6），前期一条命的价值远超输出
      if (early && Number(o?.mods?.maxHp) > 0) s += 100;
      // 带 curse / 负面 pct 的选项（>18% 伤害换 -10% 血那种）一票否决
      if (o?.pct && Object.values(o.pct).some((v) => Number(v) < 0)) s -= 1000;
      if (s > bestS) { bestS = s; bestI = i; }
    });
    globalThis.NekoAgent?.doAction?.(`chooseUpgrade(${bestI})`);
  }

  // ---------------------------------------------------------
  // 商店：优先买远程武器（定风筝基调），再补 afford 道具，然后推波
  // ---------------------------------------------------------
  _nextWave(g, ent) {
    try {
      const shop = g.shop;
      const p = ent ?? g.player;
      if (shop && p && Array.isArray(shop.offers)) {
        // ① 先合成：两把同名 → 高一阶武器（T4 传说只能合成得到，伤害跃升）
        // 第一百七十一轮（2P）：entity 模式跳过 —— canCombine 会扫到
        // P1 货架的同名武器（分池泄漏，花 P2 的钱买 P1 的格子）
        try {
          if (!this.entity) {
          const ids = new Set((p.weapons || []).map((w) => w?.def?.id).filter(Boolean));
          for (const wid of ids) {
            const info = shop.canCombine?.(p, wid);
            if (info?.ok) {
              const r = shop.combine(p, wid);
              if (r?.ok) this._log(`合成 ${wid} → ${r.target?.name ?? '?'}${r.upgraded ? `（升到 Lv.${r.level}）` : ''}`);
            }
          }
          }
        } catch { /* 合成失败不影响购买 */ }
        const weaponCount = (p.weapons || []).length;
        // ---- 第一百六十九轮：土豆兄弟铁律 —— 前 5 波武器栏没满 6 把，
        // 钱全砸武器（道具再香不看；武器多 = 输出成倍，发育滚雪球）；
        // 满 6 后转向攻速/伤害/血量。减益道具依旧一票否决。
        const rushWeapons = weaponCount < 6 && (g.waveIndex ?? 0) < 5;
        const buyCap = rushWeapons ? 4 : 3;
        let bought = 0;
        // ---- 第一百七十一轮（2P）：商店分池 —— entity 模式（P2）只买
        // 后半货架（P2 专属格），P1 买前半，互不抢货
        const slotBase = this.entity ? Math.ceil(shop.offers.length / 2) : 0;
        for (let slot = slotBase; slot < shop.offers.length && bought < buyCap; slot++) {
          const o = shop.offers[slot];
          if (!o || o.sold) continue;
          if (!(p.materials >= o.price)) continue;
          const isWeapon = o.kind === 'weapon';
          // 决策：非近战武器见到就买（远程/元素/炮台都定风筝基调）；
          // 同名武器已持有就不重复买（重复买占栏不叠属性）；
          // 诅咒道具绝不买（血之契约 -30% maxHp 曾把猫娘坑到 10 血暴毙）
          const isRangedWeapon = isWeapon && o.data?.kind !== 'melee';
          const hasCurse = o.data?.curse && Object.keys(o.data.curse).length > 0;
          // 贪婪神像类：没有 curse 字段但 pct 带负值（伤害-8% 换收获），
          // 风筝流输出就是命，同样不买
          const hasNegPct = o.data?.pct && Object.values(o.data.pct).some((v) => Number(v) < 0);
          if (hasCurse || hasNegPct) continue;
          // 血量/移速道具见到必买（10 血基底的命根子 + 风筝流的腿）
          const isHpItem = ['warm_milk', 'healing_herb', 'cat_taffy', 'wool_armor', 'steel_plate', 'running_shoes', 'feather'].includes(o.data?.id);
          // 同名武器允许持有 2 把（游戏机制：两把同名可合成升级），
          // 第 3 把起纯占栏，跳过
          if (isWeapon && typeof p.findWeapons === 'function' && p.findWeapons(o.data.id).length >= 2) continue;
          // 决策：冲刺期是武器就买（近战先塞栏，之后靠合成腾位）；
          // 满栏后远程武器见到仍买 / 血量移速必买 / 1~2 件较贵补给
          const want = rushWeapons
            ? isWeapon
            : (isRangedWeapon
              || (isWeapon && weaponCount < 6)
              || isHpItem
              || (!isWeapon && bought < 2 && o.price >= 10));
          if (!want) continue;
          const r = shop.buy(p, slot);
          if (r && r.ok !== false) {
            bought++;
            this._log(`商店购入【${o.data?.name ?? o.data?.id ?? slot}】(-${o.price})${rushWeapons && isWeapon ? '（6 武器冲刺）' : ''}`);
          }
        }
      }
    } catch { /* 商店买不成不影响推波 */ }
    // 第一百七十轮（2P）：entity 模式（pilot2）只买东西**不推波** ——
    // 推波是全局动作，由 P1 的 pilot 统一负责（不然两个大脑各推一次）
    if (this.entity) return;
    if (typeof g._beginWave === 'function' && Number.isInteger(g.waveIndex)) {
      // 防抖：同一波只推一次（shop 态每帧都会 tick 进来，不防抖会一帧
      // 推好几波 —— 实测曾一路推到 53638 波）
      if (this._lastPush === g.waveIndex) return;
      this._lastPush = g.waveIndex;
      this._log(`第 ${g.waveIndex + 1} 波结算完毕 → 开第 ${g.waveIndex + 2} 波`);
      // 先关商店 overlay 再推波 —— 与正常"下一波"按钮回调同序。漏了这步
      // 会导致商店界面挂在屏上，玩家点"下一波"就又跳一波（实测跳波）。
      g.ui?.clearOverlay?.();
      g._beginWave(g.waveIndex + 1);
      // _beginWave 只做波次装配、不切状态（正常由商店按钮回调切）——
      // pilot 绕过 UI 直接推，必须自己把状态切回 playing
      g.state = 'playing';
    }
  }

  // ---------------------------------------------------------
  // 结算：20 波活着 = 通关；团灭 = **重试当前回合**（第一百七十四轮）
  // ---------------------------------------------------------
  // 用户原话："看2个猫娘模式疑似团灭之后变回1个猫娘玩了，回合也变成1，
  // 是用了单人猫娘模式重开吗？让猫娘ai不管一个人玩还是2个人玩团灭了都
  // 继续维持当前模式重试当前回合而不是回到第一回合吧。可以设置重试5次
  // 还过不去判定失败不重试第六次了。"
  //
  // 旧实现：死亡 → startRun(单人) → 模式丢失 + 回到第 1 波（就是用户
  // 看到的"变回1个猫娘 + 回合变成1"）。
  // 新实现：死亡 → g.retryWave()（快照重试：当前回合、装备/等级保留、
  // duo 由 retryWave 里的 _spawnPartner + pilot2 重绑保留）。
  // 同一回合重试 5 次仍过不去 → 判定失败，不再试第 6 次。
  _settle(g) {
    const reached = (g.waveIndex ?? 0) + 1;
    if (!g.player?.dead && reached >= 20) {
      this.win = true;
      this._log(`★ 通关！${this.characterId} 第 ${this.attempt} 次尝试完成 20 波${this.difficulty}（现实用时 ${Math.round((Date.now() - this.startedAt) / 1000)}s）`);
      this.stop(g);
      try { g._endRun(true); } catch { /* */ }
      return;
    }
    // 换了波就清零本回合的重试计数（"重试 5 次"按**同一回合**算）
    if (this._retryWave !== g.waveIndex) {
      this._retryWave = g.waveIndex;
      this._retryN = 0;
    }
    // 第 5 次重试仍倒在同一回合 → 判定失败，不重试第 6 次
    if ((this._retryN ?? 0) >= 5) {
      this.gaveUp = true;
      this._log(`✗ 第 ${reached} 波重试 ${this._retryN} 次仍未通过，判定失败（不重试第 6 次）`);
      this.stop(g);
      return;
    }
    // ---- 自动重试当前回合（快照重试：模式保留、不回第一回合）----
    this._retryN = (this._retryN ?? 0) + 1;
    this._hpSnapshot = null;
    this._tgt = null; this._lastX = null; this._lastY = null; this._stuckN = 0;
    this._log(`第 ${reached} 波团灭 → 重试当前回合（本回合第 ${this._retryN}/5 次）`);
    try {
      g.ui?.clearOverlay?.();
      const retried = g.retryWave?.();
      if (!retried) {
        // 没有快照（比如开局第一秒就没了）：兜底重开 —— duo 维持 duo
        // watch（两个 AI 的模式），单人维持单人。
        this._log('无波次快照，兜底重开（保留模式）');
        if (g.__duo && typeof g.onDuoWatch === 'function') g.onDuoWatch();
        else g.startRun(this.characterId);
      }
      globalThis.NekoAgent?.setPuppetMode?.(true);
    } catch (e) {
      this._log(`重试失败：${e?.message ?? e}`);
      this.stop(g);
    }
  }
}
