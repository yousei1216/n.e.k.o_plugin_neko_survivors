// ============================================================
// 第二百二十八轮：生活区状态机（纯逻辑，无 DOM）
//
// 负责金币、鱼篓、农田、手办的全部存档变更。main.js 只做
// "调用 → _saveMeta → 刷 UI"，测试可以脱离浏览器直接跑。
// ============================================================

import { STAT_DEFS } from '../core/stats.js';
import {
  CROPS, CROP_MAP, FERTILIZERS, FISH, FISH_BAG_CAP, CROP_BAG_CAP,
  FIGURES, FIGURE_DUPLICATE_COINS, FIGURE_MAX_LEVEL,
  RODS, ROD_MAP, BAITS, BAIT_MAP, MACHINES, MACHINE_MAP,
  FARM_PLOTS, FARM_COLS, FARM_ROWS, COINS_PER_TICKET,
  getCrop, getFertilizer, getFish, getRod, getBait, getFigure,
} from '../data/life.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const int = (v, d = 0) => Math.floor(num(v, d));
const nowMs = () => Date.now();

// ============================================================
// 默认存档 / 读档归一化
// ============================================================

export function defaultFishing() {
  return {
    rod: 'bamboo',
    rods: ['bamboo'],
    bait: 'shrimp',
    baits: { shrimp: 5, glow: 0 },
    bag: [],
    collection: {},
    caught: 0,
    sold: 0,
  };
}

export function defaultFarm() {
  return {
    plots: Array(FARM_PLOTS).fill(null),
    seeds: { radish: 3, carrot: 1 },
    fertilizers: { basic: 2 },
    machines: { sprinkler: false, harvester: false },
    bag: [],
    collection: {},
    harvested: 0,
    sold: 0,
  };
}

export function defaultFigures() {
  return Object.fromEntries(FIGURES.map((f) => [f.charId, 0]));
}

function normalizeBagFish(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!FISH.some((f) => f.id === raw.id)) return null;
  const cm = Math.max(0, num(raw.cm));
  return {
    uid: String(raw.uid || ''),
    id: raw.id,
    cm: Math.round(cm * 10) / 10,
    star: clamp(int(raw.star), 0, 2),
    value: Math.max(1, int(raw.value, 1)),
  };
}

function normalizeBagCrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!CROP_MAP[raw.cropId]) return null;
  return {
    uid: String(raw.uid || ''),
    cropId: raw.cropId,
    size: Math.round(Math.max(0, num(raw.size)) * 10) / 10,
    star: clamp(int(raw.star), 0, 2),
    value: Math.max(1, int(raw.value, 1)),
    mutated: raw.mutated === true,
  };
}

function normalizeCollection(raw, kind) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object') continue;
    out[id] = {
      count: Math.max(0, int(rec.count)),
      best: Math.max(0, Math.round(num(rec.best) * 10) / 10),
      bestStar: clamp(int(rec.bestStar), 0, 2),
      [kind === 'fish' ? 'bestCm' : 'bestSize']: Math.max(0, Math.round(num(rec.bestCm ?? rec.bestSize) * 10) / 10),
    };
  }
  return out;
}

/**
 * 把任意旧存档合并成完整的生活区结构。
 * 只有整个 fishing/farm 字段缺失时才发新手资源；字段存在但数值为 0
 * 说明玩家真的用完了，不能重复发。
 */
export function normalizeLifeMeta(parsed = {}) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const f = src.fishing && typeof src.fishing === 'object' ? src.fishing : null;
  const farm = src.farm && typeof src.farm === 'object' ? src.farm : null;
  const df = defaultFishing();
  const da = defaultFarm();

  const fishing = {
    rod: ROD_MAP[f?.rod] ? f.rod : df.rod,
    rods: Array.isArray(f?.rods)
      ? [...new Set(['bamboo', ...f.rods.filter((id) => ROD_MAP[id])])]
      : df.rods.slice(),
    bait: BAIT_MAP[f?.bait] ? f.bait : df.bait,
    baits: {
      shrimp: Math.max(0, int(f?.baits?.shrimp, df.baits.shrimp)),
      glow: Math.max(0, int(f?.baits?.glow, df.baits.glow)),
    },
    bag: Array.isArray(f?.bag) ? f.bag.map(normalizeBagFish).filter(Boolean).slice(-FISH_BAG_CAP) : [],
    collection: normalizeCollection(f?.collection, 'fish'),
    caught: Math.max(0, int(f?.caught)),
    sold: Math.max(0, int(f?.sold)),
  };
  if (!fishing.rods.includes(fishing.rod)) fishing.rod = 'bamboo';

  const plots = Array(FARM_PLOTS).fill(null);
  if (Array.isArray(farm?.plots)) {
    for (let i = 0; i < Math.min(FARM_PLOTS, farm.plots.length); i++) {
      const p = farm.plots[i];
      if (!p || typeof p !== 'object' || !CROP_MAP[p.cropId]) continue;
      plots[i] = {
        cropId: p.cropId,
        plantedAt: Math.max(0, int(p.plantedAt)),
        watered: p.watered === true,
        fert: clamp(int(p.fert), 0, 3),
      };
    }
  }

  const seeds = { ...da.seeds };
  if (farm?.seeds && typeof farm.seeds === 'object') {
    for (const c of CROPS) {
      if (farm.seeds[c.id] != null) seeds[c.id] = Math.max(0, int(farm.seeds[c.id]));
    }
  }
  const fertilizers = { ...da.fertilizers };
  if (farm?.fertilizers && typeof farm.fertilizers === 'object') {
    for (const fert of FERTILIZERS) {
      if (fert.id !== 'none' && farm.fertilizers[fert.id] != null) {
        fertilizers[fert.id] = Math.max(0, int(farm.fertilizers[fert.id]));
      }
    }
  }

  const figures = defaultFigures();
  if (src.figures && typeof src.figures === 'object') {
    for (const fg of FIGURES) {
      figures[fg.charId] = clamp(int(src.figures[fg.charId]), 0, FIGURE_MAX_LEVEL);
    }
  }

  return {
    coins: Math.max(0, int(src.coins, f || farm ? 0 : 120)),
    fishing,
    farm: {
      plots,
      seeds,
      fertilizers,
      machines: {
        sprinkler: farm?.machines?.sprinkler === true,
        harvester: farm?.machines?.harvester === true,
      },
      bag: Array.isArray(farm?.bag) ? farm.bag.map(normalizeBagCrop).filter(Boolean).slice(-CROP_BAG_CAP) : [],
      collection: normalizeCollection(farm?.collection, 'crop'),
      harvested: Math.max(0, int(farm?.harvested)),
      sold: Math.max(0, int(farm?.sold)),
    },
    figures,
    gachaUrRate: clamp(int(src.gachaUrRate, 1), 1, 100),
    lifeSeq: Math.max(0, int(src.lifeSeq)),
  };
}

// ============================================================
// 通用小工具
// ============================================================

export function nextUid(meta, prefix = 'i') {
  meta.lifeSeq = Math.max(0, int(meta.lifeSeq)) + 1;
  return `${prefix}${meta.lifeSeq}`;
}

export function addCoins(meta, amount) {
  const n = int(amount);
  if (n > 0) meta.coins = Math.max(0, int(meta.coins)) + n;
  return meta.coins;
}

// ============================================================
// 钓鱼
// ============================================================

/** 随机一条鱼（不含 uid；入篓/收藏由 addFishItem 做）。 */
export function rollFishCatch(rng, rodId = 'bamboo', baitId = 'dough') {
  const rod = getRod(rodId);
  const bait = getBait(baitId);
  const bonus = (rod.rare || 0) + (bait.rare || 0);
  const pick = rng.pickWeighted(FISH, (f) => f.weight * (1 + bonus * (1 + f.rarity * 1.8)));
  const f = pick || FISH[0];

  // 4 个均匀随机数取平均 → 中间多、两头少，比较像真实体长分布
  const bell = (rng.next() + rng.next() + rng.next() + rng.next()) / 4;
  let factor = 0.5 + (bell - 0.5) * 1.15 + (rod.sizeBias || 0) + (bait.sizeBias || 0);
  factor = clamp(factor, 0.02, 0.98);
  const cm = f.minCm + (f.maxCm - f.minCm) * factor;
  let star = 0;
  if (factor <= 0.15 || factor >= 0.85) star = 1;
  if (factor <= 0.05 || factor >= 0.95) star = 2;
  const starMul = star === 2 ? 2.5 : star === 1 ? 1.6 : 1;
  const value = Math.max(1, Math.round((f.baseValue + cm * f.perCm) * starMul));

  return {
    id: f.id,
    cm: Math.round(cm * 10) / 10,
    star,
    value,
    rarity: f.rarity,
  };
}

function recordFishCollection(meta, fish) {
  const old = meta.fishing.collection[fish.id] || { count: 0, bestCm: 0, bestStar: 0 };
  meta.fishing.collection[fish.id] = {
    count: old.count + 1,
    bestCm: Math.max(old.bestCm || 0, fish.cm),
    bestStar: Math.max(old.bestStar || 0, fish.star),
  };
}

/** 入鱼篓；满了自动按价值折金币。返回 {added, autoSold, autoCoins, item}。 */
export function addFishItem(meta, fish) {
  recordFishCollection(meta, fish);
  meta.fishing.caught = Math.max(0, int(meta.fishing.caught)) + 1;
  if (meta.fishing.bag.length >= FISH_BAG_CAP) {
    addCoins(meta, fish.value);
    meta.fishing.sold = Math.max(0, int(meta.fishing.sold)) + 1;
    return { added: false, autoSold: true, autoCoins: fish.value, item: null, coins: meta.coins };
  }
  const item = { ...fish, uid: nextUid(meta, 'f') };
  meta.fishing.bag.push(item);
  return { added: true, autoSold: false, autoCoins: 0, item, coins: meta.coins };
}

/** 每次抛竿消耗 1 个当前鱼饵；高级饵用完自动回落到无限面团。 */
export function consumeBait(meta) {
  const id = meta.fishing.bait;
  if (id !== 'dough' && (meta.fishing.baits[id] | 0) > 0) {
    meta.fishing.baits[id] = Math.max(0, int(meta.fishing.baits[id]) - 1);
    return { ok: true, bait: getBait(id), used: id, fallback: false };
  }
  if (id !== 'dough') meta.fishing.bait = 'dough';
  return { ok: true, bait: getBait('dough'), used: 'dough', fallback: id !== 'dough' };
}

export function sellFish(meta, uid) {
  const i = meta.fishing.bag.findIndex((f) => f.uid === uid);
  if (i < 0) return { ok: false, msg: '这条鱼已经不在鱼篓里了' };
  const [fish] = meta.fishing.bag.splice(i, 1);
  addCoins(meta, fish.value);
  meta.fishing.sold = Math.max(0, int(meta.fishing.sold)) + 1;
  return { ok: true, coins: fish.value, name: getFish(fish.id).name };
}

export function sellAllFish(meta) {
  if (!meta.fishing.bag.length) return { ok: false, coins: 0, count: 0 };
  const count = meta.fishing.bag.length;
  let coins = 0;
  for (const f of meta.fishing.bag) coins += f.value;
  meta.fishing.bag.length = 0;
  addCoins(meta, coins);
  meta.fishing.sold = Math.max(0, int(meta.fishing.sold)) + count;
  return { ok: true, coins, count };
}

export function buyRod(meta, id) {
  const rod = ROD_MAP[id];
  if (!rod) return { ok: false, msg: '没有这个鱼竿' };
  if (meta.fishing.rods.includes(id)) {
    meta.fishing.rod = id;
    return { ok: true, equipped: true, msg: `已装备 ${rod.name}` };
  }
  if (meta.coins < rod.price) return { ok: false, msg: `金币不足：需要 ${rod.price}` };
  meta.coins -= rod.price;
  meta.fishing.rods.push(id);
  meta.fishing.rod = id;
  return { ok: true, bought: true, msg: `购买了 ${rod.name}` };
}

export function equipRod(meta, id) {
  if (!meta.fishing.rods.includes(id)) return { ok: false, msg: '还没有这根鱼竿' };
  meta.fishing.rod = id;
  return { ok: true };
}

export function buyBait(meta, id, units = 10) {
  const bait = BAIT_MAP[id];
  if (!bait || id === 'dough') return { ok: false, msg: '这个鱼饵不需要购买' };
  const n = Math.max(1, int(units));
  const cost = bait.price * n;
  if (meta.coins < cost) return { ok: false, msg: `金币不足：需要 ${cost}` };
  meta.coins -= cost;
  meta.fishing.baits[id] = Math.max(0, int(meta.fishing.baits[id])) + n;
  return { ok: true, count: n, cost, msg: `购买了 ${bait.name} ×${n}` };
}

export function selectBait(meta, id) {
  if (!BAIT_MAP[id]) return { ok: false, msg: '没有这种鱼饵' };
  if (id !== 'dough' && (meta.fishing.baits[id] | 0) <= 0) {
    return { ok: false, msg: '这种鱼饵用完了，先去商店补充' };
  }
  meta.fishing.bait = id;
  return { ok: true, bait: getBait(id) };
}

// ============================================================
// 农田
// ============================================================

export function plotNeighbors(plots, index) {
  const row = Math.floor(index / FARM_COLS);
  const col = index % FARM_COLS;
  const out = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= FARM_ROWS || c < 0 || c >= FARM_COLS) continue;
    const p = plots[r * FARM_COLS + c];
    if (p) out.push(p);
  }
  return out;
}

/**
 * 第二百三十二轮：作物成熟品质（三态）。
 *   相邻异种更多 → 变异（mut，价格 ×3）
 *   相邻同种更多 → 丰硕（rich，产量 +1）
 *   一样多且非 0 → 变异优先；全是空地 → 普通（normal）
 * 纯函数：成熟时显示与收获结算共用同一判定，保证所见即所得。
 */
export function computeCropGrade(plots, index) {
  const plot = plots?.[index];
  if (!plot) return 'normal';
  const neighbors = plotNeighbors(plots, index);
  let same = 0, diff = 0;
  for (const p of neighbors) {
    if (p.cropId === plot.cropId) same += 1;
    else diff += 1;
  }
  if (diff > same) return 'mut';
  if (same > diff) return 'rich';
  if (same > 0) return 'mut';   // 同种与异种一样多：变异优先
  return 'normal';
}

/**
 * @param {object} plot  地块
 * @param {number} now
 * @param {{plots:Array, index:number}} [ctx] 传入时按实时相邻情况算成熟品质；
 *        不传则回落到 plot.grade（收获瞬间已固化）或 normal。
 */
export function plotInfo(plot, now = nowMs(), ctx = null) {
  if (!plot) return { empty: true };
  const crop = getCrop(plot.cropId);
  const elapsed = Math.max(0, now - Math.max(0, num(plot.plantedAt)));
  const progress = clamp(elapsed / crop.growMs, 0, 1);
  const ready = progress >= 1;
  const stage = ready ? 4 : Math.min(3, Math.floor(progress * 4));
  let grade = 'normal';
  if (ready) {
    grade = (ctx && ctx.plots && Number.isInteger(ctx.index))
      ? computeCropGrade(ctx.plots, ctx.index)
      : (plot.grade || 'normal');
  }
  return {
    empty: false, crop, progress, stage, ready, grade,
    remainingMs: Math.max(0, crop.growMs - elapsed),
    watered: plot.watered === true,
    fert: clamp(int(plot.fert), 0, 3),
  };
}

export function plantCrop(meta, index, cropId, now = nowMs()) {
  index = int(index);
  if (index < 0 || index >= FARM_PLOTS) return { ok: false, msg: '没有这块地' };
  if (meta.farm.plots[index]) return { ok: false, msg: '这块地已经种了东西' };
  const crop = CROP_MAP[cropId];
  if (!crop) return { ok: false, msg: '没有这种种子' };
  if ((meta.farm.seeds[cropId] | 0) <= 0) return { ok: false, msg: `没有${crop.name}种子了` };
  meta.farm.seeds[cropId] = Math.max(0, int(meta.farm.seeds[cropId]) - 1);
  meta.farm.plots[index] = {
    cropId,
    plantedAt: now,
    watered: meta.farm.machines.sprinkler === true,
    fert: 0,
    grade: null,   // 成熟瞬间按相邻情况判定（normal/rich/mut）
  };
  return { ok: true, crop };
}

export function waterPlot(meta, index, now = nowMs()) {
  const plot = meta.farm.plots[int(index)];
  if (!plot) return { ok: false, msg: '这块地还没种东西' };
  const info = plotInfo(plot, now);
  if (info.ready) return { ok: false, msg: '已经成熟了，可以直接收获' };
  if (plot.watered) return { ok: false, msg: '这块地已经浇过水了' };
  plot.watered = true;
  return { ok: true };
}

export function fertilizePlot(meta, index, fertId) {
  const plot = meta.farm.plots[int(index)];
  if (!plot) return { ok: false, msg: '这块地还没种东西' };
  if (plotInfo(plot).ready) return { ok: false, msg: '已经成熟了，不能再施肥' };
  if (plot.fert > 0) return { ok: false, msg: '这块地已经施过肥了' };
  const fert = getFertilizer(fertId);
  if (!fert || fert.id === 'none') return { ok: false, msg: '没有这种肥料' };
  if ((meta.farm.fertilizers[fert.id] | 0) <= 0) return { ok: false, msg: `没有${fert.name}了` };
  meta.farm.fertilizers[fert.id] = Math.max(0, int(meta.farm.fertilizers[fert.id]) - 1);
  plot.fert = fert.tier;
  return { ok: true, fert };
}

function recordCropCollection(meta, item) {
  // 第二百三十二轮：图鉴按三态分别记录（普通 / 丰硕 / 变异）
  const key = item.grade === 'mut' ? `${item.cropId}_mut`
    : item.grade === 'rich' ? `${item.cropId}_rich`
      : item.cropId;
  const old = meta.farm.collection[key] || { count: 0, bestSize: 0, bestStar: 0 };
  meta.farm.collection[key] = {
    count: old.count + 1,
    bestSize: Math.max(old.bestSize || 0, item.size),
    bestStar: Math.max(old.bestStar || 0, item.star),
  };
}

export function addCropItem(meta, item) {
  recordCropCollection(meta, item);
  if (meta.farm.bag.length >= CROP_BAG_CAP) {
    addCoins(meta, item.value);
    meta.farm.sold = Math.max(0, int(meta.farm.sold)) + 1;
    return { added: false, autoSold: true, autoCoins: item.value, item: null };
  }
  const full = { ...item, uid: nextUid(meta, 'c') };
  meta.farm.bag.push(full);
  return { added: true, autoSold: false, autoCoins: 0, item: full };
}

/**
 * 随机收获一批作物（不写存档，方便测试）。
 *
 * 第二百三十二轮：三态品质（opts.grade 优先；不传则由相邻数推导，与
 * computeCropGrade 一致）。
 *   normal 普通 → 基础产量与价格
 *   rich   丰硕 → 产量 +1（同种相邻带来）
 *   mut    变异 → 整批价格 ×3（异种相邻带来）
 */
export function rollCropHarvest(rng, cropId, opts = {}) {
  const crop = CROP_MAP[cropId] || CROPS[0];
  const fert = FERTILIZERS[clamp(int(opts.fertTier), 0, 3)];
  const same = Math.max(0, int(opts.sameNeighbors));
  const diff = Math.max(0, int(opts.diffNeighbors));
  const watered = opts.watered === true;

  // 品质：显式传入优先，否则按相邻数推导（与 computeCropGrade 同规则）
  const grade = opts.grade
    || (diff > same ? 'mut' : same > diff ? 'rich' : same > 0 ? 'mut' : 'normal');
  const mutated = grade === 'mut';
  const rich = grade === 'rich';

  let count = rng.int(crop.yieldMin, crop.yieldMax)
    + (watered ? 1 : 0) + (fert.yieldBonus || 0) + (rich ? 1 : 0);
  count = clamp(count, 1, 6);

  const items = [];
  for (let i = 0; i < count; i++) {
    const bell = (rng.next() + rng.next() + rng.next() + rng.next()) / 4;
    let factor = 0.5 + (bell - 0.5) * 1.15
      + (fert.sizeBonus || 0) + (watered ? 0.04 : -0.04) + (rich ? 0.08 : 0);
    factor = clamp(factor, 0.02, 0.98);
    const size = crop.sizeMin + (crop.sizeMax - crop.sizeMin) * factor;
    let star = 0;
    if (factor <= 0.15 || factor >= 0.85) star = 1;
    if (factor <= 0.05 || factor >= 0.95) star = 2;
    const starMul = star === 2 ? 2.5 : star === 1 ? 1.6 : 1;
    const value = Math.max(1, Math.round((crop.baseValue + size * crop.perCm)
      * (mutated ? 3 : 1) * starMul));
    items.push({
      cropId: crop.id,
      size: Math.round(size * 10) / 10,
      star,
      value,
      grade,
      mutated,
    });
  }
  return { items, count, grade, mutated, rich };
}

export function harvestPlot(meta, index, now = nowMs(), rng) {
  index = int(index);
  const plot = meta.farm.plots[index];
  if (!plot) return { ok: false, msg: '这块地还没种东西' };
  const info = plotInfo(plot, now);
  if (!info.ready) return { ok: false, msg: '还没成熟' };

  const grade = computeCropGrade(meta.farm.plots, index);
  const neighbors = plotNeighbors(meta.farm.plots, index);
  const sameNeighbors = neighbors.filter((p) => p.cropId === plot.cropId).length;
  const diffNeighbors = neighbors.filter((p) => p.cropId !== plot.cropId).length;
  // 把成熟时定下的 grade 固化到地块，收获与展示保持一致
  plot.grade = grade;
  const roll = rollCropHarvest(rng, plot.cropId, {
    watered: plot.watered,
    fertTier: plot.fert,
    sameNeighbors,
    diffNeighbors,
    grade,
  });

  let autoCoins = 0;
  for (const item of roll.items) {
    const added = addCropItem(meta, item);
    if (added.autoSold) autoCoins += added.autoCoins;
  }
  meta.farm.harvested = Math.max(0, int(meta.farm.harvested)) + roll.items.length;
  meta.farm.plots[index] = null;
  return {
    ok: true, ...roll, autoCoins, crop: info.crop,
  };
}

/** 自动浇水 / 自动收获。标题页打开时、以及每秒的农场刷新都会调用。 */
export function tickFarm(meta, now = nowMs(), rng) {
  if (!meta?.farm) return { watered: 0, harvested: 0, autoCoins: 0, crops: [] };
  let watered = 0;
  if (meta.farm.machines.sprinkler) {
    for (const p of meta.farm.plots) {
      if (p && !p.watered) { p.watered = true; watered++; }
    }
  }
  let harvested = 0;
  let autoCoins = 0;
  const crops = [];
  if (meta.farm.machines.harvester && rng) {
    for (let i = 0; i < meta.farm.plots.length; i++) {
      const p = meta.farm.plots[i];
      if (!p) continue;
      const info = plotInfo(p, now);
      if (!info.ready) continue;
      const r = harvestPlot(meta, i, now, rng);
      if (r.ok) {
        harvested += r.items.length;
        autoCoins += r.autoCoins || 0;
        crops.push({ crop: r.crop, items: r.items, grade: r.grade, mutated: r.mutated });
      }
    }
  }
  return { watered, harvested, autoCoins, crops };
}

export function sellCrop(meta, uid) {
  const i = meta.farm.bag.findIndex((c) => c.uid === uid);
  if (i < 0) return { ok: false, msg: '这个作物已经不在仓库里了' };
  const [crop] = meta.farm.bag.splice(i, 1);
  addCoins(meta, crop.value);
  meta.farm.sold = Math.max(0, int(meta.farm.sold)) + 1;
  return { ok: true, coins: crop.value, name: getCrop(crop.cropId).name };
}

export function sellAllCrops(meta) {
  if (!meta.farm.bag.length) return { ok: false, coins: 0, count: 0 };
  const count = meta.farm.bag.length;
  let coins = 0;
  for (const c of meta.farm.bag) coins += c.value;
  meta.farm.bag.length = 0;
  addCoins(meta, coins);
  meta.farm.sold = Math.max(0, int(meta.farm.sold)) + count;
  return { ok: true, coins, count };
}

export function buySeed(meta, cropId, units = 1) {
  const crop = CROP_MAP[cropId];
  if (!crop) return { ok: false, msg: '没有这种种子' };
  const n = Math.max(1, int(units));
  const cost = crop.price * n;
  if (meta.coins < cost) return { ok: false, msg: `金币不足：需要 ${cost}` };
  meta.coins -= cost;
  meta.farm.seeds[cropId] = Math.max(0, int(meta.farm.seeds[cropId])) + n;
  return { ok: true, count: n, cost, msg: `购买了 ${crop.name}种子 ×${n}` };
}

export function buyFertilizer(meta, fertId, units = 1) {
  const fert = getFertilizer(fertId);
  if (!fert || fert.id === 'none') return { ok: false, msg: '没有这种肥料' };
  const n = Math.max(1, int(units));
  const cost = fert.price * n;
  if (meta.coins < cost) return { ok: false, msg: `金币不足：需要 ${cost}` };
  meta.coins -= cost;
  meta.farm.fertilizers[fert.id] = Math.max(0, int(meta.farm.fertilizers[fert.id])) + n;
  return { ok: true, count: n, cost, msg: `购买了 ${fert.name} ×${n}` };
}

export function buyMachine(meta, id) {
  const machine = MACHINE_MAP[id];
  if (!machine) return { ok: false, msg: '没有这种机器' };
  if (meta.farm.machines[id]) return { ok: false, msg: '已经拥有这台机器了' };
  if (meta.coins < machine.price) return { ok: false, msg: `金币不足：需要 ${machine.price}` };
  meta.coins -= machine.price;
  meta.farm.machines[id] = true;
  return { ok: true, machine };
}

// ============================================================
// 抽卡券 / 手办
// ============================================================

export function exchangeCoinsForTickets(meta, count = 1) {
  const n = Math.max(1, int(count));
  const cost = COINS_PER_TICKET * n;
  if (meta.coins < cost) return { ok: false, msg: `金币不足：需要 ${cost}` };
  meta.coins -= cost;
  meta.gachaTickets = Math.max(0, int(meta.gachaTickets)) + n;
  return { ok: true, count: n, cost, tickets: meta.gachaTickets, coins: meta.coins };
}

/** UR 抽到的手办：随机角色；重复则升级，满级折金币。 */
export function grantFigure(meta, rng) {
  const f = rng.pick(FIGURES) || FIGURES[0];
  const lv = clamp(int(meta.figures[f.charId]), 0, FIGURE_MAX_LEVEL);
  if (lv >= FIGURE_MAX_LEVEL) {
    addCoins(meta, FIGURE_DUPLICATE_COINS);
    return {
      charId: f.charId, name: f.name, level: FIGURE_MAX_LEVEL,
      duplicate: true, coins: FIGURE_DUPLICATE_COINS,
    };
  }
  meta.figures[f.charId] = lv + 1;
  return {
    charId: f.charId, name: f.name, level: lv + 1,
    duplicate: false, coins: 0, isNew: lv === 0,
  };
}

// 第二百三十九轮：能力点数直接兑换随机手办（不消耗抽卡券）
export const FIGURE_POINTS_COST = 500;

/**
 * 用能力点数换一个随机手办。
 * 与 UR 附赠走同一套 grantFigure：重复升 1 级，满级折金币。
 */
export function buyFigureWithPoints(meta, rng) {
  const cost = FIGURE_POINTS_COST;
  if ((meta.gachaPoints | 0) < cost) {
    return { ok: false, msg: `能力点数不足：需要 ${cost}` };
  }
  meta.gachaPoints = (meta.gachaPoints | 0) - cost;
  const figure = grantFigure(meta, rng);
  return { ok: true, cost, figure, points: meta.gachaPoints | 0 };
}

/** 把手办等级加成叠到对应角色身上（P1 和队友都会调用）。 */
export function applyFigureBonuses(player, meta) {
  if (!player?.stats || !player.characterId) return 0;
  const figure = getFigure(player.characterId);
  const lv = clamp(int(meta?.figures?.[figure.charId]), 0, FIGURE_MAX_LEVEL);
  if (lv <= 0) return 0;
  for (const [k, v] of Object.entries(figure.pct || {})) {
    player.stats.addPct(k, (Number(v) || 0) * lv);
  }
  for (const [k, v] of Object.entries(figure.flat || {})) {
    player.stats.addFlat(k, (Number(v) || 0) * lv);
  }
  player.stats.dirty = true;
  player._refreshMaxHp?.();
  return lv;
}

export function figureBuffText(figure, level = 1) {
  const parts = [];
  for (const [k, v] of Object.entries(figure?.pct || {})) {
    parts.push(`${STAT_DEFS[k]?.name ?? k} +${(Number(v) || 0) * level}%`);
  }
  for (const [k, v] of Object.entries(figure?.flat || {})) {
    parts.push(`${STAT_DEFS[k]?.name ?? k} +${(Number(v) || 0) * level}`);
  }
  return parts.join(' / ');
}