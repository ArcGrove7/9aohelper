#!/usr/bin/env node
'use strict';
// 解析玩家共編的 GAO 資料庫試算表（人提供，2026-09-06）。
//
//   node tools/parse-community-sheet.js <下載好的 csv> [更多 csv...]
//
// 表的排法是「每 21 欄一組」：
//   類別名（同時是該組第一列的欄名）、攻擊、防禦、幸運、重量、耐久、特效，
//   然後是 14 個品質等級的欄位——**這些數字的意義還沒確認**。
//   我先前猜是「打出該品質所需的數量」，人說完全錯了，所以先照原樣收著，
//   等問清楚再補上正確的解讀，不要留錯的說明誤導後面建站的人。
//
// 站上 materials.html 沒有的是：完整的 14 級品質階梯，以及這組品質欄位。
// 數值本身也跟站上不同單位——這張表以泥土＝1.00 當基準做相對係數，
// 站上是絕對值，兩者不能直接混用，所以分開存。
//
// 產出：capture/community-materials.json、capture/community-materials.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'capture', 'community-materials.json');
const OUT_MD = path.join(ROOT, 'capture', 'community-materials.md');

// 品質由低到高（就是表上欄位的順序）
const QUALITIES = ['屎一般', '垃圾般', '破爛', '劣質', '次等', '普通', '上等',
  '高級', '精良', '頂級', '完美', '史詩', '神話', '傳說'];
const GROUP = 7 + QUALITIES.length; // 名稱＋5 個數值＋特效＋14 個品質 = 21

// CSV 解析：欄位可能帶引號、引號內可能有逗號與換行
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const num = (s) => {
  const t = String(s == null ? '' : s).trim();
  // 空格子代表「沒有這筆資料」，不是 0——Number('') 會給 0，會把空白讀成門檻 0
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('用法：node tools/parse-community-sheet.js <csv...>'); process.exit(1); }

  const materials = new Map();
  const categories = new Set();

  for (const file of files) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    if (!rows.length) continue;

    // 表是縱橫都分區塊的：橫向每 21 欄一組，縱向還會再出現新的標題列。
    // 所以逐列掃，看到「第 base+1 欄是『攻擊』」就把那一組的類別換掉。
    const current = new Map(); // base 欄位 → { category, hasQuality }
    for (const row of rows) {
      for (let base = 0; base + 6 < row.length; base += GROUP) {
        const first = (row[base] || '').trim();
        const second = (row[base + 1] || '').trim();

        if (second === '攻擊') {
          if (first) {
            current.set(base, { category: first, hasQuality: (row[base + 7] || '').trim() === QUALITIES[0] });
            categories.add(first);
          }
          continue;
        }
        const meta = current.get(base);
        if (!meta || !first || first.startsWith('-')) continue;
        const atk = num(row[base + 1]);
        if (atk == null) continue;

        const entry = {
          name: first,
          category: meta.category,
          atk,
          def: num(row[base + 2]),
          lck: num(row[base + 3]),
          wgt: num(row[base + 4]),
          dur: num(row[base + 5]),
          effect: (row[base + 6] || '').trim().replace(/\s+/g, ' ') || null,
        };
        if (meta.hasQuality) {
          const need = {};
          QUALITIES.forEach((q, i) => {
            const v = num(row[base + 7 + i]);
            if (v != null && v > 0) need[q] = v;
          });
          if (Object.keys(need).length) entry.qualityNeed = need;
        }
        const old = materials.get(first);
        if (!old || (!old.qualityNeed && entry.qualityNeed)) materials.set(first, entry);
      }
    }
  }

  const list = [...materials.values()].sort(
    (a, b) => a.category.localeCompare(b.category, 'zh-Hant') || b.atk - a.atk,
  );
  const json = {
    source: '玩家共編的 GAO 資料庫試算表（人於 2026-09-06 提供）',
    note: '數值是以泥土＝1.00 為基準的相對係數，與站上 materials.html 的絕對值不同單位，不要混用。'
      + '品質欄位的意義尚未確認——原樣收錄，不要照字面解讀。',
    generatedAt: new Date().toISOString(),
    qualities: QUALITIES,
    categories: [...categories],
    count: list.length,
    materials: list,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  const tw = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const md = ['# 素材係數與品質門檻（社群表）', '',
    `由 \`tools/parse-community-sheet.js\` 解析 ${json.source} 生成，請勿手改。`,
    `生成時間：${tw} (UTC+8)`, '',
    '**數值是以泥土＝1.00 為基準的相對係數**，跟站上 `materials.html` 的絕對值不是同一個單位，兩者不要混用。',
    '', '品質由低到高共 14 級：' + QUALITIES.join(' → '), '',
    '**品質欄位的數字意義尚未確認**——原樣收錄，先不要照字面解讀。',
    '（曾經猜成「打出該品質所需的數量」，這個解讀是錯的。）空白表示該格沒有資料。', ''];

  for (const cat of json.categories) {
    const rows = list.filter((m) => m.category === cat);
    if (!rows.length) continue;
    md.push(`## ${cat}`, '');
    const anyQ = rows.some((m) => m.qualityNeed);
    md.push('| 素材 | 攻 | 防 | 幸 | 重 | 耐 | 特效 |' + (anyQ ? ' 品質欄（意義待確認） |' : ''));
    md.push('|---|---|---|---|---|---|---|' + (anyQ ? '---|' : ''));
    for (const m of rows) {
      const q = m.qualityNeed
        ? Object.entries(m.qualityNeed).map(([k, v]) => `${k} ${v}`).join('、')
        : '';
      md.push(`| ${m.name} | ${m.atk} | ${m.def} | ${m.lck} | ${m.wgt} | ${m.dur} | ${m.effect || ''} |`
        + (anyQ ? ` ${q} |` : ''));
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log(`素材 ${json.count} 種、類別 ${json.categories.length} 組 → 寫出 ${path.relative(ROOT, OUT_MD)}`);
}

main();
