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
function pickMines(inventory, type, limit) {
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

  // 一格一格加，每次挑「多放這一個能多拿到的加成」最大的那種
  const counts = new Map();
  for (let slot = 0; slot < cap; slot++) {
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
  return { picks, total, score: Math.round(score * 100) / 100, stat };
}

module.exports = { pickMines, loadMaterials, decay, FORGE_LIMIT, statFor };
