// ============================================================
// 第二百二十一轮：局外永久成长树（能力点数）
//
// 用户规格：
//   4 个种类：战斗 / 生存 / 辅助 / 特殊，每个种类 T0→T1→T2。
//   · 学习 T1 需要该种类 T0 累计升 5 级；
//   · 学习 T2 需要该种类 T1 累计升 5 级。
//   T3 通用：4 个种类的 T2 全部解锁 + T2 累计 20 级。
//   T4：3 个 T3 全部点亮。
//   花费：T0 10 / T1 20 / T2 40 / T3 80 / T4 100 点每级。
//
// 字段说明：
//   mods / pct        每级生效的 flat / 百分比属性（apply 时 × 等级）
//   startMoney/Xp     开局直接加材料 / 经验（不是面板属性）
//   pet*              小小猫娘的专属加成（写进 player.boons，由 pet.js 消费）
//   startRandom*      T3 的开局随机奖励（由 main._applyMetaRandomStartBonuses 发）
//   startExtraChar    T4：开局获得一个其他猫娘的能力与技能
// ============================================================

export const META_CATEGORIES = [
  { id: 'combat', name: '战斗', color: '#ff6b6b' },
  { id: 'survival', name: '生存', color: '#6bffb0' },
  { id: 'support', name: '辅助', color: '#ffd166' },
  { id: 'special', name: '特殊', color: '#c08bff' },
];

export const META_TIER_NAMES = ['T0', 'T1', 'T2', 'T3', 'T4'];
export const META_TIER_COSTS = [10, 20, 40, 80, 100];
export const META_T3_REQUIRE_T2_LEVELS = 20;

export const META_UPGRADES = [
  // ================= 战斗 =================
  {
    id: 'combat_dmg', category: 'combat', tier: 0,
    name: '伤害强化', glyph: '伤', maxLevel: 10, pct: { damage: 1 },
    desc: (lv) => `所有伤害永久 +${lv}%（每级 +1%）`,
  },
  {
    id: 'combat_aspd', category: 'combat', tier: 0,
    name: '攻速强化', glyph: '速', maxLevel: 10, pct: { attackSpeed: 1 },
    desc: (lv) => `攻击速度永久 +${lv}%（每级 +1%）`,
  },
  {
    id: 'combat_melee', category: 'combat', tier: 1,
    name: '近战专精', glyph: '近', maxLevel: 5, pct: { meleeDamage: 2 },
    desc: (lv) => `近战伤害永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'combat_ranged', category: 'combat', tier: 1,
    name: '远程专精', glyph: '远', maxLevel: 5, pct: { rangedDamage: 2 },
    desc: (lv) => `远程伤害永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'combat_elem', category: 'combat', tier: 1,
    name: '元素专精', glyph: '元', maxLevel: 5, pct: { elemDamage: 2 },
    desc: (lv) => `元素伤害永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'combat_crit', category: 'combat', tier: 2,
    name: '暴击率', glyph: '暴', maxLevel: 5, pct: { critChance: 0.4 },
    desc: (lv) => `暴击率永久 +${(lv * 0.4).toFixed(1)}%（每级 +0.4%）`,
  },
  {
    id: 'combat_critdmg', category: 'combat', tier: 2,
    name: '暴击伤害', glyph: '伤', maxLevel: 5, pct: { critDamage: 0.8 },
    desc: (lv) => `暴击伤害永久 +${(lv * 0.8).toFixed(1)}%（每级 +0.8%）`,
  },

  // ================= 生存 =================
  {
    id: 'survival_hp', category: 'survival', tier: 0,
    name: '生命强化', glyph: '血', maxLevel: 10, mods: { maxHp: 1 },
    desc: (lv) => `生命上限永久 +${lv}（每级 +1）`,
  },
  {
    id: 'survival_armor', category: 'survival', tier: 0,
    name: '护甲强化', glyph: '甲', maxLevel: 10, mods: { armor: 0.5 },
    desc: (lv) => `护甲永久 +${(lv * 0.5).toFixed(1)}（每级 +0.5）`,
  },
  {
    id: 'survival_regen', category: 'survival', tier: 1,
    name: '生命回复', glyph: '愈', maxLevel: 5, mods: { hpRegen: 0.2 },
    desc: (lv) => `生命回复永久 +${(lv * 0.2).toFixed(1)}/秒（每级 +0.2）`,
  },
  {
    id: 'survival_lifesteal', category: 'survival', tier: 1,
    name: '吸血', glyph: '吸', maxLevel: 5, pct: { lifesteal: 0.4 },
    desc: (lv) => `吸血永久 +${(lv * 0.4).toFixed(1)}%（每级 +0.4%）`,
  },
  {
    id: 'survival_move', category: 'survival', tier: 2,
    name: '移动速度', glyph: '移', maxLevel: 5, pct: { moveSpeed: 2 },
    desc: (lv) => `移动速度永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'survival_dodge', category: 'survival', tier: 2,
    name: '闪避', glyph: '闪', maxLevel: 5, pct: { dodge: 0.5 },
    desc: (lv) => `闪避永久 +${(lv * 0.5).toFixed(1)}%（每级 +0.5%）`,
  },

  // ================= 辅助 =================
  {
    id: 'support_money', category: 'support', tier: 0,
    name: '开局金钱', glyph: '金', maxLevel: 10, startMoney: 1,
    desc: (lv) => `每局开局材料永久 +${lv}（每级 +1）`,
  },
  {
    id: 'support_xp', category: 'support', tier: 0,
    name: '开局经验', glyph: '验', maxLevel: 10, startXp: 1,
    desc: (lv) => `每局开局经验永久 +${lv}（每级 +1）`,
  },
  {
    id: 'support_luck', category: 'support', tier: 1,
    name: '幸运', glyph: '运', maxLevel: 5, pct: { luck: 2 },
    desc: (lv) => `幸运永久 +${lv * 2}（每级 +2）`,
  },
  {
    id: 'support_aspd', category: 'support', tier: 1,
    name: '攻速', glyph: '速', maxLevel: 5, pct: { attackSpeed: 2 },
    desc: (lv) => `攻击速度永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'support_harvest', category: 'support', tier: 2,
    name: '收获', glyph: '收', maxLevel: 5, mods: { harvesting: 0.4 },
    desc: (lv) => `收获永久 +${(lv * 0.4).toFixed(1)}（每级 +0.4）`,
  },
  {
    id: 'support_pickup', category: 'support', tier: 2,
    name: '拾取范围', glyph: '吸', maxLevel: 5, mods: { pickupRange: 3 },
    desc: (lv) => `拾取范围永久 +${lv * 3}（每级 +3）`,
  },

  // ================= 特殊（小小猫娘） =================
  {
    id: 'special_pet_dmg', category: 'special', tier: 0,
    name: '小小猫娘攻击', glyph: '猫', maxLevel: 10, petDmgFlat: 1,
    desc: (lv) => `小小猫娘攻击力永久 +${lv}（每级 +1）`,
  },
  {
    id: 'special_pet_pickup', category: 'special', tier: 0,
    name: '小小猫娘拾取', glyph: '拾', maxLevel: 10, petPickup: 1,
    desc: (lv) => `小小猫娘拾取范围永久 +${lv}（每级 +1）`,
  },
  {
    id: 'special_pet_aspd', category: 'special', tier: 1,
    name: '小小猫娘攻速', glyph: '速', maxLevel: 5, petAtkSpeed: 2,
    desc: (lv) => `小小猫娘攻击速度永久 +${lv * 2}%（每级 +2%）`,
  },
  {
    id: 'special_pet_range', category: 'special', tier: 1,
    name: '小小猫娘射程', glyph: '远', maxLevel: 5, petRange: 2,
    desc: (lv) => `小小猫娘攻击范围永久 +${lv * 2}（每级 +2）`,
  },
  {
    id: 'special_pet_steal', category: 'special', tier: 2,
    name: '小小猫娘购物', glyph: '购', maxLevel: 5, petSteal: 0.4,
    desc: (lv) => `小小猫娘免费购物概率永久 +${(lv * 0.4).toFixed(1)}%（每级 +0.4%）`,
  },
  {
    id: 'special_pet_vuln', category: 'special', tier: 2,
    name: '小小猫娘标记', glyph: '标', maxLevel: 5, petVuln: 2,
    desc: (lv) => `小小猫娘攻击使敌人受到的伤害永久 +${lv * 2}%（每级 +2%，持续 5 秒）`,
  },

  // ================= T3 通用 =================
  {
    id: 't3_weapon', category: 'common', tier: 3,
    name: '额外武器', glyph: '武', maxLevel: 1, startRandomWeapon: 1,
    desc: (lv) => (lv >= 1 ? '开局已随机获得 1 把额外武器' : '开局随机获得 1 把额外武器'),
  },
  {
    id: 't3_item', category: 'common', tier: 3,
    name: '额外道具', glyph: '具', maxLevel: 1, startRandomItem: 1,
    desc: (lv) => (lv >= 1 ? '开局已随机获得 1 件额外道具' : '开局随机获得 1 件额外道具'),
  },
  {
    id: 't3_upgrade', category: 'common', tier: 3,
    name: '额外升级', glyph: '升', maxLevel: 1, startRandomUpgrade: 1,
    desc: (lv) => (lv >= 1 ? '开局已随机获得 1 项升级奖励' : '开局随机获得 1 项升级奖励'),
  },

  // ================= T4 究极 =================
  {
    id: 't4_char', category: 'ultimate', tier: 4,
    name: '他猫之力', glyph: '喵', maxLevel: 1, startExtraChar: 1,
    desc: (lv) => (lv >= 1 ? '开局已获得另一位猫娘的能力与技能' : '开局随机获得另一位猫娘的能力与技能'),
  },
];

/** 当前等级 */
export function metaLevel(meta, id) {
  const v = Number(meta?.metaUpgradeLevels?.[id]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** 某个种类某层的累计等级 */
export function metaCategoryTierLevel(meta, category, tier) {
  let sum = 0;
  for (const def of META_UPGRADES) {
    if (def.category === category && def.tier === tier) sum += metaLevel(meta, def.id);
  }
  return sum;
}

/** T1 需要 T0 累计 5 级；T2 需要 T1 累计 5 级 */
export function metaCategoryTierUnlocked(meta, category, tier) {
  if (tier <= 0) return true;
  return metaCategoryTierLevel(meta, category, tier - 1) >= 5;
}

/** T3：四个种类的 T2 全部解锁 + T2 累计 20 级 */
export function metaT3Unlocked(meta) {
  const allT2 = META_CATEGORIES.every((c) => metaCategoryTierUnlocked(meta, c.id, 2));
  let t2 = 0;
  for (const c of META_CATEGORIES) t2 += metaCategoryTierLevel(meta, c.id, 2);
  return allT2 && t2 >= META_T3_REQUIRE_T2_LEVELS;
}

/** T4：3 个 T3 全部点亮 */
export function metaT4Unlocked(meta) {
  return ['t3_weapon', 't3_item', 't3_upgrade'].every((id) => metaLevel(meta, id) >= 1);
}

/** 单个升级是否已解锁 */
export function metaUpgradeUnlocked(meta, def) {
  if (!def) return false;
  if (def.tier === 3) return metaT3Unlocked(meta);
  if (def.tier === 4) return metaT4Unlocked(meta);
  return metaCategoryTierUnlocked(meta, def.category, def.tier);
}

/** 从当前等级 lv 升到 lv+1 的花费 */
export function metaUpgradeCost(def, lv = 0) {
  if (!def) return Infinity;
  if (typeof def.cost === 'function') return Math.max(0, Math.round(def.cost(lv + 1)));
  if (Array.isArray(def.cost)) {
    const v = def.cost[Math.min(lv, def.cost.length - 1)];
    return Math.max(0, Math.round(Number(v) || 0));
  }
  if (Number.isFinite(def.cost)) return Math.max(0, Math.round(def.cost));
  return META_TIER_COSTS[def.tier] ?? 10;
}

/**
 * 把已购买的局外成长应用到一名玩家。
 * 返回本局需要的 T3/T4 随机奖励标记（只有 P1 会真正发放）。
 */
export function applyMetaUpgrades(player, meta) {
  const out = {
    startRandomWeapon: 0, startRandomItem: 0, startRandomUpgrade: 0, startExtraChar: 0,
  };
  if (!player || !player.stats) return out;
  if (!player.boons) player.boons = {};
  const levels = meta?.metaUpgradeLevels || {};
  let changed = false;

  for (const def of META_UPGRADES) {
    const lv = Math.max(0, Math.floor(Number(levels[def.id]) || 0));
    if (lv <= 0) continue;

    for (const k in (def.mods || {})) {
      player.stats.addFlat(k, (Number(def.mods[k]) || 0) * lv);
      changed = true;
    }
    for (const k in (def.pct || {})) {
      player.stats.addPct(k, (Number(def.pct[k]) || 0) * lv);
      changed = true;
    }

    // ---- 开局资源 ----
    if (def.startMoney) player.materials += (Number(def.startMoney) || 0) * lv;
    if (def.startXp) player.gainXp((Number(def.startXp) || 0) * lv);

    // ---- 小小猫娘加成（运行时字段）----
    if (def.petDmgFlat) player.boons.petDmgFlat = (player.boons.petDmgFlat ?? 0) + def.petDmgFlat * lv;
    if (def.petPickup) player.boons.petPickup = (player.boons.petPickup ?? 0) + def.petPickup * lv;
    if (def.petAtkSpeed) player.boons.petAtkSpeed = (player.boons.petAtkSpeed ?? 0) + def.petAtkSpeed * lv;
    if (def.petRange) player.boons.petRange = (player.boons.petRange ?? 0) + def.petRange * lv;
    if (def.petSteal) player.boons.petSteal = (player.boons.petSteal ?? 0) + def.petSteal * lv;
    if (def.petVuln) player.boons.petVuln = (player.boons.petVuln ?? 0) + def.petVuln * lv;

    // ---- T3/T4 标记 ----
    if (def.startRandomWeapon) out.startRandomWeapon += lv;
    if (def.startRandomItem) out.startRandomItem += lv;
    if (def.startRandomUpgrade) out.startRandomUpgrade += lv;
    if (def.startExtraChar) out.startExtraChar += lv;
  }

  if (changed) {
    player.stats.dirty = true;
    player._refreshMaxHp?.();
  }
  return out;
}