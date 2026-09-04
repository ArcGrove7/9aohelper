// 實體資料庫產生器（2026-09-05）。
// 把站內各頁既有的資料抽成一份實體庫 data/db.js，並自動生成雙向關聯：
//   素材 ↔ 特效、技能 ↔ 武器型別、地圖 ↔ 秘境、實體 ↔ 版本情報（名稱命中）。
// 反向關聯一律在這裡生成，不在頁面各自維護；同時做完整性檢查：
//   id 唯一、素材引用的特效必須存在、地圖鍵不重複——壞了就整個 build 失敗。
// 內容變動後重跑：node tools/build-db.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const doc = (p) => new JSDOM(read(p)).window.document;
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };

const GAME_VERSION = '3.1.8';

/* ---- 特效（31 種：名／分類／機制／鍵） ---- */
const effects = [];
for (const tr of doc('effects.html').querySelectorAll('table[data-search] tbody tr')) {
  const [n, cat, mech, key] = [...tr.children].map((td) => td.textContent.trim());
  effects.push({ id: n, cat, mech, key, materials: [] });
}
if (effects.length !== 31) fail('特效應為 31 種，讀到 ' + effects.length);
const effectById = Object.fromEntries(effects.map((e) => [e.id, e]));

/* ---- 素材（241 種）＋ 素材→特效、特效→素材 ---- */
const mSrc = read('materials.html').match(/const M=(\[\[.*?\]\]);/s)[1];
const M = vm.runInNewContext('(' + mSrc + ')');
const materials = M.map(([n, atk, def, luck, wt, dur, tags, fx]) => {
  const fxList = String(fx || '').split('|').filter(Boolean).map((s) => {
    const [en, v] = s.split(':');
    return { e: en.trim(), v: Number(v) };
  });
  fxList.forEach((f) => {
    if (!effectById[f.e]) fail('素材「' + n + '」引用不存在的特效「' + f.e + '」');
    else effectById[f.e].materials.push(n);
  });
  return {
    id: n, atk, def, luck, wt, dur,
    tags: String(tags || '').split('·').map((s) => s.trim()).filter(Boolean),
    effects: fxList,
  };
});
if (materials.length !== 241) fail('素材應為 241 種，讀到 ' + materials.length);

/* ---- 技能（197 招，14 種型別）＋ 取得方式 ---- */
const skills = [];
for (const tr of doc('skills.html').querySelectorAll('table[data-search] tbody tr')) {
  const [n, type, desc, gid, acq, note] = [...tr.children].map((td) => td.textContent.trim());
  skills.push({ id: n, type, desc,
    gid: gid === '—' ? null : Number(gid),
    acq: acq === '—' ? '' : acq,
    note: note === '—' ? '' : note });
}
if (skills.length !== 197) fail('技能應為 197 招，讀到 ' + skills.length);

/* ---- 裝備類型（15 種，效果頁內嵌 EQ 表） ---- */
const eqSrc = read('effects.html').match(/const EQ=(\[.*?\]);\n/s)[1];
const eqtypes = JSON.parse(eqSrc).map((e) => ({
  id: e.n, desc: e.d, slot: e.slot, hand: e.hand, tag: e.tag,
  q: e.q, a: e.a, df: e.df, l: e.l, u: e.u,
}));
if (eqtypes.length !== 15) fail('裝備類型應為 15 種，讀到 ' + eqtypes.length);

/* ---- 地圖（13 張，地圖圖鑑卡片） ---- */
const zones = [];
for (const card of doc('zones.html').querySelectorAll('.zcard')) {
  const name = card.querySelector('h3').childNodes[0].textContent.trim();
  const key = card.querySelector('.zkey').textContent.trim();
  const num = card.querySelector('.znum').textContent.trim();
  const desc = card.querySelector('.zdesc').textContent.trim();
  const meta = [...card.querySelectorAll('.zmeta span')].map((s) => s.textContent.trim());
  const realm = (meta.find((m) => m.startsWith('秘境：')) || '').replace('秘境：', '') || null;
  zones.push({ id: key, n: name, num, desc, realm, town: card.classList.contains('town'), meta });
}
if (zones.length !== 13) fail('地圖應為 13 張，讀到 ' + zones.length);
const dupZone = zones.map((z) => z.id).filter((k, i, a) => a.indexOf(k) !== i);
if (dupZone.length) fail('地圖鍵重複：' + dupZone.join(','));

/* ---- 敵人（敵人圖鑑頁；玩家共編資料）＋ 掉落關聯 ---- */
const zoneByName = Object.fromEntries(zones.map((z) => [z.n, z.id]));
const matSet = new Set(materials.map((m) => m.id));
const skillSet = new Set(skills.map((x) => x.id));
const splitList = (s) => String(s || '').replace(/—/g, '')
  .split(/[、,，\/／]/).map((t) => t.trim()).filter(Boolean);
const enemies = [];
for (const tr of doc('enemies.html').querySelectorAll('table[data-search] tbody tr')) {
  const a = tr.querySelector('a');
  const id = new URLSearchParams(a.getAttribute('href').split('?')[1]).get('id');
  const c = [...tr.children].map((td) => td.textContent.trim().replace(/^—$/, ''));
  const e = { id, n: c[0], zone: c[1], at: c[2], hp: c[3], lv: c[4], race: c[5],
              drops: c[6], books: c[7], scrolls: c[8], potions: c[9], other: c[10],
              equip: c[11], skills: c[12] };
  if (!zoneByName[e.zone]) fail('敵人「' + e.n + '」的地圖「' + e.zone + '」不在地圖圖鑑');
  e.zoneId = zoneByName[e.zone];
  e.dropIds = splitList(e.drops).filter((x) => matSet.has(x));
  e.bookIds = splitList(e.books).filter((x) => skillSet.has(x));
  enemies.push(e);
}
if (enemies.length < 140) fail('敵人少於 140 隻，讀到 ' + enemies.length);
{
  const dup = enemies.map((x) => x.id).filter((k, i, a2) => a2.indexOf(k) !== i);
  if (dup.length) fail('敵人 id 重複：' + [...new Set(dup)].join(','));
}
// 反向關聯：素材←掉落來源、技能←技能書來源、地圖←敵人
const matSources = Object.create(null);
const skillBooks = Object.create(null);
const zoneEnemies = Object.create(null);
for (const e of enemies) {
  e.dropIds.forEach((m) => (matSources[m] = matSources[m] || []).push({ e: e.id, at: e.at || e.zone }));
  e.bookIds.forEach((k) => (skillBooks[k] = skillBooks[k] || []).push(e.id));
  (zoneEnemies[e.zoneId] = zoneEnemies[e.zoneId] || []).push(e.id);
}

/* ---- 武器型別倍率（公式頁 §3 表；比較器要用） ---- */
const wmult = [];
for (const tr of doc('formulas.html').querySelectorAll('table[data-search] tr')) {
  const tds = [...tr.children].filter((c) => c.tagName === 'TD');
  if (tds.length !== 7) continue;
  const [label, hit, block, dodge, pierce, cres, consec] = tds.map((td) => td.textContent.trim());
  wmult.push({
    id: label,
    hit: Number(hit), block: Number(block), dodge: Number(dodge),
    pierce: Number(pierce), cres: Number(cres), consec: Number(consec),
  });
}
if (wmult.length !== 21) fail('武器倍率應為 21 列，讀到 ' + wmult.length);
if (wmult.some((w) => [w.hit, w.block, w.dodge, w.pierce, w.cres, w.consec].some((v) => !(v > 0))))
  fail('武器倍率有非正數，來源表可能改了欄位順序');

/* ---- 版本情報關聯：實體名稱在更新內容裡的命中（每實體最新 8 筆） ---- */
const updates = [];
for (const tr of doc('updates.html').querySelectorAll('table[data-search] tbody tr')) {
  const [v, date, type, text] = [...tr.children].map((td) => td.textContent.trim());
  updates.push({ v, date, type, text });
}
if (updates.length < 500) fail('更新紀錄少於 500 條，讀到 ' + updates.length);
function related(name, extra) {
  const keys = [name].concat(extra || []).filter((k) => k && k.length >= 2);
  const hits = updates.filter((u) => keys.some((k) => u.text.includes(k)));
  return hits.slice(0, 8);
}

/* ---- 名稱唯一性（跨型別的 id 空間各自獨立，但同型別必須唯一） ---- */
for (const [label, list] of [['素材', materials], ['特效', effects], ['技能', skills],
                             ['裝備類型', eqtypes], ['地圖', zones]]) {
  const dup = list.map((x) => x.id).filter((k, i, a) => a.indexOf(k) !== i);
  if (dup.length) fail(label + ' id 重複：' + [...new Set(dup)].join(','));
}

/* ---- 帶上版本情報關聯後輸出 ---- */
const db = {
  version: GAME_VERSION,
  built: new Date().toISOString().slice(0, 10),
  materials: materials.map((m) => ({ ...m, sources: matSources[m.id] || [], upd: related(m.id) })),
  effects: effects.map((e) => ({ ...e, upd: related(e.id, [e.key]) })),
  skills: skills.map((s) => ({ ...s, books: skillBooks[s.id] || [], upd: related(s.id) })),
  eqtypes: eqtypes.map((e) => ({ ...e, upd: related(e.id) })),
  zones: zones.map((z) => ({ ...z, enemies: zoneEnemies[z.id] || [],
    upd: related(z.n, z.realm ? [z.realm.split('（')[0]] : []) })),
  enemies,
  wmult,
};

if (process.exitCode) {
  console.error('完整性檢查未通過，data/db.js 未更新');
  process.exit(1);
}
const out = '/* 由 tools/build-db.js 產生——不要手改，改來源頁後重跑 */\n'
  + 'window.DB=' + JSON.stringify(db) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'db.js'), out);
const withUpd = (l) => l.filter((x) => x.upd.length).length;
console.log('data/db.js（' + Buffer.byteLength(out) + ' bytes）：'
  + '素材 ' + db.materials.length + '（' + withUpd(db.materials) + ' 有版本紀錄）、'
  + '特效 ' + db.effects.length + '（' + withUpd(db.effects) + '）、'
  + '技能 ' + db.skills.length + '（' + withUpd(db.skills) + '）、'
  + '裝備 ' + db.eqtypes.length + '（' + withUpd(db.eqtypes) + '）、'
  + '地圖 ' + db.zones.length + '（' + withUpd(db.zones) + '）、'
  + '敵人 ' + db.enemies.length + '（素材掉落來源 '
  + db.materials.filter((m) => m.sources.length).length + ' 種）');
