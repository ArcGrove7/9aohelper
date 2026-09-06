#!/usr/bin/env node
'use strict';
// 把 capture/work-log.jsonl 的挖礦紀錄彙整成「礦區 → 產出」對照。
//
//   node tools/build-mining-log.js
//
// 站上的地圖圖鑑沒有礦區資料，這張表補的就是這一段：
// 哪個礦區挖得到什麼、一次大概花多少體力、拿多少東西。
//
// 產出：capture/mining-log.json、capture/mining-log.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'capture', 'work-log.jsonl');
const OUT_JSON = path.join(ROOT, 'capture', 'mining-log.json');
const OUT_MD = path.join(ROOT, 'capture', 'mining-log.md');

// 礦區編號對名稱（拆自前端 HeroDetail）
const ZONES = {
  1: { name: '砂石場', desc: '大部分都是砂土的荒廢礦區，新手也能在這挖到點東西' },
  2: { name: '森林區', desc: '有各式各樣的樹木和肥沃的土壤，獲取木材的最佳地點' },
  3: { name: '鐵礦山', desc: '有足夠等級後便能獲取各式各樣金屬的大型礦場' },
  4: { name: '阿嬤寶山', desc: '有許多珍貴的珠寶礦物埋藏於此，但是地勢險峻，十分危險' },
};

function main() {
  if (!fs.existsSync(IN)) { console.error(`找不到 ${IN}`); process.exit(1); }
  const rows = fs.readFileSync(IN, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter((r) => r.kind === 'mining');

  const zones = new Map();
  for (const r of rows) {
    const key = r.target;
    if (!zones.has(key)) {
      zones.set(key, { target: key, runs: 0, empty: 0, sp: [], items: new Map(), accidents: [] });
    }
    const z = zones.get(key);
    z.runs++;
    let got = 0;
    for (const msg of r.messages || []) {
      const m = msg.m || '';
      const sp = m.match(/消耗了\s*(\d+)\s*點體力/);
      if (sp) { z.sp.push(Number(sp[1])); continue; }
      const gain = m.match(/^獲得了(.+?)(?:\s*×\s*(\d+))?$/);
      if (gain) {
        const name = gain[1].trim();
        const qty = Number(gain[2] || 1);
        const cur = z.items.get(name) || { total: 0, runs: 0 };
        cur.total += qty;
        cur.runs++;
        z.items.set(name, cur);
        got += qty;
        continue;
      }
      if (/什麼也沒挖到/.test(m)) { z.empty++; continue; }
      // 意外（挖礦會受傷）與其他敘述都留著，機制頁用得上
      if (m && !/獲得了|消耗了/.test(m)) z.accidents.push(m);
    }
    z.lastGot = got;
  }

  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

  const json = {
    generatedAt: new Date().toISOString(),
    runs: rows.length,
    zones: [...zones.values()]
      .sort((a, b) => a.target - b.target)
      .map((z) => ({
        target: z.target,
        name: (ZONES[z.target] || {}).name || `礦區 ${z.target}`,
        desc: (ZONES[z.target] || {}).desc || '',
        runs: z.runs,
        emptyRuns: z.empty,
        spPerRun: { avg: avg(z.sp), min: z.sp.length ? Math.min(...z.sp) : null, max: z.sp.length ? Math.max(...z.sp) : null },
        items: Object.fromEntries([...z.items].sort((a, b) => b[1].total - a[1].total)
          .map(([k, v]) => [k, { total: v.total, seenInRuns: v.runs }])),
        events: [...new Set(z.accidents)],
      })),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  const md = ['# 礦區產出', '',
    `由 \`tools/build-mining-log.js\` 從 ${rows.length} 趟挖礦生成，請勿手改。`,
    `生成時間：${json.generatedAt}`, '',
    '同一個礦區每趟挖到的品類差很多——不是固定產表，要看的是「這個礦區出現過什麼」，',
    '而不是「這個礦區只出這些」。趟數越多越準。', '',
    '收穫看的是消耗的體力，時間拉長是跳級的：三分鐘那趟「什麼也沒挖到」，', 
    '二十分鐘那趟 21 體力換 23 個，三十分鐘那趟 27 體力換 51 個。', ''];
  for (const z of json.zones) {
    md.push(`## ${z.name}（礦區 ${z.target}）`, '');
    if (z.desc) md.push(`> ${z.desc}`, '');
    md.push(`- 趟數：${z.runs}（空手 ${z.emptyRuns} 趟）`);
    if (z.spPerRun.avg != null) md.push(`- 每趟體力：${z.spPerRun.min}–${z.spPerRun.max}（平均 ${z.spPerRun.avg}）`);
    const items = Object.entries(z.items);
    if (items.length) {
      md.push('', '| 素材 | 累計 | 出現趟數 |', '|---|---|---|');
      for (const [k, v] of items) md.push(`| ${k} | ${v.total} | ${v.seenInRuns}/${z.runs} |`);
    }
    if (z.events.length) {
      md.push('', '挖礦途中發生過的事：');
      for (const e of z.events) md.push(`- ${e}`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log(`挖礦 ${rows.length} 趟 → ${json.zones.length} 個礦區；寫出 ${path.relative(ROOT, OUT_MD)}`);
}

main();
