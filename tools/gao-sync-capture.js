#!/usr/bin/env node
'use strict';
// 把 bot 的工作檔併進版控用的 capture/。
//
//   node tools/gao-sync-capture.js
//
// bot 每幾秒就寫一份戰報。要是直接寫 capture/，工作區就永遠是「有未提交的變更」，
// 也沒辦法挑一個乾淨的時間點提交。所以 bot 只寫 .gao-state/（已忽略），
// 要入庫時跑這支把新的那些併過去——用 id 去重，按時間排序。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = process.argv[2] || path.join(ROOT, '.gao-state');
const CAPTURE = path.join(ROOT, 'capture');

// [工作檔的前綴, 版控檔, 去重用的鍵]
// 每個帳號各有一份工作檔（hunt-reports-u140.jsonl…），全部併進同一份版控檔——
// 戰報是同一個遊戲的觀測資料，用 report id 去重就夠。
const PAIRS = [
  ['hunt-reports', 'hunt-reports.jsonl', (r) => r.id],
  ['work-log', 'work-log.jsonl', (r) => JSON.stringify(r)],
];

function workFiles(prefix) {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs.readdirSync(STATE_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'))
    .map((f) => path.join(STATE_DIR, f));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 壞行跳過 */ }
  }
  return out;
}

let total = 0;
for (const [prefix, dst, keyOf] of PAIRS) {
  const from = workFiles(prefix).flatMap(readJsonl);
  if (!from.length) continue;
  const target = path.join(CAPTURE, dst);
  const existing = readJsonl(target);
  const seen = new Set(existing.map(keyOf));

  const added = from.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!added.length) { console.log(`${dst}：沒有新的`); continue; }

  const all = existing.concat(added);
  all.sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
  fs.mkdirSync(CAPTURE, { recursive: true });
  fs.writeFileSync(target, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${dst}：新增 ${added.length} 筆，共 ${all.length} 筆`);
  total += added.length;
}
console.log(total ? `合計新增 ${total} 筆` : '沒有要入庫的東西');
