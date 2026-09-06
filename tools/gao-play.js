#!/usr/bin/env node
'use strict';
// 自動遊玩：同時操作 tools/gao/roster.js 裡的每個帳號。
//
//   node tools/gao-play.js [--minutes 600] [--state <目錄>] [--cap 500] [--once]
//
// 額度：每個帳號各有一份 RateLimiter（tools/gao/api.js），預設壓在 500/hr，
// 人下的令是 600/hr。額度存在磁碟上，換個行程重跑也接得回去。
//
// 一場狩獵＝一次請求（hunt 直接回完整戰報與 huntInfo，不用再撈一次狀態），
// 所以絕大部分的額度都花在打怪上，城鎮雜務每 4 分鐘才做一輪。

const fs = require('fs');
const path = require('path');
const { Client, ApiError, ActionState, sleep } = require('./gao/api.js');
const { ReportStore } = require('./gao/capture.js');
const { FloorPicker } = require('./gao/floors.js');
const { planEquipment } = require('./gao/equip.js');
const { pickMines, FORGE_LIMIT } = require('./gao/materials.js');
const roster = require('./gao/roster.js');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = args.state || path.join(ROOT, '.gao-state');
const RUN_MINUTES = Number(args.minutes || 600);
const DEADLINE = Date.now() + RUN_MINUTES * 60 * 1000;
const CAP = Number(args.cap || roster.hourlyCap);

fs.mkdirSync(STATE_DIR, { recursive: true });

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const pct = (x) => `${Math.round(x * 100)}%`;
// log 的時戳用台北時間（UTC+8）——人看的時間一律 UTC+8
const hhmm = () => new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const expOf = (report) => {
  const m = (report.messages || []).find((x) => x.s === 'exp');
  return m ? Number((m.m.match(/(\d+)/) || [])[1] || 0) : 0;
};
const dropsOf = (report) => (report.messages || [])
  .filter((x) => /^獲得了/.test(x.m || ''))
  .map((x) => x.m.replace(/^獲得了\s*/, ''));

// 全隊血量剩幾成——下探判斷用整隊看，不是只看最慘的那隻
const partyHp = (heroes) => {
  const full = heroes.reduce((s, h) => s + (h.fullHp || 0), 0);
  return full ? heroes.reduce((s, h) => s + Math.max(0, h.hp), 0) / full : 1;
};
const worstHp = (heroes) => Math.min(...heroes.map((h) => h.hp / (h.fullHp || 1)), 1);

// 兩個帳號之間傳話用的小信箱。
//
// 轉素材只能走公開市集（遊戲沒有直接給人的介面），所以掛上去的那段時間，
// 別的玩家也看得到、也搶得走。兩個帳號跑在同一個行程裡，就讓上架的人丟一則
// 通知，收貨的人下一次請求就去買——把曝光壓到十幾秒，而不是等下一輪雜務（四分鐘）。
const bus = { pending: [] };
const agents = new Map(); // nickname → Agent，上架時要看對面身上有多少錢

class Agent {
  constructor(cfg) {
    this.cfg = cfg;
    this.name = cfg.nickname;
    const token = fs.readFileSync(path.join(STATE_DIR, cfg.tokenFile), 'utf8').trim();
    this.client = new Client({ token, stateDir: STATE_DIR, label: cfg.label, cap: CAP, log: () => {} });
    this.store = new ReportStore(path.join(STATE_DIR, `hunt-reports-${cfg.label}.jsonl`));
    this.stateFile = path.join(STATE_DIR, `play-${cfg.key}.json`);
    const saved = readJson(this.stateFile) || {};
    this.state = {
      stage: (cfg.ground && cfg.ground.stage) || 1,
      hunts: 0, deaths: 0, expTotal: 0,
      sinceReview: 0,
      ...saved,
    };
    this.floors = new FloorPicker(saved.floors);
    this.lastChore = 0;
    this.lastEquipScan = 0;
    this.partyDirty = true;
    this.info = null;
    this.prevHp = null;
    this.heroes = [];
  }

  log(...a) {
    console.log(`[${hhmm()}] [${this.name}] ${a.join(' ')}`);
  }

  save() {
    this.state.floors = this.floors.toJSON();
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 1));
  }

  workLog(entry) {
    fs.appendFileSync(
      path.join(STATE_DIR, 'work-log.jsonl'),
      JSON.stringify({ time: new Date().toISOString(), account: this.name, ...entry }) + '\n',
    );
  }

  // ---- 這一刻該做什麼 ----

  // 矮人工匠出師了沒（3096 的任務 0）
  apprenticeDone() {
    const a = this.cfg.apprentice;
    if (!a) return true;
    const h = this.heroes.find((x) => x.id === a.heroId);
    return !h || h.lv >= a.untilLevel;
  }

  // 這一隊現在該有誰
  wantParty() {
    const a = this.cfg.apprentice;
    if (a && !this.apprenticeDone()) return [...this.cfg.core, a.heroId];
    return [...this.cfg.core];
  }

  // 目標是哪張圖的第幾層
  wantGround() {
    const a = this.cfg.apprentice;
    // 任務 0 指定了地點：矮人工匠出師前，全隊就待在那裡
    if (a && !this.apprenticeDone()) {
      return { zoneId: a.zoneId, zoneName: a.zoneName, stage: a.stage, fixed: true };
    }
    const g = this.cfg.ground;
    const b = this.cfg.boss;
    // 四隻都到目標等級就轉去打王
    if (b && this.coreReady()) {
      return { zoneId: b.zoneId, zoneName: b.zoneName, stage: b.stage, fixed: true, boss: true };
    }
    return { zoneId: g.zoneId, zoneName: g.zoneName, stage: this.state.stage, fixed: false };
  }

  coreReady() {
    const crew = this.heroes.filter((h) => this.cfg.core.includes(h.id));
    return crew.length === this.cfg.core.length && crew.every((h) => h.lv >= this.cfg.goalLevel);
  }

  crewLevel() {
    const crew = this.heroes.filter((h) => this.cfg.core.includes(h.id));
    return crew.length ? Math.min(...crew.map((h) => h.lv)) : 1;
  }

  // ---- 積木 ----

  async refreshHeroes() {
    this.heroes = await this.client.heroes();
    return this.heroes;
  }

  // 移動要求全隊閒置。休息、移動這種「做完還要按一下完成」的狀態，
  // 不收尾就會一直被擋在「隊伍中有英雄在非閒置狀態」。
  //
  // 這裡一定要重抓一次英雄狀態：手上那份是上一輪雜務留下的，
  // 拿舊的去判斷就會「看起來大家都閒著」而什麼也不收，接著 move 被打回，
  // 然後整個外層迴圈就在這裡空轉燒額度。
  async ensureCrewIdle() {
    await this.refreshHeroes();
    const crew = (this.heroes || []).filter((h) => h.selected);
    if (crew.some((h) => h.actionState === ActionState.Resting)) {
      try { await this.client.restAllComplete(); } catch { /* 沒得收就算了 */ }
    }
    if (crew.some((h) => h.actionState === ActionState.Moving)) {
      try { await this.client.moveComplete(); } catch { /* 同上 */ }
    }
    // restAllComplete／moveComplete 收不掉的（例如剛好卡在別的行動），
    // 只好一隻一隻按「完成行動」，不然移動永遠出不去。
    for (const h of crew) {
      if (h.actionState !== ActionState.Idle && h.canComplete) {
        try { await this.client.completeAction(h.id); } catch { /* 收不掉就算了 */ }
      }
    }
  }

  async backToTown() {
    const info = this.info || (await this.client.huntInfo());
    if (info.huntZone === 0 && info.huntStage === 0) return info;
    await this.ensureCrewIdle();
    await this.client.move(0);
    for (let i = 0; i < 40; i++) {
      try {
        const r = await this.client.moveComplete();
        this.log('已回到城鎮');
        this.info = r;
        return r;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        await sleep(15000);
      }
    }
    throw new Error('回城逾時');
  }

  async setParty(keepIds) {
    await this.refreshHeroes();
    for (const h of this.heroes) {
      const want = keepIds.includes(h.id);
      if (h.selected && !want) { await this.client.deselect(h.id); this.log(`${h.name} 離隊`); }
      else if (!h.selected && want) { await this.client.select(h.id); this.log(`${h.name} 入隊`); }
    }
    this.partyDirty = false;
    await this.refreshHeroes();
  }

  // 補血：先吃補品（一次請求就回一次血），沒有補品才休息（要等好幾分鐘，
  // 那段時間打不了怪，等於白丟掉幾十場的產出）。
  async recover(reason) {
    this.log(`${reason} → 回血`);
    await this.ensureCrewIdle();
    const until = roster.restUntil;

    for (let round = 0; round < roster.restRounds; round++) {
      const crew = ((this.info && this.info.heroes) || []).filter((h) => h.hp > 0);
      if (crew.length && crew.every((h) => h.hp / (h.fullHp || 1) >= until)) break;
      try {
        await this.client.restAll();
        await sleep(roster.restMs);
        const r = await this.client.restAllComplete();
        this.info = r.huntInfo || this.info;
        this.log(`休息第 ${round + 1} 輪：全隊 ${pct(partyHp((this.info || {}).heroes || []))}`);
      } catch (e) {
        this.log('休息失敗：', e.message);
        break;
      }
    }
    this.prevHp = null; // 休息過的血量落差不算戰損
    return this.info;
  }

  async reviveAll() {
    try {
      const r = await this.client.reviveAll();
      const reviving = (r.heroes || []).filter((h) => h.actionState === ActionState.Reviving);
      if (reviving.length) {
        this.log(`重生中 ${reviving.length} 隻，等十分鐘`);
        for (let i = 0; i < 45; i++) {
          await sleep(30000);
          try { await this.client.reviveAllComplete(); this.log('重生完成'); break; } catch { /* 還沒好 */ }
        }
      }
    } catch (e) { this.log('reviveAll：', e.message); }
  }

  // ---- 城鎮雜務 ----

  async chores() {
    this.lastChore = Date.now();
    await this.refreshHeroes();
    if (this.partyDirty) await this.setParty(this.wantParty());
    await this.tendWorkers();
    await this.tendTrades();
    if (Date.now() - this.lastEquipScan > 20 * 60 * 1000) {
      this.lastEquipScan = Date.now();
      await this.tendEquipment();
    }
  }

  // 挖礦收穫看消耗的體力，所以別一到最低時間（3 分鐘）就按完成——
  // 那樣拿到的是「消耗了 2 點體力，什麼也沒挖到」。
  minedLongEnough(h) {
    if (h.sp <= 30) return true;
    const started = h.actionStart ? new Date(h.actionStart).getTime() : 0;
    if (!started) return true;
    return this.client.now() - started >= roster.miningMinutes * 60 * 1000;
  }

  async tendWorkers() {
    const smithReady = this.apprenticeDone();
    for (const h of this.heroes) {
      const mine = this.cfg.miners[h.id];
      const isSmith = this.cfg.smiths[h.id] && smithReady;
      if (!mine && !isSmith) continue;
      if (h.hp <= 0) continue;
      if (h.selected) continue;                      // 還在隊伍裡的人不做城鎮工作
      if (h.huntZone !== 0 || h.huntStage !== 0) continue; // 只能在城裡做

      try {
        // 離隊的人不吃 restAllComplete，休息也得自己按「完成行動」收尾，
        // 否則會一直卡在休息狀態，永遠輪不到下一輪挖礦。
        if (h.actionState === ActionState.Resting && h.canComplete) {
          const r = await this.client.completeAction(h.id);
          h.actionState = ActionState.Idle;
          if (r.hero) { h.hp = r.hero.hp; h.sp = r.hero.sp; }
        } else if (h.actionState === ActionState.Mining && h.canComplete && this.minedLongEnough(h)) {
          const r = await this.client.completeAction(h.id);
          const got = (r.miningResult || []).map((m) => m.m).join('；');
          this.log(`${h.name} 挖礦完成：${got || '（無收穫）'}`);
          this.workLog({ kind: 'mining', hero: h.name, messages: r.miningResult || [] });
          h.actionState = ActionState.Idle;
          if (r.hero) h.sp = r.hero.sp;
        } else if (h.actionState === ActionState.Forging && h.canComplete) {
          const r = await this.client.completeForge(h.id);
          this.log(`${h.name} 鍛造完成：${(r.equipment && `${r.equipment.quality}的${r.equipment.name}`) || ''}`);
          this.workLog({ kind: 'forge', hero: h.name, result: r.equipment || r.message || null });
          h.actionState = ActionState.Idle;
          this.lastEquipScan = 0; // 打出新裝備，等一下就重新分配
        }
      } catch (e) { this.log(`${h.name} 收尾失敗：${e.message}`); }

      if (h.actionState !== ActionState.Idle) continue;

      try {
        if (isSmith) {
          await this.startForge(h);
        } else if (mine) {
          if (h.sp <= 20) { await this.client.rest(h.id); this.log(`${h.name} 體力不足，休息`); continue; }
          await this.client.mining(h.id, mine);
          this.log(`${h.name} 開始挖礦（礦區 ${mine}）`);
        }
      } catch (e) { this.log(`${h.name} 開工失敗：${e.message}`); }
    }
  }

  // 打什麼：隊上誰缺什麼就打什麼，型別挑那隻天賦最高的。
  // 全隊沒人有武器時，武器優先於防具——空著的武器格是白丟的傷害。
  pickForgeTarget() {
    const { planForgeTarget } = require('./gao/forge-plan.js');
    return planForgeTarget(this.heroes, this.equipments || []);
  }

  async startForge(hero) {
    if (!this.equipments) {
      const eq = await this.client.get('/api/equipments');
      this.equipments = eq.equipments || eq;
    }
    const target = this.pickForgeTarget();
    if (!target) { this.log(`${hero.name} 想不出要打什麼`); return; }

    const inv = await this.client.items();
    const mines = (inv.mines || []).filter((m) => m.available > 0);
    if (!mines.length) { this.log(`${hero.name} 沒有素材可鍛造`); return; }

    const recipe = pickMines(mines, target.type, FORGE_LIMIT[target.type]);
    if (!recipe.total) { this.log(`${hero.name} 庫存裡沒有對 ${target.type} 有加成的素材`); return; }

    await this.client.forge({
      heroId: hero.id,
      target: 1,
      name: target.name,
      type: target.type,
      selectedMines: recipe.picks.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
    });
    const detail = recipe.picks.map((p) => `${p.name}×${p.quantity}`).join('、');
    this.log(`${hero.name} 開始鍛造「${target.name}」（${target.type} 給 ${target.forName}，${recipe.total} 份：${detail}）`);
    this.workLog({ kind: 'forge-start', hero: hero.name, target, recipe });
  }

  // 誰先挑裝備。防具的分數跟穿的人無關，所以不排這個順序的話，
  // 最好的一件會被英雄清單裡排第一個的人拿走——通常是不上場的礦工。
  equipPriority() {
    const party = new Set(this.wantParty());
    const miners = this.cfg.miners || {};
    return (hero, slot) => {
      if (slot === 'tool') return miners[hero.id] ? 4 : 1; // 鎬子給礦工
      if (party.has(hero.id)) return 4;                     // 上場的人優先
      if (this.cfg.smiths[hero.id]) return 2;               // 鐵匠次之（他也會被拉上場）
      return 1;
    };
  }

  // 「穿最優質的裝備」
  async tendEquipment() {
    try {
      const eq = await this.client.get('/api/equipments');
      this.equipments = eq.equipments || eq;
      const changes = planEquipment(this.heroes, this.equipments, { priority: this.equipPriority() });
      for (const c of changes.slice(0, 6)) {
        await this.client.equip(c.equipmentId, c.heroId);
        this.log(`${c.heroName} 換上 ${c.quality}的${c.name}（${c.type}）`);
      }
      if (changes.length) {
        this.equipments = null;
        this.workLog({ kind: 'equip', changes: changes.slice(0, 6) });
      }
    } catch (e) { this.log('換裝失敗：', e.message); }
  }

  // ---- 跨帳號轉素材 ----

  // 上架給對面。價錢刻意開在行情之上：便宜貨掛在公開市集會被別人先撿走，
  // 開高了只有自己人會買，錢也還在兩個帳號之間轉，沒有真的花掉。
  async shipMines() {
    const inv = await this.client.items();
    const keep = this.cfg.keepMines || {};
    const surplus = (inv.mines || [])
      .filter((m) => m.available - (keep[m.name] || 0) >= 20)
      .sort((a, b) => b.available - a.available);
    if (!surplus.length) return;

    const m = surplus[0];
    const quantity = Math.min(m.available - (keep[m.name] || 0), 50);
    // 開價要低到對面隨時買得起——錢在兩個帳號之間轉，開太高只會讓收貨的那邊
    // 卡在「錢不夠」，素材就永遠躺在市集上等別人來撿。
    const partner = agents.get(this.cfg.shipMinesTo);
    const purse = partner && partner.profileMoney != null ? partner.profileMoney : 200;
    const price = Math.max(10, Math.min(150, Math.floor(purse / 4)));
    try {
      await this.client.sellItem(m.id, { price, quantity, message: roster.tradeTag });
      this.log(`上架 ${m.name}×${quantity}（${price} 元）給 ${this.cfg.shipMinesTo}`);
      bus.pending.push({ to: this.cfg.shipMinesTo });
    } catch (e) { this.log(`上架失敗：${e.message}`); }
  }

  // 把對面掛給我的東西買回來
  async collectMines() {
    const res = await this.client.trades('mines');
    const list = res.mines || res;
    const mine = list.filter((t) => t.sellerName !== this.name && (t.message || '').includes(roster.tradeTag));
    if (!mine.length) return;
    const money = (this.profileMoney != null) ? this.profileMoney : Infinity;
    let spent = 0;
    for (const t of mine.slice(0, 3)) {
      if (spent + t.price > money) { this.log(`錢不夠買 ${t.name}×${t.quantity}（要 ${t.price}）`); break; }
      try {
        const r = await this.client.buyTrade(t.id);
        spent += t.price;
        if (r && r.money != null) this.profileMoney = r.money;
        this.log(`收下 ${t.sellerName} 的 ${t.name}×${t.quantity}（${t.price} 元）`);
        this.workLog({ kind: 'receive', from: t.sellerName, name: t.name, quantity: t.quantity, price: t.price });
      } catch (e) { this.log(`買不到 ${t.name}：${e.message}`); }
    }
  }

  async tendTrades() {
    try {
      if (this.cfg.shipMinesTo) await this.shipMines();
      else await this.collectMines();
    } catch (e) { this.log('轉素材失敗：', e.message); }
  }

  // ---- 主迴圈 ----

  async run() {
    await this.refreshHeroes();
    this.info = await this.client.huntInfo();
    this.profileMoney = (await this.client.profile()).money;
    this.log(`開跑：${this.heroes.length} 隻英雄，主力最低 ${this.crewLevel()} 等，錢 ${this.profileMoney}`);
    await this.chores();

    while (Date.now() < DEADLINE) {
      try {
        await this.step();
      } catch (e) {
        this.log('出錯：', e.message);
        await sleep(8000);
        try { this.info = await this.client.huntInfo(); } catch { /* 下一輪再說 */ }
      }
      this.save();
      if (args.once) break;
    }
    this.log(`收工：這輪打了 ${this.state.hunts} 場，累計經驗 ${this.state.expTotal}，用掉 ${this.client.requestsUsed} 次額度`);
  }

  async step() {
    // 對面剛掛上來的素材，馬上去收，別讓它在公開市集上躺四分鐘
    const idx = bus.pending.findIndex((p) => p.to === this.name);
    if (idx >= 0) {
      bus.pending.splice(idx, 1);
      await this.collectMines();
    }

    if (Date.now() - this.lastChore > roster.choreIntervalMs) await this.chores();

    const info = this.info;
    const heroes = (info && info.heroes) || [];

    // 有人倒下：回城復活，順便補滿
    if (heroes.some((h) => h.hp <= 0)) {
      this.state.deaths++;
      this.log('有人陣亡 → 回城復活');
      await this.backToTown();
      await this.reviveAll();
      await this.recover('復活後');
      this.info = await this.client.huntInfo();
      return;
    }

    if (heroes.length && worstHp(heroes) < roster.restBelow) {
      await this.recover(`最慘的一隻剩 ${pct(worstHp(heroes))}`);
      return;
    }

    // 隊伍跟目標不合（例如矮人工匠剛出師）就重組
    const want = this.wantParty();
    const now = new Set(this.heroes.filter((h) => h.selected).map((h) => h.id));
    if (want.length !== now.size || want.some((id) => !now.has(id))) {
      await this.backToTown();
      await this.setParty(want);
      await this.chores();
      this.info = await this.client.huntInfo();
      return;
    }

    const target = this.wantGround();

    if (info.huntZone !== target.zoneId) {
      await this.backToTown();
      await this.ensureCrewIdle();
      this.log(`前往 ${target.zoneName}`);
      await this.client.move(target.zoneId);
      for (let i = 0; i < 40; i++) {
        try { this.info = await this.client.moveComplete(); break; } catch { await sleep(12000); }
      }
      return;
    }

    if (info.huntStage !== target.stage) {
      await this.walkTo(target.stage);
      return;
    }

    await this.hunt(target);
  }

  // 同一張圖裡換樓層：前進／後退各算一場戰鬥，戰報照收
  async walkTo(stage) {
    const info = this.info;
    const dir = info.huntStage < stage ? 'forward' : 'back';
    if (dir === 'forward' && !info.canForward) { this.log(`${info.huntStage}F 無法再前進`); this.state.stage = info.huntStage; return; }
    if (dir === 'back' && !info.canBack) { this.log(`${info.huntStage}F 無法再後退`); this.state.stage = info.huntStage; return; }
    await this.waitCooldown();
    const r = await this.client.hunt(dir);
    this.store.add(r.report);
    this.info = r.huntInfo || info;
    this.prevHp = null;
    this.log(`${dir === 'forward' ? '前進' : '後退'} → ${this.info.huntStage}F`);
  }

  async waitCooldown() {
    const info = this.info;
    if (!info || !info.huntAvailableAt) return;
    const wait = new Date(info.huntAvailableAt).getTime() - this.client.now();
    if (wait > 0) await sleep(Math.min(wait + 200, 60000));
  }

  async hunt(target) {
    await this.waitCooldown();
    let r;
    try {
      r = await this.client.hunt();
    } catch (e) {
      if (e instanceof ApiError && /沒有可戰鬥|無法狩獵/.test(e.message)) {
        await this.recover('沒人能打了');
        this.info = await this.client.huntInfo();
        return;
      }
      // 冷卻沒到就只是早了幾秒，睡一下再來即可；
      // 走通用錯誤路徑會多花一次 huntInfo 去問一件我們已經知道的事。
      if (e instanceof ApiError && /CD|冷卻/.test(e.message)) {
        await sleep(3000);
        return;
      }
      throw e;
    }

    const report = r.report;
    if (r.money != null) this.profileMoney = r.money;
    this.store.add(report);
    const before = this.prevHp;
    this.info = r.huntInfo || this.info;
    const heroes = (this.info && this.info.heroes) || [];
    const after = partyHp(heroes);
    const exp = expOf(report);
    const died = heroes.some((h) => h.hp <= 0);

    this.state.hunts++;
    this.state.expTotal += exp;
    this.prevHp = after;

    // 只有「同一層、上一場之後沒休息過」的落差才算戰損
    const loss = before == null ? 0 : Math.max(0, before - after);
    if (!target.fixed) this.floors.record(target.zoneId, report.stage, { exp, loss, died });

    const drops = dropsOf(report);
    const enemies = (report.b || []).map((b) => `${b.name}Lv${b.lv}`).join('、');
    this.log(
      `${report.zone}${report.stage}F #${this.state.hunts} +${exp}exp 全隊${pct(after)}` +
      ` 敵：${enemies}${drops.length ? ` ／${drops.join('、')}` : ''}`,
    );

    if (target.boss && /伊爾凡格/.test(enemies)) {
      this.log('★ 遇到狗頭人之王伊爾凡格 ★');
      this.workLog({ kind: 'boss', report: report.id, enemies, survived: !died });
    }

    // 每十場檢討一次要不要換樓層
    if (!target.fixed && ++this.state.sinceReview >= 10) {
      this.state.sinceReview = 0;
      const g = this.cfg.ground;
      const pickNext = this.floors.next({
        zoneId: target.zoneId,
        stage: report.stage,
        level: this.crewLevel(),
        minStage: g.minStage,
        maxStage: g.maxStage,
      });
      if (pickNext.stage !== report.stage) {
        this.log(pickNext.why);
        this.state.stage = pickNext.stage;
      }
    }
  }
}

async function main() {
  const list = roster.accounts.map((cfg) => new Agent(cfg));
  for (const a of list) agents.set(a.name, a);
  console.log(`開跑：${list.map((a) => a.name).join('／')}，每帳號 ${CAP}/hr，預計 ${RUN_MINUTES} 分鐘`);
  await Promise.all(list.map((a) => a.run().catch((e) => a.log('掛了：', e.stack || e.message))));
}

main().catch((e) => { console.error('主控掛了：', e); process.exit(1); });
