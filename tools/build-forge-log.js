#!/usr/bin/env node
'use strict';
// 把 capture/work-log.jsonl 的鍛造紀錄整理成「配方 → 成品」對照表。
//
//   node tools/build-forge-log.js
//
// 這是鍛造頁最缺的東西：站上有素材數值與標籤加成規則，但沒有
// 「這樣配會打出什麼」的實例。每一爐都是一筆觀測。
//
// 產出：capture/forge-log.json、capture/forge-log.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'capture', 'work-log.jsonl');
const OUT_JSON = path.join(ROOT, 'capture', 'forge-log.json');
const OUT_MD = path.join(ROOT, 'capture', 'forge-log.md');

// 品質由低到高（從實際打出來的看到的，不齊全就照字面排在最後）
const QUALITY_ORDER = ['屎一般', '破爛', '劣質', '次等', '普通', '精良', '頂級', '史詩', '傳說'];

function main() {
  if (!fs.existsSync(IN)) { console.error(`找不到 ${IN}`); process.exit(1); }
  const rows = fs.readFileSync(IN, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const forges = rows.filter((r) => r.kind === 'forge' && r.product);
  if (!forges.length) {
    console.log('還沒有帶成品數值的鍛造紀錄——先讓 bot 打幾爐');
  }

  const entries = forges.map((r) => {
    const picks = (r.recipe && r.recipe.picks) || [];
    return {
      time: r.time,
      smith: r.hero,
      equipType: r.equipType,
      quality: r.product.quality,
      product: r.product,
      soilCount: (r.recipe && r.recipe.soilCount) || 0,
      woodCount: (r.recipe && r.recipe.woodCount) || 0,
      total: (r.recipe && r.recipe.total) || picks.reduce((n, p) => n + p.quantity, 0),
      mines: picks.map((p) => ({ name: p.name, quantity: p.quantity, value: p.value })),
    };
  });

  const json = {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.sort((a, b) => new Date(a.time) - new Date(b.time)),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  const md = ['# 鍛造配方對照', '',
    `由 \`tools/build-forge-log.js\` 從 ${entries.length} 爐的紀錄生成，請勿手改。`,
    `生成時間：${json.generatedAt}`, '',
    '站上有素材數值與標籤加成規則，但沒有「這樣配會打出什麼」。這張表補的就是這一段：',
    '每一列是一爐實際的鍛造，左邊放了什麼、右邊出來什麼。',
    '同樣的配方每次結果仍有落差（品質有隨機成分），所以要看的是趨勢不是單筆。', ''];

  const byType = new Map();
  for (const e of json.entries) {
    if (!byType.has(e.equipType)) byType.set(e.equipType, []);
    byType.get(e.equipType).push(e);
  }
  for (const [type, list] of byType) {
    md.push(`## ${type || '未知類型'}`, '');
    md.push('| 成品 | 品質 | 攻 | 防 | 智 | 幸 | 重 | 耐 | 孔 | 配方 |', '|---|---|---|---|---|---|---|---|---|---|');
    const sorted = list.slice().sort((a, b) => {
      const qa = QUALITY_ORDER.indexOf(a.quality);
      const qb = QUALITY_ORDER.indexOf(b.quality);
      return (qb === -1 ? 99 : qb) - (qa === -1 ? 99 : qa);
    });
    for (const e of sorted) {
      const p = e.product;
      const mix = e.mines.map((m) => `${m.name}×${m.quantity}`).join('、');
      md.push(`| ${p.name} | ${p.quality} | ${p.atk} | ${p.def} | ${p.int} | ${p.lck} | ${p.wgt} | ${p.dur} | ${p.slots} | ${mix} |`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log(`鍛造 ${entries.length} 爐 → 寫出 ${path.relative(ROOT, OUT_JSON)}、${path.relative(ROOT, OUT_MD)}`);
}

main();
