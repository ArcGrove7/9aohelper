# capture／遊戲觀測素材

這裡是從 `beta.swordgale.online` 實際遊玩取回的**原始素材**，
不是網站內容——`index.html` 那一套頁面不會讀這個目錄。
目的是替之後的攻略頁面（尤其是敵人圖鑑）累積可查證的底料。

## 檔案

| 檔 | 內容 | 誰生成 |
|---|---|---|
| `hunt-reports.jsonl` | 一行一份狩獵戰報，原封不動 | `tools/gao-bot.js`、`tools/gao-fetch-reports.js` |
| `work-log.jsonl` | 挖礦收穫與鍛造紀錄 | `tools/gao-bot.js` |
| `bestiary.json` | 敵人／地點的彙整結果，機器讀 | `tools/build-bestiary.js` |
| `bestiary.md` | 同上，人讀的一覽表 | `tools/build-bestiary.js` |

`bestiary.*` 是產物，**不要手改**——改了下次重跑就沒了。
要修正資料就去修戰報來源或彙整規則。

## 重跑

    node tools/gao-fetch-reports.js --token-file <放 token 的檔>   # 撈伺服器上還留著的歷史戰報（只保留最近 100 份）
    node tools/gao-bot.js --token-file <放 token 的檔> --minutes 60 # 照 tools/gao/plan.js 的劇本操作帳號並持續蒐戰報
    node tools/build-bestiary.js                                    # 重建彙整

token 放在 `.gao-state/`（已在 `.gitignore`），不要進版控。

## 資料性質

- 戰報裡的敵人 HP／體力**每次出現都不一樣**，所以 `bestiary` 記的是
  **觀測區間**（目前看過的最小到最大），不是設定值。看的場次越多區間越準。
- 掉落訊息不寫是哪一隻怪掉的，只能歸到**樓層**。
  `bestiary.json` 的 `spots[].drops` 是該樓層的累計，不要當成單隻怪的掉落表。
- 敵人技能是從戰報訊息「A 對 B 使出了 X」抓出來的，只記錄實際看過的。

## 進站前要過濾

`hunt-reports.jsonl` 的 `a` 欄位是**我方隊伍**——帳號暱稱、英雄名、自家裝備數值都在裡面。
依儲存庫的內容規矩（見根目錄 `README.md`），這些一律不上站。
可以上站的只有敵人與地點那一面，也就是 `bestiary.json` 的 `enemies` 與 `spots`。
