/* ------------------------------------------------------------------
 *  tables.js — 表格组件
 *  · 数据模型：e.rows = [['单元格', ...], ...]，纯 JSON，天然兼容 .nkdraw
 *  · 画布内双击单元格直接改字；Tab / Shift+Tab / Enter 连续录入
 *  · 行列增删、列宽、密度、对齐等结构操作由右侧属性面板驱动
 * ------------------------------------------------------------------ */
window.Tables = (function () {
  const E = U.esc;
  const DENSITY = ['compact', 'normal', 'loose'];
  const ALIGN = ['left', 'center', 'right'];

  let active = null;   // { id, r, c } —— 当前定位的单元格
  let editing = null;  // { host, cell, id, r, c, before }

  /* ---------------- 数据规范化 ---------------- */
  // contenteditable 的 innerText 常带回零宽空格与首尾换行，
  // 不清掉的话表格里会多出空行、行高也会被撑高
  function cleanCell(v) {
    return String(v == null ? '' : v)
      .replace(/\u200b/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[\s]+/, '')
      .replace(/[\s]+$/, '');
  }

  function norm(e) {
    if (!Array.isArray(e.rows) || !e.rows.length) {
      e.rows = [['维度', '表现', '判断'], ['', '', ''], ['', '', '']];
    }
    e.rows = e.rows.map((row) =>
      Array.isArray(row) ? row.map(cleanCell) : ['']
    );
    const cols = Math.max.apply(null, e.rows.map((r) => r.length).concat([1]));
    e.rows.forEach((r) => { while (r.length < cols) r.push(''); });
    return e;
  }

  function size(e) {
    norm(e);
    return { rows: e.rows.length, cols: e.rows[0].length };
  }

  function blank() {
    return {
      rows: [
        ['维度', '表现', '判断'],
        ['机制', '玩家实际看到 / 操作到的', '好 · 一般 · 有问题'],
        ['数值', '产出 / 消耗 / 概率', '是否形成正反馈'],
      ],
      header: true,
      zebra: true,
      density: 'normal',
      align: 'left',
      firstCol: false,
    };
  }

  /* ---------------- 渲染 ---------------- */
  function render(e) {
    const s = size(e);
    const head = e.header !== false;
    const cls = [
      'tb',
      'tb-' + (DENSITY.indexOf(e.density) > -1 ? e.density : 'normal'),
      'tb-al-' + (ALIGN.indexOf(e.align) > -1 ? e.align : 'left'),
      e.zebra === false ? 'tb-no-zebra' : '',
      e.firstCol ? 'tb-first' : '',
      Array.isArray(e.widths) && e.widths.length === s.cols ? 'tb-fixed' : '',
    ].filter(Boolean).join(' ');

    let colgroup = '';
    if (Array.isArray(e.widths) && e.widths.length === s.cols) {
      const sum = e.widths.reduce((a, b) => a + (Number(b) || 1), 0) || s.cols;
      colgroup =
        '<colgroup>' +
        e.widths
          .map((w) => `<col style="width:${(((Number(w) || 1) / sum) * 100).toFixed(3)}%">`)
          .join('') +
        '</colgroup>';
    }

    const cell = (v, r, c, tag) =>
      `<${tag} class="tb-cell" data-r="${r}" data-c="${c}"${
        tag === 'th' ? ' scope="col"' : ''
      }>${E(v)}</${tag}>`;

    let body = '';
    let start = 0;
    if (head) {
      body += '<thead><tr>' + e.rows[0].map((v, c) => cell(v, 0, c, 'th')).join('') + '</tr></thead>';
      start = 1;
    }
    body += '<tbody>';
    for (let r = start; r < s.rows; r++) {
      body += '<tr>' + e.rows[r].map((v, c) => cell(v, r, c, 'td')).join('') + '</tr>';
    }
    body += '</tbody>';

    return (
      `<div class="tb-card">` +
      `<div class="tb-head">` +
      `<span class="tb-chip">表格</span>` +
      `<div class="tb-title" data-edit="title">${E(e.title || '表格')}</div>` +
      `<span class="tb-count">${s.cols} 列 · ${s.rows} 行</span>` +
      `<button class="fc-edit tb-edit" type="button" title="打开表格编辑窗口：改字、增删行列、调列宽">编辑</button>` +
      `</div>` +
      `<div class="tb-body"><table class="${cls}">${colgroup}${body}</table></div>` +
      (e.caption ? `<div class="tb-cap" data-edit="caption">${E(e.caption)}</div>` : '') +
      `</div>`
    );
  }

  /* ---------------- 活动单元格 ---------------- */
  function setActive(id, r, c, silent) {
    active = id == null ? null : { id, r: +r || 0, c: +c || 0 };
    reapply();
    if (!silent && window.Panels) Panels.refreshInspector(true);
  }

  function activeCell() {
    return active;
  }

  function reapply() {
    U.$$('.tb-cell.on').forEach((n) => n.classList.remove('on'));
    if (!active) return;
    const host = document.querySelector(`.el[data-id="${active.id}"]`);
    if (!host) return;
    const cell = host.querySelector(
      `.tb-cell[data-r="${active.r}"][data-c="${active.c}"]`
    );
    if (cell) cell.classList.add('on');
  }

  function findCell(host, r, c) {
    return host.querySelector(`.tb-cell[data-r="${r}"][data-c="${c}"]`);
  }

  /* ---------------- 单元格内联编辑 ---------------- */
  function editCell(host, cell) {
    if (!host || !cell) return;
    if (editing && editing.cell === cell) return;
    if (editing) commit();

    const id = host.dataset.id;
    const e = Store.el(id);
    if (!e) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (!e.rows[r] || e.rows[r][c] == null) return;

    editing = { host, cell, id, r, c, before: e.rows[r][c] };
    cell.contentEditable = 'true';
    cell.classList.add('tb-editing');
    cell.spellcheck = false;
    try { cell.focus({ preventScroll: true }); } catch (err) { cell.focus(); }

    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    sel.removeAllRanges();
    sel.addRange(range);

    cell.addEventListener('blur', onBlur, { once: true });
    cell.addEventListener('keydown', onKey);
    cell.addEventListener('paste', U.pastePlain);

    setActive(id, r, c, true);
  }

  function onBlur() {
    if (editing) commit();
  }

  function onKey(ev) {
    if (!editing) return;
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); cancel(); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); move(ev.shiftKey ? -1 : 1); return; }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); moveTo(nextRow(ev.altKey ? -1 : 1)); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); commit(); return; }
  }

  function nextRow(delta) {
    if (!editing) return null;
    const st = editing;
    const e = Store.el(st.id);
    if (!e) return null;
    const s = size(e);
    const r = st.r + delta;
    return r >= 0 && r < s.rows ? { r, c: st.c } : null;
  }

  function move(delta) {
    if (!editing) return;
    const st = editing;
    const e = Store.el(st.id);
    if (!e) return commit();
    const s = size(e);
    const flat = st.r * s.cols + st.c + delta;
    commit();
    if (flat < 0 || flat >= s.rows * s.cols) return;
    const r = Math.floor(flat / s.cols), c = flat % s.cols;
    const host = document.querySelector(`.el[data-id="${st.id}"]`);
    const cell = host && findCell(host, r, c);
    if (cell) editCell(host, cell);
  }

  function moveTo(pos) {
    if (!editing) return;
    const st = editing;
    commit();
    if (!pos) return;
    const host = document.querySelector(`.el[data-id="${st.id}"]`);
    const cell = host && findCell(host, pos.r, pos.c);
    if (cell) editCell(host, cell);
  }

  function clean(node) {
    node.removeEventListener('keydown', onKey);
    node.removeEventListener('paste', U.pastePlain);
    node.contentEditable = 'false';
    node.classList.remove('tb-editing');
  }

  function commit() {
    if (!editing) return;
    const st = editing;
    editing = null;
    clean(st.cell);

    const e = Store.el(st.id);
    if (e && e.rows[st.r]) {
      const val = cleanCell((st.cell.innerText || '').replace(/[ \t]+\n/g, '\n'));
      if (val !== st.before) {
        Store.begin();
        e.rows[st.r][st.c] = val;
        Store.end('table');
        if (window.Panels) Panels.refreshOutline();
      }
    }
    if (window.Canvas) Canvas.updateOverlay();
  }

  function cancel() {
    if (!editing) return;
    const st = editing;
    editing = null;
    st.cell.textContent = st.before;
    clean(st.cell);
    if (window.Canvas) Canvas.updateOverlay();
  }

  function isEditing() { return !!editing; }

  /* ---------------- 行列结构 ---------------- */
  function insertRow(e, at) {
    norm(e);
    const cols = e.rows[0].length;
    const idx = Math.max(0, Math.min(at == null ? e.rows.length : at, e.rows.length));
    e.rows.splice(idx, 0, new Array(cols).fill(''));
    return idx;
  }

  function deleteRow(e, at) {
    norm(e);
    if (e.rows.length <= 1) return false;
    const idx = Math.max(0, Math.min(at == null ? e.rows.length - 1 : at, e.rows.length - 1));
    e.rows.splice(idx, 1);
    return idx;
  }

  function insertCol(e, at) {
    norm(e);
    const cols = e.rows[0].length;
    const idx = Math.max(0, Math.min(at == null ? cols : at, cols));
    e.rows.forEach((r) => r.splice(idx, 0, ''));
    if (Array.isArray(e.widths)) e.widths.splice(idx, 0, 1);
    return idx;
  }

  function deleteCol(e, at) {
    norm(e);
    const cols = e.rows[0].length;
    if (cols <= 1) return false;
    const idx = Math.max(0, Math.min(at == null ? cols - 1 : at, cols - 1));
    e.rows.forEach((r) => r.splice(idx, 1));
    if (Array.isArray(e.widths)) e.widths.splice(idx, 1);
    return idx;
  }

  /* 列宽预设：auto = 自动 / even = 等宽 / first = 首列加宽 */
  function widthPreset(e, mode) {
    norm(e);
    const cols = e.rows[0].length;
    if (mode === 'even') {
      e.widths = new Array(cols).fill(1);
    } else if (mode === 'first') {
      e.widths = new Array(cols).fill(1);
      e.widths[0] = 1.7;
    } else {
      delete e.widths;
    }
  }

  function widthMode(e) {
    if (!Array.isArray(e.widths) || e.widths.length !== size(e).cols) return 'auto';
    return e.widths[0] > 1.2 ? 'first' : 'even';
  }

  return {
    render, blank, size, norm, cleanCell, widthMode,
    editCell, commit, cancel, isEditing, activeCell, setActive, reapply,
    insertRow, deleteRow, insertCol, deleteCol, widthPreset,
  };
})();
