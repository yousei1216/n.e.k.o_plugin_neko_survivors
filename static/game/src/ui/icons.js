// ============================================================
// 第二百二十二轮：图标库
//
// 用户："优化一下你新加的中boss掉落奖励图标和主菜单的能力升级图标，
//       不要只是一个字。你设计个好看点的图形代表他吧。"
//
// 统一用 24×24 的线条 SVG：外形描边 + 一块 22% 透明度的同色填充，
// 颜色继承父级 currentColor（卡片的品质色 / 种类色），所以每个图标
// 会自然带上金/紫/蓝/绿等主题色，不再是单调的汉字。
// ============================================================

const paw = `
  <ellipse cx="6.4" cy="9.2" rx="1.7" ry="2.5"/>
  <ellipse cx="10.4" cy="7.6" rx="1.7" ry="2.5"/>
  <ellipse cx="14.8" cy="7.6" rx="1.7" ry="2.5"/>
  <ellipse cx="18.8" cy="9.2" rx="1.7" ry="2.5"/>
  <path d="M12.6 12.2c-4 0-6.4 2.9-5.5 6.2.7 2.4 3.1 3.6 5.5 3.6s4.8-1.2 5.5-3.6c.9-3.3-1.5-6.2-5.5-6.2z"
        fill="currentColor" opacity=".18"/>`;

const icons = {
  spark: `
    <path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"
          fill="currentColor" opacity=".2"/>
    <path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"/>`,

  damage: `
    <path d="M4 4c3.1 1.7 5.4 4.8 6.4 9.1M8.2 3.2c2.6 2.3 4.6 5.8 5.5 10M12.6 3.4c2.1 2.4 3.5 5.7 4.2 9.4"
          fill="none"/>
    <path d="M18.6 3.4l2 2M19.6 2.4l2 2" opacity=".65"/>
    <circle cx="17.4" cy="10.2" r="1.2" fill="currentColor" opacity=".55"/>`,

  attackSpeed: `
    <path d="M13.4 2.2 5.8 13.1h5.1L9.5 21.8l8.7-12.3h-5.2l.4-7.3z"
          fill="currentColor" opacity=".2"/>
    <path d="M13.4 2.2 5.8 13.1h5.1L9.5 21.8l8.7-12.3h-5.2l.4-7.3z"/>
    <path d="M2.6 7.2h3.1M2 10.8h2.7M2.8 14.4h2.2" opacity=".6"/>`,

  melee: `
    <path d="M4.6 19.4 16.8 7.2 20 3.4l.6 3.2-3.4 3.6L5.8 21z"
          fill="currentColor" opacity=".18"/>
    <path d="M4.6 19.4 16.8 7.2 20 3.4M16.8 7.2l3.8 3.4"/>
    <path d="M3.2 16.2l4.6 4.6M3 21l5.4-5.4"/>`,

  ranged: `
    <path d="M3 12h14.5"/>
    <path d="M12.5 6.2 18.6 12l-6.1 5.8"/>
    <circle cx="4.2" cy="12" r="1.4" fill="currentColor" opacity=".6"/>
    <path d="M3 8.2c2.2 1 3.2 2.3 3.2 3.8S5.2 14.8 3 15.8" opacity=".55"/>`,

  element: `
    <path d="M12 3.2c3.3 3.4 4.4 5.8 2.6 8-1 .9-2.2 1.3-2.6 1.3s-1.6-.4-2.6-1.3c-1.8-2.2-.7-4.6 2.6-8z"
          fill="currentColor" opacity=".2"/>
    <path d="M12 3.2c3.3 3.4 4.4 5.8 2.6 8-1 .9-2.2 1.3-2.6 1.3s-1.6-.4-2.6-1.3c-1.8-2.2-.7-4.6 2.6-8z"/>
    <path d="M7.6 14.6c1.6 1 2.4 2 2.4 3.1 0 1.4-1.2 2.6-2.8 2.6s-2.8-1.1-2.8-2.5c0-1 1.5-2.3 3.2-3.2z"/>
    <path d="M16.4 14.6c1.7.9 3.2 2.2 3.2 3.2 0 1.4-1.2 2.5-2.8 2.5s-2.8-1.2-2.8-2.6c0-1.1.8-2.1 2.4-3.1z"/>`,

  crit: `
    <circle cx="12" cy="12" r="5.6"/>
    <path d="M12 2.4v4M12 17.6v4M2.4 12h4M17.6 12h4" opacity=".75"/>
    <path d="M12 8.6l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="currentColor" opacity=".6"/>`,

  critDamage: `
    <path d="M12 2.2l2.1 6.2 6.2 2.1-6.2 2.1L12 18.8l-2.1-6.2-6.2-2.1 6.2-2.1z"
          fill="currentColor" opacity=".2"/>
    <path d="M12 2.2l2.1 6.2 6.2 2.1-6.2 2.1L12 18.8l-2.1-6.2-6.2-2.1 6.2-2.1z"/>
    <path d="M18.6 16.4l3.2 3.2M21.8 16.4l-3.2 3.2" opacity=".7"/>`,

  hp: `
    <path d="M12 20.8S4.3 16.4 3.9 11.4c-.3-3.3 1.8-5.6 4.5-5.6 1.7 0 3 1 3.6 2.2.6-1.2 1.9-2.2 3.6-2.2 2.7 0 4.8 2.3 4.5 5.6-.4 5-8.1 9.4-8.1 9.4z"
          fill="currentColor" opacity=".18"/>
    <path d="M12 20.8S4.3 16.4 3.9 11.4c-.3-3.3 1.8-5.6 4.5-5.6 1.7 0 3 1 3.6 2.2.6-1.2 1.9-2.2 3.6-2.2 2.7 0 4.8 2.3 4.5 5.6-.4 5-8.1 9.4-8.1 9.4z"/>
    <path d="M12 8.7v5.8M9.1 11.6h5.8" opacity=".9"/>`,

  armor: `
    <path d="M12 3.2 19 6v6.2c0 4.1-3 7-7 8.8-4-1.8-7-4.7-7-8.8V6z"
          fill="currentColor" opacity=".18"/>
    <path d="M12 3.2 19 6v6.2c0 4.1-3 7-7 8.8-4-1.8-7-4.7-7-8.8V6z"/>
    <path d="M8.9 6.5 12 5l3.1 1.5M12 9.2v5.1M9.9 11.2l2.1 1.4 2.1-1.4"/>`,

  regen: `
    <path d="M12 20.4S5.2 16.6 4.8 12c-.3-2.9 1.6-4.9 4-4.9 1.5 0 2.6.9 3.2 2 .6-1.1 1.7-2 3.2-2 2.4 0 4.3 2 4 4.9-.4 4.6-7.2 8.4-7.2 8.4z"
          fill="currentColor" opacity=".16"/>
    <path d="M12 20.4S5.2 16.6 4.8 12c-.3-2.9 1.6-4.9 4-4.9 1.5 0 2.6.9 3.2 2 .6-1.1 1.7-2 3.2-2 2.4 0 4.3 2 4 4.9-.4 4.6-7.2 8.4-7.2 8.4z"/>
    <path d="M18.8 4.2a5.8 5.8 0 0 1 2.8 4.6M21.6 3.4v5.4h-5.4" opacity=".8"/>`,

  lifesteal: `
    <path d="M12 2.6s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"
          fill="currentColor" opacity=".18"/>
    <path d="M12 2.6s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>
    <path d="M9.2 14.4a3.1 3.1 0 0 0 2.8 3" opacity=".9"/>`,

  speed: `
    <path d="M3.4 16.4h8.2l3.7-8.8 3.5 1.4-2.9 6.5 2.1 2.9H3.4z"
          fill="currentColor" opacity=".18"/>
    <path d="M3.4 16.4h8.2l3.7-8.8 3.5 1.4-2.9 6.5 2.1 2.9H3.4z"/>
    <path d="M2.2 7.4h3.6M1.6 11h3.1M2.6 14.2h2.4" opacity=".65"/>`,

  dodge: `
    <path d="M3.2 6.2c4.3 0 5.5 3.1 5.5 5.8s-1.2 5.8-5.5 5.8" opacity=".4"/>
    <path d="M8.6 4.4c5 0 6.8 3.9 6.8 7.6s-1.8 7.6-6.8 7.6" opacity=".65"/>
    <path d="M14.2 6.2 20.6 12l-6.4 5.8"/>
    <path d="M20.2 4.2l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" fill="currentColor" opacity=".55"/>`,

  money: `
    <circle cx="12" cy="12" r="7.4" fill="currentColor" opacity=".16"/>
    <circle cx="12" cy="12" r="7.4"/>
    <path d="M9.2 9.2h5.6v5.6H9.2z" opacity=".55"/>
    <path d="M10.2 12h3.6M12 10.2v3.6"/>
    <path d="M12 2.6v1.8M12 19.6v1.8M2.6 12h1.8M19.6 12h1.8" opacity=".55"/>`,

  xp: `
    <path d="M3.6 5.2c3.1-1 5.5-.8 8.4 1v14c-2.9-1.8-5.3-2-8.4-1z"
          fill="currentColor" opacity=".16"/>
    <path d="M3.6 5.2c3.1-1 5.5-.8 8.4 1v14c-2.9-1.8-5.3-2-8.4-1z"/>
    <path d="M20.4 5.2c-3.1-1-5.5-.8-8.4 1v14c2.9-1.8 5.3-2 8.4-1z"/>
    <path d="M16.2 8.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" opacity=".6"/>`,

  luck: `
    <circle cx="8.6" cy="8.6" r="3.2" fill="currentColor" opacity=".16"/>
    <circle cx="15.4" cy="8.6" r="3.2" fill="currentColor" opacity=".16"/>
    <circle cx="8.6" cy="15.4" r="3.2" fill="currentColor" opacity=".16"/>
    <circle cx="15.4" cy="15.4" r="3.2" fill="currentColor" opacity=".16"/>
    <circle cx="8.6" cy="8.6" r="3.2"/><circle cx="15.4" cy="8.6" r="3.2"/>
    <circle cx="8.6" cy="15.4" r="3.2"/><circle cx="15.4" cy="15.4" r="3.2"/>
    <path d="M12 12v8.4M10.2 19.4c1.2-.9 2.4-.9 3.6 0" opacity=".85"/>`,

  harvest: `
    <path d="M4.2 20.2c6.4 0 11.4-5 11.4-11.4" />
    <path d="M7.4 16.6c2.3-1.9 4.6-2.7 6.9-2.5M8.8 13.2c1.9-1.7 3.9-2.4 5.9-2.2M10.4 10c1.5-1.4 3.1-2 4.7-1.9"/>
    <path d="M16.8 3.4c2.6 2.6 3.6 6 2.8 9.2" />
    <path d="M19.6 6.2c-1-1.2-2.2-1.9-3.6-2.1M20.8 10.2c-.8-1.2-1.9-2-3.2-2.3" opacity=".7"/>`,

  pickup: `
    <path d="M5.2 4.2v7.2a6.8 6.8 0 0 0 13.6 0V4.2h-4.2v7.2a2.6 2.6 0 0 1-5.2 0V4.2z"
          fill="currentColor" opacity=".18"/>
    <path d="M5.2 4.2v7.2a6.8 6.8 0 0 0 13.6 0V4.2h-4.2v7.2a2.6 2.6 0 0 1-5.2 0V4.2z"/>
    <path d="M9.4 4.2v4.2M14.6 4.2v4.2M5.2 8.4h4.2M14.6 8.4h4.2" opacity=".8"/>`,

  gift: `
    <rect x="3.2" y="9" width="17.6" height="11.2" rx="2" fill="currentColor" opacity=".16"/>
    <rect x="3.2" y="9" width="17.6" height="11.2" rx="2"/>
    <path d="M3.2 13h17.6M12 9v11.2"/>
    <path d="M8 9c0-2.6 3.4-3.4 4-.8.6-2.6 4-1.8 4 .8" />`,

  weaponUp: `
    <path d="M4.4 19.6 16 8l3.2-4 1 3.2-3.8 3.4L5.6 21z"
          fill="currentColor" opacity=".16"/>
    <path d="M4.4 19.6 16 8l3.2-4 1 3.2-3.8 3.4L5.6 21z"/>
    <path d="M3.2 16.4l4.4 4.4M3 21.2l5-5"/>
    <path d="M19 2.2v5.2M16.4 4.8h5.2" opacity=".8"/>`,

  pet: paw,

  petDmg: paw + `
    <path d="M18.8 2.2l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor" opacity=".7"/>`,

  petPickup: paw + `
    <path d="M18.2 3.2v3.2a2.8 2.8 0 0 0 5.6 0V3.2h-2v3.2a.8.8 0 0 1-1.6 0V3.2z" opacity=".75"/>`,

  petAtkSpeed: paw + `
    <path d="M20.4 1.8 17 7.4h2.6l-.6 3.8 4-5.8h-2.8l.8-3.6z" fill="currentColor" opacity=".6"/>`,

  petRange: paw + `
    <path d="M17.6 4.2h5M20.8 2l2.2 2.2-2.2 2.2" opacity=".8"/>`,

  petSteal: paw + `
    <path d="M17.8 4.4h5.2l-.7 5.2h-3.8z" fill="currentColor" opacity=".25"/>
    <path d="M17.8 4.4h5.2l-.7 5.2h-3.8zM19 4.4a1.4 1.4 0 0 1 2.8 0" opacity=".8"/>`,

  petVuln: paw + `
    <circle cx="20.4" cy="5.2" r="2.8" opacity=".8"/>
    <path d="M20.4 1.4v1.4M20.4 7.6v1.4M16.6 5.2h1.4M22.8 5.2h1.4" opacity=".55"/>`,

  clock: `
    <circle cx="12" cy="12.6" r="7.2" fill="currentColor" opacity=".16"/>
    <circle cx="12" cy="12.6" r="7.2"/>
    <path d="M12 8.4v4.4l3.2 2"/>
    <path d="M7.2 3.6 4.4 6.2M16.8 3.6l2.8 2.6M9 2.4l1 1.4M15 2.4l-1 1.4" opacity=".75"/>`,

  redItem: `
    <path d="M7.2 3.8h9.6l4 6.2-8.8 10.2L3.2 10z" fill="currentColor" opacity=".16"/>
    <path d="M7.2 3.8h9.6l4 6.2-8.8 10.2L3.2 10z"/>
    <path d="M3.2 10h17.6M7.2 3.8 12 10l4.8-6.2M12 10v10.2" opacity=".8"/>`,

  hitbox: `
    <path d="M12 3.2 18.4 6v5.8c0 3.8-2.8 6.6-6.4 8.4-3.6-1.8-6.4-4.6-6.4-8.4V6z"
          fill="currentColor" opacity=".14"/>
    <path d="M12 3.2 18.4 6v5.8c0 3.8-2.8 6.6-6.4 8.4-3.6-1.8-6.4-4.6-6.4-8.4V6z"/>
    <circle cx="12" cy="11" r="2.4" fill="currentColor" opacity=".55"/>
    <path d="M12 3.2 15 4.6" opacity=".6"/>`,

  chaos: `
    <circle cx="12" cy="4.8" r="2.8" fill="currentColor" opacity=".2"/>
    <circle cx="19.2" cy="12" r="2.8" fill="currentColor" opacity=".2"/>
    <circle cx="12" cy="19.2" r="2.8" fill="currentColor" opacity=".2"/>
    <circle cx="4.8" cy="12" r="2.8" fill="currentColor" opacity=".2"/>
    <circle cx="12" cy="4.8" r="2.8"/><circle cx="19.2" cy="12" r="2.8"/>
    <circle cx="12" cy="19.2" r="2.8"/><circle cx="4.8" cy="12" r="2.8"/>
    <path d="M12 7.6v8.8M7.6 12h8.8" opacity=".4"/>`,

  legend: `
    <path d="M3.4 18.2h17.2l1-9.4-5 3.1L12 4.4l-4.6 7.5-5-3.1z"
          fill="currentColor" opacity=".18"/>
    <path d="M3.4 18.2h17.2l1-9.4-5 3.1L12 4.4l-4.6 7.5-5-3.1z"/>
    <circle cx="12" cy="13.2" r="1.5" fill="currentColor" opacity=".7"/>
    <path d="M4.6 20.4h14.8" opacity=".6"/>`,

  extraWeapon: `
    <path d="M4.6 19 15.4 8.2l3-3.8 1 3-3.6 3.2L5.4 21z" fill="currentColor" opacity=".16"/>
    <path d="M4.6 19 15.4 8.2l3-3.8 1 3-3.6 3.2L5.4 21z"/>
    <path d="M3.4 16.2l4.2 4.2M18.2 2.2v4.4M16 4.4h4.4" opacity=".8"/>`,

  extraItem: `
    <rect x="3.4" y="9" width="17.2" height="11" rx="2" fill="currentColor" opacity=".16"/>
    <rect x="3.4" y="9" width="17.2" height="11" rx="2"/>
    <path d="M3.4 13h17.2M12 9v11M8.2 9c0-2.5 3.3-3.3 3.8-.8.5-2.5 3.8-1.7 3.8.8"/>
    <path d="M18.6 2.2v4.4M16.4 4.4h4.4" opacity=".8"/>`,

  extraUpgrade: `
    <path d="M12 2.4l2.3 6.6 6.6 2.3-6.6 2.3L12 20.2l-2.3-6.6-6.6-2.3 6.6-2.3z"
          fill="currentColor" opacity=".18"/>
    <path d="M12 2.4l2.3 6.6 6.6 2.3-6.6 2.3L12 20.2l-2.3-6.6-6.6-2.3 6.6-2.3z"/>
    <path d="M12 8.2v7.6M9.2 11l2.8-2.8 2.8 2.8" opacity=".85"/>`,

  extraChar: `
    <path d="M3.2 10.4 1.6 5l4 1.7a6.6 6.6 0 0 1 10.2 0l4-1.7-1.6 5.4v3.2a6.6 6.6 0 0 1-13.4 0z"
          fill="currentColor" opacity=".14"/>
    <path d="M3.2 10.4 1.6 5l4 1.7a6.6 6.6 0 0 1 10.2 0l4-1.7-1.6 5.4v3.2a6.6 6.6 0 0 1-13.4 0z"/>
    <path d="M13.8 15.2l-.8-3.6 2.6 1a4.8 4.8 0 0 1 7.4 0l2.4-1-1 3.4v2.6a4.6 4.6 0 0 1-9.2 0z"
          fill="currentColor" opacity=".2"/>
    <path d="M13.8 15.2l-.8-3.6 2.6 1a4.8 4.8 0 0 1 7.4 0l2.4-1-1 3.4v2.6a4.6 4.6 0 0 1-9.2 0z"/>
    <circle cx="7.3" cy="11.6" r="1" fill="currentColor"/><circle cx="11.9" cy="11.6" r="1" fill="currentColor"/>
    <path d="M8.4 15c.8.7 1.6.7 2.4 0" opacity=".8"/>`,

  video: `
    <rect x="3" y="5" width="18" height="14" rx="4" fill="currentColor" opacity=".14"/>
    <rect x="3" y="5" width="18" height="14" rx="4"/>
    <path d="M10 9.2l5.2 2.9-5.2 2.9z" fill="currentColor" opacity=".75"/>
    <path d="M18.2 2.6c1.2-1.2 3.2-.3 3.2 1.2 0 1.5-2.1 2.9-3.2 3.6-1.1-.7-3.2-2.1-3.2-3.6 0-1.5 2-2.4 3.2-1.2z"
          fill="currentColor" opacity=".5"/>`,
};

/** 中 Boss 奖励 → 图标名 */
export const BOON_ICONS = {
  w_xp: 'xp', w_money: 'money', w_item: 'gift', w_weapon_lv: 'weaponUp',
  w_atk: 'damage', w_hp: 'hp',
  b_xp: 'xp', b_money: 'money', b_weapon: 'weaponUp', b_heal: 'regen',
  b_dmg: 'damage', b_dr: 'armor',
  p_pet_dmg: 'petDmg', p_ms_hit: 'speed', p_pickup: 'pickup',
  p_items5: 'gift', p_atkspd: 'attackSpeed', p_lethal: 'hp',
  g_pet_cd: 'clock', g_red: 'redItem', g_hitbox: 'hitbox',
  g_elemental: 'chaos', g_legends: 'legend',
};

/** 永久成长树 → 图标名 */
export const META_ICONS = {
  combat_dmg: 'damage', combat_aspd: 'attackSpeed',
  combat_melee: 'melee', combat_ranged: 'ranged', combat_elem: 'element',
  combat_crit: 'crit', combat_critdmg: 'critDamage',
  survival_hp: 'hp', survival_armor: 'armor', survival_regen: 'regen',
  survival_lifesteal: 'lifesteal', survival_move: 'speed', survival_dodge: 'dodge',
  support_money: 'money', support_xp: 'xp', support_luck: 'luck',
  support_aspd: 'attackSpeed', support_harvest: 'harvest', support_pickup: 'pickup',
  special_pet_dmg: 'petDmg', special_pet_pickup: 'petPickup',
  special_pet_aspd: 'petAtkSpeed', special_pet_range: 'petRange',
  special_pet_steal: 'petSteal', special_pet_vuln: 'petVuln',
  t3_weapon: 'extraWeapon', t3_item: 'extraItem', t3_upgrade: 'extraUpgrade',
  t4_char: 'extraChar',
};

/** 生成一个 24×24 的图标 SVG（颜色继承 currentColor） */
export function iconSvg(name, cls = 'neko-ico') {
  const body = icons[name] || icons.spark;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.65"
    stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function hasIcon(name) {
  return !!icons[name];
}