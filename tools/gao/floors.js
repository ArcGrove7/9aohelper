'use strict';
// 樓層控制：自己找出「還撐得住的最深樓層」。
//
// 為什麼不寫死一層：經驗值跟著敵人等級走，越深越多（實測黑暗山洞 3F 每場 19–25，
// 大草原 8F 只有 3–5），但深到某一層就會冒出一隻打不動的怪——大草原 13F 的
// Lv16 鹿角兔一場帶走三成血。寫死就只能取一個保守的中間值，兩頭都虧。
//
// 所以改成爬山：在目前這層蒐夠樣本 → 撐得住就往下探一層 → 探到會死人就退回來，
// 並把那層記成「擋住」，等隊伍等級長上去再試。

const MIN_SAMPLE = 12;      // 一層至少打幾場才敢下判斷
const SAFE_LOSS = 0.025;    // 每場平均掉血 ≤ 2.5%（全隊合計）就算游刃有餘
const DANGER_LOSS = 0.07;   // 每場平均掉血 ≥ 7% 就是撐不住，退回上一層
const RETRY_LEVEL_GAP = 2;  // 被擋住的樓層，隊伍平均等級長這麼多才再試

function blankStat() {
  return { battles: 0, expSum: 0, lossSum: 0, deaths: 0, blockedAtLevel: null };
}

class FloorPicker {
  constructor(saved) {
    // key: `${zoneId}-${stage}` → stat
    this.stats = new Map(Object.entries((saved && saved.stats) || {}).map(([k, v]) => [k, { ...blankStat(), ...v }]));
  }

  toJSON() {
    return { stats: Object.fromEntries(this.stats) };
  }

  stat(zoneId, stage) {
    const k = `${zoneId}-${stage}`;
    if (!this.stats.has(k)) this.stats.set(k, blankStat());
    return this.stats.get(k);
  }

  // 記一場戰鬥：exp 是這場拿到的經驗，loss 是全隊血量掉了幾成，died 是有沒有人倒下
  record(zoneId, stage, { exp = 0, loss = 0, died = false } = {}) {
    const s = this.stat(zoneId, stage);
    s.battles++;
    s.expSum += exp;
    if (loss > 0) s.lossSum += loss;
    if (died) s.deaths++;
  }

  avgExp(zoneId, stage) {
    const s = this.stat(zoneId, stage);
    return s.battles ? s.expSum / s.battles : 0;
  }

  avgLoss(zoneId, stage) {
    const s = this.stat(zoneId, stage);
    return s.battles ? s.lossSum / s.battles : 0;
  }

  // 這層現在是不是被擋住的（探過會死人，而且隊伍等級還沒長夠）
  isBlocked(zoneId, stage, level) {
    const s = this.stat(zoneId, stage);
    if (s.blockedAtLevel == null) return false;
    return level < s.blockedAtLevel + RETRY_LEVEL_GAP;
  }

  block(zoneId, stage, level) {
    this.stat(zoneId, stage).blockedAtLevel = level;
  }

  /**
   * 下一步該待在哪一層。
   * @param {object} o
   * @param {number} o.zoneId    現在在哪張圖
   * @param {number} o.stage     現在在幾樓
   * @param {number} o.level     隊伍裡最低的等級（下探的門檻用最弱的那隻算）
   * @param {number} o.minStage
   * @param {number} o.maxStage
   * @returns {{stage:number, why:string}}
   */
  next({ zoneId, stage, level, minStage = 1, maxStage = 40 }) {
    const s = this.stat(zoneId, stage);
    const loss = this.avgLoss(zoneId, stage);

    // 死過人就別硬撐，先退一層再說——樣本再多也不會讓死人變成沒死。
    if (s.deaths > 0) {
      this.block(zoneId, stage, level);
      s.deaths = 0;
      s.battles = 0; s.expSum = 0; s.lossSum = 0; // 退回去之後重新蒐樣本
      return { stage: Math.max(minStage, stage - 1), why: `${stage}F 有人陣亡，退回上一層` };
    }

    if (s.battles < MIN_SAMPLE) return { stage, why: '' };

    if (loss >= DANGER_LOSS) {
      this.block(zoneId, stage, level);
      s.battles = 0; s.expSum = 0; s.lossSum = 0;
      return {
        stage: Math.max(minStage, stage - 1),
        why: `${stage}F 每場平均掉血 ${(loss * 100).toFixed(1)}%，撐不住，退回上一層`,
      };
    }

    if (loss <= SAFE_LOSS && stage < maxStage) {
      const next = stage + 1;
      if (!this.isBlocked(zoneId, next, level)) {
        s.battles = 0; s.expSum = 0; s.lossSum = 0; // 換層之後重新蒐樣本
        return {
          stage: next,
          why: `${stage}F 每場平均掉血 ${(loss * 100).toFixed(1)}%，往下探 ${next}F`,
        };
      }
    }

    return { stage, why: '' };
  }
}

module.exports = { FloorPicker, MIN_SAMPLE, SAFE_LOSS, DANGER_LOSS };
