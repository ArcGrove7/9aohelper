'use strict';
// beta.swordgale.online 的 HTTP 客戶端。
//
// 兩件事這裡一定要顧好：
//   1. 每個帳號每小時不超過 600 次請求——實際用 500/hr 當上限留餘裕，
//      額度存在磁碟上，換個行程重跑也接得回去。
//   2. 站在 Cloudflare 後面，沒有瀏覽器 UA 會吃 403 challenge。

const fs = require('fs');
const path = require('path');

const BASE = 'https://beta.swordgale.online';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 人下的令是 600/hr；留兩成餘裕給重試與突發。
const HOURLY_CAP = 500;
const WINDOW_MS = 3600 * 1000;

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class RateLimiter {
  constructor(stateFile, cap = HOURLY_CAP) {
    this.stateFile = stateFile;
    this.cap = cap;
    this.stamps = [];
    try {
      this.stamps = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      this.stamps = [];
    }
  }

  // 額度是「整個帳號」共用的，可能有別的行程也在扣，
  // 所以每次判斷前都把磁碟上的最新狀態讀回來。
  reload() {
    try {
      const disk = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (Array.isArray(disk)) {
        const merged = new Set([...this.stamps, ...disk]);
        this.stamps = [...merged].sort((a, b) => a - b);
      }
    } catch { /* 檔案還沒建立，用記憶體裡的就好 */ }
  }

  prune(now) {
    this.stamps = this.stamps.filter((t) => now - t < WINDOW_MS);
  }

  save() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.stamps));
  }

  // 需要等多久才輪得到下一次請求（毫秒）。
  //
  // urgent＝急件：只看「這一小時還有沒有額度」，不等平均間隔。
  // 真正的限制是每小時 600 次，平均攤開只是我們自己為了平順加的。
  // 有些動作差幾秒就會出事——把東西掛上公開市場後要立刻買回來，
  // 中間每多等一秒都是別人把它撿走的機會。那種場合就走急件。
  waitMs(urgent = false) {
    this.reload();
    const now = Date.now();
    this.prune(now);
    if (this.stamps.length >= this.cap) return this.stamps[0] + WINDOW_MS - now + 50;
    if (urgent) return 0;
    // 額度沒滿也不要連發：平均攤成一小時。
    const minGap = WINDOW_MS / this.cap;
    const last = this.stamps[this.stamps.length - 1] || 0;
    return Math.max(0, last + minGap - now);
  }

  async take(urgent = false) {
    for (;;) {
      const wait = this.waitMs(urgent);
      if (wait <= 0) break;
      // 抖動不是裝飾：好幾個行程共用同一份額度時，大家都照
      // 「上一次請求 + 固定間隔」算等待，就會一起醒來、同一個行程每次都先搶到，
      // 另一個永遠排不進去。錯開醒來的時間才輪得到。
      await sleep(wait + Math.floor(Math.random() * 900));
    }
    this.stamps.push(Date.now());
    this.save();
  }

  used() {
    this.reload();
    this.prune(Date.now());
    return this.stamps.length;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Client {
  constructor({ token, stateDir, label = 'main', cap = HOURLY_CAP, log = console.log }) {
    if (!token) throw new Error('缺少 token');
    this.token = token;
    this.label = label;
    this.log = log;
    this.limiter = new RateLimiter(path.join(stateDir, `ratelimit-${label}.json`), cap);
    this.serverSkewMs = 0;
  }

  get requestsUsed() {
    return this.limiter.used();
  }

  // 伺服器時間——冷卻判斷一律用這個，別用本機時鐘。
  now() {
    return Date.now() + this.serverSkewMs;
  }

  async request(method, url, body, { retries = 3, urgent = false } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.limiter.take(urgent);
      const headers = { 'User-Agent': UA, token: this.token, Accept: 'application/json' };
      const init = { method, headers };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      let res;
      try {
        res = await fetch(BASE + url, init);
      } catch (e) {
        lastErr = e;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      const st = res.headers.get('server-time');
      if (st && Number.isFinite(Number(st))) this.serverSkewMs = Number(st) - Date.now();

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = undefined;
      }
      if (res.ok) return data;

      const msg = (data && data.message) || res.statusText || `HTTP ${res.status}`;
      // 4xx 是遊戲規則擋下來的（冷卻沒到、狀態不對），重試沒意義。
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ApiError(res.status, msg, data);
      }
      lastErr = new ApiError(res.status, msg, data);
      await sleep(3000 * 2 ** attempt);
    }
    throw lastErr;
  }

  get(url, opts) {
    return this.request('GET', url, undefined, opts);
  }

  post(url, body, opts) {
    return this.request('POST', url, body, opts);
  }

  // ---- 遊戲端點 ----
  profile() { return this.get('/api/profile'); }
  heroes() { return this.get('/api/heroes').then((r) => r.heroes); }
  hero(id) { return this.get(`/api/heroes/${id}`); }
  huntInfo() { return this.get('/api/huntInfo'); }
  zones() { return this.get('/api/zones').then((r) => r.zones); }
  items() { return this.get('/api/items').then((r) => r.items || r); }
  equipments() { return this.get('/api/equipments').then((r) => r.equipments || r); }

  // type: undefined=原地、'back'=後退、'forward'=前行
  hunt(type) { return this.post(`/api/hunt${type ? `?type=${type}` : ''}`); }

  move(zoneId) { return this.post(`/api/move/${zoneId}`); }
  moveComplete() { return this.post('/api/move/complete'); }
  moveForkPath(zoneId) { return this.post(`/api/moveForkPath/${zoneId}`); }

  select(heroId) { return this.post(`/api/heroes/${heroId}/select`); }
  deselect(heroId) { return this.post(`/api/heroes/${heroId}/deselect`); }
  rest(heroId) { return this.post(`/api/heroes/${heroId}/rest`); }
  restAll() { return this.post('/api/heroes/restAll'); }
  restAllComplete() { return this.post('/api/heroes/restAll/complete'); }
  revive(heroId) { return this.post(`/api/heroes/${heroId}/revive`); }
  reviveAll() { return this.post('/api/heroes/reviveAll'); }
  reviveAllComplete() { return this.post('/api/heroes/reviveAll/complete'); }
  completeAction(heroId) { return this.post(`/api/heroes/${heroId}/completeAction`); }
  // target: 1=砂石場 2=森林區 3=鐵礦山 4=阿嬤寶山
  mining(heroId, target) { return this.post(`/api/heroes/${heroId}/mining/${target}`); }
  addPoints(heroId, points) { return this.post(`/api/heroes/${heroId}/addPoints`, points); }
  position(heroId, body) { return this.post(`/api/heroes/${heroId}/position`, body); }

  forgeInfo() { return this.get('/api/forge'); }
  forge(body) { return this.post('/api/forge', body); }
  completeForge(heroId) { return this.post(`/api/heroes/${heroId}/completeForge`); }

  reports(type = 'hunt') { return this.get(`/api/reports?type=${type}`).then((r) => r.reports); }
  report(id) { return this.get(`/api/reports/${id}`); }
}

// 動作狀態（拆自前端 bundle）
const ActionState = {
  Idle: 0, Moving: 1, Resting: 2, Reviving: 3, Mining: 4, Forging: 5, Selling: 6,
};
const MiningTarget = { 砂石場: 1, 森林區: 2, 鐵礦山: 3, 阿嬤寶山: 4 };

module.exports = { Client, ApiError, ActionState, MiningTarget, sleep, BASE, UA };
