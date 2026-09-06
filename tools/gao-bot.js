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
const { pickMines, FORGE_LIMIT } = require('./gao/materials.js');
const { randomEquipmentName } = require('./gao/names.js');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = args.state || path.join(ROOT, '.gao-state');
const RUN_MINUTES = Number(args.minutes || 60);
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;
// 每個帳號各自一份額度、階段與工作檔，用 label 分開；兩個帳號可以同時跑。
const LABEL = args.label || 'u140';

const token = fs.readFileSync(args['token-file'], 'utf8').trim();
fs.mkdirSync(STATE_DIR, { recursive: true });

const plan = require(path.resolve(ROOT, args.plan || 'tools/gao/plan.js'));

// bot 只寫工作檔（.gao-state/，已忽略）。要入庫再跑 tools/gao-sync-capture.js
// 併進 capture/——否則每隔幾秒就多一份戰報，工作區永遠是髒的。
const store = new ReportStore(path.join(STATE_DIR, `hunt-reports-${LABEL}.jsonl`));
const client = new Client({ token, stateDir: STATE_DIR, label: LABEL });

const PHASE_FILE = path.join(STATE_DIR, `phase-${LABEL}.json`);
let state = readJson(PHASE_FILE) || { phase: 'probe', routeIdx: 0, deaths: 0, hunts: 0 };

function log(...a) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] [${LABEL}/${state.phase}] ${a.join(' ')}`);
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

// 吃補品。人下的令是「戰鬥人員 HP 與體力都不准低於五成」——
// 補品比休息快，先吃；庫存有限所以只補到 plan.healUntil 就收手，剩下交給休息。
// 一次 use 可以帶 quantity，所以一個英雄一次請求就補完。
async function useConsumables(heroes) {
  if (!plan.useItems) return heroes;
  const below = plan.restBelow || 0.5;
  const upTo = plan.healUntil || 0.65;
  const crew = heroes.filter((h) => h.hp > 0);
  const needy = crew.filter((h) => h.hp / (h.fullHp || 1) < below || h.sp / (h.fullSp || 1) < below);
  if (!needy.length) return heroes;

  let stock;
  try {
    stock = (await client.get('/api/items')).items || [];
  } catch (e) { log('看不到道具欄：', e.message); return heroes; }

  // 只吃補 HP 或體力的，增益類（戰鬥口糧那種）不在這裡處理
  const potions = stock.filter((i) => i.available > 0 && i.target === 'hero' && ((i.healHp || 0) > 0 || (i.healSp || 0) > 0));
  if (!potions.length) return heroes;

  for (const h of needy) {
    for (const stat of ['hp', 'sp']) {
      const full = stat === 'hp' ? h.fullHp : h.fullSp;
      const heal = stat === 'hp' ? 'healHp' : 'healSp';
      if (!full) continue;
      let cur = stat === 'hp' ? h.hp : h.sp;
      if (cur / full >= below) continue;

      // 專補這一項的排前面，兩用的留著
      const usable = potions
        .filter((p) => (p[heal] || 0) > 0 && p.available > 0)
        .sort((a, b) => (b[heal] || 0) - (a[heal] || 0));

      for (const p of usable) {
        const gap = Math.max(0, Math.ceil(full * upTo) - cur);
        if (gap <= 0) break;
        const want = Math.min(p.available, Math.ceil(gap / p[heal]));
        if (want <= 0) continue;
        try {
          const r = await client.post(`/api/items/${p.id}/use`, { quantity: want, heroId: h.id });
          p.available -= want;
          if (r.hero) { h.hp = r.hero.hp; h.sp = r.hero.sp; }
          cur = stat === 'hp' ? h.hp : h.sp;
          log(`${h.name} 吃了 ${p.name} ×${want} → HP ${h.hp}/${h.fullHp}、體力 ${h.sp}/${h.fullSp}`);
        } catch (e) { log(`${h.name} 吃 ${p.name} 失敗：${e.message}`); break; }
        if (cur / full >= upTo) break;
      }
    }
  }
  return heroes;
}

// 顧任務。完成了就領獎，冷卻過了就接新的——不然任務欄會一直卡著同一批。
// 這裡只做「領」與「接」，不會為了任務去改隊伍在做的事，那要人決定。
async function tendQuests() {
  if (plan.quests === false) return;
  let q;
  try { q = await client.get('/api/quests'); } catch (e) { log('看不到任務：', e.message); return; }

  for (const t of q.active || []) {
    if (t.isCompleted && !t.claimedAt) {
      try {
        await client.post(`/api/quests/${t.questId}/claim`);
        log(`任務達成，已領獎：${t.desc}`);
      } catch (e) { log(`領任務獎勵失敗（${t.desc}）：${e.message}`); }
    }
  }
  if (q.cooldown && q.cooldown.canRoll) {
    try {
      const r = await client.post('/api/quests/take');
      log('接了新任務：', (r.active || []).map((x) => x.desc).join('、') || '（沒回內容）');
      q = r;
    } catch (e) { log('接新任務失敗：', e.message); }
  }
  // 存起來給回報用
  state.quests = (q.active || []).map((t) => ({
    id: t.questId, desc: t.desc,
    progress: t.progress != null ? `${t.progress}/${t.goal}` : (t.itemCount != null ? `${t.itemCount} 份` : ''),
    done: !!t.isCompleted,
  }));
}

// 增益類補品（戰鬥口糧那種：攻擊力 +10、三十分鐘）。
// 人下的令：**這種東西只能留著打 BOSS**，練功時一律不准吃。
// 所以劇本裡的 plan.useBuffs 預設是 false，這支只有打 BOSS 的劇本才會打開。
// 到期時間記在 state 裡，沒到期就不打擾伺服器——不然每打一場都要多抓一次道具欄。
async function useBuffs(heroes) {
  if (!plan.useBuffs) return;
  const now = Date.now();
  state.buffUntil = state.buffUntil || {};
  const due = heroes.filter(
    (h) => plan.grinders.includes(h.id) && h.hp > 0 && (state.buffUntil[h.id] || 0) < now,
  );
  if (!due.length) return;

  let stock;
  try {
    stock = (await client.get('/api/items')).items || [];
  } catch (e) { log('看不到道具欄：', e.message); return; }

  const buffs = stock.filter((i) => i.available > 0 && i.target === 'hero' && i.effectDurationSec > 0);
  if (!buffs.length) {
    // 沒庫存就先擱著，半小時後再看，省得每場都白抓一次
    for (const h of due) state.buffUntil[h.id] = now + 30 * 60 * 1000;
    return;
  }
  for (const h of due) {
    const b = buffs.find((x) => x.available > 0);
    if (!b) break;
    try {
      await client.post(`/api/items/${b.id}/use`, { quantity: 1, heroId: h.id });
      b.available--;
      state.buffUntil[h.id] = now + b.effectDurationSec * 1000;
      const what = (b.effectTexts || []).join('、');
      log(`${h.name} 吃了 ${b.name}（${what}，${Math.round(b.effectDurationSec / 60)} 分鐘）`);
    } catch (e) { log(`${h.name} 吃 ${b.name} 失敗：${e.message}`); break; }
  }
}

// 劇本裡的 grinders 可以寫名字（比 id 好讀）。開跑時對應成 id 存回 plan。
async function resolveGrinders() {
  if (!plan.grinders.some((g) => typeof g === 'string')) return;
  const heroes = await client.heroes();
  plan.grinders = plan.grinders.map((g) => {
    if (typeof g !== 'string') return g;
    const hit = heroes.find((h) => h.name === g);
    if (!hit) throw new Error(`劇本裡的「${g}」在這個帳號找不到`);
    return hit.id;
  });
  log('練功隊:', plan.grinders.join('、'));
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

// 挖礦收穫看消耗的體力，所以別一到最低時間（3 分鐘）就按完成——
// 那樣拿到的是「消耗了 2 點體力，什麼也沒挖到」。挖滿 plan.miningMinutes
// 或體力見底才收。
function minedLongEnough(h) {
  if (h.sp <= 30) return true;
  const started = h.actionStart ? new Date(h.actionStart).getTime() : 0;
  if (!started) return true;
  return client.now() - started >= (plan.miningMinutes || 20) * 60 * 1000;
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
      } else if (h.actionState === ActionState.Mining && h.canComplete && minedLongEnough(h)) {
        const r = await client.completeAction(h.id);
        const got = (r.miningResult || []).map((m) => m.m).join('；');
        log(`${h.name} 挖礦完成：${got || '（無收穫）'}`);
        appendWorkLog({ kind: 'mining', hero: h.name, target: mineTarget, messages: r.miningResult || [] });
        h.actionState = ActionState.Idle;
        h.sp = (r.hero && r.hero.sp) != null ? r.hero.sp : h.sp;
      } else if (h.actionState === ActionState.Forging && h.canComplete) {
        await client.completeForge(h.id);
        // completeForge 不回成品，自己去裝備欄把它撈出來——
        // 名字是隨機生的所以認得出是哪一件。配方對成品的數值就是攻略素材本身。
        let made = null;
        const want = state.forging && state.forging[h.id];
        if (want) {
          try {
            const es = await client.equipments();
            made = es.find((e) => e.name === want.name && !e.equipped) || null;
          } catch (e) { log('查成品失敗：', e.message); }
        }
        if (made) {
          log(`${h.name} 鍛造完成：${made.quality}的${made.name}（攻${made.atk} 防${made.def} 智${made.int} 幸${made.lck} 重${made.wgt} 耐${made.fullDur} 孔${made.fullSlots}）`);
        } else {
          log(`${h.name} 鍛造完成`);
        }
        appendWorkLog({
          kind: 'forge',
          hero: h.name,
          recipe: want ? want.recipe : null,
          equipType: want ? want.type : null,
          product: made && {
            name: made.name, quality: made.quality, type: made.type,
            atk: made.atk, def: made.def, int: made.int, lck: made.lck,
            wgt: made.wgt, dur: made.fullDur, slots: made.fullSlots,
          },
        });
        if (state.forging) delete state.forging[h.id];
        h.actionState = ActionState.Idle;
      }
    } catch (e) { log(`${h.name} 完成行動失敗：${e.message}`); }

    if (h.actionState !== ActionState.Idle) continue;

    // 人下的令：挖礦與鍛造都吃體力，這些人也守五成——先吃補品，補不上來就休息。
    const below = plan.restBelow || 0.5;
    if (h.hp / (h.fullHp || 1) < below || h.sp / (h.fullSp || 1) < below) {
      await useConsumables([h]);
      if (h.hp / (h.fullHp || 1) < below || h.sp / (h.fullSp || 1) < below) {
        try {
          await client.rest(h.id);
          log(`${h.name} 低於五成，先休息（HP ${Math.round((h.hp / (h.fullHp || 1)) * 100)}%／體 ${Math.round((h.sp / (h.fullSp || 1)) * 100)}%）`);
        } catch (e) { log(`${h.name} 休息失敗：${e.message}`); }
        continue;
      }
    }

    try {
      // 兩種身分都掛著的人（工匠自己挖料自己打）：配方湊得齊就鍛造，湊不齊就去挖。
      if (mineTarget && smith) {
        const mines = ((await client.get('/api/items')).mines || []).filter((m) => m.available > 0);
        const recipe = pickMines(mines, smith.type, FORGE_LIMIT[smith.type], { strategy: smith.recipe });
        if (recipe.total && !recipe.note) {
          await startForge(h, smith, mines);
        } else if (h.sp <= 20) {
          await client.rest(h.id);
          log(`${h.name} 體力不足，休息`);
        } else {
          await client.mining(h.id, mineTarget);
          log(`${h.name} 去挖料（礦區 ${mineTarget}）——${recipe.note || '素材不夠'}`);
        }
      } else if (mineTarget) {
        if (h.sp <= 20) { await client.rest(h.id); log(`${h.name} 體力見底，休息`); continue; }
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
async function startForge(hero, smith, known) {
  const mines = known || ((await client.get('/api/items')).mines || []).filter((m) => m.available > 0);
  if (!mines.length) { log(`${hero.name} 沒有素材可鍛造`); return; }

  const recipe = pickMines(mines, smith.type, FORGE_LIMIT[smith.type], { strategy: smith.recipe });
  if (!recipe.total) { log(`${hero.name} 庫存裡沒有對 ${smith.type} 有加成的素材`); return; }
  // 指定了配方就照配方打。條件湊不齊（例如泥土用完了）寧可停手等素材，
  // 也不要退回一般配方——那樣只是把素材燒成廢裝備。
  if (smith.recipe && smith.requireRecipe !== false && recipe.note) {
    log(`${hero.name} 先不打：${recipe.note}`);
    return;
  }

  const name = smith.randomName ? randomEquipmentName(smith.type) : smith.name;
  const body = {
    heroId: hero.id,
    target: smith.forgeSlot || 1,
    name,
    type: smith.type,
    selectedMines: recipe.picks.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
  };
  await client.forge(body);
  // 記著這一爐打的是什麼，完成時才對得起來
  state.forging = state.forging || {};
  state.forging[hero.id] = { name, type: smith.type, recipe };
  const detail = recipe.picks.map((p) => `${p.name}×${p.quantity}`).join('、');
  const bonus = recipe.soilCount ? `，泥土加成 +${recipe.soilBonus}%` : '';
  log(`${hero.name} 開始鍛造「${name}」（${smith.type}，${recipe.total} 份${bonus}：${detail}）`);
  appendWorkLog({ kind: 'forge-start', hero: hero.name, name, recipe, body });
}

function appendWorkLog(entry) {
  const f = path.join(STATE_DIR, `work-log-${LABEL}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

// ---- 主迴圈 ----

async function main() {
  log(`開跑，預計 ${RUN_MINUTES} 分鐘；已存戰報 ${store.count} 份`);
  await resolveGrinders();
  try { await tendQuests(); } catch (e) { log('tendQuests:', e.message); }
  // 沒有蒐證階段的劇本（例如純練功的帳號），別停在 probe 上
  if (!plan.probe && state.phase === 'probe') state.phase = 'travel';
  let info = await client.huntInfo();
  let lastTend = 0;

  while (Date.now() < DEADLINE) {
    // 每 5 分鐘照顧一次挖礦／鍛造的人
    if (Date.now() - lastTend > 5 * 60 * 1000 && state.phase !== 'probe') {
      lastTend = Date.now();
      try { await tendWorkers(await client.heroes()); } catch (e) { log('tendWorkers:', e.message); }
      try { await tendQuests(); } catch (e) { log('tendQuests:', e.message); }
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
  if (!plan.probe) { state.phase = 'travel'; return info; }
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

  await useBuffs(heroes);

  // HP 與體力都不准低於門檻
  const lowOn = (h) => h.hp / (h.fullHp || 1) < plan.restBelow || h.sp / (h.fullSp || 1) < plan.restBelow;
  if (heroes.some(lowOn)) {
    // 補品比休息快，先吃
    await useConsumables(heroes.filter((h) => plan.grinders.includes(h.id)));
  }
  const hurt = heroes.filter(lowOn);
  if (hurt.length) {
    log(`${hurt.map((h) => `${h.name}(HP ${Math.round((h.hp / (h.fullHp || 1)) * 100)}%/體 ${Math.round((h.sp / (h.fullSp || 1)) * 100)}%)`).join('、')} 低於門檻 → 全隊休息`);
    const until = plan.restUntil || 0.9;
    let latest = info;
    // 已經在休息中的先收尾，否則 restAll 會回「沒有需要休息的英雄」，
    // 這一輪就白跑，下一輪再來一次——每十幾秒燒一次額度什麼也沒做。
    await ensureCrewIdle();
    for (let round = 0; round < (plan.restRounds || 5); round++) {
      try {
        await client.restAll();
        await sleep(plan.restMs);
        const r = await client.restAllComplete();
        log(`休息第 ${round + 1} 輪:`, (r.messages || []).join(' / ') || '（無）');
        latest = r.huntInfo || latest;
      } catch (e) { log('休息失敗：', e.message); break; }
      const crew = (latest && latest.heroes) || [];
      if (crew.every((h) => h.hp / (h.fullHp || 1) >= until && h.sp / (h.fullSp || 1) >= until)) break;
    }
    return latest;
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
      // 多半只是休息還掛著沒按完成，不是真的全隊倒了。
      // 先在原地收尾——回城再走回來要重新爬好幾層，太貴。
      await ensureCrewIdle();
      const fresh = await client.huntInfo();
      const ready = (fresh.heroes || []).filter((h) => h.hp > 0 && h.actionState === ActionState.Idle);
      if (ready.length) { log(`原地收尾後還有 ${ready.length} 人能打，繼續`); return fresh; }
      log('真的沒人能打 → 回城整備');
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
