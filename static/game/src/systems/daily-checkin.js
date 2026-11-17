// ============================================================
// 第二百三十一轮：每日签到奖励（局外永久，纯逻辑无 DOM / 无存档）
//
// 用户规格（原话要点）：
//   · 每天首次登录获得奖励，连续登录奖励 +10%。
//   · 奖励 5 档：300金币 / 600金币 / 5抽奖券 / 10抽奖券 / 30抽奖券
//     → N / R / SR / SSR / UR。
//   · 概率初始 50/30/15/5/0。连续登录增加除 N 外每档 1%，
//     多出的从 N 扣；例：第 2 天 46/31/16/6/1。以此类推，断签回归。
//   · 概率不够就扣前面的低稀有度扣光为止；连签 100 天 = 100% UR。
//   · 连续签到每天奖励 +10%，最大 +100%；例：第 2 天 N 得 330 金币，
//     连续 10 天后 N 得 600 金币，UR 得 60 抽。
//   · 签到卡 5×2 共 10 格，签到盖小红花；盖满 10 个画一颗小星星，
//     一行最多 10 颗；断签从第一天重新计数。
//
// 本模块只做纯计算，方便 Node 测试。存档字段（main.meta）由 main 负责：
//   checkinLastDate  上次签到日期 'YYYY-MM-DD'
//   checkinStreak    当前连续签到天数（断签归 1）
//   checkinTotal     累计签到次数（统计用）
//   checkinBest      历史最长连续（统计用）
// ============================================================

/** 五档奖励定义；顺序即抽卡累计顺序，也是显示顺序。 */
export const CHECKIN_REWARDS = [
  { id: 'N',   kind: 'coins',   amount: 300, color: '#8fd3ff' },
  { id: 'R',   kind: 'coins',   amount: 600, color: '#7cffb2' },
  { id: 'SR',  kind: 'tickets', amount: 5,   color: '#c08bff' },
  { id: 'SSR', kind: 'tickets', amount: 10,  color: '#ffd45e' },
  { id: 'UR',  kind: 'tickets', amount: 30,  color: '#ff7bd5' },
];

export const REWARD_BY_ID = Object.fromEntries(CHECKIN_REWARDS.map((r) => [r.id, r]));

/** 第 1 天初始概率（百分数），顺序 N/R/SR/SSR/UR，总和 100。 */
export const CHECKIN_BASE_P = [50, 30, 15, 5, 0];

/** 连续签到封顶天数：满 100 天 UR = 100%，再往后不再变化。 */
export const CHECKIN_MAX_DAYS = 100;
/** 奖励倍率封顶：最大 +100%（即 ×2.0）。 */
export const CHECKIN_MAX_BONUS_STEPS = 10;
/** 签到卡格子数（5×2）。 */
export const CHECKIN_CELLS = 10;
/** 星星一行最多 10 颗（= 100 天 = 100% UR）。 */
export const CHECKIN_MAX_STARS = 10;

/** 连续天数钳制到 [1,100]。 */
export function clampStreak(streak) {
  const d = Math.floor(Number(streak) || 0);
  if (!Number.isFinite(d) || d < 1) return 1;
  return Math.min(CHECKIN_MAX_DAYS, d);
}

/**
 * 连续签到奖励倍率：每天 +10%，最大 +100%。
 *   第 1 天 = 1.0；第 2 天 = 1.1；第 11 天 = 2.0；之后恒 2.0。
 */
export function checkinMultiplier(streak) {
  const d = clampStreak(streak);
  return 1 + Math.min(d - 1, CHECKIN_MAX_BONUS_STEPS) * 0.1;
}

/**
 * 连续第 d 天的五档概率（百分数对象）。
 *
 * 逐步推演：每步给 R/SR/SSR/UR 各 +1（共 +4），再从 N→R→SR→SSR
 * 依次征收 4 点；N 扣光后自然从低稀有度往高继续扣，"扣光为止"。
 * UR 从不参与征收，所以每天稳涨 1%，最终独占 100%。
 */
export function checkinRates(streak) {
  const d = clampStreak(streak);
  if (d >= CHECKIN_MAX_DAYS) return { N: 0, R: 0, SR: 0, SSR: 0, UR: 100 };
  const p = CHECKIN_BASE_P.slice();
  const steps = d - 1;
  for (let s = 0; s < steps; s++) {
    p[1] += 1; p[2] += 1; p[3] += 1; p[4] += 1;
    let need = 4;
    for (let i = 0; i < 4 && need > 0; i++) {
      const take = Math.min(p[i], need);
      p[i] -= take;
      need -= take;
    }
    // 低档全空仍不够扣时（UR 已满），从 UR 回收以守恒 100%。
    if (need > 0) p[4] = Math.max(0, p[4] - need);
  }
  return { N: p[0], R: p[1], SR: p[2], SSR: p[3], UR: p[4] };
}

/**
 * 签到卡视觉状态：小红花章数 + 小星星数。
 * 10 格为一轮：满 10 格画一颗星，下一轮从第 1 格重新盖；
 * 星星累计（一行最多 10 颗 = 100 天 = 100% UR）。断签（streak 归 1）全部清零。
 */
export function checkinCardState(streak) {
  const d = clampStreak(streak);
  return {
    stamps: ((d - 1) % CHECKIN_CELLS) + 1,
    stars: Math.min(Math.floor(d / CHECKIN_CELLS), CHECKIN_MAX_STARS),
  };
}

/** 按概率抽一档。rng.next() ∈ [0,1)。 */
export function rollCheckinRarity(rng, streak) {
  const rates = checkinRates(streak);
  let r = (rng?.next ? rng.next() : Math.random()) * 100;
  for (const def of CHECKIN_REWARDS) {
    r -= rates[def.id] || 0;
    if (r <= 0) return def.id;
  }
  // 浮点兜底：概率全为 0 的边界（不会发生）退回 UR。
  return 'UR';
}

/**
 * 签到一次的结果（纯计算，不改存档）：
 *   { rarity, kind, amount, multiplier, streak, rates }
 */
export function checkinGrant(rarity, streak) {
  const def = REWARD_BY_ID[rarity] || REWARD_BY_ID.N;
  const d = clampStreak(streak);
  const multiplier = checkinMultiplier(d);
  return {
    rarity: def.id,
    kind: def.kind,
    amount: Math.round(def.amount * multiplier),
    base: def.amount,
    multiplier,
    streak: d,
    rates: checkinRates(d),
  };
}

/** 本地日期键 'YYYY-MM-DD'（本地时区，不用 toISOString 的 UTC 偏移）。 */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 两个日期键相差的天数（b - a），按本地日历。 */
export function dayDiffDays(a, b) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  };
  const ta = parse(a), tb = parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN;
  return Math.round((tb - ta) / 86400000);
}

/**
 * 根据上次签到日期与今天，算出本次签到后的连续天数。
 *   - 今天已签（diff=0）→ already=true，streak 不变
 *   - 昨天签过（diff=1）→ streak+1
 *   - 更早 / 首次 / 日期非法 → streak=1（断签回归）
 */
export function nextStreak(lastDate, today, curStreak = 0) {
  const diff = dayDiffDays(lastDate, today);
  const prev = clampStreak(curStreak);
  if (diff === 0) return { streak: prev, already: true };
  if (diff === 1) return { streak: Math.min(CHECKIN_MAX_DAYS, prev + 1), already: false };
  return { streak: 1, already: false };
}
