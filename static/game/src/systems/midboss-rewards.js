// ============================================================
// 第二百一十六轮：中 Boss 奖励 —— 白 / 蓝 / 紫 / 金 技能能力
//
// 用户规格（原文摘要）：
//   "增加中boss奖励，改成随机掉落白蓝紫金品质的技能能力，概率享受运气加成。
//    随机掉3个选一个提升。"
//
// 流程：
//   中 Boss 死亡 → world.onMidBossKilled → main 里 pendingMidBossRewards++
//   → 下一帧（升级优先）弹出三张卡 → 玩家选 1 张 → 立刻生效。
//
// 品质权重（0 幸运 → 220 幸运）：
//   白 60% → 15% / 蓝 25% → 40% / 紫 12% → 30% / 金 3% → 15%
//   （和商店/升级一样读 stats.luckEff，幸运总效果 80% + 角色倍率已在
//    StatSheet 里换算好，这里不再重复打折。）
//
// 奖励都是**跨波永久**的。能进 StatSheet 的走 stats.addFlat/addPct
// （随存档天然保存）；不能进的运行时字段统一收进 player.boons，
// 见 player.js 构造函数与 main._serializeRun 的 boons 字段。
// ============================================================

import { ITEMS } from '../data/items.js';
import { WEAPONS } from '../data/weapons.js';
import { rollUpgrades } from '../data/upgrades.js';

export const BOON_TIERS = {
  white: { id: 'white', name: '白色', color: '#e6e6ee' },
  blue: { id: 'blue', name: '蓝色', color: '#5fa8ff' },
  purple: { id: 'purple', name: '紫色', color: '#b06bff' },
  gold: { id: 'gold', name: '金色', color: '#ffb020' },
};

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** 按幸运抽一个品质（与商店同口径：生效幸运 / 220 封顶） */
export function rollBoonTier(rng, luckEff = 0) {
  const b = clamp01(luckEff / 220);
  const weights = [
    ['white', 60 - 45 * b],
    ['blue', 25 + 15 * b],
    ['purple', 12 + 18 * b],
    ['gold', 3 + 12 * b],
  ];
  let total = 0;
  for (const [, w] of weights) total += Math.max(0, w);
  let r = rng.next() * total;
  for (const [id, w] of weights) {
    r -= Math.max(0, w);
    if (r <= 0) return id;
  }
  return 'white';
}

// ---------------------------------------------------------
// 小工具
// ---------------------------------------------------------
function toast(game, text, kind = 'good', ms = 4200) {
  try { game?.ui?.toast?.(text, kind, ms); } catch { /* UI 不在也不影响效果 */ }
}

/** 随机一件非武器道具（复用世界奖励池：价格分层 + 幸运权重 + 排除诅咒/Boss 专属） */
function grantRandomItem(game, player) {
  for (let i = 0; i < 12; i++) {
    const reward = game?.world?._rollRewardItem?.(player);
    if (reward && player.addItem(reward.id)) return reward;
  }
  player.gainMaterials(25);
  return null;
}

/** 玩家当前最好武器品质（tier 1~4；没有武器按 1） */
function bestWeaponTier(player) {
  let best = 1;
  for (const w of player.weapons || []) best = Math.max(best, w.tier ?? 1);
  return best;
}

/** 金色红品池：8 件常规 Boss 红品，排除隐藏 Boss 战利品，且不重复给 */
export function redItemPool(player) {
  return ITEMS.filter((it) => it.bossDropOnly
    && !it.hiddenBossOnly
    && !player.hasItem(it.id));
}

/** 传说能力升级（3 条）—— 金色等级奖励 */
function grantLegendaryUpgrades(game, player) {
  const defs = rollUpgrades(game.rng, player.upgradesTaken, 3, { forceRarity: 'legendary' });
  for (const d of defs) player.applyUpgrade(d);
  return defs;
}

// ---------------------------------------------------------
// 奖励表
// ---------------------------------------------------------
export const MIDBOSS_BOONS = [
  // ---------------- 白色 ----------------
  {
    id: 'w_xp', tier: 'white', name: '经验灌注', glyph: '经',
    desc: '立刻获得当前等级所需的一整级经验。',
    apply(game, p) {
      const amount = p.xpNeeded ?? 0;
      p.gainXp(amount);
      toast(game, `经验灌注：+${Math.round(amount)} 经验`);
    },
  },
  {
    id: 'w_money', tier: 'white', name: '猫猫钱包', glyph: '钱',
    desc: '获得 50 材料，每波 +5（越往后期给得越多）。',
    apply(game, p) {
      const wave = (game?.world?.currentWave ?? game?.waveIndex ?? 0) + 1;
      const amount = 50 + wave * 5;
      p.gainMaterials(amount);
      toast(game, `猫猫钱包：+${amount} 材料（第 ${wave} 波）`);
    },
  },
  {
    id: 'w_item', tier: 'white', name: '猫猫的礼物', glyph: '礼',
    desc: '随机获得一件非武器道具，运气越好品质越高。',
    apply(game, p) {
      const got = grantRandomItem(game, p);
      toast(game, got ? `猫猫的礼物：${got.name}` : '猫猫的礼物：+25 材料');
    },
  },
  {
    id: 'w_weapon_lv', tier: 'white', name: '武器强化', glyph: '强',
    desc: '随机一把已有武器 +1 级。',
    apply(game, p) {
      if (!p.weapons?.length) { p.gainMaterials(25); return; }
      const w = game.rng.pick(p.weapons);
      w.level += 1;
      toast(game, `武器强化：${w.def.name} +1 级`);
    },
  },
  {
    id: 'w_atk', tier: 'white', name: '磨爪', glyph: '攻',
    desc: '攻击 +8%。',
    apply(game, p) {
      p.stats.addPct('damage', 8);
      toast(game, '磨爪：攻击 +8%');
    },
  },
  {
    id: 'w_hp', tier: 'white', name: '厚实猫毛', glyph: '血',
    desc: '生命上限 +8。',
    apply(game, p) {
      p.stats.addFlat('maxHp', 8);
      p._refreshMaxHp();
      toast(game, '厚实猫毛：生命上限 +8');
    },
  },

  // ---------------- 蓝色 ----------------
  {
    id: 'b_xp', tier: 'blue', name: '学习猫', glyph: '学',
    desc: '获得的经验 +10%。',
    apply(game, p) {
      p.boons.xpGain *= 1.1;
      toast(game, '学习猫：经验获取 +10%');
    },
  },
  {
    id: 'b_money', tier: 'blue', name: '招财猫', glyph: '财',
    desc: '获得的材料（金钱）+10%。',
    apply(game, p) {
      p.boons.matGain *= 1.1;
      toast(game, '招财猫：材料获取 +10%');
    },
  },
  {
    id: 'b_weapon', tier: 'blue', name: '更好的武器', glyph: '武',
    desc: '随机获得一把品质高于当前最好武器的武器。',
    apply(game, p) {
      const best = bestWeaponTier(p);
      const target = Math.min(4, best + 1);
      let pool = WEAPONS.filter((w) => (w.tier ?? 1) === target);
      if (!pool.length) pool = WEAPONS.filter((w) => (w.tier ?? 1) === 4);
      if (!pool.length) { p.gainMaterials(40); return; }
      const def = game.rng.pick(pool);
      if (p.hasWeaponSlot && p.addWeapon(def.id)) {
        toast(game, `更好的武器：获得【${def.name}】`);
      } else {
        // 武器栏已满：不白给 —— 改为把同品质（没有就随机）武器升 1 级
        const same = p.weapons.filter((w) => w.tier === target);
        const w = game.rng.pick(same.length ? same : p.weapons);
        if (w) { w.level += 1; toast(game, `武器栏已满：${w.def.name} +1 级`); }
      }
    },
  },
  {
    id: 'b_heal', tier: 'blue', name: '暖呼呼', glyph: '疗',
    desc: '受到的治疗效果 +10%。',
    apply(game, p) {
      p.boons.healRecv *= 1.1;
      toast(game, '暖呼呼：受到的治疗 +10%');
    },
  },
  {
    id: 'b_dmg', tier: 'blue', name: '猫猫连击', glyph: '伤',
    desc: '额外的攻击伤害乘区 +5%。',
    apply(game, p) {
      p.dealtFinalMul = (p.dealtFinalMul ?? 1) * 1.05;
      toast(game, '猫猫连击：额外攻击伤害 +5%');
    },
  },
  {
    id: 'b_dr', tier: 'blue', name: '软垫', glyph: '减',
    desc: '受到的伤害 -5%。',
    apply(game, p) {
      p.takenFinalMul = (p.takenFinalMul ?? 1) * 0.95;
      toast(game, '软垫：受到的伤害 -5%');
    },
  },

  // ---------------- 紫色 ----------------
  {
    id: 'p_pet_dmg', tier: 'purple', name: '小小猫娘·凶猛', glyph: '宠',
    desc: '小小猫娘的伤害 ×2。',
    apply(game, p) {
      p.boons.petDmg *= 2;
      toast(game, '小小猫娘变得凶猛：伤害 ×2');
    },
  },
  {
    id: 'p_ms_hit', tier: 'purple', name: '受击反弹', glyph: '速',
    desc: '受到攻击后移速 +15%，持续 5 秒，可以叠加。',
    apply(game, p) {
      p.boons.msOnHit = true;
      toast(game, '受击反弹：挨打后移速提升（可叠加）');
    },
  },
  {
    id: 'p_pickup', tier: 'purple', name: '大吸力', glyph: '吸',
    desc: '拾取范围 +150。',
    apply(game, p) {
      p.stats.addFlat('pickupRange', 150);
      toast(game, '大吸力：拾取范围 +150');
    },
  },
  {
    id: 'p_items5', tier: 'purple', name: '猫猫大采购', glyph: '购',
    desc: '随机获得 5 件非武器道具。',
    apply(game, p) {
      const names = [];
      for (let i = 0; i < 5; i++) {
        const got = grantRandomItem(game, p);
        if (got) names.push(got.name);
      }
      toast(game, names.length
        ? `猫猫大采购：${names.join('、')}`
        : '猫猫大采购：+125 材料', 'good', 6000);
    },
  },
  {
    id: 'p_atkspd', tier: 'purple', name: '猫猫疾风', glyph: '风',
    desc: '攻击速度 +20%，射程 +20%。',
    apply(game, p) {
      p.stats.addPct('attackSpeed', 20);
      p.stats.addPct('range', 20);
      toast(game, '猫猫疾风：攻速 +20%，射程 +20%');
    },
  },
  {
    id: 'p_lethal', tier: 'purple', name: '九条命', glyph: '命',
    desc: '下一次受到致命伤害时自动回满生命（一次）。',
    apply(game, p) {
      p.boons.lethal += 1;
      toast(game, `九条命：致命伤自动回满（${p.boons.lethal} 次）`);
    },
  },

  // ---------------- 金色 ----------------
  {
    id: 'g_pet_cd', tier: 'gold', name: '小小猫娘·灵巧', glyph: '灵',
    desc: '小小猫娘的所有技能冷却 -3 秒。',
    apply(game, p) {
      p.boons.petCdCut += 3;
      toast(game, '小小猫娘更灵巧：技能冷却 -3 秒');
    },
  },
  {
    id: 'g_red', tier: 'gold', name: '红色战利品', glyph: '红',
    desc: '随机获得一件未持有的红色 Boss 道具（不含隐藏 Boss 战利品）。',
    apply(game, p) {
      const pool = redItemPool(p);
      if (!pool.length) {
        // 8 件全齐：不再重复给，折算成一次传说馈赠。理论上很难走到。
        const defs = grantLegendaryUpgrades(game, p);
        toast(game, `红色战利品已集齐：改为 ${defs.map((d) => d.name).join('、')}`);
        return;
      }
      const def = game.rng.pick(pool);
      p.addItem(def.id);
      toast(game, `红色战利品：获得【${def.name}】！`, 'good', 7000);
    },
  },
  {
    id: 'g_hitbox', tier: 'gold', name: '猫猫缩骨功', glyph: '缩',
    desc: '被攻击的判定点 -20%（可叠加，最多 4 层）。',
    apply(game, p) {
      p.boons.hitboxStacks = Math.min(4, (p.boons.hitboxStacks ?? 0) + 1);
      p.hitR = (p._hitRBase ?? p.radius * 0.72) * Math.pow(0.8, p.boons.hitboxStacks);
      toast(game, `猫猫缩骨功：判定点 -20%（${p.boons.hitboxStacks} 层）`);
    },
  },
  {
    id: 'g_elemental', tier: 'gold', name: '混沌猫爪', glyph: '混',
    desc: '攻击有 20% 概率附带随机效果：中毒 / 燃烧 / 冰冻 / 额外命中。',
    apply(game, p) {
      p.boons.elemental = true;
      toast(game, '混沌猫爪：攻击附带随机元素效果');
    },
  },
  {
    id: 'g_legends', tier: 'gold', name: '传说馈赠', glyph: '传',
    desc: '随机获得 3 个传说能力升级。',
    apply(game, p) {
      const defs = grantLegendaryUpgrades(game, p);
      toast(game, defs.length
        ? `传说馈赠：${defs.map((d) => d.name).join('、')}`
        : '传说馈赠：升级池已空', 'good', 6500);
    },
  },
];

// ---------------------------------------------------------
// AI 自动选择（第二百一十七轮）
//
// 用户："中boss奖励掉落ai猫娘会自己选吗？包括代打模式。"
//
// 品质永远优先（金 > 紫 > 蓝 > 白），同品质内按"对 AI 生存/成长更稳"排序。
// 代打（NekoPilot）和 Q 全自动升级共用这一个评分，避免两套逻辑选出不同结果。
// ---------------------------------------------------------
const TIER_SCORE = { gold: 400, purple: 300, blue: 200, white: 100 };

const EFFECT_SCORE = {
  // 白色
  w_xp: 40, w_money: 25, w_item: 45, w_weapon_lv: 50, w_atk: 40, w_hp: 35,
  // 蓝色
  b_xp: 30, b_money: 25, b_weapon: 65, b_heal: 45, b_dmg: 50, b_dr: 55,
  // 紫色
  p_pet_dmg: 40, p_ms_hit: 30, p_pickup: 30, p_items5: 55, p_atkspd: 50, p_lethal: 70,
  // 金色
  g_pet_cd: 30, g_red: 70, g_hitbox: 50, g_elemental: 65, g_legends: 60,
};

/** 给一个中 Boss 奖励打分（只影响 AI 自动选择，不影响给玩家的选项） */
export function scoreBoon(option, player, waveIndex = 0) {
  let s = TIER_SCORE[option?.tier] ?? 0;
  s += EFFECT_SCORE[option?.id] ?? 0;
  // 经验类在前期更值钱（后期升级慢、一整条经验的边际收益下降）
  if ((option?.id === 'w_xp' || option?.id === 'b_xp') && waveIndex < 8) s += 20;
  return s;
}

/** AI 从三张卡里挑一张（返回原对象；空数组返回 null） */
export function pickBestBoon(options, player, waveIndex = 0) {
  let best = null, bestS = -Infinity;
  for (const o of options || []) {
    const s = scoreBoon(o, player, waveIndex);
    if (s > bestS) { bestS = s; best = o; }
  }
  return best;
}

const BOON_MAP = Object.fromEntries(MIDBOSS_BOONS.map((b) => [b.id, b]));

/** 某些奖励在特定局面下没有意义（例如红品已集齐）→ 不参与抽卡 */
function isAvailable(def, player) {
  if (def.id === 'g_red') return redItemPool(player).length > 0;
  if (def.id === 'w_weapon_lv' || def.id === 'b_weapon') return (player.weapons?.length ?? 0) > 0;
  return true;
}

/**
 * 抽 3 个不重复的中 Boss 奖励。
 *
 * @param {RNG} rng
 * @param {object} game  需要 game.player / game.world / game.ui
 * @param {number} count 默认 3
 * @returns {Array<object>}
 */
export function rollMidBossBoons(rng, game, count = 3, player = game.player) {
  const p = player;
  const luckEff = p?.stats?.luckEff ?? 0;
  const out = [];
  const used = new Set();
  for (let slot = 0; slot < count; slot++) {
    let picked = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const tier = rollBoonTier(rng, luckEff);
      const pool = MIDBOSS_BOONS.filter((b) => b.tier === tier
        && !used.has(b.id) && isAvailable(b, p));
      if (!pool.length) continue;
      picked = rng.pick(pool);
      break;
    }
    if (!picked) {
      // 极端兜底：从所有还没用过的可用奖励里随便挑一个
      const pool = MIDBOSS_BOONS.filter((b) => !used.has(b.id) && isAvailable(b, p));
      if (!pool.length) break;
      picked = rng.pick(pool);
    }
    used.add(picked.id);
    const tierDef = BOON_TIERS[picked.tier];
    out.push({ ...picked, tierName: tierDef.name, color: tierDef.color });
  }
  return out;
}

/** 应用一个奖励（option 是 rollMidBossBoons 返回的带 apply 的对象） */
export function applyMidBossBoon(game, option, player = game.player) {
  const def = option?.id ? (BOON_MAP[option.id] ?? option) : null;
  if (!def || typeof def.apply !== 'function') return false;
  def.apply(game, player ?? game.player);
  return true;
}