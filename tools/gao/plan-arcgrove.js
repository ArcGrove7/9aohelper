'use strict';
// 帳號 ArcGrove 的劇本。
// 練功隊：雷霆天降＋白人戰士＋慈祥老醫生（後排補師），大草原 4 樓練到全員 10 等，
// 再轉黑暗山洞 1 樓。挖礦組：獨角獸與平民留在城裡挖料。

module.exports = {
  // 不做原地蒐證階段——這隊直接練功
  probe: null,

  // 挖礦組：1189 Pegasus（獨角獸）調去打架了，只剩 1325 Daedalus（平民）挖砂石場。
  miners: { 1325: 1 },
  smiths: {},
  miningMinutes: 30,

  // 練功隊（人下的令 16:33，四人）。用 id 不用名字——這帳號的英雄改過名，id 才認得住。
  //   1138 Zeus（黑之劍士 lv8）、1152 Ares（白人戰士 lv8）、
  //   1326 Asclepius（慈祥老醫生 lv6，後排補師）、1189 Pegasus（獨角獸 lv6，剛從挖礦調回來）
  // 三個有盔甲的：Ares 防288、Zeus 防221、Asclepius 防142。
  grinders: [1138, 1152, 1326, 1189],

  // 人下的令（16:33）：帶著這身盔甲去黑暗山洞 1 樓練，練到全員 10 等。
  // 黑暗山洞是新地圖，敵人圖鑑會多一批新的。
  route: [
    { zoneId: 2, zoneName: '黑暗山洞', stage: 1, untilLevel: 10 },
  ],

  // 人下的令：戰鬥人員的 HP 與體力都不准低於五成
  // 裝備耐久歸零就消失（實測一場狩獵吃掉約 1.4 點），所以壞了自動從庫存補上
  autoEquip: true,
  equipSlots: ['單手劍', '盔甲'],

  restBelow: 0.5,
  restUntil: 0.75,
  healUntil: 0.65,
  useItems: true,
  // 增益補品（戰鬥口糧那種）**只能留著打 BOSS**（人下的令）——練功時一律不准吃
  useBuffs: false,
  restMs: 5 * 60 * 1000,
  // 一輪五分鐘大約回一百多點 HP，被打到剩一成要躺很久，所以給得寬一點
  restRounds: 10,
};
