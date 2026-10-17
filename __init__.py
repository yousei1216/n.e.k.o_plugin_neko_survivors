"""猫娘姐妹：幸存者（N.E.K.O 插件）

自带完整游戏的弹幕生存肉鸽。游戏本体是纯静态 HTML/JS，全部打包在插件的
``static/game/`` 下，由插件面板（/plugin/neko_survivors/ui/）直接伺服。

官方猫娘通道（第一百二十四轮，官方开发者确认的正确姿势）：

    游戏页面（与插件服务同源）
      → POST /plugin/neko_survivors/hosted-ui/action/game_event
        （插件管理器自带的 action 通道，同源 fetch 无跨域问题）
      → 本插件 @plugin_entry game_event
      → SDK push_message(visibility=["chat"], ai_behavior="respond")
      → 官方猫娘在聊天界面生成播报/吐槽 —— 形象与语音都走 NEKO 自己的
        Live2D / TTS 管线，对下载插件的所有用户可用

之前试图在前端直接读 /static/ 下的模型文件，被沙箱跨域拦截 —— 那条路
本来就是错的；宿主的形象和语音只接受消息平面这一类官方接口驱动。

Python 壳的其余职责：插件必需的入口类（打包工具 import 它生成
plugin.meta.json）。
"""

from __future__ import annotations

import time

try:  # 官方打包/运行环境：真实 SDK
    from plugin.sdk.plugin import Err, NekoPluginBase, Ok, SdkError, neko_plugin, plugin_entry, tr, ui
except ModuleNotFoundError:  # 本地跑测试（无 NEKO SDK）时的等价兜底
    def neko_plugin(cls):  # type: ignore[misc]
        return cls

    def plugin_entry(**_kwargs):  # type: ignore[misc]
        def deco(fn):
            return fn
        return deco

    class _UiStub:  # type: ignore[no-redef]
        @staticmethod
        def action(**_kwargs):
            def deco(fn):
                return fn
            return deco

        @staticmethod
        def context(**_kwargs):
            def deco(fn):
                return fn
            return deco

    ui = _UiStub()  # type: ignore[assignment]

    def tr(key, default=None, **_kwargs):  # type: ignore[misc]
        return default

    class Err:  # type: ignore[no-redef]
        def __init__(self, error=None):
            self.error = error

    class Ok:  # type: ignore[no-redef]
        def __init__(self, value=None):
            self.value = value

    class SdkError(Exception):  # type: ignore[no-redef]
        pass

    class NekoPluginBase:  # type: ignore[no-redef]
        def __init__(self, ctx=None):
            self.ctx = ctx


# 每类事件的最小播报间隔（秒）—— ai_behavior="respond" 会真的让模型
# 生成一轮，必须有节流，不然波次事件会烧 token + 刷屏。
_MIN_GAPS: dict[str, float] = {
    "run_start": 10.0,
    "wave_start": 45.0,
    "level_up": 30.0,
    "low_hp": 60.0,
    "boss_spawn": 30.0,
    "boss_phase": 30.0,
    "boss_kill": 15.0,
    "weapon_combo": 45.0,
    "death": 10.0,
    "win": 10.0,
}
_GLOBAL_GAP = 12.0   # 任意两次播报的全局最小间隔


@neko_plugin
class SurvivorsPlugin(NekoPluginBase):
    """猫娘姐妹：幸存者。"""

    def __init__(self, ctx=None):
        super().__init__(ctx)
        self._last_event_at: dict[str, float] = {}
        self._last_any_at = 0.0

    # @ui.action 把这个入口挂进面板 action 白名单 —— 没有它，
    # hosted-ui/action/game_event 会 403 "not exposed by surface"。
    @ui.action(id="game_event", label=tr("entries.game_event.name", default="游戏战况播报"), icon="gamepad")
    @plugin_entry(
        id="game_event",
        name=tr("entries.game_event.name", default="游戏战况播报"),
        description=tr(
            "entries.game_event.description",
            default="接收游戏内事件（开波/Boss/结算等），让官方猫娘在聊天里播报吐槽。"
                    "由游戏页面自动调用，内置节流。",
        ),
        input_schema={
            "type": "object",
            "properties": {
                "event": {"type": "string", "description": "事件类型（run_start/wave_start/boss_spawn/boss_kill/win/death 等）"},
                "text": {"type": "string", "description": "战况一句话描述（第几波/难度/血量/击杀等）"},
            },
            "required": ["event", "text"],
            "additionalProperties": False,
        },
    )
    async def game_event(self, event: str = "", text: str = "", **_) -> Ok:
        """把游戏战况交给官方猫娘播报（节流后 push_message）。"""
        now = time.monotonic()
        gap = _MIN_GAPS.get(event, 30.0)
        if now - self._last_event_at.get(event, 0.0) < gap:
            return Ok({"status": "throttled", "reason": "event_gap"})
        if now - self._last_any_at < _GLOBAL_GAP:
            return Ok({"status": "throttled", "reason": "global_gap"})
        self._last_event_at[event] = now
        self._last_any_at = now

        safe_text = str(text or "").strip()[:300]
        if not safe_text:
            return Err(SdkError("empty text"))
        self.push_message(
            source="neko_survivors",
            visibility=["chat"],
            ai_behavior="respond",
            parts=[{
                "type": "text",
                "text": (
                    "（主人正在玩你的游戏《猫娘姐妹：幸存者》，一波弹幕生存。"
                    f"现在的战况：{safe_text}。用你自己的口吻说一句话播报或吐槽，"
                    "一句话就好，别复述括号里的格式。）"
                ),
            }],
            metadata={"context_type": "neko_survivors_event", "event": str(event)[:40]},
        )
        return Ok({"status": "queued"})
