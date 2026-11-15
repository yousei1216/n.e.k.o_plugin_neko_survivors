// ============================================================
// 第二百二十一轮：T4「他猫之力」—— 额外获得一位猫娘的能力与技能
//
// 用户："开局随机获得一个其他猫娘的能力（0/1）（具体效果就是随机获得
//       一个除玩家所选角色之外的剩下7个角色的随机一个角色的能力和技能。）"
//
// 实现方式：给玩家挂一个**第二份 CharRuntime**（player.extraCharRt），
// 不替换原角色；它的 id/def/params 指向随机到的另一位猫娘。
// 被动数值（statsFinalMul / statMul / luckEffectMul）在这里直接叠加；
// 主动技能的钩子由 player / weapon / turret / world / main 在原有
// charRt 调用的地方**同时调用 extraCharRt**（见各文件的 "第二百二十一轮"）。
//
// 只给 P1 发放（T3/T4 是玩家的局外成长，不给 AI 队友重复计算）。
// ============================================================

import { CharRuntime } from './char-runtime.js';
import { getCharSkill } from '../data/char-skills.js';

/**
 * 给玩家附加另一位猫娘的能力。
 * @param {Player} player
 * @param {string} charId 另一位猫娘的 id（与玩家当前角色相同则忽略）
 * @returns {CharRuntime|null}
 */
export function grantExtraCharacter(player, charId) {
  if (!player || !player.stats || !charId) return null;
  if (charId === player.characterId) return null;
  const def = getCharSkill(charId);
  if (!def) return null;

  // ---- 被动数值（与 Player 构造函数里的角色初始化同口径）----
  if (def.statsFinalMul) {
    for (const k in def.statsFinalMul) {
      player.stats.addFinalMul(k, def.statsFinalMul[k]);
    }
  }
  if (def.statMul) {
    player.charMul = { ...(player.charMul || {}) };
    for (const k in def.statMul) {
      player.charMul[k] = (player.charMul[k] ?? 1) * def.statMul[k];
    }
  }
  if (def.luckEffectMul !== undefined) {
    player.stats.luckEffectMul = (player.stats.luckEffectMul ?? 1) * def.luckEffectMul;
  }
  player.stats.dirty = true;

  // ---- 第二份主动技能运行时 ----
  const rt = new CharRuntime(player);
  rt.id = charId;
  rt.def = def;
  rt.params = def.params || {};
  player.extraCharRt = rt;
  player._t4CharId = charId;
  return rt;
}