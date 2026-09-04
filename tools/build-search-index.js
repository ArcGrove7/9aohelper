// 全站搜尋索引產生器（2026-09-05 改版）。
// 實體條目（素材／特效／技能／裝備類型／地圖）從 data/db.js 讀，直接連到
// detail.html 的單頁；頁面、武器倍率、版本線維持連到列表頁。
// 站本身仍是零組建——內容變動後重跑，產物進版控：
//   node tools/build-db.js && node tools/build-search-index.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const doc = (p) => new JSDOM(read(p)).window.document;

const sandbox = { window: {} };
vm.runInNewContext(read('data/db.js'), sandbox);
const DB = sandbox.window.DB;
if (!DB) { console.error('data/db.js 讀不到——先跑 node tools/build-db.js'); process.exit(1); }

const entries = [];
// 條目格式：[顯示名, 分類標籤, 連結, 額外關鍵字]
const add = (n, c, u, k = '') => entries.push([n, c, u, k]);
const detail = (t, id) => 'detail.html?t=' + t + '&id=' + encodeURIComponent(id);

// 頁面本身
[['首頁', 'index.html', '9aohelper 圖鑑 攻略'],
 ['地圖圖鑑', 'zones.html', '地圖 秘境 王關 編號'],
 ['敵人圖鑑', 'enemies.html', '敵人 怪物 掉落 出沒'],
 ['技能圖鑑', 'skills.html', '技能 招式 刷熟'],
 ['素材圖鑑', 'materials.html', '素材 鍛造 標籤 特效'],
 ['裝備圖鑑', 'effects.html', '裝備 係數 品質 特效 附魔'],
 ['公式與武器', 'formulas.html', '傷害 公式 熟練 折算 倍率 戰報'],
 ['配點攻略', 'stats.html', '配點 能力點 屬性 天賦'],
 ['點數計算機', 'allocation.html', '計算機 工具 配點 配置 PVE PVP'],
 ['武器比較器', 'compare.html', '比較 武器 輸出 折算 倍率 工具'],
 ['版本情報', 'updates.html', '更新 日誌 版本 changelog'],
].forEach(([n, u, k]) => add(n, '頁面', u, k));

// 實體：全部連到詳情頁
for (const z of DB.zones) {
  add(z.n, '地圖', detail('zone', z.id), z.id + ' ' + z.meta.join(' '));
  if (z.realm) z.realm.split('（')[0].split('／').forEach((r) =>
    add(r.trim(), '秘境', detail('zone', z.id), z.n + ' ' + z.id));
}
for (const s of DB.skills) add(s.id, '技能・' + s.type, detail('skill', s.id), s.desc);
for (const e of DB.effects) add(e.id, '特效・' + e.cat, detail('effect', e.id), e.key + ' ' + e.mech);
for (const e of DB.eqtypes) add(e.id, '裝備・' + e.slot, detail('eqtype', e.id), e.tag + ' ' + e.desc);
for (const e of DB.enemies)
  add(e.n, '敵人・' + e.zone, detail('enemy', e.id),
    (e.race || '') + ' ' + e.drops + ' ' + e.books);
for (const m of DB.materials)
  add(m.id, '素材', detail('material', m.id),
    m.tags.join(' ') + ' ' + m.effects.map((f) => f.e).join(' '));

// 武器型別倍率：formulas.html §3 表的第一欄
for (const tr of doc('formulas.html').querySelectorAll('table[data-search] tr')) {
  const td = tr.querySelector('td');
  if (td) add(td.textContent.trim(), '武器倍率', 'formulas.html?q=' + encodeURIComponent(td.textContent.trim()), '型別 倍率');
}

// 版本線：updates.html 總覽
for (const tr of doc('updates.html').querySelectorAll('table:not([data-search]) tbody tr')) {
  const [v, t] = [...tr.children].map((td) => td.textContent.trim());
  add('v' + v + ' ' + t, '版本線', 'updates.html?q=' + encodeURIComponent(v), '更新');
}

const out = '/* 由 tools/build-search-index.js 產生——不要手改，改來源後重跑 */\n'
  + 'window.SEARCH_INDEX=' + JSON.stringify(entries) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'search-index.js'), out);
console.log('條目數：' + entries.length + '，寫入 data/search-index.js（'
  + Buffer.byteLength(out) + ' bytes）');
