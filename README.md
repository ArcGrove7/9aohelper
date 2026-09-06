# 9aohelper

圖鑑與攻略查表站——純靜態網站（HTML＋CSS＋一支 `site.js`，零組建、零相依）。
資料取自遊戲前端拆包、官方數值表與鍛造模擬器；機制未明的地方直說「未知」，不放猜的。

原本住在 `GunartonlineHelper/site/`，2026-09-04 拆成獨立儲存庫。

## 頁面

| 頁 | 內容 |
|---|---|
| `index.html` | 首頁：全站搜尋＋分類入口卡片 |
| `zones.html` | 地圖圖鑑：13 張地圖的官方描述、編號數法、秘境對照 |
| `enemies.html` | 敵人圖鑑：一隻怪一張卡（可切表格、可排序），出沒樓層與掉落全可點 |
| `skills.html` | 技能圖鑑：34 招可搜尋、可篩型別 |
| `materials.html` | 素材圖鑑：241 種素材 × 8 欄，可篩標籤與特效 |
| `effects.html` | 裝備圖鑑：15 種裝備係數（一次看一件）、品質倍率、31 種特效機制 |
| `formulas.html` | 公式與武器：傷害公式、熟練折算、型別倍率表 |
| `allocation.html` | 點數計算機（離線單檔工具） |
| `updates.html` | 版本情報：官方更新日誌 257 版全文檢索 |

## 部署到 Cloudflare Pages

1. 登入 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 選 `ArcGrove7/9aohelper`。
3. 建置設定：**Production branch** `main`、**Build command** 留空、**Build output directory** `/`（儲存庫根目錄就是網站）。
4. **Save and Deploy**。之後合進 `main` 就自動重新部署。

不想連 Git 的話：

    npm install -g wrangler
    wrangler login
    wrangler pages project create 9aohelper --production-branch main
    wrangler pages deploy . --project-name 9aohelper

## 開發

站本身零組建。輔助工序有三個：

- **鎖定測試**（手機 UX、搜尋篩選、詳情頁與關聯、計算機，共 160 項）：

      npm install
      npm test

- **實體庫**：五類實體（素材／特效／技能／裝備類型／地圖）與雙向關聯、
  版本紀錄命中，全部由 `tools/build-db.js` 從各圖鑑頁抽出來生成
  `data/db.js`——反向關聯不在頁面各自維護，一律在這裡生成，
  並做完整性檢查（id 唯一、引用必須存在），壞了整個 build 會失敗：

      node tools/build-db.js

- **全站搜尋索引**：實體條目從 `data/db.js` 讀、連到 `detail.html` 詳情頁：

      node tools/build-search-index.js

改了任何圖鑑內容後，兩支都重跑一次，產物進版控。

- **遊戲觀測素材**（`capture/`，不是網站內容，頁面不會讀它）：實際遊玩取回的戰報，
  用來替敵人圖鑑累積可查證的底料。

      node tools/gao-fetch-reports.js --token-file <放 token 的檔>    # 撈伺服器上還留著的歷史戰報
      node tools/gao-bot.js --token-file <放 token 的檔> --minutes 60  # 照 tools/gao/plan.js 的劇本操作帳號
      node tools/build-bestiary.js                                     # 從戰報重建敵人／地點彙整

  規矩見 `capture/README.md`：戰報的我方那一半（暱稱、英雄名、自家裝備）**不上站**，
  可上站的只有敵人與地點。帳號 token 放 `.gao-state/`，已在 `.gitignore`。
  每個帳號每小時請求上限 600，`tools/gao/api.js` 自己壓在 500 並把用量存在磁碟上。

## 資料怎麼加

1. **來源只有一個**：各圖鑑列表頁（`materials.html` 的 `M`、`effects.html`
   的表格與 `EQ`、`skills.html`／`zones.html`／`enemies.html` 的列表）。改資料改這裡。
2. 重跑 `node tools/build-db.js && node tools/build-search-index.js`——
   詳情頁、反向關聯、搜尋條目全部自動跟上；引用打錯字 build 直接失敗。
3. `npm test` 全綠再提交。數量有變（素材不是 241 種了）就同步改測試的數字。
4. 版本標記：頁尾與 `tools/build-db.js` 開頭的 `GAME_VERSION` 一起改。
5. 沒有可靠來源的欄位一律留白／寫「尚無可靠資料」——詳情頁會照實顯示，
   不要為了版面好看補值。

## 網址

列表頁：`/materials`、`/effects`、`/skills`、`/zones`、`/formulas`、`/stats`、
`/allocation`、`/enemies`、`/updates`（`?q=片段` 進頁自動篩，網址隨輸入同步，可直接分享）。
詳情頁：`/detail?t=material|effect|skill|eqtype|zone&id=名稱`。
舊網址全部不變，只加不改。

## 內容規矩（人下的令，沿自 2026-09-03；加新內容前先讀）

- **站上只放拆包資料與客觀公式**——不放帳號名、角色名、自家數值、戰力天花板情報、
  任何「實測」戰報回歸與觸發率統計。這個站是給網友看的。
- **社群資料經人核准後可入庫**（2026-09-05 起）：敵人圖鑑整理自玩家共編的
  GAO 資料庫試算表，頁面標明來源與「觀測下限」性質；新批次資料照同一規矩。
- **站名只用 `9aohelper`**，不出現「GAO 攻略站」這種字樣（標題、頁首、頁尾、meta 全都是）。
- **像真正的攻略網站一樣直接呈現資料**（人下的令，2026-09-05）：頁面上不解釋資料怎麼來、
  不出現「拆包」「實測」「測試」「逐字」「對照驗證」這類過程詞彙——一切理所當然地擺出來就好。
- **頁首只有一行**（人下的令，2026-09-05）：站名＋導覽同一行，塞不下就橫滑，不換行堆高。
- **桌機不留大片左右空白**（人下的令，2026-09-05）：主內容區 `max-width: 110rem`，
  寬螢幕讓表格與卡片撐滿，不要縮回窄欄。
- **易讀模式要一直在**（2026-09-05，為閱讀不便的玩家而設）：頁首「Aa 易讀」
  一鍵放大字距行距、所有表格攤成卡片，偏好存瀏覽器整站生效；表格常駐
  斑馬紋與滑過高亮。加新表格記得掛 `rtable`＋`<thead>`，卡片化才吃得到。
- **不放圖表**——同樣的資訊用表格呈現。
- **搜尋列要省空間、可自訂**（人下的令，2026-09-05）：篩選籤預設收合在「篩選」鈕後面；
  「欄位」鈕可整欄隱藏用不到的資料（例：敵人圖鑑藏掉落物，怪物卡跟著收），選擇整站記住。
  卡片模式 `tbody` 用 grid 一排塞多張，不留大片空白；長文表（版本情報）掛
  `data-cards="wide"` 維持一欄。
- **手機優先**：新表格要掛 `class="rtable"`＋`<thead>`；要可搜尋就加 `data-search="提示"`，
  比對一律「包含片段」。細節見 `style.css` 的 `@media` 段與 `site.js` 開頭註解。
- **鍛造計算機不要加回來**（功能有誤，2026-09-03 移除）。
- 資料同步版本寫在每頁頁尾（現行 v3.1.9，2026-09-05）；遊戲更新後請自行複驗再改。
