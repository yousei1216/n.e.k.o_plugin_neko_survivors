// ============================================================
// 第二百二十八轮：主菜单生活区 UI
//
// 只负责 HTML / 事件绑定 / Canvas 实例生命周期；
// 金币收支与存档全部通过 ctx.onLifeAction 回到 main._lifeAction。
// ============================================================

import {
  CROPS, FERTILIZERS, RODS, BAITS, MACHINES, FIGURES, FISH,
  FISH_RARITY_NAMES, FISH_RARITY_COLORS, FARM_PLOTS,
  COINS_PER_TICKET, getCrop, getFish, getRod, getBait, getFertilizer, getFigure,
} from '../data/life.js';
import { plotInfo, figureBuffText } from '../systems/life-state.js';
import { FishingGame } from '../minigames/fishing.js';

const fmtTime = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
};
const stars = (n) => (n > 0 ? '★'.repeat(n) : '');

function cropCard(item) {
  const def = getCrop(item.cropId);
  const name = item.mutated ? `变异${def.name}` : def.name;
  const color = item.mutated ? '#b06bff' : def.body;
  return `
    <div class="life-item-card crop" style="--ic:${color}">
      <div class="item-glyph" style="background:${color}22;border-color:${color};color:${color}">${item.mutated ? '变' : def.glyph}</div>
      <div class="item-main">
        <div class="item-name">${name} ${stars(item.star)}</div>
        <div class="item-sub">${item.size} cm${item.mutated ? ' · 变异' : ''}</div>
      </div>
      <div class="item-value">${item.value} 金币</div>
      <button class="life-mini-btn" data-sell-crop="${item.uid}">卖出</button>
    </div>`;
}

function fishCard(item) {
  const def = getFish(item.id);
  return `
    <div class="life-item-card fish" style="--ic:${def.body}">
      <div class="item-glyph" style="background:${def.body}22;border-color:${def.body};color:${def.body}">鱼</div>
      <div class="item-main">
        <div class="item-name">${def.name} ${stars(item.star)}</div>
        <div class="item-sub">${item.cm} cm · ${FISH_RARITY_NAMES[def.rarity] || '普通'}</div>
      </div>
      <div class="item-value">${item.value} 金币</div>
      <button class="life-mini-btn" data-sell-fish="${item.uid}">卖出</button>
    </div>`;
}

// ============================================================
// 标题页三个面板
// ============================================================

function plotHtml(plot, index, now) {
  const info = plotInfo(plot, now);
  if (info.empty) {
    return `<button class="farm-plot empty" data-farm-plot="${index}" title="空闲地块：点击种植">
      <span class="plot-plus">＋</span>
    </button>`;
  }
  const crop = info.crop;
  const pct = Math.round(info.progress * 100);
  const ready = info.ready;
  return `<button class="farm-plot ${ready ? 'ready' : 'growing'}" data-farm-plot="${index}"
      style="--pc:${crop.body};--pp:${pct}%"
      title="${crop.name} · ${ready ? '可以收获' : fmtTime(info.remainingMs)}">
    <span class="plot-crop" style="color:${crop.body}">${crop.glyph}</span>
    <span class="plot-progress"><i style="width:${pct}%"></i></span>
    <span class="plot-time">${ready ? '收获' : fmtTime(info.remainingMs)}</span>
    <span class="plot-badges">
      ${info.watered ? '<i class="w">水</i>' : '<i class="dry">旱</i>'}
      ${info.fert > 0 ? `<i class="f">肥${info.fert}</i>` : ''}
    </span>
  </button>`;
}

export function farmPanelHtml({ farm, coins = 0, now = Date.now() }) {
  const plots = farm?.plots || Array(FARM_PLOTS).fill(null);
  const seedSummary = CROPS
    .filter((c) => (farm?.seeds?.[c.id] | 0) > 0)
    .map((c) => `${c.name}×${farm.seeds[c.id]}`)
    .join(' · ') || '没有种子';
  return `
    <div class="title-farm life-panel">
      <div class="life-head">
        <span class="life-title">🌱 猫娘农场</span>
        <span class="life-sub" data-farm-seeds>${seedSummary}</span>
        <span class="life-coins">💰 <b data-life-coins>${coins}</b></span>
        <div class="life-actions">
          <button class="life-chip" data-life-open="farmShop">种子/肥料</button>
          <button class="life-chip" data-life-open="cropBag">仓库</button>
        </div>
      </div>
      <div class="farm-grid">
        ${plots.map((p, i) => plotHtml(p, i, now)).join('')}
      </div>
      <div class="farm-menu hidden" data-farm-menu></div>
    </div>`;
}

export function fishPanelHtml({ fishing, coins = 0 }) {
  const rod = getRod(fishing?.rod || 'bamboo');
  const bait = getBait(fishing?.bait || 'dough');
  const baitCount = bait.id === 'dough' ? '∞' : (fishing?.baits?.[bait.id] | 0);
  const bag = fishing?.bag?.length || 0;
  return `
    <div class="title-fishing life-panel">
      <div class="life-head">
        <span class="life-title">🎣 猫娘钓场</span>
        <span class="life-sub" data-fish-status>${rod.name} · ${bait.name} ×${baitCount}</span>
        <span class="life-coins">💰 <b data-life-coins>${coins}</b></span>
        <div class="life-actions">
          <button class="life-chip" data-life-open="fishShop">鱼竿/鱼饵</button>
          <button class="life-chip" data-life-open="fishBag">鱼篓 <b data-fish-bag-count>${bag}</b></button>
        </div>
      </div>
      <div class="fish-stage">
        <canvas class="fish-canvas" data-fish-canvas width="1000" height="170"
                aria-label="猫娘钓场：按住蓄力，松手抛竿"></canvas>
      </div>
    </div>`;
}

export function figuresPanelHtml({ figures }) {
  return `
    <div class="title-figures life-panel">
      <div class="life-head">
        <span class="life-title">🏆 手办柜</span>
        <span class="life-sub">UR 附赠 · 对应角色永久加强</span>
      </div>
      <div class="figure-grid">
        ${FIGURES.map((f) => {
          const lv = figures?.[f.charId] | 0;
          return `<div class="figure-card ${lv > 0 ? 'unlocked' : 'locked'}"
              style="--fc:${f.color};--fa:${f.accent}"
              title="${lv > 0
                ? `${f.figureName}\nLv.${lv}/5\n每级：${f.desc}\n当前：${figureBuffText(f, lv)}`
                : `${f.figureName}\n尚未获得 · UR 抽卡随机附赠`}">
            <div class="figure-avatar">${lv > 0 ? f.glyph : '?'}</div>
            <div class="figure-name">${lv > 0 ? f.name : '???'}</div>
            <div class="figure-lv">${lv > 0 ? `Lv.${lv}/5` : '未获得'}</div>
            <div class="figure-dots">${'●'.repeat(lv)}${'○'.repeat(5 - lv)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

export function lifeHubHtml({ tab = 'farm', meta }) {
  const body = tab === 'fishing'
    ? fishPanelHtml({ fishing: meta?.fishing, coins: meta?.coins })
    : tab === 'figures'
      ? figuresPanelHtml({ figures: meta?.figures })
      : farmPanelHtml({ farm: meta?.farm, coins: meta?.coins });
  return `
    <div class="screen life-hub">
      <div class="life-hub-head">
        <h2>猫娘生活区</h2>
        <div class="life-hub-tabs">
          <button class="${tab === 'farm' ? 'active' : ''}" data-hub-tab="farm">🌱 农场</button>
          <button class="${tab === 'fishing' ? 'active' : ''}" data-hub-tab="fishing">🎣 钓鱼</button>
          <button class="${tab === 'figures' ? 'active' : ''}" data-hub-tab="figures">🏆 手办</button>
        </div>
      </div>
      <div class="life-hub-body">${body}</div>
      <div class="life-hub-foot">
        <button class="btn" data-hub-close>返回主菜单</button>
      </div>
    </div>`;
}

// ============================================================
// 商店 / 鱼篓 / 仓库
// ============================================================

export function fishingShopHtml({ meta }) {
  const f = meta.fishing;
  return `
    <div class="screen life-shop-screen">
      <h2>鱼竿 / 鱼饵商店</h2>
      <div class="life-wallet">💰 金币 <b data-life-coins>${meta.coins}</b> · 🎣 已装备 ${getRod(f.rod).name}</div>
      <h3 class="life-section-title">鱼竿</h3>
      <div class="life-card-grid">
        ${RODS.map((r) => {
          const owned = f.rods.includes(r.id);
          const equipped = f.rod === r.id;
          return `<div class="life-shop-card ${equipped ? 'equipped' : ''}" style="--ic:#8fd3ff">
            <div class="shop-card-name">${r.name}</div>
            <div class="shop-card-desc">${r.desc}</div>
            <div class="shop-card-stats">
              <span>收线 ×${r.reel}</span><span>强度 ×${r.line}</span>
              <span>稀有 +${Math.round(r.rare * 100)}%</span><span>大鱼 +${Math.round(r.sizeBias * 100)}%</span>
            </div>
            <button class="btn small" data-buy-rod="${r.id}" ${equipped ? 'disabled' : ''}>
              ${equipped ? '已装备' : owned ? '装备' : `${r.price} 金币`}
            </button>
          </div>`;
        }).join('')}
      </div>
      <h3 class="life-section-title">鱼饵</h3>
      <div class="life-card-grid">
        ${BAITS.map((b) => {
          const count = b.id === 'dough' ? '∞' : (f.baits?.[b.id] | 0);
          const selected = f.bait === b.id;
          return `<div class="life-shop-card ${selected ? 'equipped' : ''}" style="--ic:${b.color}">
            <div class="shop-card-name">${b.name} <small>×${count}</small></div>
            <div class="shop-card-desc">${b.desc}</div>
            <div class="shop-card-stats">
              <span>咬钩 ${b.biteMin.toFixed(1)}~${b.biteMax.toFixed(1)}s</span>
              <span>稀有 +${Math.round(b.rare * 100)}%</span>
              <span>大鱼 +${Math.round(b.sizeBias * 100)}%</span>
            </div>
            <div class="shop-card-actions">
              ${b.id === 'dough'
                ? `<button class="btn small" data-select-bait="dough" ${selected ? 'disabled' : ''}>${selected ? '使用中' : '使用'}</button>`
                : `<button class="btn small" data-buy-bait="${b.id}" data-units="10">${b.price * 10} 金币 / 10 个</button>
                   <button class="btn small" data-select-bait="${b.id}" ${selected ? 'disabled' : ''}>${selected ? '使用中' : '使用'}</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="life-screen-foot"><button class="btn primary" data-life-close>返回</button></div>
    </div>`;
}

export function farmShopHtml({ meta }) {
  const farm = meta.farm;
  return `
    <div class="screen life-shop-screen">
      <h2>种子 / 肥料商店</h2>
      <div class="life-wallet">💰 金币 <b data-life-coins>${meta.coins}</b></div>
      <h3 class="life-section-title">种子</h3>
      <div class="life-card-grid">
        ${CROPS.map((c) => {
          const count = farm.seeds?.[c.id] | 0;
          return `<div class="life-shop-card" style="--ic:${c.body}">
            <div class="shop-card-name">${c.glyph} ${c.name} <small>×${count}</small></div>
            <div class="shop-card-desc">${c.desc}</div>
            <div class="shop-card-stats">
              <span>成熟 ${fmtTime(c.growMs)}</span>
              <span>产量 ${c.yieldMin}~${c.yieldMax}</span>
              <span>尺寸 ${c.sizeMin}~${c.sizeMax}cm</span>
            </div>
            <div class="shop-card-actions">
              <button class="btn small" data-buy-seed="${c.id}" data-units="1">${c.price} 金币 / 1</button>
              <button class="btn small" data-buy-seed="${c.id}" data-units="5">${c.price * 5} / 5</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <h3 class="life-section-title">肥料</h3>
      <div class="life-card-grid">
        ${FERTILIZERS.filter((f) => f.id !== 'none').map((f) => {
          const count = farm.fertilizers?.[f.id] | 0;
          return `<div class="life-shop-card" style="--ic:${f.color}">
            <div class="shop-card-name">${f.name} <small>×${count}</small></div>
            <div class="shop-card-desc">${f.desc}</div>
            <div class="shop-card-stats">
              <span>产量 +${f.yieldBonus}</span>
              <span>尺寸 +${Math.round(f.sizeBonus * 100)}%</span>
              <span>变异 +${Math.round(f.mutationBonus * 100)}%</span>
            </div>
            <div class="shop-card-actions">
              <button class="btn small" data-buy-fert="${f.id}" data-units="1">${f.price} 金币 / 1</button>
              <button class="btn small" data-buy-fert="${f.id}" data-units="5">${f.price * 5} / 5</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <h3 class="life-section-title">自动化机器</h3>
      <div class="life-card-grid">
        ${MACHINES.map((m) => {
          const owned = farm.machines?.[m.id] === true;
          return `<div class="life-shop-card ${owned ? 'equipped' : ''}" style="--ic:#ffd45e">
            <div class="shop-card-name">${m.name}</div>
            <div class="shop-card-desc">${m.desc}</div>
            <button class="btn small" data-buy-machine="${m.id}" ${owned ? 'disabled' : ''}>
              ${owned ? '已拥有' : `${m.price} 金币`}
            </button>
          </div>`;
        }).join('')}
      </div>
      <div class="life-screen-foot"><button class="btn primary" data-life-close>返回</button></div>
    </div>`;
}

export function fishBagHtml({ meta }) {
  const f = meta.fishing;
  const collected = Object.keys(f.collection || {}).length;
  return `
    <div class="screen life-shop-screen">
      <h2>鱼篓 / 鱼类图鉴</h2>
      <div class="life-wallet">💰 金币 <b data-life-coins>${meta.coins}</b> · 鱼篓 ${f.bag.length} 条 · 图鉴 ${collected}/${FISH.length}</div>
      <div class="life-bag-actions">
        <button class="btn small" data-sell-all-fish ${f.bag.length ? '' : 'disabled'}>全部卖出</button>
      </div>
      <div class="life-item-list">
        ${f.bag.length ? f.bag.slice().reverse().map(fishCard).join('') : '<div class="life-empty">鱼篓是空的，去钓几条吧。</div>'}
      </div>
      <h3 class="life-section-title">图鉴</h3>
      <div class="life-collection-grid">
        ${FISH.map((def) => {
          const rec = f.collection?.[def.id];
          const color = FISH_RARITY_COLORS[def.rarity] || '#9fd8ff';
          return `<div class="life-collection-card ${rec ? 'found' : ''}" style="--ic:${color}" title="${def.name}">
            <div class="col-name" style="color:${rec ? color : '#8a93a6'}">${rec ? def.name : '???'}</div>
            <div class="col-sub">${rec ? `最大 ${rec.bestCm || rec.best || 0} cm ${stars(rec.bestStar)}` : FISH_RARITY_NAMES[def.rarity]}</div>
            <div class="col-count">${rec ? `钓到 ${rec.count} 条` : '未发现'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="life-screen-foot"><button class="btn primary" data-life-close>返回</button></div>
    </div>`;
}

export function cropBagHtml({ meta }) {
  const farm = meta.farm;
  const keys = Object.keys(farm.collection || {});
  return `
    <div class="screen life-shop-screen">
      <h2>仓库 / 作物图鉴</h2>
      <div class="life-wallet">💰 金币 <b data-life-coins>${meta.coins}</b> · 仓库 ${farm.bag.length} 件 · 图鉴 ${keys.length}</div>
      <div class="life-bag-actions">
        <button class="btn small" data-sell-all-crops ${farm.bag.length ? '' : 'disabled'}>全部卖出</button>
      </div>
      <div class="life-item-list">
        ${farm.bag.length ? farm.bag.slice().reverse().map(cropCard).join('') : '<div class="life-empty">仓库是空的，去种点东西吧。</div>'}
      </div>
      <h3 class="life-section-title">图鉴</h3>
      <div class="life-collection-grid">
        ${CROPS.flatMap((def) => {
          const rec = farm.collection?.[def.id];
          const mut = farm.collection?.[`${def.id}_mut`];
          return [
            `<div class="life-collection-card ${rec ? 'found' : ''}" style="--ic:${def.body}">
              <div class="col-name" style="color:${rec ? def.body : '#8a93a6'}">${rec ? def.name : '???'}</div>
              <div class="col-sub">${rec ? `最大 ${rec.bestSize || rec.best || 0} cm ${stars(rec.bestStar)}` : '未发现'}</div>
              <div class="col-count">${rec ? `收获 ${rec.count} 个` : '普通'}</div>
            </div>`,
            `<div class="life-collection-card ${mut ? 'found' : ''}" style="--ic:#b06bff">
              <div class="col-name" style="color:${mut ? '#b06bff' : '#8a93a6'}">${mut ? `变异${def.name}` : '???'}</div>
              <div class="col-sub">${mut ? `最大 ${mut.bestSize || mut.best || 0} cm ${stars(mut.bestStar)}` : '异种相邻变异'}</div>
              <div class="col-count">${mut ? `收获 ${mut.count} 个` : '变异'}</div>
            </div>`,
          ];
        }).join('')}
      </div>
      <div class="life-screen-foot"><button class="btn primary" data-life-close>返回</button></div>
    </div>`;
}

// ============================================================
// 事件绑定
// ============================================================

function farmMenuHtml(index, plot, meta) {
  const info = plotInfo(plot, Date.now());
  if (info.empty) {
    return `<div class="farm-menu-title">选择种子 <span>地块 ${index + 1}</span></div>
      <div class="farm-menu-list">
        ${CROPS.map((c) => {
          const n = meta.farm.seeds?.[c.id] | 0;
          return `<button class="farm-menu-item" data-plant="${c.id}" ${n <= 0 ? 'disabled' : ''}>
            <b style="color:${c.body}">${c.glyph} ${c.name}</b>
            <span>×${n} · ${fmtTime(c.growMs)}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="farm-menu-foot">
        <button class="life-mini-btn" data-farm-shop>去买种子</button>
        <button class="life-mini-btn" data-menu-close>关闭</button>
      </div>`;
  }
  if (info.ready) {
    return `<div class="farm-menu-title">${info.crop.name} · 已成熟</div>
      <div class="farm-menu-desc">点击收获。相邻同种会提高肥沃概率，相邻异种有概率变异。</div>
      <div class="farm-menu-foot">
        <button class="life-mini-btn primary" data-harvest>收获</button>
        <button class="life-mini-btn" data-menu-close>关闭</button>
      </div>`;
  }
  return `<div class="farm-menu-title">${info.crop.name} · ${fmtTime(info.remainingMs)}</div>
    <div class="farm-menu-desc">${info.watered ? '已浇水' : '缺水（收获量和尺寸会降低）'} · ${info.fert > 0 ? `肥料 ${info.fert} 级` : '未施肥'}</div>
    <div class="farm-menu-list">
      ${!info.watered ? '<button class="farm-menu-item" data-water><b>💧 浇水</b><span>提高产量和尺寸</span></button>' : ''}
      ${FERTILIZERS.filter((f) => f.id !== 'none').map((f) => {
        const n = meta.farm.fertilizers?.[f.id] | 0;
        return `<button class="farm-menu-item" data-fert="${f.id}" ${info.fert > 0 || n <= 0 ? 'disabled' : ''}>
          <b style="color:${f.color}">${f.name}</b><span>×${n} · 产量+${f.yieldBonus}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="farm-menu-foot">
      <button class="life-mini-btn" data-farm-shop>肥料商店</button>
      <button class="life-mini-btn" data-menu-close>关闭</button>
    </div>`;
}

/**
 * 绑定标题页（或生活区弹窗）里的农场 / 钓鱼 / 手办。
 * ctx: { meta, onLifeAction, onOpenShop, onOpenBag, onSound, toast }
 */
export function bindLifePanels(ui, root, ctx) {
  const meta = ctx.meta;
  if (!meta) return { destroy() {} };
  let fishingGame = null;
  let farmTimer = null;

  const panel = root.querySelector('.title-farm, .life-hub .title-farm');
  const farmGrid = panel?.querySelector('.farm-grid');
  const farmMenu = panel?.querySelector('[data-farm-menu]');
  const fishPanel = root.querySelector('.title-fishing');
  const fishCanvas = root.querySelector('[data-fish-canvas]');
  const fishStatus = root.querySelector('[data-fish-status]');
  const bagCount = root.querySelector('[data-fish-bag-count]');
  const seedSummaryEl = panel?.querySelector('[data-farm-seeds]');

  const refreshCoins = () => {
    root.querySelectorAll('[data-life-coins], [data-gacha-coins]').forEach((el) => {
      el.textContent = String(meta.coins | 0);
    });
  };
  const refreshFishStatus = () => {
    if (!fishStatus) return;
    const rod = getRod(meta.fishing.rod);
    const bait = getBait(meta.fishing.bait);
    const n = bait.id === 'dough' ? '∞' : (meta.fishing.baits?.[bait.id] | 0);
    fishStatus.textContent = `${rod.name} · ${bait.name} ×${n}`;
    if (bagCount) bagCount.textContent = String(meta.fishing.bag?.length || 0);
  };
  const refreshFarm = () => {
    if (!farmGrid) return;
    farmGrid.innerHTML = (meta.farm.plots || []).map((p, i) => plotHtml(p, i, Date.now())).join('');
    if (seedSummaryEl) {
      seedSummaryEl.textContent = CROPS
        .filter((c) => (meta.farm.seeds?.[c.id] | 0) > 0)
        .map((c) => `${c.name}×${meta.farm.seeds[c.id]}`)
        .join(' · ') || '没有种子';
    }
  };
  const closeMenu = () => {
    if (!farmMenu) return;
    farmMenu.classList.add('hidden');
    farmMenu.innerHTML = '';
    farmMenu.dataset.plot = '';
  };
  const openMenu = (index) => {
    if (!farmMenu) return;
    const plot = meta.farm.plots[index];
    farmMenu.dataset.plot = String(index);
    farmMenu.innerHTML = farmMenuHtml(index, plot, meta);
    farmMenu.classList.remove('hidden');
    farmMenu.querySelectorAll('[data-plant],[data-water],[data-fert],[data-harvest],[data-farm-shop],[data-menu-close]')
      .forEach((b) => {
        b.onclick = () => {
          const idx = Number(farmMenu.dataset.plot);
          let r = null;
          if (b.dataset.plant) r = ctx.onLifeAction('plant', { index: idx, cropId: b.dataset.plant });
          else if (b.dataset.water != null) r = ctx.onLifeAction('water', { index: idx });
          else if (b.dataset.fert) r = ctx.onLifeAction('fertilize', { index: idx, fertId: b.dataset.fert });
          else if (b.dataset.harvest != null) r = ctx.onLifeAction('harvest', { index: idx });
          else if (b.dataset.farmShop != null) { closeMenu(); ctx.onOpenShop?.('farmShop'); return; }
          else if (b.dataset.menuClose != null) { closeMenu(); return; }
          if (r) {
            if (r.ok) {
              if (r.msg) ctx.toast?.(r.msg, 'good', 2200);
              closeMenu();
              refreshFarm();
              refreshCoins();
            } else {
              ctx.toast?.(r.msg || '操作失败', 'bad', 2400);
            }
          }
        };
      });
  };

  if (panel) {
    panel.addEventListener('click', (e) => {
      const open = e.target.closest('[data-life-open]');
      if (open) {
        const kind = open.dataset.lifeOpen;
        if (kind === 'farmShop') ctx.onOpenShop?.('farmShop');
        if (kind === 'cropBag') ctx.onOpenBag?.('crops');
        return;
      }
      const plotBtn = e.target.closest('[data-farm-plot]');
      if (plotBtn) {
        const idx = Number(plotBtn.dataset.farmPlot);
        const plot = meta.farm.plots[idx];
        const info = plotInfo(plot, Date.now());
        if (info.ready) {
          const r = ctx.onLifeAction('harvest', { index: idx });
          if (r.ok) {
            refreshFarm(); refreshCoins();
            ctx.toast?.(`收获 ${r.items.length} 个${r.mutated ? '变异' : ''}${r.crop.name}`, r.mutated ? 'good' : 'info', 2800);
          } else ctx.toast?.(r.msg || '还不能收获', 'bad', 2200);
        } else {
          openMenu(idx);
        }
      }
    });
  }

  if (fishPanel) {
    fishPanel.addEventListener('click', (e) => {
      const open = e.target.closest('[data-life-open]');
      if (!open) return;
      if (open.dataset.lifeOpen === 'fishShop') ctx.onOpenShop?.('fishShop');
      if (open.dataset.lifeOpen === 'fishBag') ctx.onOpenBag?.('fish');
    });
  }

  if (fishCanvas) {
    fishingGame = new FishingGame(fishCanvas, {
      onSound: (name) => ctx.onSound?.(name),
      onCast: () => {
        const r = ctx.onLifeAction('consumeBait') || {};
        refreshFishStatus();
        if (r.fallback) ctx.toast?.('高级鱼饵用完了，自动换回面团', 'info', 2400);
        return { bait: r.bait || getBait('dough'), rod: getRod(meta.fishing.rod) };
      },
      onCatch: () => {
        const r = ctx.onLifeAction('rollFish') || {};
        refreshFishStatus();
        refreshCoins();
        return r;
      },
      onHud: () => { /* 状态文字已由 onCast/onCatch 更新；Canvas 自己画操作提示 */ },
    });
  }

  if (panel) {
    farmTimer = setInterval(() => {
      const r = ctx.onLifeAction('tickFarm');
      if (!r) return;
      refreshFarm();
      refreshFishStatus();
      if (r.harvested > 0) {
        refreshCoins();
        ctx.toast?.(`自动收获 ${r.harvested} 个作物`, 'good', 2600);
      }
    }, 1000);
  }

  refreshCoins();
  refreshFishStatus();
  refreshFarm();

  return {
    fishingGame: () => fishingGame,
    destroy() {
      fishingGame?.destroy();
      fishingGame = null;
      if (farmTimer) clearInterval(farmTimer);
      farmTimer = null;
    },
  };
}

/** 商店/鱼篓/仓库的通用绑定。ctx: { meta, rerender, onLifeAction, onClose, toast } */
export function bindLifeShop(root, ctx) {
  const meta = ctx.meta;
  root.querySelectorAll('[data-life-close]').forEach((b) => { b.onclick = ctx.onClose; });
  root.querySelectorAll('[data-buy-rod]').forEach((b) => {
    b.onclick = () => {
      const owned = meta.fishing.rods.includes(b.dataset.buyRod);
      const r = ctx.onLifeAction(owned ? 'equipRod' : 'buyRod', { id: b.dataset.buyRod });
      if (r.ok) { ctx.toast?.(r.msg || '已装备', 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '购买失败', 'bad', 2400);
    };
  });
  root.querySelectorAll('[data-buy-bait]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('buyBait', { id: b.dataset.buyBait, units: Number(b.dataset.units) || 10 });
      if (r.ok) { ctx.toast?.(r.msg, 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '购买失败', 'bad', 2400);
    };
  });
  root.querySelectorAll('[data-select-bait]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('selectBait', { id: b.dataset.selectBait });
      if (r.ok) { ctx.toast?.(`已换用 ${getBait(b.dataset.selectBait).name}`, 'good', 1800); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '不能使用', 'bad', 2200);
    };
  });
  root.querySelectorAll('[data-buy-seed]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('buySeed', { id: b.dataset.buySeed, units: Number(b.dataset.units) || 1 });
      if (r.ok) { ctx.toast?.(r.msg, 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '购买失败', 'bad', 2400);
    };
  });
  root.querySelectorAll('[data-buy-fert]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('buyFertilizer', { id: b.dataset.buyFert, units: Number(b.dataset.units) || 1 });
      if (r.ok) { ctx.toast?.(r.msg, 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '购买失败', 'bad', 2400);
    };
  });
  root.querySelectorAll('[data-buy-machine]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('buyMachine', { id: b.dataset.buyMachine });
      if (r.ok) { ctx.toast?.(`购买了 ${r.machine.name}`, 'good', 2600); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '购买失败', 'bad', 2400);
    };
  });
  root.querySelectorAll('[data-sell-fish]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('sellFish', { uid: b.dataset.sellFish });
      if (r.ok) { ctx.toast?.(`卖出 ${r.name}，金币 +${r.coins}`, 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '卖出失败', 'bad', 2200);
    };
  });
  root.querySelectorAll('[data-sell-crop]').forEach((b) => {
    b.onclick = () => {
      const r = ctx.onLifeAction('sellCrop', { uid: b.dataset.sellCrop });
      if (r.ok) { ctx.toast?.(`卖出 ${r.name}，金币 +${r.coins}`, 'good', 2200); ctx.rerender?.(); }
      else ctx.toast?.(r.msg || '卖出失败', 'bad', 2200);
    };
  });
  const allFish = root.querySelector('[data-sell-all-fish]');
  if (allFish) allFish.onclick = () => {
    const r = ctx.onLifeAction('sellAllFish');
    if (r.ok) { ctx.toast?.(`卖出 ${r.count} 条鱼，金币 +${r.coins}`, 'good', 2600); ctx.rerender?.(); }
    else ctx.toast?.(r.msg || '没有可卖的鱼', 'info', 2000);
  };
  const allCrops = root.querySelector('[data-sell-all-crops]');
  if (allCrops) allCrops.onclick = () => {
    const r = ctx.onLifeAction('sellAllCrops');
    if (r.ok) { ctx.toast?.(`卖出 ${r.count} 个作物，金币 +${r.coins}`, 'good', 2600); ctx.rerender?.(); }
    else ctx.toast?.(r.msg || '没有可卖的作物', 'info', 2000);
  };
}