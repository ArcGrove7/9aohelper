#!/usr/bin/env node
'use strict';
// 把戰報訊息抽成「模板」並統計，作為戰鬥機制頁的素材。
//
//   node tools/build-messages.js
//
// 做法：把訊息裡的角色名換成 {我方}／{敵方}、數字換成 {n}，
// 剩下的骨架就是遊戲的文本模板。同一個模板出現幾次、標成什麼顏色類別
// （s 欄：skill／lucky／strong／critical／sub…），都一起記下來。
//
// 產出：
//   capture/message-templates.json
//   capture/message-templates.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 時間一律用台灣時間（UTC+8）——人下的令
function twStamp(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+8)';
}
// 狩獵與 PvP 的訊息共用同一套文本，所以三種戰報一起吃。
// PvP 的 a／b 兩邊都是玩家英雄，模板化成 {我方}／{敵方} 之後語意一樣通順。
const INPUTS = ['hunt-reports.jsonl', 'attack-reports.jsonl', 'defend-reports.jsonl']
  .map((f) => path.join(ROOT, 'capture', f));
const OUT_JSON = path.join(ROOT, 'capture', 'message-templates.json');
const OUT_MD = path.join(ROOT, 'capture', 'message-templates.md');

// s 欄的顏色類別（拆自前端 report 模組）
const STYLE_LABEL = {
  default: '一般', info: '資訊', exp: '經驗', subInfo: '次要資訊', sub: '未命中',
  skill: '技能', strong: '強力', heal: '治療', lucky: '幸運事件',
  critical: '致命', state: '狀態',
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function main() {
  const files = INPUTS.filter((f) => fs.existsSync(f));
  if (!files.length) {
    console.error('capture/ 底下找不到任何戰報，先跑 tools/gao-bot.js');
    process.exit(1);
  }
  const reports = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean));

  const templates = new Map();

  for (const rep of reports) {
    const allies = (rep.a || []).map((x) => x.name);
    const foes = (rep.b || []).map((x) => x.name);
    // 長名字先換，免得「野狗1」被「野狗」吃掉半截
    const subs = [
      ...allies.map((n) => [n, '{我方}']),
      ...foes.map((n) => [n, '{敵方}']),
    ].sort((a, b) => b[0].length - a[0].length);

    for (const msg of rep.messages || []) {
      let t = msg.m || '';
      for (const [name, token] of subs) t = t.split(name).join(token);
      // 裝備名可能任意，但數字一律抽掉
      t = t.replace(/\d+/g, '{n}');
      if (!t) continue;

      if (!templates.has(t)) {
        templates.set(t, { template: t, count: 0, styles: new Map(), crucial: 0, dmged: new Map(), sample: msg.m });
      }
      const e = templates.get(t);
      e.count++;
      const s = msg.s || 'default';
      e.styles.set(s, (e.styles.get(s) || 0) + 1);
      if (msg.crucial) e.crucial++;
      if (msg.dmged) e.dmged.set(msg.dmged, (e.dmged.get(msg.dmged) || 0) + 1);
    }
  }

  const list = [...templates.values()].sort((a, b) => b.count - a.count);
  const json = {
    generatedAt: new Date().toISOString(),
    reportCount: reports.length,
    templateCount: list.length,
    templates: list.map((e) => ({
      template: e.template,
      count: e.count,
      styles: Object.fromEntries(e.styles),
      crucial: e.crucial,
      damaged: Object.fromEntries(e.dmged),
      sample: e.sample,
    })),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  // 依顏色類別分組，人比較好讀
  const byStyle = new Map();
  for (const e of json.templates) {
    const main = Object.entries(e.styles).sort((a, b) => b[1] - a[1])[0][0];
    if (!byStyle.has(main)) byStyle.set(main, []);
    byStyle.get(main).push(e);
  }

  const md = ['# 戰報文本模板', '',
    `由 \`tools/build-messages.js\` 從 ${reports.length} 份戰報（狩獵＋對戰）生成，請勿手改。`,
    `生成時間：${twStamp(json.generatedAt)}`, '',
    `共 ${json.templateCount} 種模板。角色名換成 \`{我方}\`／\`{敵方}\`，數字換成 \`{n}\`。`,
    '分組依據是遊戲自己給訊息標的顏色類別。', ''];
  const order = ['skill', 'lucky', 'strong', 'critical', 'state', 'heal', 'sub', 'info', 'exp', 'subInfo', 'default'];
  const keys = [...byStyle.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  for (const k of keys) {
    md.push(`## ${STYLE_LABEL[k] || k}（\`${k}\`）`, '');
    md.push('| 次數 | 模板 |', '|---|---|');
    for (const e of byStyle.get(k)) md.push(`| ${e.count} | ${e.template.replace(/\|/g, '\\|')} |`);
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log(`戰報 ${reports.length} 份 → 文本模板 ${json.templateCount} 種`);
  console.log(`寫出 ${path.relative(ROOT, OUT_JSON)}、${path.relative(ROOT, OUT_MD)}`);
}

main();
