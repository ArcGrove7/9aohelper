'use strict';
// 帳號 ArcGrove（雷霆天降＋白人戰士＋獨角獸）的劇本：純練功，不挖礦不鍛造。
// 大草原 4 樓練到 10 等，再轉黑暗山洞。

module.exports = {
  // 不做原地蒐證階段——隊伍已經在練功點上了
  probe: null,

  // 獨角獸（1189）退出戰鬥去挖砂石場——帳號有兩個任務卡著：
  // 「交付 10 份礫石」與「消耗 30 點體力挖礦」，挖砂石場一趟兩個一起推進。
  miners: { 1189: 1 },
  smiths: {},
  // 人下的令：挖礦至少 30 分鐘一個階段，收太快沒有收穫
  miningMinutes: 30,

  // 用名字寫，bot 啟動時自己對應到 id
  // 慈祥老醫生（後排補師）加進來，試試有補師撐不撐得住 5 樓
  grinders: ['雷霆天降', '白人戰士', '慈祥老醫生'],

  route: [
    { zoneId: 1, zoneName: '大草原', stage: 5, untilLevel: 10 },
    { zoneId: 2, zoneName: '黑暗山洞', stage: 1, untilLevel: null },
  ],

  // 人下的令：戰鬥人員的 HP 與體力都不准低於五成
  restBelow: 0.5,
  restUntil: 0.9,
  healUntil: 0.65,
  useItems: true,
  // 增益補品（戰鬥口糧那種）**只能留著打 BOSS**（人下的令）——練功時一律不准吃
  useBuffs: false,
  restMs: 5 * 60 * 1000,
  // 一輪五分鐘大約回一百多點 HP，被打到剩一成要躺很久，所以給得寬一點
  restRounds: 10,
};
