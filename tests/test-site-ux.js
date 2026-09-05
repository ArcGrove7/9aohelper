// 攻略站「手機 UX ＋ 素材特效 ＋ 搜尋篩選」的鎖定測試（2026-09-03）。
// 用 jsdom 真的把頁面跑起來：打字、按籤、看剩幾列——不是對字串斷言，
// 因為這三件事壞掉的方式都是「畫面上沒反應」，只有跑起來才看得出來。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function load(page, query, pre) {
  // jsdom 建構完成時文件還在 loading，site.js 的 DOMContentLoaded 監聽要等它跑完，
  // 所以這裡回 Promise，等 load 事件後才把 site.js 注入並交出 dom。
  return new Promise((resolve) => {
    const dom = new JSDOM(fs.readFileSync(path.join(SITE, page), 'utf8'), {
      runScripts: 'dangerously',
      url: 'https://example.invalid/' + page + (query || ''),
      beforeParse(window) {
        (pre || []).forEach((f) =>
          window.eval(fs.readFileSync(path.join(SITE, f), 'utf8')));
      },
    });
    dom.window.addEventListener('load', () => {
      const s = dom.window.document.createElement('script');   // <script src> jsdom 不抓，手動注入
      s.textContent = fs.readFileSync(path.join(SITE, 'site.js'), 'utf8');
      dom.window.document.body.appendChild(s);
      resolve(dom);
    });
  });
}
const vis = (rows) => rows.filter((tr) => !tr.hidden).length;
function type(input, v, win) {
  input.value = v;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
}

async function main() {
  // ---------------------------------------------------------------------------
  console.log('① 素材表：腳本的素材表（含重量與特效）進站了');
  {
    const dom = await load('materials.html');
    const d = dom.window.document, w = dom.window;
    const M = w.eval('M');   // 頁內是 const（不掛 window），用同一個 realm 的 eval 取
    ok('241 種素材全在', Array.isArray(M) && M.length === 241);
    ok('每列 8 欄（名攻防幸重耐標籤特效）', M.every((r) => r.length === 8));
    const withEl = M.filter((r) => r[7]);
    ok('45 種帶特效（腳本素材表的特效欄）', withEl.length === 45);
    const nail = M.find((r) => r[0] === '巴洛古的指甲');
    ok('巴洛古的指甲＝詛咒:2|邪惡力量:2、重 5.75', nail[7] === '詛咒:2|邪惡力量:2' && nail[4] === 5.75);
    ok('19 種沒有重量資料的標成 null（不是 0，0 會誤導成「不重」）',
      M.filter((r) => r[4] === null).length === 19);
    const rows = () => [...d.querySelectorAll('#mtab tbody tr')];
    ok('一開始 241 列全渲染', rows().length === 241);
    ok('沒重量的顯示「—」',
      rows().some((tr) => tr.children[4].textContent === '—'));
    ok('特效渲染成小標籤，邪惡力量標紅（bad）',
      d.querySelector('#mtab .el.bad') !== null);
    ok('每一格都有 data-label（窄螢幕卡片模式要用）',
      rows()[0].children[0].getAttribute('data-label') === '名稱' &&
      rows()[0].children[7].getAttribute('data-label') === '特效');
    // 2026-09-03 手機實測的回歸：特效那種 inline-block 小標籤會疊到欄名上，
    // 修法是「值整份包一層 <span class=v>」，讓卡片模式只有兩個 flex item。
    ok('每一格的值都包在 <span class="v"> 裡（文字重疊的修法）',
      rows().every((tr) => [...tr.children].every((td) =>
        td.children.length === 1 && td.firstElementChild.className === 'v')));
    const fxCell = rows()[0].children[7];
    ok('特效的小標籤都在那層 span 之內，不是 td 的直接子節點',
      fxCell.querySelectorAll('.v > .el').length === 2 &&
      fxCell.querySelectorAll(':scope > .el').length === 0);

    console.log('② 素材表：關鍵字搜尋只要片段，不必完整名稱');
    const q = d.getElementById('mq');
    type(q, '秘銀', w);
    ok('打「秘銀」→ 只剩秘銀', rows().length === 1 && rows()[0].textContent.includes('秘銀'));
    type(q, '水晶', w);
    ok('打標籤「水晶」→ 篩出一整類（>10 列）', rows().length > 10);
    type(q, '邪惡', w);
    ok('打特效「邪惡」也搜得到（特效欄進索引；全表只有兩件帶邪惡力量）', rows().length === 2);
    type(q, '巴洛', w);
    ok('打名稱片段「巴洛」→ 兩件巴洛古', rows().length === 2);
    type(q, '不存在的東西', w);
    ok('沒中時顯示空狀態提示，不是一片空白',
      rows().length === 0 && d.getElementById('mempty').hidden === false);
    type(q, '', w);

    console.log('③ 素材表：標籤／特效籤篩選');
    const tagChips = [...d.querySelectorAll('#mtags .chip')];
    const elChips = [...d.querySelectorAll('#mels .chip')];
    ok('標籤籤生出來了（>20 種）', tagChips.length > 20);
    ok('特效籤生出來了（20 種）', elChips.length === 20);
    const metal = tagChips.find((b) => b.textContent.startsWith('金屬'));
    metal.click();
    const metalCount = rows().length;
    ok('按「金屬」→ 只剩金屬素材', metalCount > 20 && metalCount < 241 &&
      rows().every((tr) => tr.children[6].textContent.includes('金屬')));
    const sharp = tagChips.find((b) => b.textContent.startsWith('銳利'));
    sharp.click();
    ok('再按「銳利」→ 標籤是「同時符合」，數量變少',
      rows().length > 0 && rows().length < metalCount &&
      rows().every((tr) => tr.children[6].textContent.includes('銳利')));
    d.getElementById('mreset').click();
    ok('「清除條件」把搜尋與所有籤還原', rows().length === 241 &&
      d.querySelectorAll('#mtags .chip[aria-pressed="true"]').length === 0);
    const poison = elChips.find((b) => b.textContent.startsWith('中毒'));
    poison.click();
    ok('按特效「中毒」→ 每一列都帶中毒',
      rows().length > 0 && rows().every((tr) => tr.children[7].textContent.includes('中毒')));
    d.getElementById('mreset').click();

    console.log('④ 素材表：排序（含新的重量欄）');
    const sortSel = d.getElementById('msort');
    sortSel.value = '4';
    sortSel.dispatchEvent(new w.Event('change', { bubbles: true }));
    const first = rows()[0].children[4].textContent;
    ok('依重量排序，最重的在最上面', Number(first) > 20);
    ok('沒資料的「—」被排到最後', rows()[240].children[4].textContent === '—');
    d.getElementById('mdir').click();
    ok('切升冪後最小的（重 −3）在最上面，「—」仍在最後',
      Number(rows()[0].children[4].textContent) === -3 &&
      rows()[240].children[4].textContent === '—');
    dom.window.close();
  }

  // ---------------------------------------------------------------------------
  console.log('⑤ 特效頁：31 種併成一張可搜尋的表');
  {
    const dom = await load('effects.html');
    const d = dom.window.document, w = dom.window;
    const table = d.querySelector('table[data-search]');
    const rows = [...table.querySelectorAll('tbody tr')];
    ok('31 種特效全在一張表', rows.length === 31);
    // 這一頁有兩條工具列（上面是裝備卡片的），要指名搜尋表格自己那一條
    const bar = table.closest('.table-wrap').previousElementSibling;
    const input = bar.querySelector('input[type="search"]');
    ok('搜尋列自動長出來（沒有手寫在 HTML 裡）', !!input);
    type(input, '毒', w);
    ok('打「毒」→ 中毒／麻痺毒／解毒都在', vis(rows) >= 3 && vis(rows) < 31);
    type(input, 'evil', w);
    ok('打鍵名片段「evil」也找得到邪惡力量', vis(rows) === 1);
    type(input, '', w);
    const chips = [...bar.querySelectorAll('.chip:not(.colchip)')];
    ok('分類籤（攻擊／防禦／特殊）生出來了', chips.length === 3);
    chips.find((b) => b.textContent.startsWith('防禦')).click();
    ok('按「防禦」→ 只剩防禦・回復那一組', vis(rows) === 11);
    dom.window.close();
  }

  // ---------------------------------------------------------------------------
  console.log('⑥ 技能頁：三張表併成一張，可搜尋可篩型別');
  {
    const dom = await load('skills.html');
    const d = dom.window.document, w = dom.window;
    const rows = [...d.querySelectorAll('table[data-search] tbody tr')];
    ok('197 招（14 種型別全收）', rows.length === 197);
    const input = d.querySelector('.tbar input[type="search"]');
    type(input, '追擊', w);
    ok('打效果片段「追擊」篩得到（不必記招名）', vis(rows) >= 4);
    type(input, '', w);
    const chips = [...d.querySelectorAll('.tbar .chip')];
    chips.find((b) => b.textContent.startsWith('短刀')).click();
    ok('按型別籤「短刀」→ 只剩短刀的招', vis(rows) === 14);
    chips.find((b) => b.textContent.startsWith('短刀')).click();   // 還原
    chips.find((b) => b.textContent.startsWith('通用 ')).click();
    ok('按「通用」不會把「通用槍械」一起算進去（整值比對）', vis(rows) === 39);
    chips.find((b) => b.textContent.startsWith('通用 ')).click();
    ok('對空鳴槍沒被弄丟（併進總表）',
      rows.some((tr) => tr.textContent.includes('對空鳴槍')));
    dom.window.close();
  }

  // ---------------------------------------------------------------------------
  console.log('⑦ 手機 UX：導覽、觸控目標、回到頂端、卡片模式');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('有 @media 斷點（原本整份樣式表一個都沒有）', css.includes('@media (max-width: 46rem)'));
    ok('導覽列固定在頂端且橫向可滑', /header\.site \{[^}]*position: sticky/.test(css) &&
      /nav\.site \{[^}]*overflow-x: auto/.test(css));
    ok('導覽每一格至少 44px（min-height: 2.75rem）', /nav\.site a \{[^}]*min-height: 2\.75rem/.test(css));
    ok('搜尋框 16px，避免 iOS 一點就整頁放大',
      /input\[type="search"\] \{[^}]*font-size: 16px/.test(css));
    ok('窄螢幕表格攤成卡片（table.rtable 逐格 display:block）',
      css.includes('table.rtable td::before') && css.includes('content: attr(data-label)'));
    ok('卡片模式不再用負 text-indent（那是文字重疊的元凶）',
      !/table\.rtable td \{[^}]*text-indent: -/.test(css));
    ok('值那層 span 有自己的 flex 規則', css.includes('table.rtable td > .v'));
    ok('回到頂端按鈕有樣式與安全區內距', css.includes('#totop') && css.includes('env(safe-area-inset-bottom)'));

    const dom = await load('materials.html');
    const d = dom.window.document;
    ok('回到頂端按鈕真的被插進 DOM', !!d.getElementById('totop'));
    ok('捲不到 600px 時是藏著的', !d.getElementById('totop').classList.contains('show'));
    for (const p of ['index.html', 'formulas.html', 'zones.html',
                     'skills.html', 'materials.html', 'effects.html']) {
      const html = fs.readFileSync(path.join(SITE, p), 'utf8');
      ok(p + ' 掛了 site.js 與 theme-color', html.includes('site.js') && html.includes('theme-color'));
    }
    dom.window.close();
  }


  // -------------------------------------------------------------------------
  console.log('⑧ 圖表已移除（人下的令：這不是最重要的功能）');
  {
    for (const p of ['formulas.html', 'materials.html', 'index.html',
                     'effects.html', 'skills.html', 'zones.html']) {
      const html = fs.readFileSync(path.join(SITE, p), 'utf8');
      ok(p + ' 沒有任何圖表（svg.curve／div.chart）',
        !html.includes('class="curve"') && !html.includes('class="chart"'));
    }
    const f = fs.readFileSync(path.join(SITE, 'formulas.html'), 'utf8');
    ok('武器倍率表沒被一起刪掉，而且從 details 裡拉出來直接看得到',
      f.includes('data-search="搜尋武器型別') && !f.includes('展開：完整武器倍率表'));
    const dom = await load('materials.html');
    const d = dom.window.document;
    const decay = [...d.querySelectorAll('table.rtable')].find(
      (tb) => tb.textContent.includes('實得加成倍數'));
    ok('堆疊衰減改用數值表，關鍵點沒走味（2 個 ×1.5、10 個 ×2.87、33 個 ×5）',
      !!decay && decay.textContent.includes('×1.5') &&
      decay.textContent.includes('×2.87') && decay.textContent.includes('×5'));
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑨ 裝備係數改成「一次看一件」的卡片');
  {
    const dom = await load('effects.html');
    const d = dom.window.document, w = dom.window;
    ok('15 種裝備都在選單裡', d.querySelectorAll('#eqsel option').length === 15);
    ok('不再有 15 列攤開來比較的係數表',
      !fs.readFileSync(path.join(SITE, 'effects.html'), 'utf8')
        .includes('<th>裝備類型</th>'));
    const card = d.getElementById('eqcard');
    ok('預設卡片是短刀，敘述／部位／持法／tag 都在（腳本裝備表的欄位）',
      card.textContent.includes('連擊迅捷') && card.textContent.includes('部位：武器') &&
      card.textContent.includes('持法：單手') && card.textContent.includes('Dagger'));
    ok('四維係數各一格：1.4／1／1.7／1',
      [...card.querySelectorAll('.eqstat .v')].map((e) => e.textContent).join(',')
        === '1.4x,1x,1.7x,1x');
    ok('全表最高的那一欄標出來（短刀幸運 1.7）',
      card.querySelector('.eqstat[data-k="l"]').classList.contains('top') &&
      card.querySelectorAll('.eqstat.top').length === 1);
    ok('素材需求跟著換', d.getElementById('eqq').textContent.includes('12'));
    const sel = d.getElementById('eqsel');
    sel.value = [...sel.options].find((o) => o.textContent.startsWith('狙擊槍')).value;
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok('換成狙擊槍：攻 1.5、素材 48',
      card.querySelector('.eqstat[data-k="a"] .v').textContent === '1.5x' &&
      d.getElementById('eqq').textContent.includes('48'));
    const chips = [...d.querySelectorAll('#eqslots .chip')];
    chips.find((b) => b.textContent.startsWith('身體')).click();
    ok('按部位籤「身體」→ 選單只剩大衣與盔甲',
      [...d.querySelectorAll('#eqsel option')].map((o) => o.textContent.split('（')[0]).join(',')
        === '大衣,盔甲');
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑩ 站名只用 9aohelper');
  {
    for (const p of ['index.html', 'formulas.html', 'zones.html',
                     'skills.html', 'materials.html', 'effects.html', 'allocation.html']) {
      const html = fs.readFileSync(path.join(SITE, p), 'utf8');
      const visible = html.replace(/<!--[\s\S]*?-->/g, '');
      ok(p + ' 看得見的文字沒有「GAO 攻略站」', !visible.includes('GAO 攻略站'));
      ok(p + ' 標題掛的是 9aohelper', /<title>[^<]*9aohelper<\/title>/.test(html));
    }
    const dom = await load('index.html');
    const d = dom.window.document;
    ok('頁首站名是 9aohelper', d.querySelector('header.site .title').textContent === '9aohelper');
    ok('頁尾也是 9aohelper 開頭',
      d.querySelector('footer.site').textContent.trim().startsWith('9aohelper'));
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑪ 圖鑑站改版（2026-09-04）：地圖卡片、版本情報、全站搜尋');
  {
    // 地圖圖鑑卡片：13 張全在，描述是官方文案（拆包逐字），秘境名對得上
    const dom = await load('zones.html');
    const d = dom.window.document;
    const cards = [...d.querySelectorAll('.zcard')];
    ok('地圖卡片 13 張（11 戰鬥圖＋2 城鎮）', cards.length === 13);
    ok('城鎮卡標成 town 樣式', d.querySelectorAll('.zcard.town').length === 2);
    const eagle = cards.find((c) => c.textContent.includes('eagle_cave'));
    ok('鷹洞卡片帶官方描述與秘境「陰洞」',
      eagle.textContent.includes('猛禽盤旋的峭壁洞窟') && eagle.textContent.includes('秘境：陰洞'));
    const huofeng = cards.find((c) => c.textContent.includes('huofeng_liaoyuan'));
    ok('火鳳燎原卡片寫明三國秘境三選一與巾色山麥岔路',
      huofeng.textContent.includes('三選一') && huofeng.textContent.includes('巾色山麥'));

    // 秘境入口與王關樓層：卡片與一覽表要對得上，別讓兩處各說各話
    ok('蘑菇園卡片有秘境入口 F12 與王關 F24',
      cards.find((c) => c.textContent.includes('mushroom_garden')).textContent
        .includes('秘境入口 F12')
      && cards.find((c) => c.textContent.includes('mushroom_garden')).textContent
        .includes('王關 F24'));
    ok('鷹洞卡片有秘境入口 F1、王關 F30 與毒的提示',
      eagle.textContent.includes('秘境入口 F1') && eagle.textContent.includes('王關 F30')
      && eagle.textContent.includes('地下 50 層起有毒'));

    const tables = [...d.querySelectorAll('table.rtable')];
    ok('地圖頁有三張表（秘境王關一覽／三國識別碼／黃巾軍團）', tables.length === 3);
    tables.forEach((t, i) => ok('第 ' + (i + 1) + ' 張表有 thead（易讀模式卡片化要吃）',
      !!t.querySelector('thead')));
    const overview = tables[0];
    ok('一覽表 11 張戰鬥圖各一列',
      overview.querySelectorAll('tbody tr').length === 11);
    const mushRow = [...overview.querySelectorAll('tbody tr')]
      .find((r) => r.textContent.includes('蘑菇園'));
    ok('一覽表的蘑菇園與卡片一致（入口 F12、王關 F24）',
      mushRow.textContent.includes('F12') && mushRow.textContent.includes('F24'));

    const wei = [...tables[1].querySelectorAll('tbody tr')]
      .find((r) => r.textContent.includes('魏'));
    ok('三國識別碼表列出 secret_realm_wei',
      wei.textContent.includes('secret_realm_wei'));
    ok('巾色山麥寫明落地 F75，不是從 F1 起算',
      d.body.textContent.includes('落地 F75'));

    const jin = [...tables[2].querySelectorAll('tbody tr')];
    ok('黃巾軍團表列出七種成員', jin.length === 7);
    ok('三名頭目都在', ['張角', '張寶', '張梁']
      .every((n) => jin.some((r) => r.textContent.includes(n))));

    ok('陰洞的輝鐵標明只在地下 26～36 層',
      d.body.textContent.includes('地下 26～36 層'));
    ok('底部警告不再說樓層「不固定」（已知的都列在表上）',
      !d.querySelector('.warn').textContent.includes('不固定'));
    dom.window.close();

    // 版本情報：549 條變更、可搜尋、可篩類型
    const dom2 = await load('updates.html');
    const d2 = dom2.window.document, w2 = dom2.window;
    const table = d2.querySelector('table[data-search]');
    const rows = [...table.querySelectorAll('tbody tr')];
    ok('更新日誌 550 條全在（含 3.1.9）', rows.length === 550);
    const bar = table.closest('.table-wrap').previousElementSibling;
    const input = bar.querySelector('input[type="search"]');
    type(input, '鷹洞', w2);
    ok('打「鷹洞」篩得到相關更新', vis(rows) > 3 && vis(rows) < 550);
    type(input, '', w2);
    const chips = [...bar.querySelectorAll('.chip:not(.colchip)')];
    ok('類型籤（新功能／調整／修復…）生出來了', chips.length === 5);
    chips.find((b) => b.textContent.startsWith('修復')).click();
    ok('按「修復」→ 只剩修復類（206 條）', vis(rows) === 206);
    ok('標題掛 9aohelper、頁面沒有「GAO 攻略站」',
      /<title>[^<]*9aohelper<\/title>/.test(fs.readFileSync(path.join(SITE, 'updates.html'), 'utf8')) &&
      !d2.body.textContent.includes('GAO 攻略站'));
    dom2.window.close();

    // 全站搜尋：索引檔存在，打片段跳得到分類頁
    const dom3 = await load('index.html');
    const d3 = dom3.window.document, w3 = dom3.window;
    const s = d3.createElement('script');   // <script src> jsdom 不抓，手動注入索引
    s.textContent = fs.readFileSync(path.join(SITE, 'data', 'search-index.js'), 'utf8');
    d3.body.appendChild(s);
    ok('搜尋索引載入且條目 > 350', (w3.SEARCH_INDEX || []).length > 350);
    const gq = d3.getElementById('gq'), hits = d3.getElementById('ghits');
    ok('首頁有全站搜尋框', !!gq && !!hits);
    type(gq, '秘銀', w3);
    ok('打「秘銀」→ 命中素材，連去素材詳情頁',
      !hits.hidden && [...hits.querySelectorAll('a')].some((a) => a.href.includes('detail.html?t=material')));
    type(gq, '陰洞', w3);
    ok('打「陰洞」→ 命中秘境，連去地圖詳情頁',
      [...hits.querySelectorAll('a')].some((a) => a.href.includes('detail.html?t=zone')));
    type(gq, '對空鳴槍', w3);
    ok('打「對空鳴槍」→ 命中技能，連去技能詳情頁',
      [...hits.querySelectorAll('a')].some((a) => a.href.includes('detail.html?t=skill')));
    type(gq, '', w3);
    ok('清空後結果收起來', hits.hidden === true);
    dom3.window.close();

    // 首頁是圖鑑入口：分類卡片連到四本圖鑑＋攻略工具
    const dom4 = await load('index.html');
    const d4 = dom4.window.document;
    const cat = [...d4.querySelectorAll('a.catcard')].map((a) => a.getAttribute('href'));
    ok('分類卡片含四本圖鑑', ['zones.html', 'skills.html', 'materials.html', 'effects.html']
      .every((u) => cat.includes(u)));
    ok('分類卡片含攻略、工具與版本情報', ['formulas.html', 'allocation.html', 'updates.html']
      .every((u) => cat.includes(u)));
    dom4.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑫ 頁首只有一行（人下的令，2026-09-05：站名＋導覽同一行，不堆高）');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('header.site 是 flex 橫排', /header\.site \{[^}]*display: flex/.test(css));
    ok('導覽不換行（flex-wrap: nowrap），塞不下就橫滑', css.includes('flex-wrap: nowrap'));
    ok('主內容區放寬到 110rem（桌機不留大片左右空白）',
      /main \{[^}]*max-width: 110rem/.test(css));
    for (const p of ['index.html', 'formulas.html', 'zones.html',
                     'skills.html', 'materials.html', 'effects.html', 'updates.html',
                     'allocation.html', 'enemies.html']) {
      const dom = await load(p);
      const d = dom.window.document;
      const head = d.querySelector('header.site');
      ok(p + ' 頁首沒有副標題那一行', !head.querySelector('.subtitle'));
      ok(p + ' 站名是連回首頁的連結',
        head.querySelector('a.title')?.getAttribute('href') === 'index.html' &&
        head.querySelector('a.title').textContent === '9aohelper');
      ok(p + ' 頁首是「站名＋導覽＋易讀＋搜尋」一行四件',
        head.children.length === 4 && head.querySelector('#hsearch') &&
        head.querySelector('#areadable'));
      ok(p + ' 導覽包含全部九頁（敵人圖鑑在內）',
        head.querySelectorAll('nav a').length === 9 &&
        head.querySelector('nav a[href="enemies.html"]'));
      dom.window.close();
    }
  }

  // -------------------------------------------------------------------------
  console.log('⑬ 點數計算機：建議配點（PVE／PVP）與配置的增刪查改');
  {
    const dom = await load('allocation.html');
    const d = dom.window.document, w = dom.window;
    const click = (label) => {
      const b = [...d.querySelectorAll('button')].find((x) => x.textContent === label ||
        x.getAttribute('aria-label') === label);
      b.click();
      return b;
    };
    const statVal = (cjk) =>
      Number(d.querySelector('input[aria-label="' + cjk + ' 配點"]').value);
    const leftVal = () => {
      const cells = [...d.querySelectorAll('.cell')];
      const c = cells.find((x) => x.textContent.includes('剩餘'));
      return Number(c.querySelector('.v').textContent.replace(/,/g, ''));
    };

    // 建議配點
    const presets = [...d.querySelectorAll('button')].filter((b) =>
      (b.getAttribute('aria-label') || '').startsWith('套用'));
    ok('三套建議配方（PVE 練功／PVE 打王／PVP 切磋）都有「套用」', presets.length === 3);
    click('套用 PVE・練功');
    ok('套用「PVE・練功」→ 總點數鋪滿（剩餘 0）', leftVal() === 0);
    ok('練功配方以敏捷為大宗', statVal('敏捷') > statVal('體質') &&
      statVal('體質') > statVal('韌性') && statVal('幸運') === 0);
    click('套用 PVP・切磋');
    ok('套用「PVP・切磋」→ 技巧有份量、仍然鋪滿', leftVal() === 0 && statVal('技巧') > 0);

    // 增：存一筆
    const nameIn = d.querySelector('input[aria-label="配置名稱"]');
    nameIn.value = '切磋用';
    nameIn.dispatchEvent(new w.Event('input', { bubbles: true }));
    click('儲存新配置');
    let sel = d.querySelector('select[aria-label="已存配置"]');
    ok('儲存後出現在配置清單', sel && sel.options.length === 1 &&
      sel.options[0].textContent.includes('切磋用'));

    // 改：改點數後覆蓋更新
    click('套用 PVE・打王');
    click('覆蓋更新配置');
    const saved = JSON.parse(w.localStorage.getItem('gao.calc.builds.v1'));
    ok('覆蓋更新把目前的點數寫回那一筆', saved.length === 1 && saved[0].con === statVal('體質'));

    // 查：清空再載入
    click('清空重新配置');
    ok('清空後體質歸零', statVal('體質') === 0);
    click('載入配置');
    ok('載入把存的配置放回來', statVal('體質') === saved[0].con && leftVal() === 0);

    // 刪
    click('刪除配置');
    ok('刪除後清單消失、回到空狀態提示',
      !d.querySelector('select[aria-label="已存配置"]') &&
      d.body.textContent.includes('還沒有儲存的配置'));
    ok('localStorage 也清掉了', JSON.parse(w.localStorage.getItem('gao.calc.builds.v1')).length === 0);
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑭ 資料圖譜：實體庫、詳情頁、雙向關聯、網址篩選、Ctrl+K');
  {
    // 實體庫完整性（data/db.js 由 tools/build-db.js 產生）
    const DB = (() => {
      const window = {};
      eval(fs.readFileSync(path.join(SITE, 'data', 'db.js'), 'utf8'));
      return window.DB;
    })();
    ok('五類實體數量對（241/31/197/15/13）',
      DB.materials.length === 241 && DB.effects.length === 31 &&
      DB.skills.length === 197 && DB.eqtypes.length === 15 && DB.zones.length === 13);
    const effById = Object.fromEntries(DB.effects.map((e) => [e.id, e]));
    const matById = Object.fromEntries(DB.materials.map((m) => [m.id, m]));
    ok('素材→特效的每一筆引用都存在，且特效端反向列得到它',
      DB.materials.every((m) => m.effects.every((f) =>
        effById[f.e] && effById[f.e].materials.includes(m.id))));
    ok('特效→素材的每一筆反向引用都存在，且素材端真的帶它',
      DB.effects.every((e) => e.materials.every((mn) =>
        matById[mn] && matById[mn].effects.some((f) => f.e === e.id))));
    for (const list of [DB.materials, DB.effects, DB.skills, DB.eqtypes, DB.zones]) {
      const ids = list.map((x) => x.id);
      if (new Set(ids).size !== ids.length) { ok('id 唯一', false); }
    }
    ok('每類實體 id 皆唯一', true);

    // 詳情頁：素材 → 特效 → 素材 走得回來
    const dm = await load('detail.html', '?t=material&id=' + encodeURIComponent('巴洛古的指甲'), ['data/db.js']);
    const dd = dm.window.document;
    ok('素材詳情頁：名稱、五維、標籤都在',
      dd.querySelector('h1').textContent === '巴洛古的指甲' &&
      dd.body.textContent.includes('35.5') && dd.body.textContent.includes('銳利'));
    ok('特效渲染成可點的實體連結（詛咒→特效詳情頁）',
      [...dd.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=effect') && a.textContent.includes('詛咒')));
    ok('沒有資料的欄位寫「尚無可靠資料」，不補值',
      dd.body.textContent.includes('取得來源') && dd.body.textContent.includes('尚無可靠資料'));
    dm.window.close();

    const de = await load('detail.html', '?t=effect&id=' + encodeURIComponent('邪惡力量'), ['data/db.js']);
    const ed = de.window.document;
    ok('特效詳情頁：反向列出帶它的素材（巴洛古的指甲在內）',
      [...ed.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=material') && a.textContent === '巴洛古的指甲'));
    ok('特效詳情頁：附版本紀錄', ed.body.textContent.includes('版本紀錄') &&
      ed.querySelectorAll('table tbody tr').length > 0);
    de.window.close();

    const dz = await load('detail.html', '?t=zone&id=eagle_cave', ['data/db.js']);
    ok('地圖詳情頁：官方描述與秘境都在',
      dz.window.document.body.textContent.includes('猛禽盤旋的峭壁洞窟') &&
      dz.window.document.body.textContent.includes('陰洞'));
    dz.window.close();

    const dx = await load('detail.html', '?t=material&id=不存在的東西', ['data/db.js']);
    ok('查不到的 id 顯示「找不到這一筆」與各圖鑑入口',
      dx.window.document.body.textContent.includes('找不到這一筆'));
    dx.window.close();

    // 網址帶 ?q=：進頁自動篩，分享網址還原得了
    const du = await load('updates.html', '?q=%E6%A0%BC%E6%93%8B');
    const ud = du.window.document;
    const uRows = [...ud.querySelectorAll('table[data-search] tbody tr')];
    const uVis = uRows.filter((tr) => !tr.hidden).length;
    ok('updates.html?q=格擋 → 進頁就篩好', uVis > 0 && uVis < uRows.length);
    du.window.close();
    const dmm = await load('materials.html', '?q=%E7%A7%98%E9%8A%80');
    ok('materials.html?q=秘銀 → 素材表也吃網址篩選',
      [...dmm.window.document.querySelectorAll('#mtab tbody tr')].length === 1);
    dmm.window.close();

    // Ctrl+K：任何頁都開得了全站搜尋
    const dk = await load('zones.html', '', ['data/search-index.js']);
    const kd = dk.window.document, kw = dk.window;
    ok('頁首有搜尋鈕', !!kd.getElementById('hsearch'));
    kw.dispatchEvent(new kw.KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    const ov = kd.getElementById('soverlay');
    ok('Ctrl+K 打開覆蓋層', !!ov && !ov.hidden);
    const soq = kd.getElementById('soq');
    type(soq, '短刃', kw);
    ok('覆蓋層搜尋命中技能，連到詳情頁',
      [...kd.querySelectorAll('#sohits a')].some((a) => a.href.includes('detail.html?t=skill')));
    dk.window.close();

    // 列表 → 詳情：各列表頁的名稱是實體連結
    const dl = await load('skills.html');
    ok('技能表名稱連到詳情頁',
      [...dl.window.document.querySelectorAll('table a.dlink')].length === 197);
    dl.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑯ 帶入路徑：計算機吃網址、攻略頁一鍵開配方、技能↔裝備↔比較器互通');
  {
    // 配點計算機：?lv=…&配點 直接還原（分享連結）
    const da = await load('allocation.html', '?lv=60&agi=100&con=50');
    const ad = da.window.document, aw = da.window;
    ok('分享連結還原等級與配點',
      ad.querySelector('input[aria-label="角色等級"]').value === '60' &&
      ad.querySelector('input[aria-label="敏捷 配點"]').value === '100' &&
      ad.querySelector('input[aria-label="體質 配點"]').value === '50');
    [...ad.querySelectorAll('button')].find((b) => b.textContent === '+1').click();
    ok('改配點後網址跟著同步（str=1）', aw.location.search.includes('str=1') &&
      aw.location.search.includes('lv=60'));
    da.window.close();

    // ?preset=pvp 一鍵套配方，套完把 preset 從網址拿掉
    const dp = await load('allocation.html', '?preset=pvp');
    const pd = dp.window.document;
    const leftCell = [...pd.querySelectorAll('.cell')].find((c) => c.textContent.includes('剩餘'));
    ok('?preset=pvp → 配方鋪滿（剩餘 0）、技巧有份量',
      leftCell.querySelector('.v').textContent === '0' &&
      Number(pd.querySelector('input[aria-label="技巧 配點"]').value) > 0);
    ok('套完網址不再帶 preset', !dp.window.location.search.includes('preset'));
    dp.window.close();

    // 技能詳情 → 裝備類型與比較器
    const dk = await load('detail.html', '?t=skill&id=' + encodeURIComponent('短刃'), ['data/db.js']);
    const kd = dk.window.document;
    ok('技能詳情連到裝備類型（短刀）',
      [...kd.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=eqtype') && decodeURIComponent(a.href).includes('短刀')));
    dk.window.close();

    // 裝備類型詳情：手槍列出單持與雙持兩種持法
    const dq = await load('detail.html', '?t=eqtype&id=' + encodeURIComponent('手槍'), ['data/db.js']);
    const links = [...dq.window.document.querySelectorAll('a')]
      .filter((a) => a.href.includes('formulas.html?q='));
    ok('手槍詳情列出 2 種持法的命中倍率（連回公式頁）',
      links.length === 2 && links.every((a) => decodeURIComponent(a.href).includes('手槍')));
    dq.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑰ 敵人圖鑑（①～⑧）：列表、掉落雙向關聯、詳情頁');
  {
    // 列表頁
    const dom = await load('enemies.html');
    const d = dom.window.document, w = dom.window;
    const rows = [...d.querySelectorAll('table[data-search] tbody tr')];
    ok('176 隻敵人全在', rows.length === 176);
    const input = d.querySelector('.tbar input[type="search"]');
    type(input, '菇菇', w);
    ok('打「菇菇」篩得到蘑菇園那掛', vis(rows) > 3 && vis(rows) < 176);
    type(input, '狗頭人爪', w);
    ok('打掉落物「狗頭人爪」也搜得到', vis(rows) >= 2);
    type(input, '', w);
    const chips = [...d.querySelectorAll('.tbar .chip:not(.colchip)')];
    ok('地圖籤有 10 張圖', chips.length === 10);
    ok('地圖籤多了鷹洞', chips.some((b) => b.textContent.startsWith('鷹洞')));

    // 鷹洞（第 11 張圖）：陰洞十種＋王關兩種
    const eagleRows = rows.filter((r) => r.children[1].textContent.trim() === '鷹洞');
    ok('鷹洞 12 隻敵人', eagleRows.length === 12);
    ok('陰洞的魑魅魍魎四隻都在', ['魑', '魅', '魍', '魎']
      .every((n) => eagleRows.some((r) => r.children[0].textContent.trim() === n)));
    const heitie = eagleRows.find((r) => r.children[0].textContent.includes('黑鐵一輝'));
    ok('黑鐵一輝 Lv175、HP 8500、人形',
      heitie.children[4].textContent.trim() === '175'
      && heitie.children[3].textContent.trim() === '8500'
      && heitie.children[5].textContent.trim() === '人形');
    const yelu = eagleRows.find((r) => r.children[0].textContent.includes('夜露'));
    ok('夜露帶 SMG 與三招（掃射轉移／瞬爆閃／跑射）',
      yelu.children[11].textContent.includes('SMG')
      && ['掃射轉移', '瞬爆閃', '跑射'].every((k) => yelu.children[12].textContent.includes(k)));
    ok('陰洞的出沒欄寫「地下 N 層」，不是 NF',
      eagleRows.filter((r) => r.children[2].textContent.includes('陰洞'))
        .every((r) => r.children[2].textContent.includes('地下')));
    ok('王關兩隻標在鷹洞 30', eagleRows
      .filter((r) => r.children[2].textContent.includes('王關')).length === 2);

    // 火鳳燎原（第 9 張圖）：西涼兵到三國群雄，王關是董卓＋呂布
    const fireRows = rows.filter((r) => r.children[1].textContent.trim() === '火鳳燎原');
    ok('火鳳燎原 14 隻敵人', fireRows.length === 14);
    ok('西涼四兵種都在', ['西涼槍兵', '西涼刀兵', '西涼暴徒', '西涼精銳']
      .every((n) => fireRows.some((r) => r.children[0].textContent.trim() === n)));
    ok('三國群雄都在', ['李傕', '郭汜', '文醜', '顏良', '袁紹', '袁術']
      .every((n) => fireRows.some((r) => r.children[0].textContent.trim() === n)));
    const lubu = fireRows.find((r) => r.children[0].textContent.includes('呂布'));
    ok('呂布 Lv140、HP 6758、王關 F25',
      lubu.children[4].textContent.trim() === '140'
      && lubu.children[3].textContent.trim() === '6758'
      && lubu.children[2].textContent.includes('25（王關）'));
    ok('呂布帶方天畫戟', lubu.children[11].textContent.includes('方天畫戟'));
    ok('火鳳燎原的王關兩隻都標了', fireRows
      .filter((r) => r.children[2].textContent.includes('王關')).length === 2);
    chips.find((b) => b.textContent.startsWith('青藏高原')).click();
    ok('按「青藏高原」→ 只剩那張圖的敵人', vis(rows) > 0 &&
      rows.filter((tr) => !tr.hidden).every((tr) => tr.children[1].textContent.includes('青藏高原')));
    dom.window.close();

    // 實體庫雙向：敵人掉落 ↔ 素材來源、技能書、地圖敵人
    const DB3 = (() => {
      const window = {};
      eval(fs.readFileSync(path.join(SITE, 'data', 'db.js'), 'utf8'));
      return window.DB;
    })();
    ok('敵人 176 隻進庫', DB3.enemies.length === 176);
    const matById3 = Object.fromEntries(DB3.materials.map((m) => [m.id, m]));
    ok('敵人→素材的每筆掉落，素材端都反向列得到',
      DB3.enemies.every((e) => e.dropIds.every((m) =>
        matById3[m] && matById3[m].sources.some((sc) => sc.e === e.id))));
    ok('素材→來源的每筆引用，敵人端都真的掉它',
      DB3.materials.every((m) => m.sources.every((sc) => {
        const e = DB3.enemies.find((x) => x.id === sc.e);
        return e && e.dropIds.includes(m.id);
      })));
    ok('狗頭人爪的來源包含狗頭人',
      matById3['狗頭人爪'].sources.some((sc) => sc.e.includes('狗頭人')));
    ok('大草原的敵人清單非空',
      DB3.zones.find((z) => z.id === 'great_plains').enemies.length > 5);
    ok('技能「短刃」有技能書掉落來源',
      DB3.skills.find((x) => x.id === '短刃').books.length >= 2);

    // 詳情頁走一圈：敵人 → 素材 → 回到敵人
    const de = await load('detail.html', '?t=enemy&id=' + encodeURIComponent('狗頭人'), ['data/db.js']);
    const ed = de.window.document;
    ok('敵人詳情：HP／等級下限與出沒都在',
      ed.body.textContent.includes('最低 HP') && ed.body.textContent.includes('狗頭人'));
    ok('掉落素材連到素材詳情頁',
      [...ed.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=material') && a.textContent === '狗頭人爪'));
    de.window.close();
    const dm2 = await load('detail.html', '?t=material&id=' + encodeURIComponent('狗頭人爪'), ['data/db.js']);
    ok('素材詳情的「取得來源」反向列出敵人',
      [...dm2.window.document.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=enemy') && a.textContent.includes('狗頭人')));
    dm2.window.close();
    const dz2 = await load('detail.html', '?t=zone&id=great_plains', ['data/db.js']);
    ok('地圖詳情列出這張圖的敵人',
      [...dz2.window.document.querySelectorAll('a')].filter((a) =>
        a.href.includes('detail.html?t=enemy')).length > 5);
    dz2.window.close();
    const dk2 = await load('detail.html', '?t=skill&id=' + encodeURIComponent('短刃'), ['data/db.js']);
    ok('技能詳情列出技能書掉落的敵人',
      dk2.window.document.body.textContent.includes('技能書掉落') &&
      [...dk2.window.document.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=enemy')));
    dk2.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑱ 易讀模式：一鍵大字距＋全表格卡片化，狀態記住');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('易讀模式的字級與行距規則在',
      /html\.readable body \{[^}]*font-size/.test(css) &&
      /html\.readable body \{[^}]*line-height/.test(css));
    ok('卡片模式（預設開）下 rtable 在任何寬度都攤成卡片',
      css.includes('html.cards table.rtable td::before') &&
      /html\.cards table\.rtable thead \{ display: none/.test(css));
    ok('表格有斑馬紋與滑過高亮（逐行閱讀輔助）',
      css.includes('tbody tr:nth-child(even)') && css.includes('tbody tr:hover'));

    const dom = await load('skills.html');
    const d = dom.window.document, w = dom.window;
    const btn = d.getElementById('areadable');
    ok('頁首有「Aa 易讀」開關', !!btn && btn.getAttribute('aria-pressed') === 'false');
    btn.click();
    ok('按下後整站進入易讀模式（html.readable）',
      d.documentElement.classList.contains('readable') &&
      btn.getAttribute('aria-pressed') === 'true');
    ok('偏好記進瀏覽器', w.localStorage.getItem('pref.readable') === '1');
    btn.click();
    ok('再按一次還原', !d.documentElement.classList.contains('readable') &&
      w.localStorage.getItem('pref.readable') === '0');
    dom.window.close();

    // 換頁後偏好仍生效（進頁就套，不必再按）
    const dom2 = await load('materials.html', '', []);
    dom2.window.close();
    const dom3 = await new Promise((resolve) => {
      const { JSDOM } = require('jsdom');
      const dm = new JSDOM(fs.readFileSync(path.join(SITE, 'zones.html'), 'utf8'), {
        runScripts: 'dangerously',
        url: 'https://example.invalid/zones.html',
        beforeParse(window) {
          window.localStorage.setItem('pref.readable', '1');
        },
      });
      dm.window.addEventListener('load', () => {
        const sc = dm.window.document.createElement('script');
        sc.textContent = fs.readFileSync(path.join(SITE, 'site.js'), 'utf8');
        dm.window.document.body.appendChild(sc);
        resolve(dm);
      });
    });
    ok('帶著偏好進下一頁，直接就是易讀模式',
      dom3.window.document.documentElement.classList.contains('readable') &&
      dom3.window.document.getElementById('areadable').getAttribute('aria-pressed') === 'true');
    dom3.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑲ 攻略文字逐點卡片化：一個重點一張卡，粗體結論＋短補充');
  {
    for (const [p, min] of [['index.html', 5], ['formulas.html', 7], ['zones.html', 6],
                            ['effects.html', 3]]) {
      const html = fs.readFileSync(path.join(SITE, p), 'utf8');
      const count = (html.match(/class="point[ "]/g) || []).length;
      ok(p + ' 的攻略重點是逐點卡片（≥ ' + min + ' 張）', count >= min);
    }
    const dom = await load('index.html');
    const pts = [...dom.window.document.querySelectorAll('.point')];
    ok('首頁五件事＝五張卡，每張都有結論行與補充行',
      pts.length === 5 && pts.every((p) =>
        p.querySelector('.pt') && p.querySelector('.pd') && p.querySelector('.pn')));
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑳ 敵人圖鑑卡片檢視：一隻怪一張卡、與搜尋同步、可切表格、可排序');
  {
    const dom = await load('enemies.html', '', ['data/db.js']);
    const d = dom.window.document, w = dom.window;
    const cards = [...d.querySelectorAll('#ecards .ecard')];
    ok('176 張怪物卡建出來了', cards.length === 176);
    ok('預設卡片檢視：表格收起、卡片顯示',
      d.querySelector('.table-wrap').hidden === true &&
      d.getElementById('ecards').hidden === false);
    const c0 = cards[0];
    ok('卡片有名稱連結、LV 徽章、屬性 chips 與出沒地圖',
      c0.querySelector('header a').href.includes('detail.html?t=enemy') &&
      c0.querySelector('.lvb') && c0.textContent.includes('最低HP') &&
      c0.textContent.includes('出沒地圖'));
    ok('掉落素材在卡片上是實體連結',
      cards.some((c) => [...c.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=material'))));

    // 搜尋與籤同步
    const input = d.querySelector('.tbar input[type="search"]');
    type(input, '菇菇', w);
    const visCards = () => cards.filter((c) => !c.hidden).length;
    ok('搜尋「菇菇」→ 卡片跟著表格一起被篩', visCards() > 3 && visCards() < 176);
    type(input, '', w);
    ok('清空搜尋 → 卡片全回來', visCards() === 176);

    // 切檢視＋記住
    const tbtn = [...d.querySelectorAll('.vbtn')].find((b) => b.textContent.includes('表格'));
    tbtn.click();
    ok('切到表格檢視：表格展開、卡片收起、偏好記住',
      d.querySelector('.table-wrap').hidden === false &&
      d.getElementById('ecards').hidden === true &&
      w.localStorage.getItem('pref.enemyview') === 'table');
    [...d.querySelectorAll('.vbtn')].find((b) => b.textContent.includes('卡片')).click();

    // 排序
    const sel = d.querySelector('select[aria-label="排序"]');
    sel.value = 'lv-d';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    const DBx = (() => {
      const window = {};
      eval(fs.readFileSync(path.join(SITE, 'data', 'db.js'), 'utf8'));
      return window.DB;
    })();
    const maxLv = Math.max(...DBx.enemies.map((e) => Number(e.lv) || 0));
    const first = d.querySelector('#ecards .ecard');
    ok('排序「等級高→低」→ 最高等級（' + maxLv + '）排最前',
      first.querySelector('.lvb').textContent === 'LV ' + maxLv);
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('㉑ 地圖圖鑑領域輪播：編號數法移除，兩個領域用 ‹ › 切換');
  {
    const html = fs.readFileSync(path.join(SITE, 'zones.html'), 'utf8');
    ok('編號數法整節移除', !html.includes('編號數法'));

    const dom = await load('zones.html');
    const d = dom.window.document;
    const panels = [...d.querySelectorAll('.wzone')];
    ok('兩個領域面板（起始之鎮／耶索得）', panels.length === 2 &&
      panels[0].dataset.name === '起始之鎮 領域' && panels[1].dataset.name === '耶索得 領域');
    ok('起始領域 11 張卡、耶索得領域 2 張卡＋未開放佔位',
      panels[0].querySelectorAll('.zcard').length === 11 &&
      panels[1].querySelectorAll('.zcard').length === 2 &&
      panels[1].querySelector('.zmystery'));
    ok('預設顯示起始之鎮領域（MAP 01 – 10），另一頁收起',
      !panels[0].hidden && panels[1].hidden &&
      d.getElementById('wrange').textContent === 'MAP 01 – 10');
    d.getElementById('wnext').click();
    ok('按 › 切到耶索得領域（MAP 11 – 20），指示點跟著動',
      panels[0].hidden && !panels[1].hidden &&
      d.getElementById('wname').textContent === '耶索得 領域' &&
      d.querySelectorAll('.wdot')[1].classList.contains('on'));
    d.getElementById('wnext').click();
    ok('再按 › 繞回起始之鎮領域', !panels[0].hidden && panels[1].hidden);
    d.getElementById('wprev').click();
    ok('按 ‹ 也能往回繞', panels[0].hidden && !panels[1].hidden);
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('㉒ 圖鑑圖示與遊戲原生特效色（v3.1.9 對齊）');
  {
    // 敵人表與卡片：名稱前有圖示
    const de = await load('enemies.html', '', ['data/icons.js', 'data/db.js']);
    const ed = de.window.document;
    const firstA = ed.querySelector('table tbody tr a.dlink');
    ok('敵人表名稱前有圖示（小白兔 → 🐇）',
      firstA.querySelector('.ic') && firstA.textContent.includes('🐇'));
    const card = ed.querySelector('#ecards .ecard header');
    ok('敵人卡片名稱前也有圖示', !!card.querySelector('.ic'));
    de.window.close();

    // 素材表：名稱前有圖示、特效用遊戲原生色
    const dm = await load('materials.html', '', ['data/icons.js']);
    const md = dm.window.document;
    const rows = [...md.querySelectorAll('#mtab tbody tr')];
    const obsidian = rows.find((tr) => tr.textContent.includes('藍黑曜石'));
    ok('藍黑曜石名稱前有石頭圖示', obsidian.querySelector('.ic') &&
      obsidian.textContent.includes('🪨'));
    const nail = rows.find((tr) => tr.textContent.includes('巴洛古的指甲'));
    const evil = [...nail.querySelectorAll('.el')].find((el) => el.textContent.includes('邪惡力量'));
    ok('特效小標籤套遊戲原生色（邪惡力量＝#c97aff）',
      evil.getAttribute('style').includes('#c97aff'));
    const curse = [...nail.querySelectorAll('.el')].find((el) => el.textContent.includes('詛咒'));
    ok('詛咒也是 elements 模組的紫色', curse.getAttribute('style').includes('#c97aff'));
    dm.window.close();

    // 技能表：依型別的武器圖示；特效表：名稱套原生色
    const dk = await load('skills.html', '', ['data/icons.js']);
    ok('技能表名稱前有型別圖示',
      !!dk.window.document.querySelector('table tbody tr a.dlink .ic'));
    dk.window.close();
    const df = await load('effects.html', '', ['data/icons.js']);
    const fxA = [...df.window.document.querySelectorAll('table[data-search] tbody tr a.dlink')];
    const fire = fxA.find((a) => a.textContent.includes('火焰') && !a.textContent.includes('抗性'));
    ok('特效表名稱套遊戲原生色（火焰＝#ff4655）',
      fire.style.color && fire.style.color.replace(/\s/g, '') !== '');
    df.window.close();

    // 3.1.9 入庫與版本標記
    const du = await load('updates.html');
    ok('3.1.9（技能書機率調整）已入版本情報',
      du.window.document.body.textContent.includes('3.1.9') &&
      du.window.document.body.textContent.includes('技能書機率全面統一'));
    ok('頁尾版本標記更新為 v3.1.9',
      du.window.document.querySelector('footer').textContent.includes('v3.1.9'));
    du.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('㉓ 全表格卡片化預設＋系統鍵名隱藏');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('[hidden] 欄位在卡片模式也藏得住（!important）',
      css.includes('th[hidden], td[hidden] { display: none !important; }'));
    ok('地圖卡片的系統鍵名（zkey）不顯示', css.includes('.zcard .zkey { display: none; }'));

    const dom = await load('skills.html');
    const d = dom.window.document, w = dom.window;
    ok('進頁預設就是卡片模式（html.cards）',
      d.documentElement.classList.contains('cards'));
    ok('搜尋列上有「卡片／表格」切換', !!d.querySelector('.tbar .vbtn'));
    const tb = [...d.querySelectorAll('.vbtn')].find((b) => b.textContent.includes('表格'));
    tb.click();
    ok('切表格：html.cards 移除、偏好記住',
      !d.documentElement.classList.contains('cards') &&
      w.localStorage.getItem('pref.tableview') === '1');
    ok('技能表的 ID 欄整欄 hidden（玩家看不到，搜尋照吃）',
      d.querySelectorAll('table thead th[hidden]').length === 1 &&
      d.querySelectorAll('table tbody td[hidden]').length === 197);
    dom.window.close();

    const de = await load('effects.html');
    ok('特效表的鍵欄整欄 hidden',
      de.window.document.querySelectorAll('table[data-search] tbody td[hidden]').length === 31);
    de.window.close();

    const dd = await load('detail.html', '?t=effect&id=' + encodeURIComponent('邪惡力量'), ['data/db.js', 'data/icons.js']);
    ok('特效詳情不再顯示鍵名', !dd.window.document.body.textContent.includes('evil_power'));
    dd.window.close();
    const dk3 = await load('detail.html', '?t=skill&id=' + encodeURIComponent('短刃'), ['data/db.js', 'data/icons.js']);
    ok('技能詳情不再顯示技能 ID', !dk3.window.document.body.textContent.includes('技能 ID'));
    dk3.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('㉔ 篩選欄摺疊＋隱藏欄位＋卡片一排多張');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('卡片模式 tbody 用 grid：一排塞多張、不留大片空白',
      /html\.cards table\.rtable tbody \{\n  display: grid;/.test(css) &&
      css.includes('repeat(auto-fill, minmax(20rem, 1fr))'));
    ok('長文表標 data-cards="wide" 維持一欄（版本情報）',
      css.includes('html.cards table.rtable[data-cards="wide"] tbody { display: block; }') &&
      fs.readFileSync(path.join(SITE, 'updates.html'), 'utf8').includes('data-cards="wide"'));
    ok('被篩掉的列在卡片模式也真的消失（[hidden] 全域 !important）',
      css.includes('[hidden] { display: none !important; }'));

    // 通用搜尋列：篩選籤預設收合、「欄位」鈕可整欄隱藏，怪物卡跟著收
    const dom = await load('enemies.html', '', ['data/db.js', 'data/icons.js']);
    const d = dom.window.document, w = dom.window;
    const chips = d.querySelector('.tbar .chips:not(.wrap)');
    ok('篩選籤預設收合（省空間）', !!chips && chips.hidden === true);
    const fbtn = [...d.querySelectorAll('.tbar .vbtn')].find((b) => b.textContent.startsWith('篩選'));
    fbtn.click();
    ok('按「篩選」展開籤、狀態整站記住',
      chips.hidden === false && w.localStorage.getItem('pref.filters') === '1');
    const cbtn = [...d.querySelectorAll('.tbar .vbtn')].find((b) => b.textContent.startsWith('欄位'));
    ok('搜尋列有「欄位」鈕、欄位籤預設收合',
      !!cbtn && d.querySelector('.tbar .chips.wrap').hidden === true);
    cbtn.click();
    const drop = [...d.querySelectorAll('.colchip')].find((b) => b.textContent === '掉落素材');
    drop.click();
    const etab = d.getElementById('etab');
    ok('點「掉落素材」→ 表頭與 162 格整欄 hidden',
      etab.querySelector('tr').children[6].hidden === true &&
      [...etab.querySelectorAll('tbody tr')].every((tr) => tr.children[6].hidden));
    const cardDrops = [...d.querySelectorAll('#ecards [data-c="掉落素材"]')];
    ok('怪物卡上的掉落素材一起收', cardDrops.length > 100 && cardDrops.every((el) => el.hidden));
    ok('隱藏欄位整站記住（pref.hidecols）',
      (w.localStorage.getItem('pref.hidecols.enemies.html:etab') || '').includes('掉落素材'));
    drop.click();
    ok('再點一下整欄顯示回來', etab.querySelector('tr').children[6].hidden === false &&
      cardDrops.every((el) => !el.hidden));
    dom.window.close();

    // 素材頁自家工具列：同一套摺疊與欄位隱藏
    const dm = await load('materials.html', '', ['data/icons.js']);
    const md = dm.window.document;
    ok('素材頁籤區預設收合（#mfilters）', md.getElementById('mfilters').hidden === true);
    md.getElementById('mfbtn').click();
    ok('按「篩選」展開標籤與特效籤',
      md.getElementById('mfilters').hidden === false &&
      md.querySelectorAll('#mtags .chip').length > 5);
    const mcbtn = [...md.querySelectorAll('.tbar .vbtn')].find((b) => b.textContent.startsWith('欄位'));
    ok('素材工具列也有「欄位」鈕', !!mcbtn);
    mcbtn.click();
    [...md.querySelectorAll('.colchip')].find((b) => b.textContent === '特效').click();
    ok('隱藏「特效」欄 → 241 列的特效格都 hidden',
      [...md.querySelectorAll('#mtab tbody tr')].every((tr) => tr.children[7].hidden));
    md.getElementById('mdir').click();          // tbody 整個重畫
    await new Promise((r) => setTimeout(r, 30));
    ok('表格重畫後隱藏欄仍生效（MutationObserver 補掛）',
      [...md.querySelectorAll('#mtab tbody tr')].every((tr) => tr.children[7].hidden));
    dm.window.close();
  }
}

main().then(() => {
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
});
