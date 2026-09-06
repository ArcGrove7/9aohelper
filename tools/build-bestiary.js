#!/usr/bin/env node
'use strict';
// 把 capture/hunt-reports.jsonl 的戰報彙整成敵人圖鑑素材。
//
//   node tools/build-bestiary.js
//
// 產出：
//   capture/bestiary.json  機器讀的彙整結果（後續建站用）
//   capture/bestiary.md    人讀的一覽表
//
// 規矩：這裡只做「戰報裡看得到的事實」的歸納——出沒地點、等級／HP／體力的
// 觀測區間、用過的技能、同場出現的敵人、該場的掉落與經驗。
// 掉落訊息不標示是哪隻怪掉的，所以只能記成「同場出現」，不要當成單隻的掉落表。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'capture', 'hunt-reports.jsonl');
const OUT_JSON = path.join(ROOT, 'capture', 'bestiary.json');
const OUT_MD = path.join(ROOT, 'capture', 'bestiary.md');

// 同場出現多隻同種會加編號（野狗1、野狗2）。去掉尾巴的數字取基底名。
function baseName(name) {
  return String(name).replace(/\d+$/, '') || String(name);
}

function range(r, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return r;
  if (!r) return { min: v, max: v, n: 1, sum: v };
  r.min = Math.min(r.min, v);
  r.max = Math.max(r.max, v);
  r.n++;
  r.sum += v;
  return r;
}
const fmtRange = (r) => (!r ? '—' : r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`找不到 ${IN}，先跑 tools/gao-bot.js 蒐戰報`);
    process.exit(1);
  }
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter((l) => l.trim());
  const reports = [];
  for (const l of lines) {
    try { reports.push(JSON.parse(l)); } catch { /* 壞行跳過 */ }
  }

  const enemies = new Map(); // 基底名 → 彙整
  const spots = new Map();   // 「地圖 樓層」 → 該點的掉落與經驗

  for (const rep of reports) {
    const zone = rep.zone;
    const stage = rep.stage;
    const spotKey = `${zone} ${stage}`;
    const allies = new Set((rep.a || []).map((x) => x.name));
    const foes = new Set((rep.b || []).map((x) => x.name));

    if (!spots.has(spotKey)) {
      spots.set(spotKey, { zone, stage, battles: 0, drops: new Map(), exp: null, lineups: new Map() });
    }
    const spot = spots.get(spotKey);
    spot.battles++;

    const lineup = (rep.b || []).map((b) => baseName(b.name)).sort();
    const lineupKey = lineup.join('、');
    spot.lineups.set(lineupKey, (spot.lineups.get(lineupKey) || 0) + 1);

    for (const b of rep.b || []) {
      const key = baseName(b.name);
      if (!enemies.has(key)) {
        enemies.set(key, {
          name: key, seen: 0, battles: 0, zones: new Map(),
          lv: null, hp: null, sp: null,
          skills: new Map(), withEnemies: new Map(), deaths: 0,
        });
      }
      const e = enemies.get(key);
      e.seen++;
      e.lv = range(e.lv, b.lv);
      e.hp = range(e.hp, b.hp);
      e.sp = range(e.sp, b.sp);
      const zk = `${zone} ${stage}`;
      e.zones.set(zk, (e.zones.get(zk) || 0) + 1);
      for (const other of lineup) {
        if (other === key) continue;
        e.withEnemies.set(other, (e.withEnemies.get(other) || 0) + 1);
      }
    }
    for (const key of new Set(lineup)) enemies.get(key).battles++;

    for (const msg of rep.messages || []) {
      const m = msg.m || '';

      // 技能：「A對B使出了X，…」／「A對B使出X，造成 N 傷害」
      const skill = m.match(/^(.+?)對(.+?)使出了?(.+?)(?:，|$)/);
      if (skill) {
        const actor = skill[1];
        const what = skill[3];
        if (foes.has(actor)) {
          const e = enemies.get(baseName(actor));
          if (e) e.skills.set(what, (e.skills.get(what) || 0) + 1);
        }
        continue;
      }

      // 陣亡
      const dead = m.match(/^(.+?)被擊殺死亡了$/);
      if (dead && foes.has(dead[1])) {
        const e = enemies.get(baseName(dead[1]));
        if (e) e.deaths++;
        continue;
      }

      // 掉落：「獲得了 X」／「獲得了 X × 2」
      const drop = m.match(/^獲得了(.+?)(?:\s*×\s*(\d+))?$/);
      if (drop) {
        const item = drop[1].trim();
        const qty = Number(drop[2] || 1);
        spot.drops.set(item, (spot.drops.get(item) || 0) + qty);
        continue;
      }

      // 經驗
      const exp = m.match(/^每位英雄獲得了\s*(\d+)\s*點經驗值$/);
      if (exp) spot.exp = range(spot.exp, Number(exp[1]));
    }
  }

  const sortedEnemies = [...enemies.values()].sort(
    (a, b) => (a.lv && b.lv ? a.lv.min - b.lv.min : 0) || a.name.localeCompare(b.name, 'zh-Hant'),
  );

  const json = {
    generatedAt: new Date().toISOString(),
    reportCount: reports.length,
    enemyCount: sortedEnemies.length,
    enemies: sortedEnemies.map((e) => ({
      name: e.name,
      seen: e.seen,
      battles: e.battles,
      killed: e.deaths,
      lv: e.lv && { min: e.lv.min, max: e.lv.max },
      hp: e.hp && { min: e.hp.min, max: e.hp.max, avg: Math.round(e.hp.sum / e.hp.n) },
      sp: e.sp && { min: e.sp.min, max: e.sp.max, avg: Math.round(e.sp.sum / e.sp.n) },
      spots: Object.fromEntries([...e.zones].sort((a, b) => b[1] - a[1])),
      skills: Object.fromEntries([...e.skills].sort((a, b) => b[1] - a[1])),
      appearsWith: Object.fromEntries([...e.withEnemies].sort((a, b) => b[1] - a[1])),
    })),
    spots: [...spots.values()]
      .sort((a, b) => a.zone.localeCompare(b.zone, 'zh-Hant') || a.stage - b.stage)
      .map((s) => ({
        zone: s.zone,
        stage: s.stage,
        battles: s.battles,
        exp: s.exp && { min: s.exp.min, max: s.exp.max, avg: Math.round(s.exp.sum / s.exp.n) },
        drops: Object.fromEntries([...s.drops].sort((a, b) => b[1] - a[1])),
        lineups: Object.fromEntries([...s.lineups].sort((a, b) => b[1] - a[1])),
      })),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

  // ---- 人讀版 ----
  const md = [];
  md.push('# 敵人觀測彙整');
  md.push('');
  md.push(`由 \`tools/build-bestiary.js\` 從 ${reports.length} 份狩獵戰報生成，請勿手改。`);
  md.push(`生成時間：${json.generatedAt}`);
  md.push('');
  md.push('數值是**觀測區間**，不是設定值——同一隻怪每次出現的 HP／體力都不一樣，');
  md.push('這裡記的是目前看過的最小到最大。掉落記在「出沒地點」那一節：');
  md.push('戰報不寫哪一隻掉的，只能歸到該樓層。');
  md.push('');
  md.push('## 敵人');
  md.push('');
  md.push('| 敵人 | 等級 | HP | 體力 | 出沒 | 遭遇場次 | 技能 |');
  md.push('|---|---|---|---|---|---|---|');
  for (const e of json.enemies) {
    const spots = Object.keys(e.spots).join('、') || '—';
    const skills = Object.entries(e.skills).map(([k, v]) => `${k}×${v}`).join('、') || '—';
    md.push(`| ${e.name} | ${e.lv ? fmtRange({ min: e.lv.min, max: e.lv.max }) : '—'} | ${e.hp ? `${e.hp.min}–${e.hp.max}` : '—'} | ${e.sp ? `${e.sp.min}–${e.sp.max}` : '—'} | ${spots} | ${e.battles} | ${skills} |`);
  }
  md.push('');
  md.push('## 出沒地點');
  md.push('');
  for (const s of json.spots) {
    md.push(`### ${s.zone} ${s.stage} 樓`);
    md.push('');
    md.push(`- 戰鬥場次：${s.battles}`);
    if (s.exp) md.push(`- 每場經驗：${s.exp.min}–${s.exp.max}（平均 ${s.exp.avg}）`);
    const drops = Object.entries(s.drops);
    if (drops.length) {
      md.push('- 掉落累計：');
      for (const [k, v] of drops) md.push(`  - ${k} × ${v}`);
    }
    const lineups = Object.entries(s.lineups).slice(0, 12);
    if (lineups.length) {
      md.push('- 敵人組合（前 12 種）：');
      for (const [k, v] of lineups) md.push(`  - ${k}（${v} 場）`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log(`戰報 ${reports.length} 份 → 敵人 ${json.enemyCount} 種、地點 ${json.spots.length} 處`);
  console.log(`寫出 ${path.relative(ROOT, OUT_JSON)}、${path.relative(ROOT, OUT_MD)}`);
}

main();
