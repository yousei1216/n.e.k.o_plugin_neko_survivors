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
    // 难度默认跟当前选角界面选的难度走（用户从选角界面点"猫娘帮你玩"
    // 时期望打的就是选中的难度，不是写死的噩梦）
    this.difficulty = opts.difficulty ?? g?.difficultyId ?? 'nightmare';
    this.characterId = opts.characterId ?? 'luna';
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.on = true;
    this.win = false;
    this.gaveUp = false;
    this.attempt = 1;
    this._lastPush = -999;
    this._events = [];
    this.startedAt = Date.now();
    try {
      if (this.difficulty && typeof g.setDifficulty === 'function' && g.difficultyId !== this.difficulty) {
        g.setDifficulty(this.difficulty);
      }
      g.ui?.clearOverlay?.();
      g.startRun(this.characterId);
      window.NekoAgent?.setPuppetMode?.(true);
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
    try {
      window.NekoAgent?.setPuppetMode?.(true);
      this._log(`代打中途接管（第 ${(g?.waveIndex ?? 0) + 1} 波）`);
      g?._nekoSay?.(pick(TAKEOVER_LINES));
    } catch { /* */ }
    return true;
  }

  /** 停止代打，控制权立刻还给玩家 */
  stop(g) {
    this.on = false;
    try { window.NekoAgent?.setPuppetMode?.(false); } catch { /* */ }
    try { if (g?.player) g.player.pilotBuff = false; } catch { /* */ }
    try { g?._nekoSay?.(pick(HANDOVER_LINES)); } catch { /* */ }
    this._log('代打结束，控制权交还玩家');
  }

  /** 每帧决策入口（NekoAgent._tick 里调用，永远不抛） */
  tick(g) {
    if (!this.on || !g) return;
    try {
      // 辅助光环每帧保证（startRun 会新建 player，重开后 buff 会丢）。
      // 明牌设计：代打 AI 的走位没有真人细（无弹道预测），「猫娘的敏捷」
      // 三件套补容错 —— 单次受伤至多 1（takeDamage）+ 持续回复 + 芙兰
      // 真伤削减；关掉代打立刻全部消失。
      if (g.player && !g.player.dead) {
        g.player.pilotBuff = true;
        if (g.player.hp > 0) {
          // ≈12/s —— 刻意压到"围殴+维吉尔真伤连击"能击穿的水位：
          // 用户要"输了也挺有趣，但不能真的一局都赢不了"，留死亡窗口
          g.player.hp = Math.min(g.player.maxHp, g.player.hp + 0.4);
        }
      }
      switch (g.state) {
        case 'playing': this._combat(g, false); break;
        case 'vergil': this._combat(g, true); break;
        case 'flandre': this._combat(g, true); break;   // 芙兰战同款环绕（20 波后挑战）
        case 'level_up': this._pickUpgrade(g); break;
        case 'shop': this._nextWave(g); break;
        case 'result': this._settle(g); break;
        default: break; // title/char_select/paused 等不动作
      }
    } catch { /* 决策异常不许影响游戏 */ }
  }

  // ---------------------------------------------------------
  // 战斗走位
  // ---------------------------------------------------------
  _combat(g, vergilMode) {
    const p = g.player;
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
        const rot = 0.6 * (this._orbitDir ??= (Math.random() < 0.5 ? 1 : -1));
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const rfX = fleeX * cosR - fleeY * sinR;
        const rfY = fleeX * sinR + fleeY * cosR;
        const distC = Math.hypot(p.x, p.y);
        const pullC = Math.max(0, distC - half * 0.78) / 160;
        tx = p.x + rfX * fleeMag - p.x * 0.1 * pullC + this._pickupPull(g, p, 'x') * 0.5;
        ty = p.y + rfY * fleeMag - p.y * 0.1 * pullC + this._pickupPull(g, p, 'y') * 0.5;
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
    window.NekoAgent?.doAction?.(`move(${Math.round(tx)}, ${Math.round(ty)})`);
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
  _pickUpgrade(g) {
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
    window.NekoAgent?.doAction?.(`chooseUpgrade(${bestI})`);
  }

  // ---------------------------------------------------------
  // 商店：优先买远程武器（定风筝基调），再补 afford 道具，然后推波
  // ---------------------------------------------------------
  _nextWave(g) {
    try {
      const shop = g.shop;
      const p = g.player;
      if (shop && p && Array.isArray(shop.offers)) {
        // ① 先合成：两把同名 → 高一阶武器（T4 传说只能合成得到，伤害跃升）
        try {
          const ids = new Set((p.weapons || []).map((w) => w?.def?.id).filter(Boolean));
          for (const wid of ids) {
            const info = shop.canCombine?.(p, wid);
            if (info?.ok) {
              const r = shop.combine(p, wid);
              if (r?.ok) this._log(`合成 ${wid} → ${r.target?.name ?? '?'}${r.upgraded ? `（升到 Lv.${r.level}）` : ''}`);
            }
          }
        } catch { /* 合成失败不影响购买 */ }
        const weaponCount = (p.weapons || []).length;
        let bought = 0;
        for (let slot = 0; slot < shop.offers.length && bought < 3; slot++) {
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
          // 决策：远程武器见到就买（最多 4 把）；其余买 1~2 件最贵的补给
          const want = isRangedWeapon
            || (isWeapon && weaponCount + bought < 2)
            || isHpItem
            || (!isWeapon && bought < 2 && o.price >= 10);
          if (!want) continue;
          const r = shop.buy(p, slot);
          if (r && r.ok !== false) {
            bought++;
            this._log(`商店购入【${o.data?.name ?? o.data?.id ?? slot}】(-${o.price})`);
          }
        }
      }
    } catch { /* 商店买不成不影响推波 */ }
    if (typeof g._beginWave === 'function' && Number.isInteger(g.waveIndex)) {
      // 防抖：同一波只推一次（shop 态每帧都会 tick 进来，不防抖会一帧
      // 推好几波 —— 实测曾一路推到 53638 波）
      if (this._lastPush === g.waveIndex) return;
      this._lastPush = g.waveIndex;
      this._log(`第 ${g.waveIndex + 1} 波结算完毕 → 开第 ${g.waveIndex + 2} 波`);
      g._beginWave(g.waveIndex + 1);
      // _beginWave 只做波次装配、不切状态（正常由商店按钮回调切）——
      // pilot 绕过 UI 直接推，必须自己把状态切回 playing
      g.state = 'playing';
    }
  }

  // ---------------------------------------------------------
  // 结算：20 波活着 = 通关；否则换一条命重开
  // ---------------------------------------------------------
  _settle(g) {
    const reached = (g.waveIndex ?? 0) + 1;
    if (!g.player?.dead && reached >= 20) {
      this.win = true;
      this._log(`★ 通关！${this.characterId} 第 ${this.attempt} 次尝试完成 20 波${this.difficulty}（现实用时 ${Math.round((Date.now() - this.startedAt) / 1000)}s）`);
      this.stop(g);
      try { g._endRun(true); } catch { /* */ }
      return;
    }
    // 死亡 / 意外结算：重开
    if (this.attempt >= this.maxAttempts) {
      this.gaveUp = true;
      this._log(`✗ ${this.maxAttempts} 次尝试均未通关（最远第 ${reached} 波），代打放弃`);
      this.stop(g);
      return;
    }
    this.attempt++;
    this._lastPush = -999;   // 防抖标志跨局重置（每局都从 waveIndex=0 开始，
    //                            不重置会把新一局第 1 波的推波误拦成"已推过"）
    this._log(`第 ${this.attempt - 1} 次尝试倒在第 ${reached} 波 → 重开（${this.attempt}/${this.maxAttempts}）`);
    try {
      g.ui?.clearOverlay?.();
      g.startRun(this.characterId);
      window.NekoAgent?.setPuppetMode?.(true);
    } catch (e) {
      this._log(`重开失败：${e?.message ?? e}`);
      this.stop(g);
    }
  }
}
