#!/usr/bin/env node
'use strict';
// 把伺服器上還留著的歷史戰報抓回來存進 capture/hunt-reports.jsonl。
// 列表只保留最近 100 份，舊的會被新戰報擠掉，所以值得先撈一次。
//
//   node tools/gao-fetch-reports.js --token-file <檔> --label <帳號代號> [--type hunt|attack|defend|boss]

const fs = require('fs');
const path = require('path');
const { Client } = require('./gao/api.js');
const { ReportStore } = require('./gao/capture.js');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    args[process.argv[i].slice(2)] =
      process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  }
}

const ROOT = path.resolve(__dirname, '..');
const type = args.type || 'hunt';
const token = fs.readFileSync(args['token-file'], 'utf8').trim();
// 額度是按帳號算的，label 一定要跟著帳號走——寫死的話兩個帳號會共用同一份額度，
// 其中一邊莫名其妙被扣光。
const client = new Client({
  token,
  stateDir: args.state || path.join(ROOT, '.gao-state'),
  label: args.label || 'u140',
});
const store = new ReportStore(path.join(ROOT, 'capture', `${type}-reports.jsonl`));

(async () => {
  const list = await client.reports(type);
  console.log(`伺服器上有 ${list.length} 份 ${type} 戰報，本地已存 ${store.count} 份`);
  const todo = list.filter((r) => !store.has(r.id));
  console.log(`要抓 ${todo.length} 份`);
  let n = 0;
  for (const meta of todo) {
    try {
      const res = await client.report(meta.id);
      const rep = res.report || res;
      if (store.add(rep)) n++;
      if (n % 10 === 0) console.log(`  …已存 ${n}/${todo.length}`);
    } catch (e) {
      console.log(`  戰報 ${meta.id} 抓失敗：${e.message}`);
    }
  }
  console.log(`完成，新增 ${n} 份，本地共 ${store.count} 份；本小時已用 ${client.requestsUsed} 次額度`);
})().catch((e) => { console.error(e); process.exit(1); });
