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

export function rollGachaRarity(rng) {
  let r = rng.next();
  for (const def of GACHA_RARITIES) {
    r -= def.p;
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
export function rollTenPull(rng, pity = 0) {
  const cards = [];
  let sinceSSR = Math.max(0, Math.floor(Number(pity) || 0));
  let hasSRPlus = false;

  for (let i = 0; i < 10; i++) {
    let rarity;
    let pityForced = false;
    // 100 抽保底：连续 99 抽没有 SSR/UR，这一抽（第 100 抽）必出 SSR。
    if (sinceSSR >= 99) {
      rarity = 'SSR';
      pityForced = true;
    } else {
      rarity = rollGachaRarity(rng);
    }
    if (rarity === 'SSR' || rarity === 'UR') sinceSSR = 0;
    else sinceSSR += 1;
    if (rarity === 'SR' || rarity === 'SSR' || rarity === 'UR') hasSRPlus = true;
    cards.push({
      index: i,
      rarity,
      points: GACHA_POINTS[rarity] ?? 1,
      guaranteed: false,
      pityForced,
    });
  }

  // 10 抽保底 1 个 SR：整组都没有 SR 及以上 → 最后一张变 SR。
  // （如果最后一张本来就被 SSR 保底占了，hasSRPlus 已经为 true，不会触发。）
  if (!hasSRPlus) {
    const last = cards[cards.length - 1];
    last.rarity = 'SR';
    last.points = GACHA_POINTS.SR;
    last.guaranteed = true;
  }

  return { cards, pityAfter: sinceSSR };
}

/** 一整组卡折算的能力点数 */
export function totalGachaPoints(cards) {
  let sum = 0;
  for (const c of cards || []) sum += GACHA_POINTS[c?.rarity] ?? 0;
  return sum;
}