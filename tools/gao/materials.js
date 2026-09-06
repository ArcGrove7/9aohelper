'use strict';
// 鍛造要放什麼素材，答案站上就有：materials.html 的 M 表（241 種素材的攻／防／幸／重／耐）
// 加上「同素材越堆越不划算」的衰減表。這支把兩者接起來，算出一份配方。
//
// 為什麼不是「拿庫存最多的塞滿」：同一種素材放 n 個，實得加成只有 f(n) 倍，
// f(2)=1.5、f(16)≈3.5、要堆到 33 個才 5 倍。與其狂堆一種，不如湊多種高值的。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// materials.html 的欄位：0 名稱、1 攻、2 防、3 幸、4 重、5 耐、6 標籤、7 特效
const COL = { name: 0, atk: 1, def: 2, lck: 3, wgt: 4, dur: 5, tags: 6, effects: 7 };

// 社群表（capture/community-materials.json）用的是「泥土＝1.00」的相對係數，
// 站上 materials.html 是絕對值。拿泥土、石頭、兔皮三種交叉比對，換算係數是固定的：
//   攻 ×2.0、防 ×2.0、幸 ×0.6、重 ×5.0、耐 ×3.0
// 所以社群表可以換算後補進來，站上沒收錄的素材（夜明砂、蝙蝠翅膀…）才用得上。
const COMMUNITY_SCALE = { atk: 2.0, def: 2.0, lck: 0.6, wgt: 5.0, dur: 3.0 };

function loadCommunity(table) {
  const file = path.join(ROOT, 'capture', 'community-materials.json');
  if (!fs.existsSync(file)) return 0;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  let added = 0;
  for (const m of data.materials || []) {
    if (table.has(m.name)) continue; // 站上有的以站上為準
    table.set(m.name, {
      name: m.name,
      atk: (m.atk || 0) * COMMUNITY_SCALE.atk,
      def: (m.def || 0) * COMMUNITY_SCALE.def,
      lck: (m.lck || 0) * COMMUNITY_SCALE.lck,
      wgt: m.wgt == null ? null : m.wgt * COMMUNITY_SCALE.wgt,
      dur: (m.dur || 0) * COMMUNITY_SCALE.dur,
      // 社群表的「類別」其實是產地（大草原、蝙蝠洞…），不是站上那種材質標籤，
      // 所以不塞進 tags——泥土類／木頭類的判定仍以站上的標籤為準。
      tags: [],
      from: 'community',
      qualityNeed: m.qualityNeed || null,
    });
    added++;
  }
  return added;
}

let cache = null;
function loadMaterials() {
  if (cache) return cache;
  const html = fs.readFileSync(path.join(ROOT, 'materials.html'), 'utf8');
  const m = html.match(/const M=(\[[\s\S]*?\]);/);
  if (!m) throw new Error('materials.html 裡找不到 M 表');
  const rows = JSON.parse(m[1].replace(/\bnull\b/g, 'null'));
  cache = new Map();
  for (const r of rows) {
    cache.set(r[COL.name], {
      name: r[COL.name],
      atk: Number(r[COL.atk]) || 0,
      def: Number(r[COL.def]) || 0,
      lck: Number(r[COL.lck]) || 0,
      wgt: r[COL.wgt] == null ? null : Number(r[COL.wgt]),
      dur: Number(r[COL.dur]) || 0,
      tags: String(r[COL.tags] || '').split('·').filter(Boolean),
    });
  }
  loadCommunity(cache);
  return cache;
}

// 同素材衰減表（materials.html「同素材越堆越不划算」）
const DECAY = [
  [1, 1], [2, 1.5], [3, 1.76], [5, 2.15], [8, 2.61], [10, 2.87],
  [15, 3.44], [20, 3.93], [25, 4.36], [30, 4.76], [33, 4.99], [40, 5.49], [48, 6.03],
];

// 表上沒有的數量用線性內插；超出表尾就照最後一段的斜率外推
function decay(n) {
  if (n <= 0) return 0;
  if (n <= 1) return 1;
  for (let i = 1; i < DECAY.length; i++) {
    const [n0, v0] = DECAY[i - 1];
    const [n1, v1] = DECAY[i];
    if (n <= n1) return v0 + ((v1 - v0) * (n - n0)) / (n1 - n0);
  }
  const [na, va] = DECAY[DECAY.length - 2];
  const [nb, vb] = DECAY[DECAY.length - 1];
  return vb + ((vb - va) / (nb - na)) * (n - nb);
}

// 泥土類的標籤加成（站上「標籤加成完整數值表」）。
// 觸發規則寫的是「同素材會重複加成 需要木頭類素材啟動」——所以泥土放幾個就疊幾份，
// 但整組裡沒有木頭類素材的話一份都不算。
const SOIL_BONUS = {
  黑土: { atk: 0.2, def: 0.3, dur: 0.3 },
  藍黑土: { atk: 0.15, def: 0.25, dur: 0.25 },
  泥土: { atk: 0.1, def: 0.2, dur: 0.2 },
  紅土: { atk: 0.1, def: 0.2, dur: 0.05 },
  沙子: { atk: 0.01, def: 0.01, dur: 0.01 },
};

function isSoil(name) {
  return Object.prototype.hasOwnProperty.call(SOIL_BONUS, name);
}

// 站上沒收錄的素材（楊木、樺木…）用名字兜底：只要能啟動泥土加成就夠，
// 基礎數值算 0，不會因此被誤選進高分格。
function isWood(name, meta) {
  if (meta && meta.tags.includes('木頭')) return true;
  return /木$/.test(name);
}

const WEAPONS = new Set(['sword', 'rapier', 'dagger', 'hammer', 'thsword', 'katana', 'axe', 'spear']);

// 武器看攻擊，防具（含盾牌）看防禦
function statFor(type) {
  return WEAPONS.has(type) ? 'atk' : 'def';
}

// 各裝備類型的素材上限（拆自前端 Forge 模組）
const FORGE_LIMIT = {
  sword: 16, rapier: 14, dagger: 11, hammer: 16, shield: 16,
  thsword: 22, katana: 20, axe: 22, spear: 18,
  helmet: 10, hat: 10, armor: 16, coat: 12,
};

/**
 * 挑一份配方。
 * @param {Array} inventory /api/items 回傳的 mines：[{ id, name, available }]
 * @param {string} type 裝備類型 id（sword、armor…）
 * @param {number} [limit] 素材上限，不給就用該類型的預設
 * @returns {{ picks: Array<{itemId:number, quantity:number, name:string, value:number}>, total:number, score:number, stat:string }}
 */
function pickMines(inventory, type, limit, opts = {}) {
  const cap = limit || FORGE_LIMIT[type] || 16;
  const table = loadMaterials();
  const stat = statFor(type);

  const cands = [];
  for (const item of inventory) {
    if (!item.available || item.available <= 0) continue;
    const meta = table.get(item.name);
    // 站上沒收錄的素材給 0 分——不是「不能用」，是沒有依據拿它去比
    const value = meta ? meta[stat] : 0;
    if (value <= 0) continue;
    cands.push({ id: item.id, name: item.name, available: item.available, value });
  }
  if (!cands.length) return { picks: [], total: 0, score: 0, stat };

  if (opts.strategy === 'soilWood') return pickSoilWood(inventory, cands, cap, stat);
  return assemble(greedy(cands, cap), cands, stat);
}

// 一格一格加，每次挑「多放這一個能多拿到的加成」最大的那種
function greedy(cands, cap, preset) {
  const counts = new Map(preset || []);
  let used = 0;
  for (const n of counts.values()) used += n;
  for (let slot = used; slot < cap; slot++) {
    let best = null;
    let bestGain = 0;
    for (const c of cands) {
      const n = counts.get(c.name) || 0;
      if (n >= c.available) continue;
      const gain = c.value * (decay(n + 1) - decay(n));
      if (gain > bestGain) { bestGain = gain; best = c; }
    }
    if (!best) break;
    counts.set(best.name, (counts.get(best.name) || 0) + 1);
  }
  return counts;
}

function assemble(counts, cands, stat, extra) {
  const picks = [];
  let total = 0;
  let score = 0;
  for (const c of cands) {
    const n = counts.get(c.name) || 0;
    if (!n) continue;
    picks.push({ itemId: c.id, quantity: n, name: c.name, value: c.value });
    total += n;
    score += c.value * decay(n);
  }
  picks.sort((a, b) => b.value - a.value);
  return { picks, total, score: Math.round(score * 100) / 100, stat, ...extra };
}

// 泥土＋木頭配方：泥土的加成是百分比又可以重複疊，但沒有木頭類素材就一份都不算。
// 泥土本身基礎值很低（泥土只有防 2），所以放幾個是個取捨——
// 逐一試算「放 k 個泥土」，剩下的格子照一般貪心補滿，取
// 基礎分 ×（1 ＋ 泥土加成）最高的那個 k。
function pickSoilWood(inventory, cands, cap, stat) {
  const table = loadMaterials();
  const byName = new Map(cands.map((c) => [c.name, c]));

  const soils = inventory
    .filter((m) => m.available > 0 && isSoil(m.name))
    .map((m) => ({ ...m, bonus: SOIL_BONUS[m.name][stat] || 0 }))
    .sort((a, b) => b.bonus - a.bonus);
  const woods = inventory
    .filter((m) => m.available > 0 && isWood(m.name, table.get(m.name)))
    .sort((a, b) => ((table.get(b.name) || {})[stat] || 0) - ((table.get(a.name) || {})[stat] || 0));

  if (!soils.length || woods.length === 0) {
    // 缺任何一邊，泥土加成就啟動不了，退回一般貪心
    const missing = !soils.length ? '沒有泥土類素材' : '沒有木頭類素材';
    return assemble(greedy(cands, cap), cands, stat, { note: `${missing}，泥土加成啟動不了` });
  }

  const soilStock = soils.reduce((n, s) => n + s.available, 0);
  const woodStock = woods.reduce((n, w) => n + w.available, 0);
  const wood = woods[0];
  let best = null;

  // 人下的令：1 土要配 2 木。所以 k 個泥土就要 2k 個木頭，佔掉 3k 格。
  const RATIO = 2;
  const maxK = Math.min(soilStock, Math.floor(woodStock / RATIO), Math.floor(cap / (1 + RATIO)));
  for (let k = 1; k <= maxK; k++) {
    const preset = new Map();
    let bonus = 0;
    let left = k;
    // 加成高的泥土先放滿
    for (const s of soils) {
      if (left <= 0) break;
      const take = Math.min(s.available, left);
      preset.set(s.name, take);
      bonus += s.bonus * take;
      left -= take;
      if (!byName.has(s.name)) byName.set(s.name, { id: s.id, name: s.name, available: s.available, value: (table.get(s.name) || {})[stat] || 0 });
    }
    // 1 土配 2 木——木頭也照防禦值高的先放
    let needWood = k * RATIO;
    for (const w of woods) {
      if (needWood <= 0) break;
      const take = Math.min(w.available, needWood);
      preset.set(w.name, (preset.get(w.name) || 0) + take);
      needWood -= take;
      if (!byName.has(w.name)) byName.set(w.name, { id: w.id, name: w.name, available: w.available, value: (table.get(w.name) || {})[stat] || 0 });
    }
    if (needWood > 0) continue; // 木頭不夠配這個 k

    const pool = [...byName.values()];
    const counts = greedy(pool, cap, preset);
    const r = assemble(counts, pool, stat);
    const effective = r.score * (1 + bonus);
    if (!best || effective > best.effective) {
      best = { ...r, soilCount: k, woodCount: k * RATIO, soilBonus: Math.round(bonus * 100), effective: Math.round(effective * 100) / 100 };
    }
  }
  if (!best) {
    return assemble(greedy(cands, cap), cands, stat, { note: '木頭不夠配 1 土 2 木' });
  }
  return best;
}

module.exports = { pickMines, loadMaterials, decay, FORGE_LIMIT, statFor, SOIL_BONUS, isSoil, isWood, COMMUNITY_SCALE };
