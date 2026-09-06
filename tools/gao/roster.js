'use strict';
// 兩個帳號的分工。改這裡就好，主控迴圈（tools/gao-play.js）不用動。
//
// 練功場為什麼是黑暗山洞：2026-09-06 實測下探，同一隊在
//   黑暗山洞 3F     每場 19–25 經驗
//   大草原 1–8F     每場 1–5 經驗
//   大草原 9–12F    每場 8–19 經驗
//   大草原 13F      冒出 Lv16 鹿角兔，一場把人打掉 30% 血
// 所以「練等為主」的隊伍走黑暗山洞，代價是那裡不掉補品；
// 補品由大草原那一隊收（兔肉在 1–14F，狗頭人的 HP 藥水在 18F 以後）。

module.exports = {
  // 人下的令是每個帳號每小時 600 次；壓在 500 留兩成餘裕給重試與突發。
  hourlyCap: 500,

  // 城鎮雜務（挖礦、鍛造、換裝、轉素材）多久做一次
  choreIntervalMs: 4 * 60 * 1000,

  // 血量低於此比例就想辦法回血
  restBelow: 0.4,
  // 補到這個比例才回去打。一輪休息只補幾十點，補一次就回去會一直在低血量震盪。
  restUntil: 0.85,
  restMs: 5 * 60 * 1000,
  restRounds: 6,

  // 挖礦挖滿幾分鐘才收。收穫看消耗的體力，一到最低時間（3 分鐘）就按完成，
  // 結果會是「消耗了 2 點體力，什麼也沒挖到」。
  miningMinutes: 20,

  // 跨帳號轉素材：上架時把這串寫進 message，對面照這個認領。
  // 別加連字號——遊戲的訊息欄只收英數與 . / : ; < = > ? @ 這段和 # $ % ^ & * + , ~，
  // '-' 剛好落在允許範圍外，帶了就整個上架被打回「資料格式錯誤」。
  tradeTag: '#gaoship',

  accounts: [
    {
      key: 'arcgrove',
      nickname: 'ArcGrove',
      label: 'u177',
      tokenFile: 'token-b.txt',

      // 任務 1：盡可能用最高效率練等。
      // 任務 4：目標是四隻 25 等去打大草原 30F 的狗頭人之王伊爾凡格。
      core: [1189, 1138, 1326, 1152], // Pegasus／Zeus／Asclepius／Ares
      goalLevel: 25,
      ground: { zoneId: 2, zoneName: '黑暗山洞', stage: 3, minStage: 1, maxStage: 40 },
      boss: { zoneId: 1, zoneName: '大草原', stage: 30, name: '狗頭人之王伊爾凡格' },

      // 任務 3：礦工挖到的素材轉給 3096 鍛造。
      miners: { 1489: 3 }, // 工地外勞 → 鐵礦山（金屬素材的攻／防最高）
      smiths: {},
      shipMinesTo: '3096',
      // 這些留著自己用，其餘全部轉出去
      keepMines: {},
    },

    {
      key: '3096',
      nickname: '3096',
      label: 'u140',
      tokenFile: 'token-a.txt',

      // 任務 0：先把矮人工匠練到 10 等，地點指定大草原 7F。
      // 出師之前他跟著隊伍打，出師之後回城專心鍛造。
      apprentice: { heroId: 537, untilLevel: 10, zoneId: 1, zoneName: '大草原', stage: 7 },

      // 任務 1：狩獵收集補品——大草原才掉，所以這一隊不進黑暗山洞。
      core: [429, 1041, 816], // 西域霸天／鐵砂教頭／黑色獠牙
      goalLevel: 25,
      ground: { zoneId: 1, zoneName: '大草原', stage: 7, minStage: 1, maxStage: 26 },
      boss: null,

      // 任務 2：鍛造裝備。矮人工匠出師後才會真的開工。
      miners: { 1527: 3, 1456: 1 }, // 白人戰士 → 鐵礦山、吉娃娃 → 砂石場
      smiths: { 537: true },
      shipMinesTo: null,
      keepMines: {},
    },
  ],
};
