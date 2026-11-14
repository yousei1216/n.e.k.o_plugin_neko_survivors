// ============================================================
// 第二百二十轮：局外永久成长（能力点数）
//
// 用户："抽卡券自动兑换能力升级点数，升级点数可以换取永久生效的局外
//       成长。具体成长我还没想好，先把点数系统做出来……然后加个升级能力
//       的按钮和界面，之后方便更新升级能力来永久成长。"
//
// 所以本轮只搭**数据驱动**的框架，META_UPGRADES 先留空：
// UI 会显示"强化项目筹备中"，点数照常累计；以后往数组里加一条就自动
// 出现在升级界面里，不需要再改 UI / 存档逻辑。
//
// 一条升级的字段：
//   id        唯一 id（存档 meta.metaUpgradeLevels[id] 记等级）
//   name      显示名
//   glyph     卡面字符（单字，如 '血'）
//   color     卡面颜色（CSS 色值）
//   desc(lv)  当前等级的说明文本（可以是函数，也可以是字符串）
//   maxLevel  最大等级（默认 1）
//   cost(lv)  从 lv-1 升到 lv 的花费（数字 / 数组 / 函数均可，见下方）
//   mods      每级生效的 flat 属性，如 { maxHp: 2, armor: 1 }
//   pct       每级生效的百分比属性，如 { damage: 1 }
//
// 例（以后直接取消注释并调整数值即可）：
//   {
//     id: 'meta_hp', name: '猫猫体质', glyph: '血', color: '#ff7bac',
//     maxLevel: 10, cost: (lv) => 10 + lv * 5,
//     mods: { maxHp: 2 },
//     desc: (lv) => `所有猫娘生命上限 +${lv * 2}`,
//   }
// ============================================================

export const META_UPGRADES = [];

/** 从当前等级 lv 升到 lv+1 的花费 */
export function metaUpgradeCost(def, lv = 0) {
  if (!def) return Infinity;
  const next = Math.max(1, Math.floor(lv) + 1);
  if (typeof def.cost === 'function') return Math.max(0, Math.round(def.cost(next)));
  if (Array.isArray(def.cost)) {
    const v = def.cost[Math.min(next - 1, def.cost.length - 1)];
    return Math.max(0, Math.round(Number(v) || 0));
  }
  if (Number.isFinite(def.cost)) return Math.max(0, Math.round(def.cost));
  const base = Number(def.baseCost ?? 10);
  const growth = Number(def.growth ?? 1.6);
  return Math.max(1, Math.round(base * Math.pow(growth, next - 1)));
}

/** 把已购买的局外成长应用到一名玩家（开局时对 P1~P4 各调一次） */
export function applyMetaUpgrades(player, meta) {
  if (!player || !player.stats) return;
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
  }
  if (changed) {
    player.stats.dirty = true;
    player._refreshMaxHp?.();
  }
}