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
function load(page) {
  // jsdom 建構完成時文件還在 loading，site.js 的 DOMContentLoaded 監聽要等它跑完，
  // 所以這裡回 Promise，等 load 事件後才把 site.js 注入並交出 dom。
  return new Promise((resolve) => {
    const dom = new JSDOM(fs.readFileSync(path.join(SITE, page), 'utf8'), {
      runScripts: 'dangerously',
      url: 'https://example.invalid/' + page,
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
}

main().then(() => {
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
});
