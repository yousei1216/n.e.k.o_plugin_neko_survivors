// ============================================================
// 玩家实体
// 负责：移动、受伤/回复、经验、材料、武器槽、属性面板
// ============================================================

import { Entity } from './entity.js';
import { StatSheet, defaultBaseStats, STAT_DEFS } from '../core/stats.js';
import { clamp } from '../core/math.js';
import { resolveTerrain } from '../data/terrain.js';
import { getWeapon } from '../data/weapons.js';
import { getCharacter } from '../data/characters.js';
import { getItem } from '../data/items.js';
import { xpForLevel } from '../data/upgrades.js';
import { WeaponInstance } from './weapon.js';
import { getCharSkill } from '../data/char-skills.js';
import { attachCharRuntime } from '../systems/char-runtime.js';

// 第一百三十四轮：小鱼干「每升一级，所有属性 +1」的属性全集。
// 剔除 turretMax（flat 但有 max=8 的实体数量属性）——多 1 座炮台上限
// 不该是"属性+1"的语义。其余全部 +1（含 maxHp / armor / 伤害系 / 幸运）。
const ALL_STAT_KEYS = Object.keys(STAT_DEFS).filter((k) => k !== 'turretMax');

export const MAX_WEAPONS = 6;

/**
 * 第九十六轮：受击无敌帧分档（用户裁决）。
 * · 接触（撞怪/自爆）：0.8s —— 库洛这类脆皮近战贴脸时的保命帧；
 *   用户原话："如果我们砍太多库洛角色将无法游玩。"
 * · 弹幕：0.6s —— 弹幕是可以"硬吃"的常规伤害，帧短一点让承伤上限
 *   从 6.73/s 提到 8.97/s（噩梦 20 波口径），配合 regen/吸血限频。
 * 芙兰的 flandreHit 保持 0.8s 不动（她的战斗是单独调过的 22% 真伤体系）。
 */
export const CONTACT_INVULN = 0.8;
export const PROJECTILE_INVULN = 0.6;
/** 吸血限频：每秒最多触发次数（每次回 1 点） */
export const LIFESTEAL_PROCS_PER_SEC = 10;
/**
 * 第九十七轮：芙兰战受击无敌帧（用户裁决 0.8 → 1 秒）。
 * 用户原话："把芙兰战的无敌帧改到1秒，被动的小小猫娘消弹也持续1秒吧，
 * 考虑到很多人初见杀，可能还没见到芙兰就被30秒演出弹干碎了。"
 * 只作用于芙兰战的两种受击（flandreHit 真伤 + 莱万汀激光扫中），
 * 普通关卡的 0.8/0.6 分档不动。
 */
export const FLANDRE_HIT_INVULN = 1;

export class Player extends Entity {
  constructor(characterId, rng) {
    super();
    const char = getCharacter(characterId);
    this.characterId = char.id;
    this.char = char;
    this.rng = rng;

    this.radius = 16;
    // 第五十一轮：弹幕判定圈缩到 80%（用户："玩家判定点有点太大了，甚至
    // 我们的贴图里的头发双马尾都有挨打判定，缩小一圈玩家的弹幕hitbox，
    // 到原来的80%左右，全模式通用修改"）。
    // radius 保持 16：身体接触伤害/拾取磁铁/移动边界都还用它，
    // 只有**弹幕命中**（bullet.js）走 hitR。
    this.hitR = this.radius * 0.8;
    // 第十九轮：200 → 215。噩梦怪提速 + 玩家数值削弱后，满速怪能贴着玩家
    // 跑，第一波就能把角色围殴致死。玩家默认提速 7.5%，重新拉开能逃生的
    // 空间。（同轮末：敌人移速绝对上限 ENEMY_SPEED_CAP 已整个移除 ——
    // 后期敌人靠波次成长超过 215 是被接受的设定，升不升移速是玩家自己的
    // 抉择，见 data/difficulty.js 第十九轮末的墓碑说明。）
    this.baseSpeed = 215;

    // ---- 属性面板 ----
    this.stats = new StatSheet(defaultBaseStats());
    // 角色的基础值覆盖
    for (const k in (char.stats || {})) this.stats.base[k] = char.stats[k];
    // 角色的初始修正
    for (const k in (char.mods || {})) this.stats.addFlat(k, char.mods[k]);
    for (const k in (char.pct || {})) this.stats.addPct(k, char.pct[k]);

    // ---- 第十六轮：角色专属能力 ----
    //
    // 分两处落，因为属性分两类（详见 data/char-skills.js 顶部注释）：
    //   statsFinalMul → kind:'flat' 属性，走 StatSheet 的最终乘算
    //   statMul       → kind:'percent' 属性，必须存下来在**消费点**乘
    //
    // statMul 存成一个普通对象挂在 player 上，读取走 mulFor()。
    const cs = getCharSkill(char.id);
    if (cs?.statsFinalMul) {
      for (const k in cs.statsFinalMul) this.stats.addFinalMul(k, cs.statsFinalMul[k]);
    }
    this.charMul = { ...(cs?.statMul || {}) };
    // 幸运总效果的角色倍率（悠怡萌妹 = 1.2 → 0.8×1.2 = 0.96）
    if (cs?.luckEffectMul !== undefined) this.stats.luckEffectMul = cs.luckEffectMul;
    // 属性缓存已经算过一轮了，改完 luckEffectMul 要标脏
    this.stats.dirty = true;

    // ---- 生命 ----
    this.hp = this.stats.get('maxHp');
    this._lastMaxHp = this.hp;

    // ---- 护盾（第十二轮）----
    //
    // 来源是「猫娘的慰藉」升级的高品质档。**不是一个属性** —— 它不进
    // StatSheet、不吃任何百分比修正，就是一块"额外的临时血"。
    //
    // 为什么不做成 STAT_DEFS 里的一个属性：
    //   属性是"买之前就在算、每帧重算"的静态值。护盾是**一次性消耗品**：
    //   挨打会掉、不挨打也不会自己涨。做成属性的话，每次 computeStats()
    //   都会把它重置回满，玩家永远打不死。
    //   所以它是一个独立的运行时字段，只有 addShield() 能加。
    this.shield = 0;
    this.maxShield = 0;
    this.shieldFlash = 0;   // 受击时闪一下，让玩家知道护盾在挡

    // ---- 第十六轮：悠怡洛丽塔的"完全格挡盾"开关 ----
    //
    // 用户原话："护盾存在时不会受到生命伤害（即有1点护盾的时候即便受到
    //   100伤害也只是碎盾而不扣血）。"
    //
    // 这和**已有护盾**的规则是冲突的：
    //   普通护盾（猫娘的慰藉）允许一帧打穿并溢出到血量 —— 那是第十一轮
    //   特意堵上的洞（否则 1 点盾能免疫一切大伤害）。
    //   本技能要的恰恰是"1 点盾挡 100 伤害"。
    //
    // 两者不能同时成立，所以做成一个**开关**：
    //   默认 false → 走老规则，别的角色分毫不变；
    //   只有悠怡洛丽塔拿到"溢出转化"的盾时才置 true。
    // 注意碎盾时必须清掉（见 CharRuntime.onShieldBreak），
    // 否则封锁期结束前又摸到一点普通护盾就又能无敌。
    this.shieldFullBlock = false;

    // ---- 第十六轮：角色技能带来的运行时加成 ----
    // speedBonusMul 是"额外乘在移速上"的临时倍率（悠怡锁血后 +40%）。
    // 单独一个字段而不是改 stats：stats 是"买到的属性"，
    // 而这个只有 3 秒，混进去会让面板显示一个会自己跳的数字。
    this.speedBonusMul = 1;
    this.lethalFlash = 0;    // 锁血触发的视觉反馈
    this.mdStacks = 0;       // 开发猫猫的受伤叠层（给渲染/UI 读）

    // ---- 成长 ----
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = xpForLevel(1);
    this.materials = 0;
    this.pendingLevelUps = 0;
    // 第九十三轮：过期拾取物的"暂存补偿"额度 —— 记**个数**（用户口径）：
    // 90 秒没捡走的每枚经验球/金币记 1 次额度，之后捡到的对应拾取物
    // 双倍收益、每次消耗 1 点额度，耗尽回单倍。等于"自动帮你捡了"，
    // 打得很艰难也不会被过期扣光陷入恶性循环。进 _serializeRun 存档。
    this.xpDebt = 0;
    this.materialDebt = 0;

    // ---- 武器 ----
    this.weapons = [];
    this.addWeapon(char.startWeapon);

    // ---- 道具 ----
    this.items = new Map(); // id -> count

    // ---- 升级记录 ----
    this.upgradesTaken = new Map();

    // ---- 战斗状态 ----
    this.facing = -Math.PI / 2;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.isMoving = false;
    this.walkPhase = 0;
    // 第九十六轮：吸血限频预算 —— 每秒最多回 10 次（每次 1 点 = 最多 10/秒）。
    // 预算按秒回满；命中触发的吸血每次消耗 1 点，预算空了就只有概率没有回复。
    // 用户原话："吸血频率上限改成1秒最多吸10次（每次一点，也就是1秒最多吸10）。
    // 这样2个加起来一秒也就最多回20血。"
    this.lsBudget = LIFESTEAL_PROCS_PER_SEC;
    // ---- 眨眼（第十轮）----
    // blinkTimer 倒数到 0 就眨一次，然后重新随机。
    // 为什么不用 sin(age) 之类的周期函数：固定周期的眨眼看起来像机器，
    // 而且所有猫娘会**同时**眨，很假。随机间隔才有"活物"的感觉。
    this.blinkTimer = 1.5 + Math.random() * 3;
    this.blinkPhase = 0;      // > 0 表示正在眨（0.12 秒）

    // ---- 统计 ----
    this.kills = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.timeAlive = 0;

    // ---- 外观 ----
    this.color = char.color;
    this.accent = char.accent;

    // ---- 第十六轮：技能运行时 ----
    // 放在**最后**：CharRuntime 的构造函数会读 player.stats / characterId，
    // 前面任何一处没初始化完都会读到 undefined。
    // （重试本波会整个重建 Player，所以运行时状态天然被重置 ——
    //  这也是不做成全局单例的原因，见 char-runtime.js 的注释。）
    attachCharRuntime(this);
  }

  /**
   * 读一条"最终乘算"的角色属性倍率（第十六轮）。
   *
   * ⚠️ 这个函数存在的唯一理由是：`statMul` 里的属性全是 `kind:'percent'`，
   *    它们的 base 是 0，`0 × 1.2` 恒等于 0 —— 不能走 StatSheet。
   *    所以必须在**消费点**（伤害公式、冷却公式、移速公式）上乘。
   *
   * @param {string} key  属性 key，如 'meleeDamage' / 'attackSpeed'
   * @returns {number} 倍率，没有就是 1
   */
  mulFor(key) {
    const m = this.charMul?.[key];
    return typeof m === 'number' && m > 0 ? m : 1;
  }

  // ---------------------------------------------------------
  // 武器管理
  // ---------------------------------------------------------
  get weaponCount() { return this.weapons.length; }
  get hasWeaponSlot() { return this.weapons.length < MAX_WEAPONS; }

  addWeapon(weaponId, level = 1) {
    if (this.weapons.length >= MAX_WEAPONS && level === 1) return null;
    const def = getWeapon(weaponId);
    if (!def) return null;
    const inst = new WeaponInstance(def, level);
    this.weapons.push(inst);
    return inst;
  }

  /** 找到某个武器 id 的所有实例 */
  findWeapons(weaponId) {
    return this.weapons.filter((w) => w.def.id === weaponId);
  }

  removeWeapon(inst) {
    const i = this.weapons.indexOf(inst);
    if (i >= 0) this.weapons.splice(i, 1);
  }

  // ---------------------------------------------------------
  // 道具
  // ---------------------------------------------------------
  addItem(itemId) {
    const def = getItem(itemId);
    if (!def) return false;
    const count = this.items.get(itemId) || 0;
    if (count >= (def.maxStacks ?? 99)) return false;
    this.items.set(itemId, count + 1);
    this.applyItemMods(def);
    // 最大生命变化时，按比例保留当前血量
    this._refreshMaxHp();
    return true;
  }

  /** 第一百三十四轮：是否拥有某道具（Boss 专属红品的效果查询用） */
  hasItem(itemId) {
    return (this.items.get(itemId) || 0) > 0;
  }

  applyItemMods(def) {
    for (const k in (def.mods || {})) this.stats.addFlat(k, def.mods[k]);
    for (const k in (def.pct || {})) this.stats.addPct(k, def.pct[k]);
    // 诅咒类（扣最大生命等）走乘算，避免叠加到 1 点血上限
    for (const k in (def.curse || {})) this.stats.addCurse(k, def.curse[k]);
    // 第一百三十四轮：属性上限放宽（黑色披风：闪避上限 80 → 90）
    for (const k in (def.statCapBonus || {})) this.stats.addCapBonus(k, def.statCapBonus[k]);
    // 第四十九轮：最终乘算类道具（莱万汀：伤害 +80% / 承伤 +50%）。
    // 体检修复（第九十二轮）：'damage' 是 kind:'percent' 属性，
    // addFinalMul 的守卫（第十六轮加的，防止 percent 属性被乘成 0）
    // 会直接拒绝 → +80% 伤害此前完全静默失效（只剩承伤惩罚生效）。
    // 改为与承伤侧对称的裸字段 dealtFinalMul，weapon.computeDamage
    // 在所有乘区最后消费；两个字段都进 _serializeRun 存档。
    if (def.finalDamageMul) this.dealtFinalMul = (this.dealtFinalMul ?? 1) * def.finalDamageMul;
    if (def.finalTakenMul) this.takenFinalMul = (this.takenFinalMul ?? 1) * def.finalTakenMul;
    // 第一百一十五轮：穿甲弹 —— 道具给的穿透数（叠买 +1，上限 5）。
    // 存在 player 上而不是 stats 里：它不是面板属性，是子弹生成时的
    // 附加参数（weapon.js / turret.js 生成子弹时读走）。
    if (def.apPierce) this.apPierce = Math.min(5, (this.apPierce ?? 0) + def.apPierce);
  }

  /** 升级带来的修正 */
  applyUpgrade(def) {
    // 第一百三十四轮：小鱼干 —— "每升一级，所有属性 +1"。
    // 放在最前面：本次升级选项本身给的加成之后还要吃满血/护盾结算，
    // 全属性 +1（含 maxHp）必须先落地，后面的 _refreshMaxHp 才算得对。
    if (this.hasItem('dried_fish')) {
      for (const k of ALL_STAT_KEYS) this.stats.addFlat(k, 1);
    }
    for (const k in (def.mods || {})) this.stats.addFlat(k, def.mods[k]);
    for (const k in (def.pct || {})) this.stats.addPct(k, def.pct[k]);
    const prev = this.upgradesTaken.get(def.id) || 0;
    this.upgradesTaken.set(def.id, prev + 1);
    this._refreshMaxHp();
    if (def.heal) this.hp = this.stats.get('maxHp');

    // ---- 护盾（第十二轮）----
    // shieldPct 是"生命上限的倍数"，由 upgrades.js 按稀有度查表填好。
    // 注意顺序：**先回满血再给盾**。反过来的话护盾会按"回血前的生命上限"
    // 计算 —— 而这条升级本身不加生命上限，所以两者其实相等，
    // 但保持"先结算血量、再结算护盾"的顺序，以后如果给它加上限也不会错。
    const pct = def.shieldPct ?? 0;
    if (pct > 0) {
      this.addShield(this.stats.get('maxHp') * pct);
    }
  }

  /**
   * 最大生命变化后调整当前血量。
   *
   * 关键：诅咒扣上限时按**比例**保留当前血量百分比，
   * 而不是简单 `hp = min(hp, max)`。否则 100/100 血买一个 -20% 项圈后
   * 会变成 80/80（看起来没损失），或者 50/100 时被硬压到 50/80。
   * 按比例走：100/100 → 80/80；50/100 → 40/80，直觉一致。
   */
  _refreshMaxHp() {
    const max = this.stats.get('maxHp');
    const prev = this._lastMaxHp;
    if (prev > 0 && Math.abs(max - prev) > 0.001) {
      const ratio = clamp(this.hp / prev, 0, 1);
      this.hp = ratio * max;
    }
    this._lastMaxHp = max;
    this.hp = clamp(this.hp, 1, max);
  }

  get maxHp() { return this.stats.get('maxHp'); }

  // ---------------------------------------------------------
  // 经验
  // ---------------------------------------------------------
  gainXp(amount) {
    // 第十六轮：悠怡「获得的经验 +20%」。
    // 放在 gainXp 入口而不是每个拾取点：经验有三个来源
    // （拾取物 / 宠物代拾 / 波次结算），改入口一处就全覆盖，
    // 改调用点必然漏（这正是幸运那 6 个消费点踩过的坑）。
    const mul = this.charRt?.xpMul?.() ?? 1;
    const gain = mul === 1 ? amount : amount * mul;
    this.xp += gain;
    let leveled = 0;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.xpNeeded = xpForLevel(this.level);
      this.pendingLevelUps++;
      leveled++;
      if (leveled > 50) break; // 保险
    }
    return leveled;
  }

  gainMaterials(amount) {
    this.materials += amount;
  }

  // ---------------------------------------------------------
  // 伤害与治疗
  // ---------------------------------------------------------
  /**
   * 受伤。第九十六轮起无敌帧分档：
   *   opts.projectile = true（敌人弹幕）→ 0.6s
   *   其余（接触/自爆/其他）→ 0.8s
   * 理由见文件头 CONTACT_INVULN / PROJECTILE_INVULN 的注释
   * （库洛等脆皮近战的贴脸保命帧不动，只收紧可以硬吃的弹幕）。
   */
  takeDamage(amount, sourceX, sourceY, opts = {}) {
    // ---- 第一百四十轮：维吉尔系刀波（表演 Boss）----
    // opts.ignoreIFrames = true：**无视无敌帧** —— 入口不做 invuln 拦截，
    // 结算后也不给常规无敌帧（限频由攻击方自己的受击内置 CD 负责，
    // 维吉尔系是 0.2s）。死亡拦截保留。
    // opts.fixedDamage = 绝对值真伤：调用方算好（如 maxHp * 0.05），
    //   跳过 miss / 闪避 / 护甲 / 承伤乘区 / 真伤附加 —— 护盾照常吸收，
    //   猫的步伐锁血照常触发（防暴毙精神保留），回血 / 吸血不受限制。
    const ignoreI = opts.ignoreIFrames === true;
    if (this.dead) return 0;
    if (!ignoreI && this.invuln > 0) return 0;

    // ---- 第一百零八轮：浓雾 miss ----
    // 用户："玩家的攻击有20%概率miss，敌人也是（概率计算为额外增加
    // 闪避率，无视80%上限，如果玩家这时候能叠到80%闪避上限，那这个
    // 天气玩家则会100%闪避）。" 判定走天气独立随机流 —— 主流一个
    // 字不动（否则天气一激活，几百个确定性测试全移位）。
    // noMiss：流星/烧灼这类天气自身的伤害不吃 miss。
    const wxW = this.world?.weather;
    if (!ignoreI && wxW && wxW.miss > 0 && !opts.noMiss && wxW.rng.next() * 100 < wxW.miss) {
      this.onDodge?.();
      return 0;
    }

    // 闪避判定
    const dodge = this.stats.get('dodge');
    if (!ignoreI && dodge > 0 && this.rng.next() * 100 < dodge) {
      this.onDodge?.();
      return 0;
    }

    // ---- 第一百三十四轮：幸运猫脚 —— 受伤 15% 概率变成 miss ----
    // **独立的第二次判定**（用户明确）：普通闪避没过再来这里掷一次 15%，
    // 中了照样完全免伤。与天气 miss 同级：免伤 + 不给无敌帧，走玩家
    // 主流 rng —— 它是道具效果，不是天气，不该吃天气独立流。
    if (!ignoreI && !opts.noMiss && this.hasItem('lucky_cat_paw')
        && this.rng.next() * 100 < 15) {
      this.onDodge?.();
      return 0;
    }

    // ---- 第一百四十轮：固定真伤直取（在一切乘区之前）----
    if (opts.fixedDamage != null) {
      const fixed = Math.max(1, opts.fixedDamage);
      let toHpF = fixed;
      if (this.shield > 0) {
        const absorbedF = Math.min(this.shield, toHpF);
        this.shield -= absorbedF;
        toHpF -= absorbedF;
        if (this.shield <= 0) { this.shield = 0; this._breakShield(); }
      }
      if (this.charRt && toHpF > 0 && toHpF >= this.hp && this.hp > 0) {
        if (this.charRt.tryLethalSave()) {
          this.damageTaken += Math.max(0, this.hp - 1);
          this.hp = 1;
          this.onHurt?.(toHpF, sourceX, sourceY);
          return toHpF;
        }
      }
      this.hp -= toHpF;
      this.damageTaken += fixed;
      this.hurtFlash = 0.25;
      if (toHpF > 0) this.charRt?.onHurt?.();
      this.onHurt?.(fixed, sourceX, sourceY);
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.onDeath?.();
      }
      return fixed;
    }

    // 护甲减伤（第一百零八轮：流星的真实伤害 pierceArmor 无视护甲）
    const mul = opts.pierceArmor ? 1 : this.stats.armorMul;
    let final = Math.max(1, amount * mul);

    // ---- 第十六轮：库洛「受到的伤害 +20%」----
    // 放在护甲**之后**、护盾**之前**：
    //   放在护甲之前的话，这条惩罚会被护甲稀释
    //   （100 伤害 ×1.2 再减伤 50% = 60，实际只多挨 10），
    //   而用户说的是"受到的伤害+20%"，是**最终**多挨 20%。
    // 第一百一十三轮：opts.noTaken 豁免 —— 芙兰战激光扫中（固定 10 点）
    // 不吃承伤加成。用户："真伤也是只打22%，不要因为库洛有20%受到伤
    // 害增加就让库洛多受伤。" 芙兰的百分比真伤走 flandreHit（直接扣
    // hp，本就绕开这里）；激光这 10 点走 takeDamage，加 noTaken 对齐
    // 同一口径：芙兰战的伤害体系不被承伤类乘区放大。
    const dtMul = opts.noTaken ? 1 : this.mulFor('damageTaken');
    if (dtMul !== 1) final *= dtMul;

    // 第四十九轮：莱万汀「受到的伤害 +50% 最终加成」（道具侧的最终乘算，
    // 与角色技能同一位置 —— 护甲之后、护盾之前）。
    if ((this.takenFinalMul ?? 1) !== 1) final *= this.takenFinalMul;

    // ---- 第十六轮：悠怡萌妹「本喵最欧」防御侧 ----
    // 也放在护甲之后：用户说"减少50%**最终**伤害"。
    const guard = this.charRt?.rollLuckyGuard?.() ?? 1;
    if (guard !== 1) final *= guard;

    // ---- 第一百三十二轮：波次真实伤害附加 ----
    // （第一百三十三轮按用户要求修订：**不穿护盾**）
    //
    // 用户原话："额外真伤不要穿透护盾。护盾目前只有升级获得的那一点和
    // 悠怡洛丽塔可以获得，如果穿透了升级选护盾就没意义了。"
    //
    // 所以真伤在乘区链（护甲/承伤/最终加成/欧皇守护）**之后**原样并入
    // final —— 不吃护甲、不吃承伤类加成的定性保留，但作为普通伤害的
    // 一部分交给护盾正常吸收：盾够厚，真伤也先扣盾。
    //
    // 无敌帧语义天然满足："每次有效受击只结算 1 次" —— invuln > 0 时
    // 本函数第一行就 return 0，闪避/天气 miss 也走不到这里。
    // trueBonus 由调用方（接触/自爆/敌弹）按当前波次与攻击者档位算好；
    // 不传 = 无附加（天气伤害、芙兰战激光、芙兰 flandreHit 都不传）。
    //
    // 猫的步伐（悠怡锁血）不受影响：下面的致死判定用的是 toHp
    // （= 护盾吸收后真正会扣到血上的部分，含真伤溢出），
    // tryLethalSave 照常触发、照常锁 1 血。
    if (opts.trueBonus > 0) final += opts.trueBonus;

    // ---- 护盾先吃伤害（第十二轮）----
    //
    // 用户要求把「猫娘的慰藉」升级的高品质档从"只是回满血"改成给护盾：
    //   稀有 50% / 史诗 100% / 传说 150% 生命上限的护盾。
    //
    // 为什么把护盾结算放在**护甲之后**而不是"先扣护盾、护盾不减免"：
    //   护盾在这个游戏里是"额外血量"，玩家心里它就是血条的一部分。
    //   如果护盾不享受护甲，那么"堆护甲"和"拿护盾"两个防御向选择就会
    //   互相打架（护甲越高，护盾相对越亏），玩家会觉得被骗。
    //   走同一套减伤 = 护盾就是"按护甲减伤后的额外血量"，直觉一致。
    //
    // 为什么"一帧内打穿护盾"也要允许溢出到血量（而不是整段被护盾吃掉）：
    //   否则只要有 1 点护盾，一次 5000 的伤害也只扣 1 点护盾，
    //   玩家可以用小护盾免疫任何大伤害 —— 那是个能直接躺赢的洞。
    //
    // 第十六轮补充：上面那条规则**只有悠怡洛丽塔会例外**。
    //   她的"伤不到我喵"要的正是"1 点盾挡 100 伤害"，由
    //   shieldFullBlock 开关控制（见构造函数里的注释）。
    //   开关默认 false，所以其余 7 个角色和所有老测试行为完全不变。
    let toHp = final;
    if (this.shield > 0) {
      if (this.shieldFullBlock) {
        // 完全格挡：整段伤害都由护盾吃，一点不溢出到血量。
        // 护盾不够也照样全吃（用户的例子就是"1 点盾挨 100 伤害"）。
        this.shield = 0;
        toHp = 0;
        this._breakShield();
      } else {
        const absorbed = Math.min(this.shield, toHp);
        this.shield -= absorbed;
        toHp -= absorbed;
        if (this.shield <= 0) {
          this.shield = 0;
          this._breakShield();
        }
      }
    }

    // ---- 第十六轮：悠怡「猫的步伐」锁血 ----
    //
    // ⚠️ 位置很讲究：必须在**护盾结算之后**、`hp -=` 之前。
    //
    // 一开始我把它放在护盾之前（"final 算完了就判"），结果
    // test/shield-check.mjs 立刻红了：有 1000 点护盾的角色挨 100 伤害，
    // 本该只掉 100 盾，却因为 `final(100) >= hp` 触发了锁血 ——
    // 明明有盾挡着，根本不该算"致死"。
    //
    // 所以判定条件用的是 **toHp**（真正会扣到血上的那部分），
    // 而不是 final。护盾吃掉的伤害不算数。
    if (this.charRt && toHp > 0 && toHp >= this.hp && this.hp > 0) {
      if (this.charRt.tryLethalSave()) {
        // 统计口径：这一下**本该**扣掉 hp-1（锁血后剩 1 点），
        // 所以按差额记入承受伤害，而不是记满 toHp ——
        // 否则"承受伤害"的统计会比玩家实际掉的血虚高一大截。
        this.damageTaken += Math.max(0, this.hp - 1);
        this.hp = 1;
        this.onHurt?.(toHp, sourceX, sourceY);
        return toHp;
      }
    }

    this.hp -= toHp;
    // 承伤统计：final 已含真伤附加（如实体计入）
    this.damageTaken += final;
    // 无敌帧：太短会被多个敌人叠加瞬间秒杀，太长则失去受击反馈。
    // 第四十四轮：0.5 → 0.8（用户原话："那从0.5秒改到0.8秒吧。"）
    // 第九十六轮：分档 —— 弹幕 0.6s，其余 0.8s（见文件头常量注释）。
    // opts.invuln：显式覆盖（第九十七轮，芙兰战激光扫中传 1s）。
    // 第一百零八轮：台风把无敌帧下限抬到 1.5s（弹幕/接触都适用）。
    // 第一百四十轮：ignoreIFrames 时不给常规无敌帧（维吉尔系自己的
    // 0.2s 受击内置 CD 负责防秒杀）。
    if (!ignoreI) {
      this.invuln = Math.max(
        opts.invuln ?? (opts.projectile ? PROJECTILE_INVULN : CONTACT_INVULN),
        this.world?.weather?.invulnMin ?? 0,
      );
    }
    this.hurtFlash = 0.25;

    // ---- 第十六轮：开发猫猫「M博士来了」叠层 ----
    // 放在这里而不是更早：只有**真的挨到伤害**（没被闪避/锁血/护盾全挡）
    // 才算"受到伤害"。用盾全挡掉的那次不该给叠层，否则悠怡洛丽塔
    // 那种"一直有盾"的角色会白嫖（虽然她不是开发猫猫，但规则要一致）。
    if (toHp > 0) this.charRt?.onHurt?.();

    this.onHurt?.(final, sourceX, sourceY);

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.onDeath?.();
    }
    return final;
  }

  /**
   * 回复生命。
   *
   * 第十六轮：悠怡洛丽塔的"伤不到我喵"要在这里截走**溢出**的部分转成护盾。
   * 所以返回值仍然是"实际回的血"，但多了一个 onOverheal 回调 ——
   * 溢出的量由调用方决定怎么用，Player 本身不认识技能。
   */
  /**
   * 护盾碎掉的统一入口（第十六轮）。
   *
   * ⚠️ 这里**必须**先通知 charRt，再调 onShieldBreak 回调。
   *
   * 之前的写法是只调 `this.onShieldBreak?.()`，而那个回调**只有 main.js
   * 会挂**。于是纯逻辑测试（不建 UI、不跑 main.js）里碎盾之后
   * CharRuntime 完全不知情：悠怡洛丽塔不会进入 5 秒封锁、
   * shieldFullBlock 也不会关掉 —— 表现为"碎盾了还能无限续盾"。
   *
   * 技能状态属于**玩法层**，不该依赖表现层的回调是否被挂上。
   * 所以拆成两半：技能通知走这里（永远执行），
   * UI/音效走 onShieldBreak（可选的、由 main.js 挂）。
   */
  _breakShield() {
    this.charRt?.onShieldBreak?.();
    this.onShieldBreak?.();
  }

  /**
   * 回血。体检修复（第九十二轮）：芙兰战的 noHeal 此前只挡了
   * regen/吸血两条路，heal() 直呼路径（999 血包、龙虾突击、医疗包）
   * 全被连带豁免——玩家掉血后踩到 Boss 掉的回满血包凭空满血。
   * 现在 heal() 统一拦；唯一合法豁免走 opts.force（小小猫娘半血
   * 治疗，第四十九轮明确保留）。
   */
  heal(amount, opts = {}) {
    if (this.noHeal && !opts.force) return 0;
    // ---- 第一百三十四轮：猫娘奶糖 —— 生命低于 50% 时治疗翻倍 ----
    // "受到的所有治疗效果"：入口处翻倍，regen/吸血/血包全走 heal()，
    // 一处改动全覆盖（与 gainXp 的入口策略同一思路）。
    if (this.hasItem('cat_taffy') && this.hp < this.stats.get('maxHp') / 2) {
      amount *= 2;
    }
    const max = this.stats.get('maxHp');
    const before = this.hp;
    this.hp = Math.min(max, this.hp + amount);
    const healed = this.hp - before;
    const overflow = amount - healed;
    if (overflow > 0) {
      // 满了还继续回 → 溢出的部分交给技能处理（没有技能就是纯浪费）
      this.charRt?.healToShield?.(overflow);
    }
    return healed;
  }

  /**
   * 加护盾（第十二轮）。
   *
   * @param {number} amount     护盾点数
   * @param {boolean} [replace] true = 覆盖（取较大值），false = 叠加
   * @returns {number} 实际增加了多少
   *
   * 默认是**取较大值**而不是叠加：同一级升级重复拿（比如传说档连拿两次）
   * 如果叠加会变成 300% 生命上限的盾，玩家可以直接站撸整局。
   * 取较大值则"再拿一次只是刷新满"，强度可控，也符合"护盾"的直觉
   * （换一面更厚的盾，而不是叠两面盾）。
   *
   * 升级给的护盾走 replace；以后如果有"回复护盾"类的东西再传 false。
   */
  addShield(amount, replace = true) {
    if (!(amount > 0)) return 0;
    const before = this.shield;
    this.shield = replace ? Math.max(this.shield, amount) : this.shield + amount;
    // maxShield 记录"这辈子拿到过的最高护盾"，只给 UI 画比例用
    this.maxShield = Math.max(this.maxShield, this.shield);
    this.shieldFlash = 0.5;
    return this.shield - before;
  }

  // ---------------------------------------------------------
  // 每帧更新
  // ---------------------------------------------------------
  update(dt, input, camera, world) {
    this.age += dt;
    this.timeAlive += dt;

    // ---- 移动 ----
    const axis = input.moveAxis();
    const speedMul = this.stats.moveSpeedMultiplier;
    // 第十六轮：两处角色技能加成
    //   mulFor('moveSpeed')  → 库洛 / 开发猫猫 的最终乘算（statMul）
    //   speedBonusMul        → 悠怡锁血后的临时 +40%
    //   mdMoveBonus          → 开发猫猫"每层 +5% 移速"（第二十轮起，原 3%）
    // 用**加法**把 mdMoveBonus 并进 stats 那一层，而不是再乘一次：
    // 用户说的是"移速+3%"（第二十轮起 +5%），是百分点，和属性面板上"移速 +30%"同一个量纲。
    const mdMove = this.charRt?.mdMoveBonus ?? 0;
    // 第一百零八轮：晴岚 —— 所有人移速 +25%（乘区，天气结束自动归一）
    let speed = this.baseSpeed * speedMul * this.mulFor('moveSpeed')
      * (this.speedBonusMul ?? 1) * (1 + mdMove / 100)
      * (world?.weather?.moveMul ?? 1);
    // 第六十五轮：芙兰 boss 战专属移速设定 ——
    // 用户："玩家移动速度在boss战期间强制110%移速，然后加个设计，玩家
    // 按住shift的时候移动速度减半"（用户原文写成 shirt，指 Shift 键）。
    // 第一百一十三轮：改成**绝对锁 120% 基础移速** ——
    // 用户："看一下现在20回合的芙兰战是否正确将玩家速度限制在120%？
    // 无视库洛自己的20%移速。我记得之前设置速度是锁110%。现在改到
    // 120%（shirt依旧减半）。" 旧实现是 ×1.1 乘算，库洛（×1.2 statMul）
    // 一叠就破 130% —— 现在直接锁 baseSpeed × 1.2，角色被动/道具/天气
    // 移速一概不参与（Shift 减半保留）。
    if (this.flandreSpeed && this.flandreSpeed !== 1) {
      speed = this.baseSpeed * this.flandreSpeed;
      if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) speed *= 0.5;
    }
    this.vx = axis.x * speed;
    this.vy = axis.y * speed;
    this.isMoving = axis.x !== 0 || axis.y !== 0;

    if (this.isMoving) {
      this.walkPhase += dt * 11;
    } else {
      this.walkPhase = 0;
    }

    this._terrainPrevX = this.x;
    this._terrainPrevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // 世界边界
    const half = world.halfSize - this.radius;
    this.x = clamp(this.x, -half, half);
    this.y = clamp(this.y, -half, half);

    // ---- 不可通行地形（第十二轮）----
    // 和世界边界一样，放在位移之后立刻结算，保证玩家**永远**不会
    // 停在墙里。放在下一帧的话，玩家会有一帧的时间能穿过去，
    // 高速移动（冲刺/加速流派）时表现为"偶尔能穿墙"，很难复现。
    if (world.terrain) {
      const px = this._terrainPrevX ?? this.x;
      const py = this._terrainPrevY ?? this.y;
      if (resolveTerrain(world.terrain, this, px, py)) {
        // 撞墙清速度分量：不清的话玩家会贴着墙持续"顶"，
        // 手感上是黏住不动，而不是顺着墙滑走。
        this.vx *= 0.2;
        this.vy *= 0.2;
      }
    }

    // ---- 朝向：跟随移动方向（停下时保持） ----
    if (this.isMoving) {
      this.facing = Math.atan2(axis.y, axis.x);
    }

    // ---- 计时器 ----
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
    if (this.lethalFlash > 0) this.lethalFlash -= dt;

    // ---- 第十六轮：角色技能运行时 ----
    // 放在武器更新**之前**：毒舌 debuff 这一帧就该生效，
    // 晚一帧的话，第一次判定会打到"还没被 debuff 的敌人"身上，
    // 表现为技能偶尔没效果。
    this.charRt?.update?.(dt, world);

    // ---- 眨眼 ----
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkPhase = 0.12;                    // 眨一次约 0.12 秒
        // 隔 1.5~4.5 秒眨下一次。区间偏长是故意的：
        // 眨太勤会显得焦躁，偶尔眨一下才自然。
        this.blinkTimer = 1.5 + Math.random() * 3;
      }
    }

    // ---- 生命回复 ----
    // 第四十九轮：芙兰朵露战期间回复全部失效（用户要求），
    // 但小小猫娘的半血治疗走 heal() 不走 regen，不受影响。
    // regen 的值本身已被 stats.js 的 max:10 钳住（第九十六轮）。
    const regen = this.noHeal ? 0 : this.stats.get('hpRegen');
    if (regen > 0 && this.hp < this.stats.get('maxHp')) {
      this.heal(regen * dt);
    }
    // 吸血限频预算回填（第九十六轮，见 refillLifestealBudget）
    this.refillLifestealBudget(dt);

    // ---- 武器更新 ----
    // 第五十轮：芙兰战演出+秘弹期间 noAttack=true（那时她本人不在场，
    // 打不着）；芙兰登场瞬间恢复（用户："芙兰出现就恢复攻击"）。
    if (!this.noAttack) {
      for (const w of this.weapons) {
        w.update(dt, this, world);
      }
    }

    // ---- 武器冷却缩减来自攻速属性，统一在 weapon.update 里读取 ----
  }

  /** 应用吸血：返回实际回复量（第九十六轮起受限频预算约束） */
  applyLifesteal(percentChance) {
    if (percentChance <= 0) return 0;
    // 第四十九轮：芙兰朵露战期间吸血失效（world.flandreFight 由 main 挂上）
    if (this.noHeal) return 0;
    if (this.rng.next() * 100 >= percentChance) return 0;
    // 第九十六轮：限频 —— 预算按"次"计，每秒最多 10 次（每秒回满 10 次）。
    // 没预算时这次命中只吃概率不回血；失败的掷骰不消耗预算。
    if ((this.lsBudget ?? LIFESTEAL_PROCS_PER_SEC) < 1) return 0;
    this.lsBudget -= 1;
    // 第一百三十四轮：龙虾抱枕 —— 吸血回复翻倍（1 滴 → 2 滴）
    return this.heal(this.hasItem('lobster_pillow') ? 2 : 1);
  }

  /**
   * 第九十六轮：吸血预算回填（player.update 每帧调用）。
   * 按 dt 比例回满到每秒 10 次；拆成独立方法是为了能在 Node 测试里
   * 不跑整个 update 就能推进预算。
   */
  refillLifestealBudget(dt) {
    this.lsBudget = Math.min(
      LIFESTEAL_PROCS_PER_SEC,
      (this.lsBudget ?? LIFESTEAL_PROCS_PER_SEC) + LIFESTEAL_PROCS_PER_SEC * dt,
    );
    return this.lsBudget;
  }

  /**
   * 第四十九轮：芙兰朵露的弹命中 —— 每发固定扣一定比例最大生命的真实伤害：
   * 无视护甲、无视闪避，只保留无敌帧。
   * 第五十六轮：30% → 24%（用户："把芙兰的弹幕伤害从30%真伤改到24%真伤，
   * 可以让玩家多吃一发"）；第七十四轮：24% → 22%（用户："考虑到猫娘
   * 本身是个桌宠，用户群体大概都不是弹幕游戏受众，我们再削弱一下芙兰
   * 的伤害。从24%真伤改到22%。这样差不多又可以多抗一发"）。
   * 第九十七轮：受击无敌帧 0.8 → 1 秒（用户："把芙兰战的无敌帧改到1秒……
   * 很多人初见杀，可能还没见到芙兰就被30秒演出弹干碎了"）。
   * 与 flandre.js 的 HIT_FRAC 保持一致。
   * 每次命中回调 onFlandrePlayerHit（main.js 用来触发小小猫娘自动消弹）。
   */
  flandreHit(sourceX, sourceY) {
    if (this.invuln > 0 || this.dead) return 0;
    const dmg = Math.max(1, Math.round(this.stats.get('maxHp') * 0.22));
    this.hp -= dmg;
    this.damageTaken += dmg;
    // 第九十七轮：1 秒受击免疫（FLANDRE_HIT_INVULN），否则一发连发直接蒸发
    this.invuln = FLANDRE_HIT_INVULN;
    this.hurtFlash = 0.25;
    this.onFlandrePlayerHit?.(sourceX, sourceY);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return dmg;
  }
}