// ============================================================
// 第二百二十轮：扭蛋机（局外永久成长）
//
// 用户规格：
//   · 每过 1 回合获得 1 张抽卡券；无限模式 1 回合 2 张；
//     打败隐藏 Boss 每一个给 1 张。
//   · 点击主菜单右侧扭蛋机抽一发十连；概率 49/35/10/5/1
//     → N / R / SR / SSR / UR。
//   · 10 抽保底 1 个 SR（10 张都没有 SR 时最后一张变 SR）；
//     100 抽保底 1 个 SSR（连续 100 抽没有 SSR 时第 100 抽必出）。
//   · 卡券在动画结束后折算成能力点数：N1 / R5 / SR20 / SSR60 / UR300。
//
// 本模块只做**纯随机与点数换算**（无 DOM、无存档），方便 Node 测试：
//   存档字段（main.meta）：
//     gachaTickets    扭蛋券
//     gachaPoints     能力点数
//     gachaPitySSR    距离上次 SSR/UR 的抽数（0..99，第 100 抽强制 SSR）
//     gachaPulls      累计抽数（统计用）
// ============================================================

export const GACHA_COST = 10;   // 一次十连消耗的券
// 第二百二十八轮：UR 动态概率 —— 每次十连没出 UR，下一次十连 +1%，
// 出 UR 后回到 1%。100 发（10 个十连）没出 = 11%。
export const GACHA_UR_RATE_START = 1;
export const GACHA_UR_RATE_STEP = 1;
export const GACHA_UR_RATE_MAX = 100;

/** 顺序即显示顺序；p 之和必须为 1 */
export const GACHA_RARITIES = [
  { id: 'N', name: 'N', p: 0.49, points: 1, color: '#8fd3ff' },
  // 第二百二十四轮：用户要求 R 3→5、SR 10→20、SSR 30→60、UR 80→300
  { id: 'R', name: 'R', p: 0.35, points: 5, color: '#7cffb2' },
  { id: 'SR', name: 'SR', p: 0.10, points: 20, color: '#c08bff' },
  { id: 'SSR', name: 'SSR', p: 0.05, points: 60, color: '#ffd45e' },
  { id: 'UR', name: 'UR', p: 0.01, points: 300, color: '#ff7bd5' },
];

export const GACHA_POINTS = Object.fromEntries(
  GACHA_RARITIES.map((r) => [r.id, r.points]),
);

/**
 * 把"UR 总概率"换算成五档权重。其余四档按原比例缩小，保证总和为 1。
 * urRate=1 时和旧的固定概率完全一致。
 */
export function gachaWeights(urRate = GACHA_UR_RATE_START) {
  const ur = Math.max(0, Math.min(100, Number(urRate) || 0)) / 100;
  const rest = 1 - ur;
  const baseSum = GACHA_RARITIES
    .filter((r) => r.id !== 'UR')
    .reduce((s, r) => s + r.p, 0) || 1;
  const out = {};
  for (const def of GACHA_RARITIES) {
    out[def.id] = def.id === 'UR' ? ur : (def.p / baseSum) * rest;
  }
  return out;
}

export function rollGachaRarity(rng, urRate = GACHA_UR_RATE_START) {
  const weights = gachaWeights(urRate);
  let r = rng.next();
  for (const def of GACHA_RARITIES) {
    r -= weights[def.id] || 0;
    if (r <= 0) return def.id;
  }
  return 'N';
}

/**
 * 抽一次十连。
 *
 * @param {RNG} rng
 * @param {number} pity 当前"距上次 SSR/UR"的抽数（0..99+）
 * @returns {{cards:Array<{rarity:string,points:number,index:number,guaranteed:boolean,pityForced:boolean}>, pityAfter:number}}
 */
export function rollTenPull(rng, pity = 0, urRate = GACHA_UR_RATE_START) {
  const rate = Math.max(GACHA_UR_RATE_START, Math.min(GACHA_UR_RATE_MAX, Number(urRate) || GACHA_UR_RATE_START));
  const cards = [];
  let sinceSSR = Math.max(0, Math.floor(Number(pity) || 0));
  let hasSRPlus = false;
  let hasUR = false;

  for (let i = 0; i < 10; i++) {
    let rarity;
    let pityForced = false;
    // 100 抽保底：连续 99 抽没有 SSR/UR，这一抽（第 100 抽）必出 SSR。
    // UR 概率被动态拉到 100% 时，保底直接给 UR。
    if (sinceSSR >= 99) {
      rarity = rate >= GACHA_UR_RATE_MAX ? 'UR' : 'SSR';
      pityForced = rarity === 'SSR';
    } else {
      rarity = rollGachaRarity(rng, rate);
    }
    if (rarity === 'SSR' || rarity === 'UR') sinceSSR = 0;
    else sinceSSR += 1;
    if (rarity === 'SR' || rarity === 'SSR' || rarity === 'UR') hasSRPlus = true;
    if (rarity === 'UR') hasUR = true;
    cards.push({
      index: i,
      rarity,
      points: GACHA_POINTS[rarity] ?? 1,
      guaranteed: false,
      pityForced,
    });
  }

  // 10 抽保底 1 个 SR：整组都没有 SR 及以上 → 最后一张变 SR。
  // 注意：UR 也算 SR+；如果最后一张被改成 SR，不能影响 hasUR 的判定
  // （UR 只会更早出现在卡组里，保底不会把它降级）。
  if (!hasSRPlus) {
    const last = cards[cards.length - 1];
    last.rarity = 'SR';
    last.points = GACHA_POINTS.SR;
    last.guaranteed = true;
  }

  return {
    cards,
    pityAfter: sinceSSR,
    urRate: rate,
    urRateAfter: hasUR
      ? GACHA_UR_RATE_START
      : Math.min(GACHA_UR_RATE_MAX, rate + GACHA_UR_RATE_STEP),
    hasUR,
  };
}

/** 一整组卡折算的能力点数 */
export function totalGachaPoints(cards) {
  let sum = 0;
  for (const c of cards || []) sum += GACHA_POINTS[c?.rarity] ?? 0;
  return sum;
}