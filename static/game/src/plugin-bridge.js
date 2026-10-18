// ============================================================
// plugin-bridge.js — 第一百二十四轮：插件环境 ↔ 官方猫娘通道
//
// 用户转述官方开发者的说法：插件可以通过官方插件通信接口请求宿主去
// 播放语音和展示 Live2D —— 正确姿势不是前端去读 /static/ 的模型文件
// （沙箱跨域拦死），而是：
//
//   游戏页面（与插件服务同源 48916）
//     → POST /plugin/neko_survivors/hosted-ui/action/game_event
//       （同源 fetch，插件管理器自带的 action 通道）
//     → 插件 Python 壳 @plugin_entry game_event
//     → SDK push_message(visibility=["chat"], ai_behavior="respond")
//     → 官方猫娘在聊天界面生成一段播报/吐槽（自带官方 Live2D 形象 + TTS）
//
// 不在插件环境（本地浏览器 / 48911 部署）时 init() 探测失败，
// 整个桥静默禁用，零开销。
// ============================================================

/**
 * 第一百二十七轮：基址不再写死 —— 运行时从页面路径推导。
 * 游戏就跑在插件面板的 iframe 里，pathname 一定是 /plugin/<id>/ui/...；
 * 从这里截出 /plugin/<id>，再拼出 action 探活 URL，并用 new URL(...,origin)
 * 绝对化 —— 杜绝任何"相对路径被页面基址吃掉前缀"的可能。
 * （用户抓包：请求打到了 hosted-ui/action/game_event —— 少了插件前缀；
 *   无论根因是缓存还是解析，这一版都会把完整 URL 打进控制台。）
 */
function deriveBase() {
  try {
    const m = location.pathname.match(/^(\/plugin\/[^/]+)\/ui\//);
    if (m) return m[1];
  } catch { /* 忽略，走兜底 */ }
  return '/plugin/neko_survivors';
}

const BASE = deriveBase();
const ABS = (path) => new URL(path, location.origin).href;
const ACTION_URL = (action) => ABS(`${BASE}/hosted-ui/action/${action}`);
const PROBE_URL = ABS(`${BASE}/ui-info`);

export const pluginBridge = {
  enabled: false,
  /** 各事件的上报时间（秒），客户端侧限频 */
  _last: new Map(),

  /** 探测是否跑在插件面板里（同源探活，失败即禁用） */
  async init() {
    try {
      console.log('[neko-bridge] 探活 URL：', PROBE_URL, '（页面路径：', location.pathname, '）');
      const r = await fetch(PROBE_URL, { method: 'GET' });
      this.enabled = r.ok;
    } catch {
      this.enabled = false;
    }
    console.log(`[neko-bridge] 探活结果 → ${this.enabled ? '命中，桥启用' : '未命中，桥禁用（本地/宿主环境走原通道）'}`);
    return this.enabled;
  },

  /**
   * 上报一个游戏事件给官方猫娘。
   * @param {string} event  事件类型（start / boss / end）
   * @param {string} text   给猫娘看的战况描述（她会用自己的口吻播报）
   * @param {number} [minGapSec] 同类事件最小间隔（客户端侧限频）
   */
  report(event, text, minGapSec = 30) {
    this._post('game_event', { event, text }, minGapSec, event);
  },

  /**
   * 照念台词 —— 走宿主官方 TTS（/api/game/<type>/speak 的 B 层输出通道，
   * 和内置小游戏台词同一条管线）。宠物业/天气台词、各种 _nekoSay 固定
   * 台词都从这里出声。
   * 第一百二十八轮：**去掉 CD** —— 官方 TTS 不走 LLM、完全免费，限频只会
   * 把密集台词（隐藏 Boss 战的连发提示）整句吞掉；排队/打断交给官方管线。
   */
  say(text) {
    this._post('speak', { text: String(text || '').slice(0, 300) }, 0, 'speak');
  },

  /** 统一限频 POST action（fire-and-forget；minGapSec<=0 表示不限） */
  _post(action, args, minGapSec, gapKey) {
    if (!this.enabled) return;
    const now = Date.now() / 1000;
    const key = gapKey || action;
    if (minGapSec > 0) {
      const last = this._last.get(key) || 0;
      if (now - last < minGapSec) {
        console.log(`[neko-bridge] ${action} 被客户端限频吞掉（距上次 ${Math.round(now - last)}s < ${minGapSec}s）`);
        return;
      }
      this._last.set(key, now);
    }
    const url = ACTION_URL(action);
    console.log(`[neko-bridge] → POST ${url}:`, args);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args, kind: 'panel' }),
    }).then((r) => {
      if (!r.ok) {
        console.warn(`[neko-bridge] ${action} 响应 ${r.status}（404/409 多为插件没在运行 —— 去插件面板把 neko_survivors 启动起来）`);
      } else {
        console.log(`[neko-bridge] ${action} → 已受理`);
      }
    }).catch((e) => {
      console.warn('[neko-bridge] 请求失败：', e && e.message);
    });
  },

  /** 事件 → 给猫娘看的战况一句话（她会用自己口吻重新播报） */
  formatEvent(event, ctx = {}) {
    const LABELS = {
      run_start: '新一轮围攻开始了',
      wave_start: '进入了新的一波',
      level_up: '升了一级',
      low_hp: '血量见底了',
      boss_spawn: 'Boss 登场了',
      boss_phase: 'Boss 进入了更强的阶段',
      boss_kill: '把 Boss 打倒了',
      weapon_combo: '武器合成了更高品质',
      death: '这一轮没能撑住',
      win: '撑过了全部围攻，通关了',
    };
    const label = LABELS[event] || '战况更新';
    const bits = [];
    if (ctx.wave) bits.push(`第 ${ctx.wave} 波`);
    if (ctx.difficultyName) bits.push(ctx.difficultyName);
    if (ctx.characterName) bits.push(`操纵${ctx.characterName}`);
    if (ctx.bossName) bits.push(`对手是 ${ctx.bossName}`);
    // 第一百三十五轮：新波开播报不再报血量 —— 新回合开始必然满血，
    // "血量 100%"是废话（用户："每次都播报血量有点没意义……可以改成
    // 其他的"）。改成报等级（有成长感）；其它事件（低血量告警等）
    // 的血量照旧保留，那才是有信息量的时刻。
    const isWaveStart = event === 'wave_start';
    if (!isWaveStart && typeof ctx.hpRatio === 'number') bits.push(`血量 ${Math.round(ctx.hpRatio * 100)}%`);
    if (ctx.level != null) bits.push(`已到 Lv ${ctx.level}`);
    if (ctx.kills != null) bits.push(`击杀 ${ctx.kills}`);
    if (ctx.weaponName) bits.push(`主武器 ${ctx.weaponName}`);
    return `${label}（${bits.join('，')}）`;
  },
};
