#!/usr/bin/env node
'use strict';
// 把 capture/level-ups.jsonl 整理成「升級時長了什麼」的對照。
//
//   node tools/build-levelup-log.js
//
// 兩個題目要靠這份資料回答：
//   1. **行動會不會影響升級時長哪些能力**——所以每筆都記著這一級期間
//      狩獵幾場、挖礦幾次、鍛造幾次。
//   2. **轉生點怎麼配**——先看清楚各英雄種族的自然成長曲線長什麼樣。
//
// 成長量是「升級後、配點前」減「上一級配完點之後」，所以不含我們自己配的點。
// plus 是裝備給的加成，另外記，不算進成長。
//
// 產出：capture/levelup-log.json、capture/levelup-log.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'capture', 'level-ups.jsonl');
const OUT_JSON = path.join(ROOT, 'capture', 'levelup-log.json');
const OUT_MD = path.join(ROOT, 'capture', 'levelup-log.md');

const STAT_LABEL = {
  fullHp: 'HP上限', fullSp: '體力上限', str: '力量', tou: '韌性', agi: '敏捷',
  tec: '技巧', int: '智力', lck: '幸運', hunt: '狩獵', forge: '鍛造',
  tailor: '裁縫', craft: '工藝', mining: '挖礦', logging: '伐木', efficiency: '效率',
};
const ORDER = Object.keys(STAT_LABEL);

function main() {
  if (!fs.existsSync(IN)) {
    console.log('還沒有升級紀錄——bot 要在英雄升級時才會寫一筆');
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify({ count: 0, entries: [] }, null, 1) + '\n');
    fs.writeFileSync(OUT_MD, '# 升級能力點紀錄\n\n（還沒有資料）\n');
    return;
  }
  const rows = fs.readFileSync(IN, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  // 依英雄種族彙整平均成長
  const byType = new Map();
  for (const r of rows) {
    const key = r.type || r.typeId || '未知';
    if (!byType.has(key)) byType.set(key, { type: key, levels: 0, sum: {}, actions: { hunt: 0, mining: 0, forge: 0 } });
    const t = byType.get(key);
    t.levels++;
    for (const [k, v] of Object.entries(r.growth || {})) {
      if (k === 'lv') continue;
      t.sum[k] = (t.sum[k] || 0) + v;
    }
    for (const k of ['hunt', 'mining', 'forge']) t.actions[k] += (r.actionsSince || {})[k] || 0;
  }

  const json = {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    note: '成長量是「升級後、配點前」減「上一級配完點之後」，不含自行配的點；'
      + 'equipmentPlus 是裝備加成，不算進成長。',
    byType: [...byType.values()].map((t) => ({
      type: t.type,
      levels: t.levels,
      avgGrowth: Object.fromEntries(ORDER
        .filter((k) => t.sum[k])
        .map((k) => [k, Math.round((t.sum[k] / t.levels) * 100) / 100])),
      totalActions: t.actions,
    })),
    entries: rows,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  const tw = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const md = ['# 升級能力點紀錄', '',
    `由 \`tools/build-levelup-log.js\` 從 ${rows.length} 次升級生成，請勿手改。`,
    `生成時間：${tw} (UTC+8)`, '',
    '這份資料要回答兩個題目：**行動會不會影響升級時長哪些能力**（所以每筆都記著',
    '這一級期間狩獵幾場、挖礦幾次、鍛造幾次），以及**轉生點怎麼配**（先看清楚',
    '各種族的自然成長曲線）。', '',
    '成長量是「升級後、配點前」減「上一級配完點之後」，**不含我們自己配的點**；',
    '裝備加成（`equipmentPlus`）另外記，不算進成長。', ''];

  if (json.byType.length) {
    md.push('## 各種族的平均每級成長', '');
    md.push('| 種族 | 升級次數 | 平均成長 | 期間行動合計 |');
    md.push('|---|---|---|---|');
    for (const t of json.byType) {
      const g = Object.entries(t.avgGrowth).map(([k, v]) => `${STAT_LABEL[k] || k} +${v}`).join('、') || '—';
      const a = `狩獵 ${t.totalActions.hunt}／挖礦 ${t.totalActions.mining}／鍛造 ${t.totalActions.forge}`;
      md.push(`| ${t.type} | ${t.levels} | ${g} | ${a} |`);
    }
    md.push('');
  }

  md.push('## 逐次紀錄', '');
  md.push('| 時間 | 英雄 | 種族 | 等級 | 自然成長 | 得點 | 期間行動 |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const g = Object.entries(r.growth || {}).filter(([k]) => k !== 'lv')
      .map(([k, v]) => `${STAT_LABEL[k] || k} +${v}`).join('、') || '—';
    const a = r.actionsSince
      ? `狩獵 ${r.actionsSince.hunt}／挖礦 ${r.actionsSince.mining}／鍛造 ${r.actionsSince.forge}`
      : '—';
    md.push(`| ${String(r.time).slice(5, 16)} | ${r.name} | ${r.type || ''} | ${r.fromLv}→${r.toLv} | ${g} | ${r.pointsGained ?? ''} | ${a} |`);
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log(`升級 ${rows.length} 次、種族 ${json.byType.length} 種 → 寫出 ${path.relative(ROOT, OUT_MD)}`);
}

main();
