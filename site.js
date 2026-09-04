/* 9aohelper 共用前端（2026-09-03）
   做三件事，全部是為了手機：
   1. 任何 <table data-search="…"> 自動長出「關鍵字搜尋列」——打幾個字就篩，
      不必輸入完整名稱；可再加 data-chip-col 生出一排篩選籤。
   2. 表格在窄螢幕會被 style.css 攤成卡片，這裡負責把每格的欄名寫進 data-label。
   3. 回到頂端按鈕、導覽列自動捲到目前頁面。
   所有功能都是「加上去」的：沒有 JS 也看得到完整表格，只是不能篩。 */
(function () {
  'use strict';

  /* ---- 小工具 ---- */
  const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();
  function headerCells(table) {
    const hr = table.querySelector('tr');
    if (!hr) return [];
    return [...hr.children].map((c) => c.textContent.replace(/[▾▴]/g, '').trim());
  }
  function bodyRows(table) {
    return [...table.querySelectorAll('tr')].filter((tr) => !tr.querySelector('th'));
  }

  /* ---- 2) 卡片模式要用的欄名 ---- */
  function labelCells(table) {
    const head = headerCells(table);
    const titleCol = Number(table.dataset.titleCol || 0);
    bodyRows(table).forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', head[i] || '');
        if (i === titleCol && table.dataset.titleCol !== 'none') td.classList.add('title');
        // 值整份包一層 span：卡片模式下欄名與值各是一個 flex item，
        // 格子裡的 <strong> 才不會各自被當成 item 而把一段話切成直行。
        const wrapped = td.children.length === 1 && td.firstElementChild.classList.contains('v');
        if (!wrapped && td.innerHTML.trim()) {
          const v = document.createElement('span');
          v.className = 'v';
          while (td.firstChild) v.appendChild(td.firstChild);
          td.appendChild(v);
        }
      });
    });
  }

  /* ---- 1) 搜尋列 ---- */
  function attachSearch(table) {
    const wrap = table.closest('.table-wrap') || table;
    const rows = bodyRows(table);
    if (!rows.length) return;

    const bar = document.createElement('div');
    bar.className = 'tbar';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = table.dataset.search || '關鍵字搜尋（打片段就好）';
    input.setAttribute('aria-label', input.placeholder);

    const count = document.createElement('span');
    count.className = 'count';

    const row1 = document.createElement('div');
    row1.className = 'row';
    row1.append(input, count);
    bar.append(row1);

    /* 篩選籤：從指定欄位的值切出來（以「·」「、」「／」分隔） */
    let chipBox = null;
    const picked = new Set();
    const chipCol = table.dataset.chipCol;
    if (chipCol != null) {
      const vals = new Map();
      rows.forEach((tr) => {
        const cell = tr.children[Number(chipCol)];
        if (!cell) return;
        cell.textContent.split(/[·、／\/]/).map((s) => s.trim()).filter(Boolean)
          .forEach((v) => vals.set(v, (vals.get(v) || 0) + 1));
      });
      const list = [...vals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (list.length > 1) {
        chipBox = document.createElement('div');
        chipBox.className = 'chips';
        list.forEach(([v, n]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.textContent = v + ' ' + n;
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => {
            if (picked.has(v)) picked.delete(v); else picked.add(v);
            b.setAttribute('aria-pressed', picked.has(v) ? 'true' : 'false');
            render();
          });
          chipBox.append(b);
        });
        bar.append(chipBox);
      }
    }

    const empty = document.createElement('p');
    empty.className = 'empty-hit';
    empty.hidden = true;
    empty.textContent = '沒有符合的項目——試試少打幾個字，或清掉篩選籤。';

    wrap.parentNode.insertBefore(bar, wrap);
    wrap.parentNode.insertBefore(empty, wrap.nextSibling);

    const hay = rows.map((tr) => norm(tr.textContent));
    // 籤比對用「切開後的整值」：按「通用」不能把「通用槍械」一起算進去
    const tagText = rows.map((tr) => {
      const c = chipCol == null ? null : tr.children[Number(chipCol)];
      return c ? c.textContent.split(/[·、／\/]/).map((s) => s.trim()).filter(Boolean) : [];
    });

    function render() {
      const q = norm(input.value);
      let hit = 0;
      rows.forEach((tr, i) => {
        const okQ = !q || hay[i].includes(q);
        const okC = !picked.size || [...picked].every((v) => tagText[i].includes(v));
        const show = okQ && okC;
        tr.hidden = !show;
        if (show) hit++;
      });
      count.innerHTML = '<b>' + hit + '</b> / ' + rows.length;
      empty.hidden = hit !== 0;
    }
    input.addEventListener('input', render);
    render();
  }

  /* ---- 4) 全站搜尋（索引在 data/search-index.js；結果依型別分組排序） ----
     wireSearch 把「輸入框＋結果匣」接上索引：首頁 hero 用一組，
     每一頁的頁首搜尋覆蓋層再用一組。名稱命中的排在關鍵字命中之前。 */
  const CAT_ORDER = ['頁面', '地圖', '秘境', '敵人', '素材', '特效', '技能', '裝備', '武器倍率', '版本線'];
  const catRank = (c) => {
    for (let i = 0; i < CAT_ORDER.length; i++) if (c.indexOf(CAT_ORDER[i]) === 0) return i;
    return CAT_ORDER.length;
  };
  function wireSearch(input, box) {
    let sel = -1;
    function render() {
      const idx = window.SEARCH_INDEX || [];
      const q = norm(input.value);
      sel = -1;
      if (!q) { box.hidden = true; box.innerHTML = ''; return; }
      const byName = [], byKey = [];
      for (const [n, c, u, k] of idx) {
        if (norm(n).includes(q)) byName.push([n, c, u]);
        else if (norm(k).includes(q) || norm(c).includes(q)) byKey.push([n, c, u]);
        if (byName.length + byKey.length > 80) break;
      }
      const hits = byName.concat(byKey);
      hits.sort((a, b) => catRank(a[1]) - catRank(b[1]));
      const top = hits.slice(0, 12);
      box.innerHTML = top.map(([n, c, u]) =>
        '<a href="' + u + '"><span class="hn">' + n + '</span><span class="hc">' + c + '</span></a>').join('')
        + (hits.length > top.length ? '<div class="hmore">還有更多——到分類頁用表格搜尋列細篩</div>' : '')
        + (hits.length ? '' : '<div class="hmore">沒有符合的項目——試試少打幾個字</div>');
      box.hidden = false;
    }
    function move(d) {
      const links = [...box.querySelectorAll('a')];
      if (!links.length) return;
      sel = (sel + d + links.length) % links.length;
      links.forEach((a, i) => a.classList.toggle('sel', i === sel));
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        const a = box.querySelector('a.sel') || box.querySelector('a');
        if (a) location.href = a.href;
      } else if (e.key === 'Escape') { box.hidden = true; }
    });
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && e.target !== input) box.hidden = true;
    });
    input.addEventListener('focus', () => { if (input.value) render(); });
  }
  function attachGlobalSearch() {
    const input = document.getElementById('gq');
    const box = document.getElementById('ghits');
    if (input && box) wireSearch(input, box);
  }

  /* ---- 8) 敵人圖鑑卡片檢視：一隻怪一張卡（屬性 chips＋掉落＋出沒），
     資料吃 data/db.js 的關聯（掉落可點進素材／技能詳情），與表格搜尋
     籤同步過濾；預設卡片、可切表格、可排序，偏好存瀏覽器。 ---- */
  function enemyCards() {
    const table = document.getElementById('etab');
    const DB = window.DB;
    if (!table || !DB || !DB.enemies) return;
    const wrap = table.closest('.table-wrap');
    const rows = bodyRows(table);
    if (rows.length !== DB.enemies.length) return;   // 對不上就不動，表格照舊

    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const dlink = (t, id, text) => '<a href="detail.html?t=' + t + '&id='
      + encodeURIComponent(id) + '">' + esc(text == null ? id : text) + '</a>';
    const splitList = (x) => String(x || '').split(/[、,，\/／]/)
      .map((v) => v.trim()).filter(Boolean);

    const grid = document.createElement('div');
    grid.id = 'ecards';
    const cards = DB.enemies.map((e) => {
      const card = document.createElement('article');
      card.className = 'ecard';
      const ic = window.GAOICON ? window.GAOICON.enemy(e.n, e.race) : '';
      let h = '<header>' + (ic ? '<span class="ic" aria-hidden="true">' + ic + '</span>' : '')
        + dlink('enemy', e.id, e.n)
        + '<span class="lvb">LV ' + (e.lv ? esc(e.lv) : '?') + '</span>'
        + (e.race ? '<span class="raceb">' + esc(e.race) + '</span>' : '')
        + '</header>';
      h += '<div class="esec">怪物屬性</div><div class="echips">'
        + '<span class="stat">最低HP<b>' + (e.hp ? esc(e.hp) : '—') + '</b></span>'
        + '<span class="stat">最低等級<b>' + (e.lv ? esc(e.lv) : '—') + '</b></span>'
        + '</div>';
      const dropIds = new Set(e.dropIds || []);
      const bookIds = new Set(e.bookIds || []);
      const drops = splitList(e.drops).map((d) =>
        dropIds.has(d) ? dlink('material', d) : '<span>' + esc(d) + '</span>');
      const books = splitList(e.books).map((b) =>
        bookIds.has(b) ? dlink('skill', b) : '<span>' + esc(b) + '</span>');
      const rest = [e.scrolls, e.potions, e.other].map(splitList).flat()
        .map((v) => '<span class="dim">' + esc(v) + '</span>');
      if (drops.length + books.length + rest.length) {
        h += '<div class="esec">掉落</div><div class="echips">'
          + drops.join('') + books.join('') + rest.join('') + '</div>';
      }
      h += '<div class="esec">出沒地圖</div><div class="echips">'
        + dlink('zone', e.zoneId, e.zone)
        + (e.at && e.at !== e.zone
            ? '<span class="' + (e.at.indexOf(e.zone) === 0 ? '' : 'realm') + '">'
              + esc(e.at) + '</span>' : '')
        + '</div>';
      if (e.equip || e.skills) {
        h += '<div class="emeta">'
          + (e.equip ? '<div>裝備：' + esc(e.equip) + '</div>' : '')
          + (e.skills ? '<div>技能：' + esc(e.skills) + '</div>' : '') + '</div>';
      }
      card.innerHTML = h;
      return card;
    });
    cards.forEach((c) => grid.append(c));
    wrap.parentNode.insertBefore(grid, wrap);

    // 與表格的搜尋／籤同步：表格列被篩掉，卡片跟著消失
    const sync = () => rows.forEach((tr, i) => { cards[i].hidden = tr.hidden; });
    document.addEventListener('input', sync);
    document.addEventListener('click', () => setTimeout(sync, 0));
    sync();

    // 檢視切換＋排序，掛在搜尋列上
    const bar = wrap.parentNode.querySelector('.tbar .row');
    const VKEY = 'pref.enemyview';
    let mode = 'cards';
    try { if (localStorage.getItem(VKEY) === 'table') mode = 'table'; } catch (e) {}
    const vbtns = {};
    const applyView = () => {
      grid.hidden = mode !== 'cards';
      wrap.hidden = mode === 'cards';
      Object.entries(vbtns).forEach(([m, b]) =>
        b.setAttribute('aria-pressed', String(m === mode)));
    };
    [['cards', '▦ 卡片'], ['table', '☰ 表格']].forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vbtn';
      b.textContent = label;
      b.setAttribute('aria-label', label + '檢視');
      b.addEventListener('click', () => {
        mode = m;
        try { localStorage.setItem(VKEY, m); } catch (e) {}
        applyView();
      });
      vbtns[m] = b;
      if (bar) bar.append(b);
    });
    applyView();

    const sel = document.createElement('select');
    sel.setAttribute('aria-label', '排序');
    [['', '預設順序'], ['lv-a', '等級低→高'], ['lv-d', '等級高→低'],
     ['hp-a', 'HP低→高'], ['hp-d', 'HP高→低']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      sel.append(o);
    });
    sel.addEventListener('change', () => {
      const [key, dir] = sel.value ? sel.value.split('-') : [null, null];
      const order = DB.enemies.map((e, i) => i);
      if (key) {
        order.sort((a, b) => {
          const va = Number(DB.enemies[a][key]) || Infinity;
          const vb = Number(DB.enemies[b][key]) || Infinity;
          return dir === 'd' ? (vb === Infinity ? -1 : va === Infinity ? 1 : vb - va) : va - vb;
        });
      }
      const tbody = rows[0].parentNode;
      order.forEach((i) => { grid.append(cards[i]); tbody.append(rows[i]); });
    });
    if (bar) bar.append(sel);
  }

  /* ---- 9) 圖鑑圖示：table[data-icons] 的名稱前加上該實體的 emoji 圖示，
     規則在 data/icons.js（與遊戲本身的 emoji 視覺語言一致）。 ---- */
  function iconizeTables() {
    const G = window.GAOICON;
    if (!G) return;
    document.querySelectorAll('table[data-icons]').forEach((table) => {
      const kind = table.dataset.icons;
      bodyRows(table).forEach((tr) => {
        const a = tr.children[0] && tr.children[0].querySelector('a');
        if (!a || a.querySelector('.ic')) return;
        const name = a.textContent.trim();
        let icon = '';
        if (kind === 'enemy') icon = G.enemy(name, tr.children[5] ? tr.children[5].textContent : '');
        else if (kind === 'material') icon = G.mat(name, tr.children[6] ? tr.children[6].textContent : '');
        else if (kind === 'skill') icon = G.skill(tr.children[1] ? tr.children[1].textContent : '');
        else if (kind === 'effect') {
          icon = G.effectCat(tr.children[1] ? tr.children[1].textContent : '');
          const c = G.fxColor(name);
          if (c) a.style.color = c;
        }
        if (!icon) return;
        const sp = document.createElement('span');
        sp.className = 'ic';
        sp.textContent = icon;
        sp.setAttribute('aria-hidden', 'true');
        a.prepend(sp);
      });
    });
  }

  /* ---- 7) 易讀模式：放大字距行距、表格攤成卡片，整站記住 ---- */
  function readableToggle() {
    const KEY = 'pref.readable';
    let on = false;
    try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
    const apply = () => document.documentElement.classList.toggle('readable', on);
    apply();
    const head = document.querySelector('header.site');
    if (!head) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'areadable';
    b.textContent = 'Aa 易讀';
    b.title = '易讀模式：放大字距與行距，所有表格攤成一列一張卡片';
    b.setAttribute('aria-label', '切換易讀模式');
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      apply();
      b.setAttribute('aria-pressed', String(on));
    });
    head.appendChild(b);
  }

  /* ---- 5) 頁首搜尋：每一頁右上角的搜尋鈕＋覆蓋層，Ctrl／Cmd＋K 也開得了 ---- */
  function headerSearch() {
    const head = document.querySelector('header.site');
    if (!head) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hsearch';
    btn.innerHTML = '🔍 搜尋<kbd>Ctrl K</kbd>';
    btn.setAttribute('aria-label', '全站搜尋（Ctrl+K）');
    head.appendChild(btn);
    let overlay = null;
    function open() {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'soverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', '全站搜尋');
        overlay.innerHTML = '<div class="spanel gsearch">'
          + '<input type="search" id="soq" autocomplete="off" '
          + 'placeholder="全站搜尋：素材、技能、特效、地圖、更新…" aria-label="全站搜尋">'
          + '<div class="hits" id="sohits" hidden></div></div>';
        document.body.appendChild(overlay);
        wireSearch(overlay.querySelector('#soq'), overlay.querySelector('#sohits'));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('#soq').addEventListener('keydown', (e) => {
          if (e.key === 'Escape') close();
        });
      }
      overlay.hidden = false;
      const inp = overlay.querySelector('#soq');
      inp.value = '';
      overlay.querySelector('#sohits').hidden = true;
      inp.focus();
    }
    function close() { overlay.hidden = true; }
    btn.addEventListener('click', open);
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        open();
      }
    });
  }

  /* ---- 6) 表格搜尋與網址同步：?q=片段 進頁自動篩，改了字網址跟著改 ----
     這讓「篩好的表」可以直接分享；跨頁連結（例如詳情頁的「在版本情報搜尋」）
     也是走這一條。 */
  function urlQuery() {
    const inp = document.querySelector('.tbar input[type="search"]') || document.getElementById('mq');
    if (!inp) return;
    const q = new URLSearchParams(location.search).get('q');
    if (q) {
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    inp.addEventListener('input', () => {
      try {
        const u = new URL(location.href);
        if (inp.value) u.searchParams.set('q', inp.value);
        else u.searchParams.delete('q');
        history.replaceState(null, '', u);
      } catch (e) { /* 環境不支援就算了，篩選本身照常 */ }
    });
  }

  /* ---- 3) 回到頂端 ---- */
  function backToTop() {
    const b = document.createElement('button');
    b.id = 'totop';
    b.type = 'button';
    b.textContent = '↑';
    b.title = '回到頂端';
    b.setAttribute('aria-label', '回到頂端');
    b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.append(b);
    const sync = () => b.classList.toggle('show', window.scrollY > 600);
    addEventListener('scroll', sync, { passive: true });
    sync();
  }

  function boot() {
    document.querySelectorAll('table.rtable').forEach(labelCells);
    iconizeTables();
    document.querySelectorAll('table[data-search]').forEach(attachSearch);
    attachGlobalSearch();
    enemyCards();
    readableToggle();
    headerSearch();
    urlQuery();
    const cur = document.querySelector('nav.site a[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    backToTop();
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();
