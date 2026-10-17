"""game_event 官方猫娘播报通道的行为测试（本地无 SDK，走兜底壳）。"""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path


def _load_plugin_class():
    root = Path(__file__).resolve().parents[1]
    # 目录名带前缀不能直接 import，按文件路径加载
    import importlib.util
    spec = importlib.util.spec_from_file_location("neko_survivors_pkg", root / "__init__.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.SurvivorsPlugin


def _make():
    log: list = []
    cls = _load_plugin_class()
    p = object.__new__(cls)
    p._last_event_at = {}
    p._last_any_at = 0.0

    def fake_push(**kwargs):
        log.append(kwargs)

    p.push_message = fake_push  # 实例属性遮蔽类方法
    return p, log


def test_game_event_pushes_respond_message():
    p, log = _make()
    r = asyncio.run(p.game_event(event="boss_spawn", text="第 10 波，Boss 登场"))
    assert getattr(r, "data", None) == {"status": "queued"}
    assert len(log) == 1
    kw = log[0]
    assert kw["visibility"] == ["chat"]
    assert kw["ai_behavior"] == "respond"        # 官方猫娘会真的开口（自带形象+TTS）
    assert kw["source"] == "neko_survivors"
    assert "第 10 波" in kw["parts"][0]["text"]


def test_throttle_same_event_and_global_gap():
    p, log = _make()
    asyncio.run(p.game_event(event="boss_spawn", text="Boss 登场"))
    r = asyncio.run(p.game_event(event="boss_spawn", text="又来"))
    assert getattr(r, "data", {}).get("status") == "throttled"
    r2 = asyncio.run(p.game_event(event="boss_kill", text="打倒了"))  # 全局间隔未到
    assert getattr(r2, "data", {}).get("status") == "throttled"
    assert len(log) == 1


def test_empty_text_rejected():
    p, log = _make()
    r = asyncio.run(p.game_event(event="win", text="   "))
    assert not hasattr(r, "data") or getattr(r, "data", None) is None  # Err 分支
    assert len(log) == 0


def test_manifest_and_bridge_pins():
    root = Path(__file__).resolve().parents[1]
    toml = (root / "plugin.toml").read_text(encoding="utf-8")
    assert 'id = "neko_survivors"' in toml
    assert 'entry = "plugin.plugins.neko_survivors:SurvivorsPlugin"' in toml
    init = (root / "__init__.py").read_text(encoding="utf-8")
    assert 'id="game_event"' in init
    assert 'ai_behavior="respond"' in init
    bridge = (root / "static" / "game" / "src" / "plugin-bridge.js").read_text(encoding="utf-8")
    assert "hosted-ui/action/game_event" in bridge   # 同源 action 通道
    assert "fetch('/static" not in bridge            # 不再跨域读静态模型资源
