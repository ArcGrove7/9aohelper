'use strict';
// 帳號 ArcGrove（雷霆天降＋白人戰士＋獨角獸）的劇本：純練功，不挖礦不鍛造。
// 大草原 4 樓練到 10 等，再轉黑暗山洞。

module.exports = {
  // 不做原地蒐證階段——隊伍已經在練功點上了
  probe: null,

  miners: {},
  smiths: {},

  // 用名字寫，bot 啟動時自己對應到 id
  grinders: ['雷霆天降', '白人戰士', '獨角獸'],

  route: [
    { zoneId: 1, zoneName: '大草原', stage: 4, untilLevel: 10 },
    { zoneId: 2, zoneName: '黑暗山洞', stage: 1, untilLevel: null },
  ],

  // 人下的令：戰鬥人員的 HP 與體力都不准低於五成
  restBelow: 0.5,
  restUntil: 0.9,
  healUntil: 0.65,
  useItems: true,
  useBuffs: true,
  restMs: 5 * 60 * 1000,
  restRounds: 5,
};
