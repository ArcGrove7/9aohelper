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
const { pickMines, FORGE_LIMIT } = require('./gao/materials.js');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = args.state || path.join(ROOT, '.gao-state');
const RUN_MINUTES = Number(args.minutes || 60);
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;

const token = fs.readFileSync(args['token-file'], 'utf8').trim();
fs.mkdirSync(STATE_DIR, { recursive: true });

// bot 只寫工作檔（.gao-state/，已忽略）。要入庫再跑 tools/gao-sync-capture.js
// 併進 capture/——否則每隔幾秒就多一份戰報，工作區永遠是髒的。
const store = new ReportStore(path.join(STATE_DIR, 'hunt-reports.jsonl'));
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
  await ensureCrewIdle();
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
        // 重生要等十分鐘，這段空檔別讓挖礦跟鍛造的人閒著
        if (i % 4 === 3) {
          try { await tendWorkers(await client.heroes()); } catch (e) { log('tendWorkers:', e.message); }
        }
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

// 移動要求全隊閒置。休息、移動這種「做完還要按一下完成」的狀態，
// 不收尾就會一直被擋在「隊伍中有英雄在非閒置狀態」。
async function ensureCrewIdle() {
  const heroes = await client.heroes();
  const crew = heroes.filter((h) => h.selected);
  if (crew.some((h) => h.actionState === ActionState.Resting)) {
    try {
      const r = await client.restAllComplete();
      log('收尾休息:', (r.messages || []).join(' / ') || '（無）');
    } catch (e) { log('收尾休息失敗：', e.message); }
  }
  if (crew.some((h) => h.actionState === ActionState.Moving)) {
    try { await client.moveComplete(); log('收尾移動'); } catch (e) { log('收尾移動失敗：', e.message); }
  }
  return crew;
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
      // 離隊的人不吃 restAllComplete，休息也得自己按「完成行動」收尾，
      // 否則會一直卡在休息狀態，永遠輪不到下一輪挖礦。
      if (h.actionState === ActionState.Resting && h.canComplete) {
        const r = await client.completeAction(h.id);
        log(`${h.name} 休息完成`);
        h.actionState = ActionState.Idle;
        if (r.hero) { h.hp = r.hero.hp; h.sp = r.hero.sp; }
      } else if (h.actionState === ActionState.Mining && h.canComplete) {
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

// 從庫存挑素材下去打。配方交給 gao/materials.js——它讀站上 materials.html 的
// 素材數值表，武器看攻擊、防具看防禦，再照「同素材越堆越不划算」的衰減表分配，
// 所以不會出現拿十六個兔皮去打劍這種事。
async function startForge(hero, smith) {
  const inv = await client.get('/api/items');
  const mines = (inv.mines || []).filter((m) => m.available > 0);
  if (!mines.length) { log(`${hero.name} 沒有素材可鍛造`); return; }

  const recipe = pickMines(mines, smith.type, FORGE_LIMIT[smith.type]);
  if (!recipe.total) { log(`${hero.name} 庫存裡沒有對 ${smith.type} 有加成的素材`); return; }

  const body = {
    heroId: hero.id,
    target: smith.forgeSlot || 1,
    name: smith.name,
    type: smith.type,
    selectedMines: recipe.picks.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
  };
  await client.forge(body);
  const detail = recipe.picks.map((p) => `${p.name}×${p.quantity}`).join('、');
  log(`${hero.name} 開始鍛造「${smith.name}」（${smith.type}，${recipe.total} 份：${detail}）`);
  appendWorkLog({ kind: 'forge-start', hero: hero.name, recipe, body });
}

function appendWorkLog(entry) {
  const f = path.join(STATE_DIR, 'work-log.jsonl');
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
  // 復活要趁全員都還在隊上——reviveAll 只管隊伍裡的人。
  // 休息留到分工之後再做，免得把正在鍛造的人也一起叫去休息。
  await reviveAndRest();
  state.phase = 'split';
  return client.huntInfo();
}

// 階段 2：分工——挖礦的去挖、鍛造的去打、練功的組隊出發
async function stepSplit() {
  await backToTown();
  const heroes = await setParty(plan.grinders);
  await tendWorkers(heroes);
  // 練功隊出發前先補滿——這時隊伍裡只剩他們，不會吵到挖礦與鍛造的人
  await ensureCrewIdle();
  const crew = heroes.filter((h) => plan.grinders.includes(h.id));
  if (crew.some((h) => h.hp < h.fullHp || h.sp < h.fullSp)) {
    try {
      await client.restAll();
      log(`練功隊休息 ${Math.round(plan.restMs / 1000)} 秒`);
      await sleep(plan.restMs);
      const r = await client.restAllComplete();
      log('休息完成:', (r.messages || []).join(' / ') || '（無）');
    } catch (e) { log('休息失敗：', e.message); }
  }
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
    await ensureCrewIdle();
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

  // huntInfo 本來就帶等級，不必為了看等級多打一次 heroes()
  if (leg && leg.untilLevel) {
    const crew = heroes.filter((h) => plan.grinders.includes(h.id));
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
