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
    const chips = [...bar.querySelectorAll('.chip')];
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
    ok('34 招（單手劍＋短刀＋細劍＋通用槍械／其他）', rows.length === 34);
    const input = d.querySelector('.tbar input[type="search"]');
    type(input, '追擊', w);
    ok('打效果片段「追擊」篩得到（不必記招名）', vis(rows) >= 4);
    type(input, '', w);
    const chips = [...d.querySelectorAll('.tbar .chip')];
    chips.find((b) => b.textContent.startsWith('短刀')).click();
    ok('按型別籤「短刀」→ 只剩短刀的招', vis(rows) === 9);
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
    for (const p of ['index.html', 'formulas.html', 'stats.html', 'zones.html',
                     'skills.html', 'materials.html', 'effects.html']) {
      const html = fs.readFileSync(path.join(SITE, p), 'utf8');
      ok(p + ' 掛了 site.js 與 theme-color', html.includes('site.js') && html.includes('theme-color'));
    }
    dom.window.close();
  }


  // -------------------------------------------------------------------------
  console.log('⑧ 圖表已移除（人下的令：這不是最重要的功能）');
  {
    for (const p of ['formulas.html', 'materials.html', 'stats.html', 'index.html',
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
    for (const p of ['index.html', 'formulas.html', 'stats.html', 'zones.html',
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
    dom.window.close();

    // 版本情報：549 條變更、可搜尋、可篩類型
    const dom2 = await load('updates.html');
    const d2 = dom2.window.document, w2 = dom2.window;
    const table = d2.querySelector('table[data-search]');
    const rows = [...table.querySelectorAll('tbody tr')];
    ok('更新日誌 549 條全在', rows.length === 549);
    const bar = table.closest('.table-wrap').previousElementSibling;
    const input = bar.querySelector('input[type="search"]');
    type(input, '鷹洞', w2);
    ok('打「鷹洞」篩得到相關更新', vis(rows) > 3 && vis(rows) < 549);
    type(input, '', w2);
    const chips = [...bar.querySelectorAll('.chip')];
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
    ok('分類卡片含攻略、工具與版本情報', ['formulas.html', 'stats.html', 'allocation.html', 'updates.html']
      .every((u) => cat.includes(u)));
    dom4.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑫ 頁首只有一行（人下的令，2026-09-05：站名＋導覽同一行，不堆高）');
  {
    const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
    ok('header.site 是 flex 橫排', /header\.site \{[^}]*display: flex/.test(css));
    ok('導覽不換行（flex-wrap: nowrap），塞不下就橫滑', css.includes('flex-wrap: nowrap'));
    for (const p of ['index.html', 'formulas.html', 'stats.html', 'zones.html',
                     'skills.html', 'materials.html', 'effects.html', 'updates.html',
                     'allocation.html', 'compare.html', 'enemies.html']) {
      const dom = await load(p);
      const d = dom.window.document;
      const head = d.querySelector('header.site');
      ok(p + ' 頁首沒有副標題那一行', !head.querySelector('.subtitle'));
      ok(p + ' 站名是連回首頁的連結',
        head.querySelector('a.title')?.getAttribute('href') === 'index.html' &&
        head.querySelector('a.title').textContent === '9aohelper');
      ok(p + ' 頁首是「站名＋導覽＋搜尋鈕」一行三件',
        head.children.length === 3 && head.querySelector('#hsearch'));
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
    ok('五類實體數量對（241/31/34/15/13）',
      DB.materials.length === 241 && DB.effects.length === 31 &&
      DB.skills.length === 34 && DB.eqtypes.length === 15 && DB.zones.length === 13);
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
      [...dl.window.document.querySelectorAll('table a.dlink')].length === 34);
    dl.window.close();
  }

  // -------------------------------------------------------------------------
  console.log('⑮ 武器比較器：折算計算、網址還原、未知區間、詳情頁帶入');
  {
    const q = '?at=%E7%8B%99%E6%93%8A%E6%A7%8D&aatk=100000&adef=50000&aluck=30000&awt=1000&aprof=10000000'
            + '&bt=%E9%9B%99%E6%89%8B%E5%8A%8D&batk=150000&bdef=40000&bluck=20000&bwt=2000&bprof=1000000';
    const dom = await load('compare.html', q, ['data/db.js']);
    const d = dom.window.document, w = dom.window;
    ok('網址參數還原成輸入值', d.getElementById('aatk').value === '100000' &&
      d.getElementById('btype').value === '雙手劍');
    const rows = (side) => [...d.querySelectorAll('.wpanel[data-side="' + side + '"] .rrow')]
      .map((r) => r.textContent);
    // A：需求 1790 萬、達成率 55.9%、折算 1.205×achv^0.153、×狙擊命中 1.8
    const achvA = 10000000 / 17900000;
    const outA = Math.round(100000 * 1.205 * Math.pow(achvA, 0.153) * 1.8);
    ok('A 的需求熟練照（攻＋防＋幸−重）×100 算', rows('a').some((t) => t.includes('17,900,000')));
    ok('A 的輸出指標＝攻擊×折算比×命中倍率', rows('a').some((t) =>
      t.includes('輸出指標') && t.replace(/,/g, '').includes(String(outA))));
    // B：達成率 4.8% ≤ 6.7% → 硬地板 0.20 → 150000×0.2×1.0 = 30000
    ok('B 掉在 0.20 硬地板，指標 30,000', rows('b').some((t) =>
      t.includes('輸出指標') && t.replace(/,/g, '').includes('30000')));
    const verdict = d.getElementById('verdict');
    ok('判定指出 A 較高', !verdict.hidden && verdict.textContent.includes('A（狙擊槍）'));
    // 改選型別 → 網址跟著變
    const sel = d.getElementById('btype');
    sel.value = '太刀';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok('改型別後網址同步（bt=太刀）',
      decodeURIComponent(w.location.search).includes('bt=太刀'));
    dom.window.close();

    // 6.7%～27% 的未知區間照實顯示，不內插
    const q2 = '?at=%E7%8B%99%E6%93%8A%E6%A7%8D&aatk=100000&adef=50000&aluck=30000&awt=1000&aprof=2000000';
    const d2 = await load('compare.html', q2, ['data/db.js']);
    const body2 = d2.window.document.querySelector('.wpanel[data-side="a"]').textContent;
    ok('未知區間顯示 0.2～0.99 與「此區間無公式」',
      body2.includes('0.2～0.99') && body2.includes('此區間無公式'));
    d2.window.close();

    // 從裝備類型詳情頁帶入
    const d3 = await load('detail.html', '?t=eqtype&id=%E7%8B%99%E6%93%8A%E6%A7%8D', ['data/db.js']);
    ok('狙擊槍詳情頁有「放進武器比較器」連結',
      [...d3.window.document.querySelectorAll('a')].some((a) =>
        a.href.includes('compare.html?at=')));
    d3.window.close();

    // 實體庫的倍率表完整
    const DB2 = (() => {
      const window = {};
      eval(fs.readFileSync(path.join(SITE, 'data', 'db.js'), 'utf8'));
      return window.DB;
    })();
    ok('倍率表 21 列、狙擊命中 1.8 與公式頁一致',
      DB2.wmult.length === 21 &&
      DB2.wmult.find((x) => x.id === '狙擊槍').hit === 1.8);
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

    // 配點攻略頁 → 計算機
    const ds = await load('stats.html');
    ok('攻略頁有三個一鍵開配方的連結',
      [...ds.window.document.querySelectorAll('a')].filter((a) =>
        a.href.includes('allocation.html?preset=')).length === 3);
    ds.window.close();

    // 技能詳情 → 裝備類型與比較器
    const dk = await load('detail.html', '?t=skill&id=' + encodeURIComponent('短刃'), ['data/db.js']);
    const kd = dk.window.document;
    ok('技能詳情連到裝備類型（短刀）',
      [...kd.querySelectorAll('a')].some((a) =>
        a.href.includes('detail.html?t=eqtype') && decodeURIComponent(a.href).includes('短刀')));
    ok('技能詳情列出對應持法的比較器帶入（單持／雙持／帶盾共 3 條）',
      [...kd.querySelectorAll('a')].filter((a) => a.href.includes('compare.html?at=')).length === 3);
    dk.window.close();

    // 裝備類型詳情：手槍列出單持與雙持兩種持法
    const dq = await load('detail.html', '?t=eqtype&id=' + encodeURIComponent('手槍'), ['data/db.js']);
    const links = [...dq.window.document.querySelectorAll('a')]
      .filter((a) => a.href.includes('compare.html?at='));
    ok('手槍詳情列出 2 種持法各自帶入比較器',
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
    ok('150 隻敵人全在', rows.length === 150);
    const input = d.querySelector('.tbar input[type="search"]');
    type(input, '菇菇', w);
    ok('打「菇菇」篩得到蘑菇園那掛', vis(rows) > 3 && vis(rows) < 150);
    type(input, '狗頭人爪', w);
    ok('打掉落物「狗頭人爪」也搜得到', vis(rows) >= 2);
    type(input, '', w);
    const chips = [...d.querySelectorAll('.tbar .chip')];
    ok('地圖籤有 8 張圖', chips.length === 8);
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
    ok('敵人 150 隻進庫', DB3.enemies.length === 150);
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
}

main().then(() => {
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
});
