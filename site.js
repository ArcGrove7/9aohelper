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
    const tagText = rows.map((tr) => {
      const c = chipCol == null ? null : tr.children[Number(chipCol)];
      return c ? c.textContent : '';
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
    document.querySelectorAll('table[data-search]').forEach(attachSearch);
    const cur = document.querySelector('nav.site a[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    backToTop();
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();
