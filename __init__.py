"""猫娘姐妹：幸存者（N.E.K.O 插件）

自带完整游戏的弹幕生存肉鸽。游戏本体是纯静态 HTML/JS，全部打包在插件的
``static/game/`` 下，由插件面板（/plugin/neko_survivors/ui/）直接伺服 ——
打开面板就是游戏，无需联网、无需配置、无需任何第三方依赖。

Python 壳只承担插件必需的入口类（打包工具会 import 它生成
plugin.meta.json），不承载任何游戏逻辑。
"""

from __future__ import annotations

try:  # 官方打包/运行环境：真实 SDK
    from plugin.sdk.plugin import NekoPluginBase, neko_plugin
except ModuleNotFoundError:  # 本地跑测试（无 NEKO SDK）时的等价兜底
    def neko_plugin(cls):  # type: ignore[misc]
        return cls

    class NekoPluginBase:  # type: ignore[no-redef]
        def __init__(self, ctx=None):
            self.ctx = ctx


@neko_plugin
class SurvivorsPlugin(NekoPluginBase):
    """猫娘姐妹：幸存者。"""

    def __init__(self, ctx=None):
        super().__init__(ctx)
