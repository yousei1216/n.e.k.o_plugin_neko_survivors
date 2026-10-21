2P 角色技能"每回合"效果全面修复：
用户实测："2p的悠怡的猫的步伐不会刷新，只生效过一次之后的新回合都是直接死""如果猫的步伐不刷新，是不是阎魔刀也不刷新？刷新效果不再2p角色身上生效？"——全部命中。
1. 猫的步伐：_beginWave 的 charRt.onRoundStart() 只调了 P1，2P 悠怡的 lethalUsedThisRound 卡在 1，锁血一次后每个新回合直接死（双死重开时 P2 重建实例才"看起来好了"）。改为遍历 world.players() 全员重置（库洛毒舌表、Neon 炮台叠层同步受益）。
2. 阎魔刀：触发条件与 playerUltWave 标志都只认 P1——2P 装了 yamato 永不放。现在 P2 自己判触发（!dead !downed、<50% 血、p2UltWave 独立计数），演出复用同一段次元斩。
3. 回合收益顺手修：onRoundEnd（悠怡+2收获）与 luckHarvest（萌妹幸运转化）也只结算 P1，2P 的回合收益此前一直没发——现在 duo 全员结算。
全量回归全绿。
