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

const BASE = '/plugin/neko_survivors';
const ACTION_URL = `${BASE}/hosted-ui/action/game_event`;
const PROBE_URL = `${BASE}/ui-info`;

export const pluginBridge = {
  enabled: false,
  /** 各事件的上报时间（秒），客户端侧限频 */
  _last: new Map(),

  /** 探测是否跑在插件面板里（同源探活，失败即禁用） */
  async init() {
    try {
      const r = await fetch(PROBE_URL, { method: 'GET' });
      this.enabled = r.ok;
    } catch {
      this.enabled = false;
    }
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
   * 第一百二十五轮：照念台词 —— 走宿主官方 TTS（/api/game/<type>/speak
   * 的 B 层输出通道，和内置小游戏台词同一条管线）。宠物业/天气台词、
   * 各种 _nekoSay 固定台词都从这里出声。
   */
  say(text, minGapSec = 3) {
    this._post('speak', { text: String(text || '').slice(0, 200) }, minGapSec, 'speak');
  },

  /** 统一限频 POST action（fire-and-forget） */
  _post(action, args, minGapSec, gapKey) {
    if (!this.enabled) return;
    const now = Date.now() / 1000;
    const key = gapKey || action;
    const last = this._last.get(key) || 0;
    if (now - last < minGapSec) return;
    this._last.set(key, now);
    fetch(`${BASE}/hosted-ui/action/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args, kind: 'panel' }),
    }).catch(() => { /* 插件没起/离线：静默 */ });
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
    if (typeof ctx.hpRatio === 'number') bits.push(`血量 ${Math.round(ctx.hpRatio * 100)}%`);
    if (ctx.kills != null) bits.push(`击杀 ${ctx.kills}`);
    if (ctx.weaponName) bits.push(`主武器 ${ctx.weaponName}`);
    return `${label}（${bits.join('，')}）`;
  },
};
