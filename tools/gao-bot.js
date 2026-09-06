#!/usr/bin/env node
'use strict';
// 主控迴圈：照 tools/gao/plan.js 的劇本操作帳號，順手把每一份戰報存進 JSONL。
//
//   node tools/gao-bot.js --token-file <檔> [--minutes 60] [--state <目錄>]
//
// 請求額度由 tools/gao/api.js 的 RateLimiter 管住（500/hr，人下的令是 600）。
// 狩獵一次就回傳一份完整戰報，所以「打一場＝一次請求」，不用另外抓 report。

const fs = require('fs');
const path = require('path');
const { Client, ApiError, ActionState, sleep } = require('./gao/api.js');
const { ReportStore } = require('./gao/capture.js');
const plan = require('./gao/plan.js');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = args.state || path.join(ROOT, '.gao-state');
const RUN_MINUTES = Number(args.minutes || 60);
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;

const token = fs.readFileSync(args['token-file'], 'utf8').trim();
fs.mkdirSync(STATE_DIR, { recursive: true });

const store = new ReportStore(path.join(ROOT, 'capture', 'hunt-reports.jsonl'));
const client = new Client({ token, stateDir: STATE_DIR, label: 'u140' });

const PHASE_FILE = path.join(STATE_DIR, 'phase.json');
let state = readJson(PHASE_FILE) || { phase: 'probe', routeIdx: 0, deaths: 0, hunts: 0 };

function log(...a) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] [${state.phase}] ${a.join(' ')}`);
}
function saveState() { fs.writeFileSync(PHASE_FILE, JSON.stringify(state, null, 1)); }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}

// 存戰報並回報這場有沒有人倒下
function keepReport(report) {
  if (!report) return { saved: false };
  const isNew = store.add(report);
  if (isNew) state.hunts++;
  return { saved: isNew };
}

// huntAvailableAt 是伺服器時間，等到冷卻過去
async function waitHuntCooldown(info) {
  if (!info || !info.huntAvailableAt) return;
  const wait = new Date(info.huntAvailableAt).getTime() - client.now();
  if (wait > 0) await sleep(Math.min(wait + 200, 60000));
}

const isDown = (h) => h.hp <= 0;

// ---- 動作積木 ----

async function backToTown() {
  const info = await client.huntInfo();
  if (info.huntZone === 0 && info.huntStage === 0) return info;
  log('回城');
  await client.move(0);
  for (let i = 0; i < 40; i++) {
    try {
      const r = await client.moveComplete();
      log('已回到城鎮');
      return r;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      await sleep(15000);
    }
  }
  throw new Error('回城逾時');
}

async function reviveAndRest() {
  try {
    const r = await client.reviveAll();
    const reviving = (r.heroes || []).filter((h) => h.actionState === ActionState.Reviving);
    if (reviving.length) {
      log(`重生中 ${reviving.length} 隻，等 10 分鐘`);
      for (let i = 0; i < 45; i++) {
        await sleep(30000);
        try { await client.reviveAllComplete(); log('重生完成'); break; } catch { /* 還沒好 */ }
      }
    }
  } catch (e) { log('reviveAll:', e.message); }

  try {
    await client.restAll();
    log(`全隊休息 ${Math.round(plan.restMs / 1000)} 秒`);
    await sleep(plan.restMs);
    const r = await client.restAllComplete();
    log('休息完成:', (r.messages || []).join(' / ') || '（無）');
    return r.huntInfo;
  } catch (e) { log('restAll:', e.message); }
  return null;
}

// 把不該跟著跑的人踢出隊伍
async function setParty(keepIds) {
  const heroes = await client.heroes();
  for (const h of heroes) {
    const want = keepIds.includes(h.id);
    if (h.selected && !want) { await client.deselect(h.id); log(`${h.name} 離隊`); }
    else if (!h.selected && want) { await client.select(h.id); log(`${h.name} 入隊`); }
  }
  return client.heroes();
}

// 挖礦組／鍛造組的例行維護：完成了就再開一輪
async function tendWorkers(heroes) {
  for (const h of heroes) {
    const mineTarget = plan.miners[h.id];
    const smith = plan.smiths[h.id];
    if (!mineTarget && !smith) continue;
    if (h.hp <= 0) continue;
    if (h.huntZone !== 0 || h.huntStage !== 0) continue; // 只能在城裡做

    try {
      if (h.actionState === ActionState.Mining && h.canComplete) {
        const r = await client.completeAction(h.id);
        const got = (r.miningResult || []).map((m) => m.m).join('；');
        log(`${h.name} 挖礦完成：${got || '（無收穫）'}`);
        appendWorkLog({ kind: 'mining', hero: h.name, target: mineTarget, messages: r.miningResult || [] });
        h.actionState = ActionState.Idle;
        h.sp = (r.hero && r.hero.sp) != null ? r.hero.sp : h.sp;
      } else if (h.actionState === ActionState.Forging && h.canComplete) {
        const r = await client.completeForge(h.id);
        log(`${h.name} 鍛造完成`);
        appendWorkLog({ kind: 'forge', hero: h.name, result: r.equipment || r.message || null });
        h.actionState = ActionState.Idle;
      }
    } catch (e) { log(`${h.name} 完成行動失敗：${e.message}`); }

    if (h.actionState !== ActionState.Idle) continue;

    try {
      if (mineTarget) {
        if (h.sp <= 20) { await client.rest(h.id); log(`${h.name} 體力不足，休息`); continue; }
        await client.mining(h.id, mineTarget);
        log(`${h.name} 開始挖礦（礦區 ${mineTarget}）`);
      } else if (smith) {
        await startForge(h, smith);
      }
    } catch (e) { log(`${h.name} 開始行動失敗：${e.message}`); }
  }
}

// 從庫存挑素材下去打。挑法：同種素材優先湊滿該武器的素材上限。
async function startForge(hero, smith) {
  const inv = await client.get('/api/items');
  const mines = (inv.mines || []).filter((m) => m.available > 0);
  if (!mines.length) { log(`${hero.name} 沒有素材可鍛造`); return; }
  const limit = FORGE_LIMIT[smith.type] || 16;

  // 挑數量最多的素材墊底，湊到上限為止
  const sorted = mines.slice().sort((a, b) => b.available - a.available);
  const picked = [];
  let total = 0;
  for (const m of sorted) {
    if (total >= limit) break;
    const take = Math.min(m.available, limit - total);
    picked.push({ itemId: m.id, quantity: take });
    total += take;
  }
  if (!total) { log(`${hero.name} 素材不足`); return; }
  const body = {
    heroId: hero.id,
    target: smith.forgeSlot || 1,
    name: smith.name,
    type: smith.type,
    selectedMines: picked,
  };
  await client.forge(body);
  log(`${hero.name} 開始鍛造「${smith.name}」（${smith.type}，素材 ${total} 份）`);
  appendWorkLog({ kind: 'forge-start', hero: hero.name, body });
}

// 各武器/防具的素材上限（拆自前端）
const FORGE_LIMIT = {
  sword: 16, rapier: 14, dagger: 11, hammer: 16, shield: 16,
  thsword: 22, katana: 20, axe: 22, spear: 18,
  helmet: 10, hat: 10, armor: 16, coat: 12,
};

function appendWorkLog(entry) {
  const f = path.join(ROOT, 'capture', 'work-log.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

// ---- 主迴圈 ----

async function main() {
  log(`開跑，預計 ${RUN_MINUTES} 分鐘；已存戰報 ${store.count} 份`);
  let info = await client.huntInfo();
  let lastTend = 0;

  while (Date.now() < DEADLINE) {
    // 每 5 分鐘照顧一次挖礦／鍛造的人
    if (Date.now() - lastTend > 5 * 60 * 1000 && state.phase !== 'probe') {
      lastTend = Date.now();
      try { await tendWorkers(await client.heroes()); } catch (e) { log('tendWorkers:', e.message); }
    }

    try {
      info = await step(info);
    } catch (e) {
      log('步驟出錯：', e.message);
      await sleep(10000);
      try { info = await client.huntInfo(); } catch { /* 下一輪再說 */ }
    }
    saveState();
  }
  log(`時間到。這輪共存 ${store.count} 份戰報，用掉 ${client.requestsUsed} 次請求額度`);
}

async function step(info) {
  switch (state.phase) {
    case 'probe': return stepProbe(info);
    case 'regroup': return stepRegroup();
    case 'split': return stepSplit();
    case 'travel': return stepTravel(info);
    case 'grind': return stepGrind(info);
    default: state.phase = 'grind'; return info;
  }
}

// 階段 0：全隊在大草原 10 原地硬打，蒐戰報與敵人資料。有人倒下就回城整備。
async function stepProbe(info) {
  if (info.huntZone !== plan.probe.zoneId || info.huntStage !== plan.probe.stage) {
    log(`不在 ${plan.probe.zoneId}-${plan.probe.stage}，改走分工`);
    state.phase = 'split';
    return info;
  }
  await waitHuntCooldown(info);
  let r;
  try {
    r = await client.hunt();
  } catch (e) {
    if (e instanceof ApiError && /沒有可戰鬥/.test(e.message)) {
      log('全隊沒人能打了 → 回城整備');
      state.phase = 'regroup';
      return info;
    }
    throw e;
  }
  keepReport(r.report);
  const hi = r.huntInfo;
  const down = (hi ? hi.heroes : []).filter(isDown);
  const enemies = (r.report.b || []).map((b) => `${b.name}Lv${b.lv}`).join('、');
  log(`原地狩獵 #${state.hunts} 敵：${enemies}${down.length ? ` ／倒下 ${down.map((h) => h.name).join('、')}` : ''}`);
  if (down.length) {
    state.deaths += down.length;
    log('有人陣亡 → 回城整備');
    state.phase = 'regroup';
  }
  return hi || info;
}

// 階段 1：回城、復活、休息
async function stepRegroup() {
  await backToTown();
  await reviveAndRest();
  state.phase = 'split';
  return client.huntInfo();
}

// 階段 2：分工——挖礦的去挖、鍛造的去打、練功的組隊出發
async function stepSplit() {
  await backToTown();
  const heroes = await setParty(plan.grinders);
  await tendWorkers(heroes);
  state.routeIdx = 0;
  state.phase = 'travel';
  return client.huntInfo();
}

// 階段 3：把練功隊帶到路線上的目標樓層
async function stepTravel(info) {
  const leg = plan.route[state.routeIdx];
  if (!leg) { state.phase = 'grind'; return info; }

  if (info.huntZone !== leg.zoneId) {
    await backToTown();
    log(`前往 ${leg.zoneName}`);
    await client.move(leg.zoneId);
    for (let i = 0; i < 40; i++) {
      try { info = await client.moveComplete(); break; } catch { await sleep(15000); }
    }
    return info;
  }

  if (info.huntStage < leg.stage && info.canForward) {
    await waitHuntCooldown(info);
    const r = await client.hunt('forward');
    keepReport(r.report);
    log(`前進 → ${r.huntInfo ? r.huntInfo.huntStage : '?'} 樓`);
    return r.huntInfo || info;
  }
  if (info.huntStage > leg.stage && info.canBack) {
    await waitHuntCooldown(info);
    const r = await client.hunt('back');
    keepReport(r.report);
    log(`後退 → ${r.huntInfo ? r.huntInfo.huntStage : '?'} 樓`);
    return r.huntInfo || info;
  }

  log(`已抵達 ${leg.zoneName} ${leg.stage} 樓，開始練功`);
  state.phase = 'grind';
  return info;
}

// 階段 4：原地練功。血低就休息，有人倒下就回城復活，達標就換下一段路線。
async function stepGrind(info) {
  const leg = plan.route[state.routeIdx];
  const heroes = (info && info.heroes) || [];

  if (heroes.some(isDown)) {
    log('有人陣亡 → 回城復活');
    await backToTown();
    await reviveAndRest();
    state.phase = 'travel';
    return client.huntInfo();
  }

  const hurt = heroes.filter((h) => h.hp / (h.fullHp || 1) < plan.restBelow);
  if (hurt.length) {
    log(`${hurt.map((h) => h.name).join('、')} 血量偏低 → 全隊休息`);
    try {
      await client.restAll();
      await sleep(plan.restMs);
      const r = await client.restAllComplete();
      log('休息完成:', (r.messages || []).join(' / ') || '（無）');
      return r.huntInfo || info;
    } catch (e) { log('休息失敗：', e.message); }
  }

  if (leg && leg.untilLevel) {
    const full = await client.heroes();
    const crew = full.filter((h) => plan.grinders.includes(h.id));
    if (crew.length && crew.every((h) => h.lv >= leg.untilLevel)) {
      log(`練功隊都到 ${leg.untilLevel} 等 → 前往下一段`);
      state.routeIdx++;
      state.phase = 'travel';
      return client.huntInfo();
    }
  }

  await waitHuntCooldown(info);
  let r;
  try {
    r = await client.hunt();
  } catch (e) {
    if (e instanceof ApiError && /沒有可戰鬥/.test(e.message)) {
      log('沒人能打 → 回城整備');
      await backToTown();
      await reviveAndRest();
      state.phase = 'travel';
      return client.huntInfo();
    }
    throw e;
  }
  keepReport(r.report);
  const enemies = (r.report.b || []).map((b) => `${b.name}Lv${b.lv}`).join('、');
  log(`${r.report.zone}${r.report.stage}F #${state.hunts} 敵：${enemies}`);
  return r.huntInfo || info;
}

main().catch((e) => { console.error('主迴圈掛了：', e); process.exit(1); });
