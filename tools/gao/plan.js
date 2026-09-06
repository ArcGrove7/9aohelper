'use strict';
// 這一輪要跑的劇本。改這裡就好，主控迴圈不用動。

module.exports = {
  // 蒐證階段：全隊在哪裡原地打
  probe: { zoneId: 1, stage: 10 },

  // 挖礦組：英雄 id → 礦區（1=砂石場 2=森林區 3=鐵礦山 4=阿嬤寶山）
  miners: { 429: 2 },

  // 一輪挖多久才收（分鐘）。最低是 3 分鐘，但收穫看消耗的體力——
  // 一到 3 分鐘就按完成，結果會是「消耗了 2 點體力，什麼也沒挖到」。
  miningMinutes: 20,

  // 鍛造組：英雄 id → 要打的東西
  smiths: {
    537: { type: 'sword', name: '雷霆天降', forgeSlot: 1 },
  },

  // 練功組：這幾隻留在隊伍裡
  grinders: [816, 1041],

  // 練功路線：先到大草原 4 練到 10 等，再轉黑暗山洞
  route: [
    { zoneId: 1, zoneName: '大草原', stage: 4, untilLevel: 10 },
    { zoneId: 2, zoneName: '黑暗山洞', stage: 1, untilLevel: null },
  ],

  // HP 低於此比例就全隊休息
  restBelow: 0.35,
  // 休息到 HP 回到這個比例才回去打。恢復量看休息的時間，一輪只補幾十點，
  // 補一次就回去打會一直在低血量附近震盪，所以要休息到夠。
  restUntil: 0.75,
  // 一輪休息多久（毫秒）——最低休息時間是 1 分鐘
  restMs: 5 * 60 * 1000,
  // 一次最多連休幾輪，免得補不上來時卡死在休息
  restRounds: 5,
};
