团灭后天彗龙 BGM 不停修复（用户："团灭了之后天彗龙的bgm一直持续没停过"）：
根因：comet 的 BGM 是独立 audio 元素（刻意不进 audio 的场景通道，回合结束由 onWaveEnd 显式停），而团灭走 _endRun —— 它只调 audio.stopMusic()，管不到这个独立元素，结算页就一直压着 comet_bgm 和 end 曲双重奏。
修：_endRun（团灭/通关/退出三条路径的统一入口）里显式 comet.stopBgm()，之后正常播结算曲。
全量回归全绿。
