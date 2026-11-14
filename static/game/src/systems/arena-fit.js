// ============================================================
// 第二百一十九轮：演出战场地按视口自适应
//
// 用户反馈：
//   "大排档椅子boss战地图场景有点靠上，就是整体上面会出去一些看不到，
//    角色和boss是可以上去导致看不到的。查一下是我的屏幕分辨率问题还是
//    哪里有bug。"
//   "魂5的场景也是正式游玩感觉小了一些，看看是我的错觉还是改出来了bug。"
//
// 原因不是分辨率，而是固定尺寸：
//   · 维吉尔 ARENA = 1120×1000（cy=-80）—— 1000 > 1280×800 的 800，
//     上下各 100px 永远在屏幕外；镜头又锁死中心，玩家/椅子走到边上就消失。
//   · 魂5 ARENA = 1120×720 —— 在 1280×800 里只剩 40px 边距，显得局促。
//
// 修法：
//   1) 每场战斗开始前把 ARENA 收敛到**当前视口**以内（留 margin）；
//   2) 垂直居中（cy=0）—— 旧场景整体偏上，正是用户看到的上方出框；
//   3) 保留一份 _base 原始尺寸，换分辨率/下一场重新 fit 时仍从设计值换算，
//      不会越缩越小。
// ============================================================

/**
 * 把场地收进视口并垂直居中。
 * @param {{cx:number,cy:number,hw:number,hh:number}} arena 会被原地修改
 * @param {{viewW:number,viewH:number}} camera
 * @param {number} [margin] 场地边缘与屏幕边缘的最小留白（px）
 */
export function fitArenaToViewport(arena, camera, margin = 24) {
  if (!arena || !camera) return arena;
  if (!arena._base) {
    arena._base = { cx: arena.cx, cy: arena.cy, hw: arena.hw, hh: arena.hh };
  }
  const base = arena._base;
  const vw = Number(camera.viewW) || 1280;
  const vh = Number(camera.viewH) || 720;
  arena.cx = base.cx;
  // 垂直居中：镜头锁中心时，arena 的上下边界必须对称落在视口内。
  arena.cy = 0;
  arena.hw = Math.max(260, Math.min(base.hw, vw / 2 - margin));
  arena.hh = Math.max(180, Math.min(base.hh, vh / 2 - margin));
  return arena;
}

/** 还原到设计尺寸（测试/换场时用；正常流程不需要）。 */
export function resetArena(arena) {
  if (!arena || !arena._base) return arena;
  arena.cx = arena._base.cx;
  arena.cy = arena._base.cy;
  arena.hw = arena._base.hw;
  arena.hh = arena._base.hh;
  return arena;
}