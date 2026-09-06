# capture／遊戲觀測素材

這裡是從 `beta.swordgale.online` 實際遊玩取回的**原始素材**，
不是網站內容——`index.html` 那一套頁面不會讀這個目錄。
目的是替之後的攻略頁面（尤其是敵人圖鑑）累積可查證的底料。

## 檔案

| 檔 | 內容 | 誰生成 |
|---|---|---|
| `hunt-reports.jsonl` | 一行一份狩獵戰報，原封不動 | `tools/gao-sync-capture.js`、`tools/gao-fetch-reports.js` |
| `attack-reports.jsonl` | 對戰戰報（我方發起：劫掠／廝殺／友好切磋） | `tools/gao-fetch-reports.js --type attack` |
| `defend-reports.jsonl` | 對戰戰報（被打的那一邊） | `tools/gao-fetch-reports.js --type defend` |
| `work-log.jsonl` | 挖礦收穫與鍛造紀錄 | `tools/gao-sync-capture.js` |
| `bestiary.json` | 敵人／地點的彙整結果，機器讀 | `tools/build-bestiary.js` |
| `bestiary.md` | 同上，人讀的一覽表 | `tools/build-bestiary.js` |
| `message-templates.json` | 戰報文本模板與出現次數，機器讀 | `tools/build-messages.js` |
| `message-templates.md` | 同上，依訊息顏色類別分組 | `tools/build-messages.js` |
| `forge-log.json` | 鍛造配方對成品的數值，機器讀 | `tools/build-forge-log.js` |
| `forge-log.md` | 同上，依裝備類型分組、依品質排序 | `tools/build-forge-log.js` |

`bestiary.*`、`message-templates.*` 與 `forge-log.*` 都是產物，**不要手改**——改了下次重跑就沒了。
要修正資料就去修戰報來源或彙整規則。

## 重跑

    node tools/gao-fetch-reports.js --token-file <檔> --label <帳號代號> [--type hunt|attack|defend]
                                                                    # 撈伺服器上還留著的歷史戰報（每種只保留最近 100 份）
    node tools/gao-bot.js --token-file <放 token 的檔> --label <帳號代號> \
      [--plan tools/gao/plan-<誰>.js] --minutes 60                  # 照劇本操作帳號並持續蒐戰報
    node tools/gao-sync-capture.js                                  # 把 bot 的工作檔併進這個目錄（去重、按時間排序）
    node tools/build-bestiary.js                                    # 重建敵人／地點彙整
    node tools/build-messages.js                                    # 重建戰報文本模板
    node tools/build-forge-log.js                                   # 重建鍛造配方對照

token 放在 `.gao-state/`（已在 `.gitignore`），不要進版控。

一個帳號一支 bot，用 `--label` 分開（額度、階段、工作檔都各自一份），可以同時跑；
劇本用 `--plan` 指定，`tools/gao/plan.js` 是預設的那一份。
入庫時所有帳號的工作檔會併進同一份 `hunt-reports.jsonl`——都是同一個遊戲的觀測資料，
用戰報 id 去重就夠。

bot **不直接寫這個目錄**——它每隔幾秒就產一份戰報，直接寫的話工作區永遠是
「有未提交的變更」，也挑不到乾淨的提交點。它只寫 `.gao-state/` 的同名工作檔，
要入庫時跑 `gao-sync-capture.js` 併過來。

## 資料性質

- 戰報裡的敵人 HP／體力**每次出現都不一樣**，所以 `bestiary` 記的是
  **觀測區間**（目前看過的最小到最大），不是設定值。看的場次越多區間越準。
- 掉落訊息不寫是哪一隻怪掉的，只能歸到**樓層**。
  `bestiary.json` 的 `spots[].drops` 是該樓層的累計，不要當成單隻怪的掉落表。
- 敵人技能是從戰報訊息「A 對 B 使出了 X」抓出來的，只記錄實際看過的。
- `forge-log.*` 是「放了什麼 → 打出什麼」的實例。站上有素材數值與標籤加成規則，
  但沒有這一段。同樣的配方每次結果仍有落差（品質有隨機成分），要看趨勢不是單筆。
- `message-templates.*` 吃狩獵與對戰三種戰報（文本是共用的），把角色名換成 `{我方}`／`{敵方}`、數字換成 `{n}`，
  剩下的骨架就是遊戲的文本模板。分組依據是遊戲自己標的顏色類別
  （`skill` 技能、`lucky` 幸運事件、`strong` 強力、`critical` 致命、`sub` 未命中…），
  拿來整理戰鬥機制頁很好用，而且完全不含我方資料。

## 進站前要過濾

`hunt-reports.jsonl` 的 `a` 欄位是**我方隊伍**——帳號暱稱、英雄名、自家裝備數值都在裡面。
依儲存庫的內容規矩（見根目錄 `README.md`），這些一律不上站。
可以上站的只有敵人與地點那一面（`bestiary.json` 的 `enemies` 與 `spots`）
以及 `message-templates.*`——那兩份產物本來就不含我方資料。
