// ============================================================
// 敌人状态系统（第二百零一轮：火焰 / 冰冻系列武器的底座）
//
// 用户需求（原话摘要）：
//   · 火焰：点燃怪物，点燃可以在怪物之间相互传染、持续伤害；
//     持续伤害和火焰系武器都吃「元素伤害」加成。
//   · 冰冻：减速；冰冻武器打多了的怪会被暂时冻结；
//     能冻结地面，踩上去的怪减速并冻伤；精英怪有冻结抗性；
//     Boss 不可冻结但可以被大幅减速。
//
// 状态都挂在 enemy.st 上（懒创建，没吃过状态的怪零开销）：
//   burn      点燃：DoT，按 0.5s 一跳；每 0.5s 向周围传染（衰减 + 最多 MAX_GEN 代）
//   slow      减速：乘区，取最强的一个
//   chill     寒意：0~阈值的累积条，同时给线性减速；满了 → 冻结
//   frozen    冻结：不动不攻击（和僵直同款处理），期间受击 ×1.2（碎冰）
//   frostbite 冻伤：DoT（冰面 / 寒意满时），按 0.5s 一跳
//
// 所有 DoT 都走 world.dealDotDamage —— 可以击杀、掉落、记武器伤害，
// 但不触发受击闪白 / 闪避 / 宝箱怪逃跑（takeDamage 的 opts.dot）。
// ============================================================

export const STATUS = {
  tick: 0.5,              // DoT 一跳间隔
  burnSpreadR: 64,        // 传染半径
  burnSpreadMul: 0.8,     // 每一代传染后 DPS 衰减
  burnMaxGen: 4,          // 传染最多传几代（防止一团怪永久互相点燃）
  chillThreshold: 100,    // 小怪冻结阈值
  chillThresholdElite: 180, // 精英冻结阈值（抗性）
  freezeTime: 1.7,        // 小怪冻结时长
  freezeTimeElite: 0.9,   // 精英冻结时长
  freezeImmune: 3.5,      // 解冻后的免冻窗口（防控死）
  chillDecayDelay: 1.2,   // 多久没再挨冰就开始散寒
  chillDecayRate: 30,     // 寒意每秒衰减
  shatterMul: 1.2,        // 冻结中受到伤害倍率
  slowFloor: 0.2,         // 小怪最低速度倍率
  slowFloorElite: 0.35,   // 精英
  slowFloorBoss: 0.45,    // Boss 被大幅减速也不会停
  chillMaxSlow: 0.5,      // 寒意满时线性减速（速度 ×0.5）
};

export function ensureStatus(e) {
  if (!e.st) {
    e.st = {
      burnT: 0, burnDps: 0, burnGen: 0, burnSrc: null, burnTick: 0, burnSpread: 0,
      slowT: 0, slowMul: 1,
      chill: 0, chillIdle: 0, frozenT: 0, freezeImmune: 0,
      biteT: 0, biteDps: 0, biteSrc: null, biteTick: 0,
      fxT: 0,
    };
  }
  return e.st;
}

/** 点燃：同一只怪取更强的 DPS，持续时间刷新到更长者 */
export function applyIgnite(e, dps, dur, src, gen = 0) {
  if (!e || e.dead || !(dps > 0)) return false;
  const st = ensureStatus(e);
  if (st.burnT > 0 && st.burnDps > dps) {
    st.burnT = Math.max(st.burnT, dur * 0.6);   // 弱火只能续一点命
    return false;
  }
  const fresh = st.burnT <= 0;
  st.burnDps = dps;
  st.burnT = Math.max(st.burnT, dur);
  st.burnGen = gen;
  st.burnSrc = src;
  if (fresh) { st.burnTick = STATUS.tick * 0.5; st.burnSpread = 0.35; }
  return fresh;
}

/** 减速：mul<1，取最强；持续时间取更长 */
export function applySlow(e, mul, dur) {
  if (!e || e.dead) return;
  const st = ensureStatus(e);
  if (mul < st.slowMul || st.slowT <= 0) { st.slowMul = mul; }
  st.slowT = Math.max(st.slowT, dur);
}

/** 寒意累积；满值冻结（Boss 不可冻结，只顶满线性减速） */
export function applyChill(e, amount, src, world) {
  if (!e || e.dead || !(amount > 0)) return false;
  const st = ensureStatus(e);
  if (st.freezeImmune > 0 || st.frozenT > 0) return false;
  const th = e.boss ? STATUS.chillThreshold : e.elite ? STATUS.chillThresholdElite : STATUS.chillThreshold;
  st.chill = Math.min(th, st.chill + amount);
  st.chillIdle = 0;
  if (st.chill >= th && !e.boss) {
    st.frozenT = e.elite ? STATUS.freezeTimeElite : STATUS.freezeTime;
    st.freezeImmune = STATUS.freezeImmune + st.frozenT;
    st.chill = 0;
    world?.fx?.iceBurst?.(e.x, e.y, e.radius);
    world?.fx?.damageText?.(e.x, e.y - e.radius - 6, '冻结', false, '#bfeaff');
    return true;
  }
  return false;
}

/** 冻伤 DoT */
export function applyFrostbite(e, dps, dur, src) {
  if (!e || e.dead || !(dps > 0)) return;
  const st = ensureStatus(e);
  if (st.biteDps > dps && st.biteT > 0) { st.biteT = Math.max(st.biteT, dur); return; }
  st.biteDps = dps;
  st.biteT = Math.max(st.biteT, dur);
  st.biteSrc = src;
}

/** 状态带来的移动倍率（0 = 冻结） */
export function statusSpeedMul(e) {
  const st = e.st;
  if (!st) return 1;
  if (st.frozenT > 0) return 0;
  let m = 1;
  if (st.slowT > 0) m = st.slowMul;
  if (st.chill > 0) {
    const th = e.elite ? STATUS.chillThresholdElite : STATUS.chillThreshold;
    m = Math.min(m, 1 - STATUS.chillMaxSlow * Math.min(1, st.chill / th));
  }
  const floor = e.boss ? STATUS.slowFloorBoss : e.elite ? STATUS.slowFloorElite : STATUS.slowFloor;
  return Math.max(floor, m);
}

export function isFrozen(e) { return !!(e.st && e.st.frozenT > 0); }
export function isBurning(e) { return !!(e.st && e.st.burnT > 0); }

/** 每帧推进（由 Enemy.update 开头调用） */
export function tickStatus(e, dt, world) {
  const st = e.st;
  if (!st) return;

  if (st.slowT > 0) { st.slowT -= dt; if (st.slowT <= 0) { st.slowT = 0; st.slowMul = 1; } }
  if (st.freezeImmune > 0) st.freezeImmune -= dt;
  if (st.frozenT > 0) {
    st.frozenT -= dt;
    if (st.frozenT <= 0) { st.frozenT = 0; world?.fx?.iceBurst?.(e.x, e.y, e.radius * 0.7, true); }
  } else if (st.chill > 0) {
    st.chillIdle += dt;
    if (st.chillIdle > STATUS.chillDecayDelay) st.chill = Math.max(0, st.chill - STATUS.chillDecayRate * dt);
  }

  // ---- 点燃 ----
  if (st.burnT > 0) {
    st.burnT -= dt;
    st.burnTick -= dt;
    st.burnSpread -= dt;
    // 冻结的怪火会熄（冰火相克：冻结直接灭火）
    if (st.frozenT > 0) { st.burnT = 0; }
    if (st.burnTick <= 0 && st.burnT > -1) {
      st.burnTick += STATUS.tick;
      const src = st.burnSrc;
      if (src && world?.dealDotDamage) {
        world.dealDotDamage(src.player, src.weapon, e, st.burnDps * STATUS.tick, '#ff9a3d');
      }
    }
    if (!e.dead && st.burnSpread <= 0 && st.burnT > 0) {
      st.burnSpread += STATUS.tick;
      if (st.burnGen < STATUS.burnMaxGen && world?.grid) {
        const near = world.grid.query(e.x, e.y, STATUS.burnSpreadR + e.radius, []);
        for (const o of near) {
          if (o === e || !o.isEnemy || o.dead) continue;
          if (isBurning(o) && o.st.burnDps >= st.burnDps * STATUS.burnSpreadMul) continue;
          applyIgnite(o, st.burnDps * STATUS.burnSpreadMul, Math.min(st.burnT + 0.8, 3.5), st.burnSrc, st.burnGen + 1);
        }
      }
    }
    if (st.burnT <= 0) { st.burnT = 0; st.burnDps = 0; st.burnSrc = null; }
  }

  // ---- 冻伤 ----
  if (st.biteT > 0) {
    st.biteT -= dt;
    st.biteTick -= dt;
    if (st.biteTick <= 0) {
      st.biteTick += STATUS.tick;
      const src = st.biteSrc;
      if (src && world?.dealDotDamage) {
        world.dealDotDamage(src.player, src.weapon, e, st.biteDps * STATUS.tick, '#8fd9f0');
      }
    }
    if (st.biteT <= 0) { st.biteT = 0; st.biteDps = 0; st.biteSrc = null; }
  }

  // ---- 视觉粒子（低频；MOBILE 由 fx 自己裁）----
  st.fxT -= dt;
  if (st.fxT <= 0 && world?.fx) {
    st.fxT = 0.12;
    if (st.burnT > 0) world.fx.emberOn?.(e.x, e.y, e.radius);
    else if (st.biteT > 0 || st.chill > 20) world.fx.frostOn?.(e.x, e.y, e.radius);
  }
}

/**
 * 命中时按武器定义施加状态（由 world.dealDamage 在命中后调用）。
 * 武器 def 字段：
 *   ignite: { dps, dur }       点燃（dps 是基础值，会吃等级 / 元素加成）
 *   chill:  number              寒意累积
 *   slow:   { mul, dur }        减速
 *   bite:   { dps, dur }        冻伤
 */
export function applyWeaponStatus(world, player, weapon, target) {
  const def = weapon?.def;
  if (!def || !target?.isEnemy || target.dead) return;
  const src = { player, weapon };
  const mul = weapon.computeStatusMul ? weapon.computeStatusMul(player) : 1;
  if (def.ignite) {
    const fresh = applyIgnite(target, def.ignite.dps * mul, def.ignite.dur, src, 0);
    if (fresh) world.fx?.emberOn?.(target.x, target.y, target.radius, 4);
  }
  if (def.slow) applySlow(target, def.slow.mul, def.slow.dur);
  if (def.bite) applyFrostbite(target, def.bite.dps * mul, def.bite.dur, src);
  if (def.chill) applyChill(target, def.chill, src, world);
}
