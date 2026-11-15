// ============================================================
// 第二百二十八轮：主菜单「生活区」数据表
//   · 钓鱼：鱼种 / 鱼竿 / 鱼饵
//   · 农田：作物 / 肥料 / 自动化机器
//   · 手办：8 个角色的纪念手办与永久小幅加强
//
// 这里只放静态数据；金币收支、种植、收获、卖鱼等状态变更在
// src/systems/life-state.js，Canvas 钓鱼在 src/minigames/fishing.js。
// ============================================================

import { CHARACTERS } from './characters.js';

/** 金币兑换 1 张扭蛋券的价格（用户选择"不限量"，所以只设单价） */
export const COINS_PER_TICKET = 200;
/** 农田格数：6 列 × 2 行，和概念图一致 */
export const FARM_COLS = 6;
export const FARM_ROWS = 2;
export const FARM_PLOTS = FARM_COLS * FARM_ROWS;
/** 鱼篓 / 仓库软上限：超过后新物品自动折成金币，防止 localStorage 无限膨胀 */
export const FISH_BAG_CAP = 80;
export const CROP_BAG_CAP = 100;

// ============================================================
// 钓鱼
// ============================================================

/**
 * rarity 0..4 只用于"稀有度权重加成"和显示，不是独立概率。
 * baseValue + cm * perCm 是基础价，星标再乘倍率。
 */
export const FISH = [
  {
    id: 'minnow', name: '小银鱼', rarity: 0, weight: 30,
    minCm: 6, maxCm: 15, baseValue: 4, perCm: 0.8,
    body: '#b9d7e8', belly: '#eef9ff', fin: '#8fb8cc',
  },
  {
    id: 'goldfish', name: '小金鱼', rarity: 0, weight: 24,
    minCm: 8, maxCm: 19, baseValue: 6, perCm: 1.1,
    body: '#ff9a3c', belly: '#ffd8a5', fin: '#ff6a2e',
  },
  {
    id: 'carp', name: '鲤鱼', rarity: 1, weight: 18,
    minCm: 18, maxCm: 44, baseValue: 15, perCm: 1.5,
    body: '#d9a45b', belly: '#f3d5a3', fin: '#b57a38',
  },
  {
    id: 'catfish', name: '猫猫鲶', rarity: 1, weight: 14,
    minCm: 22, maxCm: 56, baseValue: 20, perCm: 1.8,
    body: '#6f7b8a', belly: '#c3ced9', fin: '#4d5866',
  },
  {
    id: 'koi', name: '锦鲤', rarity: 2, weight: 8,
    minCm: 30, maxCm: 72, baseValue: 40, perCm: 3,
    body: '#ff6f61', belly: '#fff0e8', fin: '#d94a40',
  },
  {
    id: 'moonfish', name: '月光鱼', rarity: 2, weight: 6,
    minCm: 16, maxCm: 38, baseValue: 60, perCm: 4,
    body: '#8fd3ff', belly: '#e6f9ff', fin: '#5fb8e8', glow: 'rgba(120, 220, 255, .55)',
  },
  {
    id: 'golden_koi', name: '黄金锦鲤', rarity: 3, weight: 3,
    minCm: 35, maxCm: 82, baseValue: 100, perCm: 6,
    body: '#ffd23a', belly: '#fff6c2', fin: '#e0a800', glow: 'rgba(255, 220, 90, .55)',
  },
  {
    id: 'catfish_king', name: '猫鲶王', rarity: 3, weight: 1.5,
    minCm: 60, maxCm: 122, baseValue: 150, perCm: 8,
    body: '#4b5d6e', belly: '#a9c5d6', fin: '#2f3c48',
  },
  {
    id: 'dreamfish', name: '梦境猫鱼', rarity: 4, weight: 0.7,
    minCm: 40, maxCm: 100, baseValue: 250, perCm: 10,
    body: '#c08bff', belly: '#f0e3ff', fin: '#8d5ed6', glow: 'rgba(190, 130, 255, .6)',
  },
  {
    id: 'star_whale', name: '星海小鲸', rarity: 4, weight: 0.3,
    minCm: 80, maxCm: 180, baseValue: 500, perCm: 15,
    body: '#5f8cff', belly: '#d6e2ff', fin: '#3f62c8', glow: 'rgba(110, 160, 255, .6)',
  },
];

export const FISH_RARITY_NAMES = ['普通', '少见', '稀有', '史诗', '传说'];
export const FISH_RARITY_COLORS = ['#9fd8ff', '#7cffb2', '#c08bff', '#ffd45e', '#ff7bd5'];

export const RODS = [
  {
    id: 'bamboo', name: '竹制鱼竿', price: 0,
    reel: 1.0, line: 1.0, rare: 0, sizeBias: 0,
    desc: '新手鱼竿，收线慢但不容易断线。',
  },
  {
    id: 'glass', name: '玻璃钢鱼竿', price: 1200,
    reel: 1.12, line: 1.15, rare: 0.06, sizeBias: 0.02,
    desc: '更稳的竿身，收线更快，稍微容易遇到稀有鱼。',
  },
  {
    id: 'carbon', name: '碳素鱼竿', price: 5000,
    reel: 1.25, line: 1.3, rare: 0.12, sizeBias: 0.05,
    desc: '轻量高强度，稀有大鱼更容易上钩。',
  },
  {
    id: 'neko', name: '猫神鱼竿', price: 18000,
    reel: 1.45, line: 1.5, rare: 0.22, sizeBias: 0.1,
    desc: '猫神赐福的鱼竿，收线极快，传说鱼也会给面子。',
  },
];

export const BAITS = [
  {
    id: 'dough', name: '面团', price: 0, bundle: 0,
    biteMin: 1.8, biteMax: 4.2, rare: 0, sizeBias: 0,
    color: '#e7d6b0', desc: '无限使用的默认鱼饵。',
  },
  {
    id: 'shrimp', name: '虾饵', price: 30, bundle: 10,
    biteMin: 1.1, biteMax: 2.8, rare: 0.08, sizeBias: 0.03,
    color: '#ff9a8a', desc: '鱼咬钩更快，稀有度小幅提升。',
  },
  {
    id: 'glow', name: '发光饵', price: 90, bundle: 10,
    biteMin: 0.8, biteMax: 2.0, rare: 0.18, sizeBias: 0.06,
    color: '#8ff5e8', desc: '发光诱鱼，咬钩最快，稀有鱼概率大幅提升。',
  },
];

// ============================================================
// 农田
// ============================================================

export const CROPS = [
  {
    id: 'radish', name: '小萝卜', price: 10, glyph: '萝',
    growMs: 3 * 60 * 1000,
    yieldMin: 1, yieldMax: 2, sizeMin: 6, sizeMax: 15,
    baseValue: 8, perCm: 2,
    body: '#ff8a8a', leaf: '#7ed07e',
    desc: '3 分钟成熟，适合刚开始种。',
  },
  {
    id: 'carrot', name: '胡萝卜', price: 25, glyph: '胡',
    growMs: 8 * 60 * 1000,
    yieldMin: 1, yieldMax: 3, sizeMin: 10, sizeMax: 25,
    baseValue: 14, perCm: 2.2,
    body: '#ff9a3c', leaf: '#6fbf73',
    desc: '8 分钟成熟，产量和价格都不错。',
  },
  {
    id: 'tomato', name: '番茄', price: 60, glyph: '茄',
    growMs: 20 * 60 * 1000,
    yieldMin: 1, yieldMax: 3, sizeMin: 5, sizeMax: 13,
    baseValue: 30, perCm: 4,
    body: '#ff5f6d', leaf: '#5fbf6f',
    desc: '20 分钟成熟，容易受相邻作物影响。',
  },
  {
    id: 'pumpkin', name: '南瓜', price: 150, glyph: '瓜',
    growMs: 60 * 60 * 1000,
    yieldMin: 1, yieldMax: 2, sizeMin: 20, sizeMax: 52,
    baseValue: 80, perCm: 4,
    body: '#ffb347', leaf: '#6fae5a',
    desc: '1 小时成熟，单个就很值钱。',
  },
  {
    id: 'moonmelon', name: '月光瓜', price: 400, glyph: '月',
    growMs: 3 * 60 * 60 * 1000,
    yieldMin: 1, yieldMax: 2, sizeMin: 25, sizeMax: 62,
    baseValue: 200, perCm: 8,
    body: '#8fd3ff', leaf: '#5f9fd8',
    desc: '3 小时成熟，夜里会发光的稀有作物。',
  },
];

// 第二百三十轮：像素图标（tools/make_life_sprites.py 生成，64×64 透明底）
for (const f of FISH) f.sprite = `assets/fishing/fish_${f.id}.png`;
for (const c of CROPS) {
  c.sprite = `assets/fishing/crop_${c.id}.png`;
  c.spriteMut = `assets/fishing/crop_${c.id}_mut.png`;
}

export const FERTILIZERS = [
  {
    id: 'none', name: '不施肥', price: 0, tier: 0,
    yieldBonus: 0, sizeBonus: 0, mutationBonus: 0,
    color: '#9aa7b8', desc: '保持自然生长。',
  },
  {
    id: 'basic', name: '基础肥料', price: 20, tier: 1,
    yieldBonus: 1, sizeBonus: 0.05, mutationBonus: 0.03,
    color: '#7ed07e', desc: '收获 +1，尺寸略微提升。',
  },
  {
    id: 'good', name: '优质肥料', price: 60, tier: 2,
    yieldBonus: 1, sizeBonus: 0.1, mutationBonus: 0.06,
    color: '#5fd3e8', desc: '收获 +1，尺寸明显提升，变异率提高。',
  },
  {
    id: 'rich', name: '猫神肥料', price: 180, tier: 3,
    yieldBonus: 2, sizeBonus: 0.18, mutationBonus: 0.12,
    color: '#ffd45e', desc: '收获 +2，尺寸大幅提升，变异率最高。',
  },
];

export const MACHINES = [
  {
    id: 'sprinkler', name: '自动浇水器', price: 3000,
    desc: '所有作物自动保持已浇水状态，不用再手动浇水。',
  },
  {
    id: 'harvester', name: '自动收获机', price: 8000,
    desc: '作物成熟后自动收获进仓库；适合长时间挂机。',
  },
];

// ============================================================
// 手办（8 个角色各 1 个）
// ============================================================

export const FIGURE_MAX_LEVEL = 5;
export const FIGURE_DUPLICATE_COINS = 500;

// 每级加成；数值刻意很小，避免手办变成第二套数值成长。
const FIGURE_BUFFS = {
  yui: { pct: { damage: 1.5, attackSpeed: 1 }, desc: '伤害 +1.5% / 攻速 +1%' },
  mimi: { pct: { damage: 2, lifesteal: 1 }, desc: '伤害 +2% / 吸血 +1%' },
  luna: { pct: { elemDamage: 2, range: 1 }, desc: '元素伤害 +2% / 射程 +1%' },
  shiro: { flat: { maxHp: 2, armor: 0.5 }, desc: '最大生命 +2 / 护甲 +0.5' },
  nana: { pct: { luck: 2 }, flat: { pickupRange: 2 }, desc: '幸运 +2% / 拾取范围 +2' },
  kuro: { pct: { critChance: 1, critDamage: 2 }, desc: '暴击率 +1% / 暴击伤害 +2%' },
  youyi: { flat: { hpRegen: 0.05, maxHp: 1 }, desc: '生命回复 +0.05 / 最大生命 +1' },
  neon_party: { pct: { turretDamage: 2, turretRate: 1 }, desc: '炮台伤害 +2% / 炮台攻速 +1%' },
};

export const FIGURES = CHARACTERS.map((c) => ({
  charId: c.id,
  name: c.name,
  color: c.color,
  accent: c.accent,
  glyph: c.glyph,
  figureName: `${c.name} · 纪念手办`,
  pct: FIGURE_BUFFS[c.id]?.pct || {},
  flat: FIGURE_BUFFS[c.id]?.flat || {},
  desc: FIGURE_BUFFS[c.id]?.desc || '永久小幅加强。',
}));

export const FISH_MAP = Object.fromEntries(FISH.map((f) => [f.id, f]));
export const ROD_MAP = Object.fromEntries(RODS.map((r) => [r.id, r]));
export const BAIT_MAP = Object.fromEntries(BAITS.map((b) => [b.id, b]));
export const CROP_MAP = Object.fromEntries(CROPS.map((c) => [c.id, c]));
export const FERTILIZER_MAP = Object.fromEntries(FERTILIZERS.map((f) => [f.id, f]));
export const MACHINE_MAP = Object.fromEntries(MACHINES.map((m) => [m.id, m]));
export const FIGURE_MAP = Object.fromEntries(FIGURES.map((f) => [f.charId, f]));

export function getFish(id) { return FISH_MAP[id] || FISH[0]; }
export function getRod(id) { return ROD_MAP[id] || RODS[0]; }
export function getBait(id) { return BAIT_MAP[id] || BAITS[0]; }
export function getCrop(id) { return CROP_MAP[id] || CROPS[0]; }
export function getFertilizer(id) { return FERTILIZER_MAP[id] || FERTILIZERS[0]; }
export function getFigure(charId) { return FIGURE_MAP[charId] || FIGURES[0]; }