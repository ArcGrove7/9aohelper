#!/usr/bin/env node
'use strict';
// 兩個帳號之間搬東西。遊戲沒有直接贈送的管道，只能走市場：
// 賣方掛單 → 買方立刻買回。掛在公開市場的那幾秒是有風險的，所以
//   1. 一次只掛一筆，買到手才掛下一筆——不要一次把家當攤在市場上
//   2. 價格不要明顯低於市價，太便宜會被路過的人撿走
//      （吃過虧：一把攻 138 的頂級劍掛 136 元想快速轉帳，結果……其實那次是耐久壞的，
//        但低價掛單這個風險是真的，別賭）
//
//   node tools/gao-transfer.js --from <token檔> --from-label <代號> \
//     --to <token檔> --to-label <代號> --kind mines|equipments \
//     [--exclude 泥土,兔皮] [--only 鐵,石頭] [--unit-price 2] [--floor-price 30] [--min-total 40] [--top 3] [--gap 2500]
//
// --top 只對 equipments 有意義：挑攻＋防最高的前 N 件。

const fs = require('fs');
const path = require('path');
const { Client, sleep } = require('./gao/api.js');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    args[process.argv[i].slice(2)] =
      process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  }
}

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.gao-state');
const kind = args.kind || 'mines';
const gap = Number(args.gap || 2500);
const unitPrice = Number(args['unit-price'] || 2);
// 每筆的最低價。小額品項照單價算會變成個位數，那種價格路過的人會順手撿走
// （轉一批礦物時「藍寶殼 ×2 掛 4 元」就這樣沒了，暴露不到十秒）。
// 錢是自己人左手換右手，寧可掛貴一點也別讓東西飛掉。
const floorPrice = Number(args['floor-price'] || 30);
const exclude = new Set(String(args.exclude || '').split(',').filter(Boolean));
// 累積到這個總量才值得跑一趟——每筆都要掛單、查市場、買回，
// 為了三五個素材開一次市場不划算，而且每次掛單都有被路過的人撿走的風險。
const minTotal = Number(args['min-total'] || 0);
const only = new Set(String(args.only || '').split(',').filter(Boolean));

const from = new Client({
  token: fs.readFileSync(args.from, 'utf8').trim(), stateDir: STATE, label: args['from-label'] || 'from',
});
const to = new Client({
  token: fs.readFileSync(args.to, 'utf8').trim(), stateDir: STATE, label: args['to-label'] || 'to',
});

const listOf = (o) => o.mines || o.items || o.equipments || [];

async function pickSource() {
  if (kind === 'equipments') {
    const es = await from.equipments();
    let free = es.filter((e) => !e.equipped && e.state === 0 && !e.notForSale);
    if (only.size) free = free.filter((e) => only.has(e.name) || only.has(e.type));
    free = free.filter((e) => !exclude.has(e.name) && !exclude.has(e.type));
    free.sort((a, b) => (b.atk + b.def) - (a.atk + a.def));
    const top = Number(args.top || 0);
    return (top ? free.slice(0, top) : free).map((e) => ({
      id: e.id,
      label: `${e.quality}的${e.name}（${e.type} 攻${e.atk} 防${e.def} 耐${e.fullDur}）`,
      quantity: 1,
      // 裝備照回收價掛，這是遊戲自己給的估值，不會賤賣
      price: Math.max(floorPrice, e.recyclePrice || 1),
    }));
  }
  const inv = await from.get('/api/items');
  let mines = (inv.mines || []).filter((m) => m.available > 0);
  if (only.size) mines = mines.filter((m) => only.has(m.name));
  mines = mines.filter((m) => !exclude.has(m.name));
  return mines.map((m) => ({
    id: m.id,
    label: `${m.name} ×${m.available}`,
    name: m.name,
    quantity: m.available,
    price: Math.max(floorPrice, Math.round(m.available * unitPrice)),
  }));
}

(async () => {
  const items = await pickSource();
  if (!items.length) { console.log('沒有可轉移的東西'); return; }
  if (minTotal > 0) {
    const total = items.reduce((n, it) => n + it.quantity, 0);
    if (total < minTotal) {
      console.log(`只有 ${total} 份（門檻 ${minTotal}），先不轉，等累積夠再說`);
      return;
    }
    console.log(`累積 ${total} 份，達到門檻 ${minTotal}，開始轉`);
  }
  const seller = (await from.profile()).id;
  const budget = (await to.profile()).money;
  console.log(`要轉 ${items.length} 筆，買方現有 ${budget} 元`);
  if (exclude.size) console.log('排除:', [...exclude].join('、'));

  let spent = 0;
  let done = 0;
  for (const it of items) {
    if (spent + it.price > budget) {
      console.log(`跳過 ${it.label}：買方的錢不夠（要 ${it.price}，剩 ${budget - spent}）`);
      continue;
    }
    try {
      const sellPath = kind === 'equipments'
        ? `/api/equipments/${it.id}/sell`
        : `/api/items/${it.id}/sell`;
      const body = kind === 'equipments'
        ? { price: it.price, message: '轉帳' }
        : { price: it.price, quantity: it.quantity, message: '轉帳' };
      await from.post(sellPath, body);

      const market = await to.get(`/api/trades?type=${kind}`);
      // 認自己人掛的那一筆：賣方 id 對得上、價格對得上、素材名也對得上
      const hit = listOf(market).find((x) => x.sellerId === seller && x.price === it.price
        && (kind === 'equipments' ? true : x.name === it.name));
      if (!hit) { console.log(`✗ ${it.label}：掛上去了但市場找不到，可能被搶`); continue; }
      await to.post(`/api/trades/${hit.id}/buy`);
      spent += it.price;
      done++;
      console.log(`✓ ${it.label} → ${it.price} 元（累計 ${spent}）`);
    } catch (e) {
      console.log(`✗ ${it.label}：${e.message}`);
    }
    await sleep(gap);
  }
  console.log(`完成 ${done}/${items.length} 筆，共花 ${spent} 元`);
})().catch((e) => { console.error(e); process.exit(1); });
