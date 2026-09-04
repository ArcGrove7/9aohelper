// 全站搜尋索引產生器（2026-09-04）。
// 讀站內頁面的既有資料（zones 卡片、技能表、特效表、裝備表 EQ、素材表 M、
// 公式頁武器倍率表、版本線總覽），輸出 data/search-index.js。
// 站本身仍是零組建——這支只在內容變動時手動重跑，產物進版控：
//   node tools/build-search-index.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const doc = (p) => new JSDOM(read(p)).window.document;
const entries = [];
// 條目格式：[顯示名, 分類標籤, 連結, 額外關鍵字]
const add = (n, c, u, k = '') => entries.push([n, c, u, k]);

// 頁面本身
[['首頁', 'index.html', '9aohelper 圖鑑 攻略'],
 ['地圖圖鑑', 'zones.html', '地圖 秘境 王關 編號'],
 ['技能圖鑑', 'skills.html', '技能 招式 刷熟'],
 ['素材圖鑑', 'materials.html', '素材 鍛造 標籤 特效'],
 ['裝備圖鑑', 'effects.html', '裝備 係數 品質 特效 附魔'],
 ['公式與武器', 'formulas.html', '傷害 公式 熟練 折算 倍率 戰報'],
 ['配點攻略', 'stats.html', '配點 能力點 屬性 天賦'],
 ['點數計算機', 'allocation.html', '計算機 工具 配點'],
 ['版本情報', 'updates.html', '更新 日誌 版本 changelog'],
].forEach(([n, u, k]) => add(n, '頁面', u, k));

// 地圖：zones.html 的圖鑑卡片
for (const card of doc('zones.html').querySelectorAll('.zcard')) {
  const name = card.querySelector('h3').childNodes[0].textContent.trim();
  const key = card.querySelector('.zkey').textContent.trim();
  const meta = [...card.querySelectorAll('.zmeta span')].map((s) => s.textContent).join(' ');
  add(name, '地圖', 'zones.html', key + ' ' + meta);
  const realm = meta.match(/秘境：([^（(]+)/);
  if (realm) realm[1].split(/[／]/).forEach((r) =>
    add(r.trim(), '秘境', 'zones.html', name + ' ' + key));
}

// 技能：skills.html 總表（名／型別／說明）
for (const tr of doc('skills.html').querySelectorAll('table tbody tr')) {
  const [n, t, d] = [...tr.children].map((td) => td.textContent.trim());
  add(n, '技能・' + t, 'skills.html', d);
}

// 特效：effects.html 總表（名／分類／機制／鍵）
for (const tr of doc('effects.html').querySelectorAll('table tbody tr')) {
  const [n, c, d, k] = [...tr.children].map((td) => td.textContent.trim());
  add(n, '特效・' + c, 'effects.html', k + ' ' + d);
}

// 裝備類型：effects.html 內嵌的 EQ 表（合法 JSON）
const eqSrc = read('effects.html').match(/const EQ=(\[.*?\]);\n/s)[1];
for (const e of JSON.parse(eqSrc)) add(e.n, '裝備・' + e.slot, 'effects.html', e.tag + ' ' + e.d);

// 素材：materials.html 內嵌的 M 表（在沙盒裡執行那一行拿陣列）
const mSrc = read('materials.html').match(/const M=(\[\[.*?\]\]);/s)[1];
const M = vm.runInNewContext('(' + mSrc + ')');
for (const [name, , , , , , tags, fx] of M) add(name, '素材', 'materials.html', tags + ' ' + fx);

// 武器型別倍率：formulas.html §3 表的第一欄
for (const tr of doc('formulas.html').querySelectorAll('table[data-search] tr')) {
  const td = tr.querySelector('td');
  if (td) add(td.textContent.trim(), '武器倍率', 'formulas.html', '型別 倍率');
}

// 版本線：updates.html 總覽
for (const tr of doc('updates.html').querySelectorAll('table:not([data-search]) tbody tr')) {
  const [v, t] = [...tr.children].map((td) => td.textContent.trim());
  add('v' + v + ' ' + t, '版本線', 'updates.html', '更新');
}

const out = '/* 由 tools/build-search-index.js 產生——不要手改，改來源頁後重跑 */\n'
  + 'window.SEARCH_INDEX=' + JSON.stringify(entries) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'search-index.js'), out);
console.log('條目數：' + entries.length + '，寫入 data/search-index.js（'
  + Buffer.byteLength(out) + ' bytes）');
