/* ------------------------------------------------------------------
 *  tableeditor.js — 表格编辑窗口
 *  · 直接改格子（contenteditable），Tab 下一格 / Enter 下一行
 *  · 增删行列、表头、斑马纹、行高、对齐、列宽都在左侧面板
 *  · 完成后一次性写回画布，取消则丢弃
 * ------------------------------------------------------------------ */
window.TableEditor = (function () {
  const E = U.esc;
  const DENSITY = [['compact', '紧凑'], ['normal', '标准'], ['loose', '宽松']];
  const ALIGN = [['left', '居左'], ['center', '居中'], ['right', '居右']];

  let ov = null;
  let cur = null;
  let draft = null;
  let gridEl = null;
  let ctx = { r: 0, c: 0 };

  function open(id) {
    const e = Store.el(id);
    if (!e || e.type !== 'table') return;
    close();
    cur = id;
    draft = JSON.parse(JSON.stringify(e));
    Tables.norm(draft);
    ctx = { r: draft.header === false ? 0 : Math.min(1, draft.rows.length - 1), c: 0 };
    build();
  }

  function close() {
    if (!ov) return;
    window.removeEventListener('keydown', onWinKey, true);
    ov.remove();
    ov = null;
    gridEl = null;
    cur = null;
    draft = null;
    document.body.classList.remove('ed-open');
  }

  /* ---------------- 结构 ---------------- */
  function build() {
    ov = document.createElement('div');
    ov.className = 'ed';
    ov.innerHTML = shell();
    document.body.appendChild(ov);
    document.body.classList.add('ed-open');
    gridEl = ov.querySelector('#te-grid');

    renderGrid();
    syncCtxLabel();
    bind();
    ov.querySelector('.ed-panel').focus();
    window.addEventListener('keydown', onWinKey, true);
  }

  function onWinKey(ev) {
    if (!ov) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); save(); }
  }

  function shell() {
    return (
      `<div class="ed-panel wide" role="dialog" tabindex="-1" aria-label="表格编辑">` +
      `<div class="ed-head">` +
      `<span class="ed-chip">表格</span>` +
      `<div class="ed-headtxt"><b>表格编辑</b><span>直接改格子 · Tab 下一格 · Enter 下一行</span></div>` +
      `<span class="ed-count" id="te-count"></span>` +
      `<button class="ed-x" data-act="close" title="关闭（Esc）">` +
      `<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` +
      `</button>` +
      `</div>` +
      `<div class="ed-body">` +
      side() +
      `<div class="ed-main">` +
      `<div class="te-stage"><div class="te-card"><table class="te-grid" id="te-grid"></table>` +
      `<div class="te-add">` +
      `<button class="te-addbtn" data-op="row-append" title="在末尾添加一行">＋ 行</button>` +
      `<button class="te-addbtn" data-op="col-append" title="在末尾添加一列">＋ 列</button>` +
      `</div></div></div>` +
      `</div>` +
      `</div>` +
      `<div class="ed-foot">` +
      `<span class="ed-meta" id="te-pos"></span>` +
      `<span class="ed-tiphint">完成后写回画布</span>` +
      `<button class="ed-btn ghost" data-act="close">取消</button>` +
      `<button class="ed-btn primary" data-act="save">完成</button>` +
      `</div>` +
      `</div>`
    );
  }

  function side() {
    return (
      `<div class="ed-side">` +
      `<div class="ed-sec">表格</div>` +
      fld('标题', `<input class="ed-ipt" id="te-title" value="${E(draft.title || '')}" placeholder="表格标题">`) +
      fld('说明（表下小字）', `<input class="ed-ipt" id="te-caption" value="${E(draft.caption || '')}" placeholder="可留空">`) +
      `<div class="ed-sec">样式</div>` +
      `<div class="ed-row2">` +
      fld('首行表头', sel('te-header', draft.header === false ? 'off' : 'on', [['on', '有'], ['off', '无']])) +
      fld('斑马纹', sel('te-zebra', draft.zebra === false ? 'off' : 'on', [['on', '有'], ['off', '无']])) +
      `</div>` +
      `<div class="ed-row2">` +
      fld('行高', sel('te-density', draft.density || 'normal', DENSITY)) +
      fld('对齐', sel('te-align', draft.align || 'left', ALIGN)) +
      `</div>` +
      `<div class="ed-row2">` +
      fld('列宽', sel('te-widths', Tables.widthMode(draft), [['auto', '自动'], ['even', '等宽'], ['first', '首列加宽']])) +
      fld('首列强调', sel('te-first', draft.firstCol ? 'on' : 'off', [['on', '加粗'], ['off', '不强调']])) +
      `</div>` +
      `<div class="ed-sec">结构 <span class="dim" id="te-ctx"></span></div>` +
      `<div class="te-ops">` +
      `<button class="ed-btn sm ghost" data-op="row-above">上方插入行</button>` +
      `<button class="ed-btn sm ghost" data-op="row-below">下方插入行</button>` +
      `<button class="ed-btn sm ghost" data-op="col-left">左侧插入列</button>` +
      `<button class="ed-btn sm ghost" data-op="col-right">右侧插入列</button>` +
      `<button class="ed-btn sm danger" data-op="row-del">删除本行</button>` +
      `<button class="ed-btn sm danger" data-op="col-del">删除本列</button>` +
      `</div>` +
      `<p class="ed-note">行列操作作用在当前选中的格子上；点一下格子即可切换。</p>` +
      `</div>`
    );
  }

  const fld = (label, inner) => `<label class="ed-f"><span>${label}</span>${inner}</label>`;
  const sel = (id, val, opts) =>
    `<select class="ed-ipt" id="${id}">${opts
      .map((o) => `<option value="${o[0]}" ${o[0] === val ? 'selected' : ''}>${o[1]}</option>`)
      .join('')}</select>`;

  /* ---------------- 网格 ---------------- */
  function renderGrid() {
    const rows = draft.rows;
    const cols = rows[0].length;
    const head = draft.header !== false;

    let colgroup = '';
    if (Array.isArray(draft.widths) && draft.widths.length === cols) {
      const sum = draft.widths.reduce((a, b) => a + (Number(b) || 1), 0) || cols;
      colgroup =
        '<colgroup>' +
        draft.widths.map((w) => `<col style="width:${(((Number(w) || 1) / sum) * 100).toFixed(3)}%">`).join('') +
        '</colgroup>';
    }

    const cell = (v, r, c, tag) =>
      `<${tag} class="te-cell" data-r="${r}" data-c="${c}" contenteditable="true" spellcheck="false">${E(v)}</${tag}>`;

    let html = '';
    let start = 0;
    if (head) {
      html += '<thead><tr>' + rows[0].map((v, c) => cell(v, 0, c, 'th')).join('') + '</tr></thead>';
      start = 1;
    }
    html += '<tbody>';
    for (let r = start; r < rows.length; r++) {
      html += '<tr>' + rows[r].map((v, c) => cell(v, r, c, 'td')).join('') + '</tr>';
    }
    html += '</tbody>';

    gridEl.className =
      'te-grid te-' + (draft.density || 'normal') +
      ' te-al-' + (draft.align || 'left') +
      (draft.zebra === false ? ' te-no-zebra' : '') +
      (draft.firstCol ? ' te-first' : '');
    gridEl.innerHTML = colgroup + html;

    const n = ov.querySelector('#te-count');
    if (n) n.textContent = cols + ' 列 × ' + rows.length + ' 行';
    syncCtxLabel();
    markCtx();
  }

  function markCtx() {
    U.$$('.te-cell.on', gridEl).forEach((n) => n.classList.remove('on'));
    const cell = cellAt(ctx.r, ctx.c);
    if (cell) cell.classList.add('on');
  }

  function cellAt(r, c) {
    return gridEl.querySelector(`.te-cell[data-r="${r}"][data-c="${c}"]`);
  }

  function syncCtxLabel() {
    const a = ov && ov.querySelector('#te-ctx');
    const b = ov && ov.querySelector('#te-pos');
    const txt = 'R' + (ctx.r + 1) + ' · C' + (ctx.c + 1);
    if (a) a.textContent = txt;
    if (b) b.textContent = txt + ' / ' + draft.rows.length + ' 行 ' + draft.rows[0].length + ' 列';
  }

  function syncFromDom() {
    if (!gridEl) return;
    U.$$('.te-cell', gridEl).forEach((cell) => {
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (draft.rows[r]) draft.rows[r][c] = Tables.cleanCell(cell.innerText);
    });
  }

  function focusCell(r, c) {
    const rows = draft.rows.length, cols = draft.rows[0].length;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    ctx = { r, c };
    const cell = cellAt(r, c);
    if (!cell) return false;
    cell.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    sel.removeAllRanges();
    sel.addRange(range);
    markCtx();
    syncCtxLabel();
    return true;
  }

  /* ---------------- 交互 ---------------- */
  function bind() {
    ov.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'close') close();
        else if (act.dataset.act === 'save') save();
        return;
      }
      const op = ev.target.closest('[data-op]');
      if (op) { doOp(op.dataset.op); return; }
      if (ev.target === ov) close();
    });

    gridEl.addEventListener('focusin', (ev) => {
      const cell = ev.target.closest('.te-cell');
      if (!cell) return;
      ctx = { r: +cell.dataset.r, c: +cell.dataset.c };
      markCtx();
      syncCtxLabel();
    });

    gridEl.addEventListener('input', (ev) => {
      const cell = ev.target.closest('.te-cell');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (draft.rows[r]) draft.rows[r][c] = Tables.cleanCell(cell.innerText);
    });

    gridEl.addEventListener('keydown', (ev) => {
      const cell = ev.target.closest('.te-cell');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const cols = draft.rows[0].length;
        const flat = r * cols + c + (ev.shiftKey ? -1 : 1);
        focusCell(Math.floor(flat / cols), flat % cols);
        return;
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        focusCell(r + 1, c);
        return;
      }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      ev.stopPropagation();
    });

    // 样式切换即时预览
    ov.addEventListener('change', (ev) => {
      const id = ev.target.id;
      if (id === 'te-header') {
        draft.header = ev.target.value === 'on';
        syncFromDom(); renderGrid();
      } else if (id === 'te-zebra') {
        draft.zebra = ev.target.value === 'on';
        syncFromDom(); renderGrid();
      } else if (id === 'te-density') {
        draft.density = ev.target.value;
        syncFromDom(); renderGrid();
      } else if (id === 'te-align') {
        draft.align = ev.target.value;
        syncFromDom(); renderGrid();
      } else if (id === 'te-first') {
        draft.firstCol = ev.target.value === 'on';
        syncFromDom(); renderGrid();
      } else if (id === 'te-widths') {
        Tables.widthPreset(draft, ev.target.value);
        syncFromDom(); renderGrid();
      }
    });

    ov.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); save(); }
    });
  }

  function doOp(op) {
    syncFromDom();
    let ok = true;
    if (op === 'row-above') ctx.r = Tables.insertRow(draft, ctx.r);
    else if (op === 'row-below') ctx.r = Tables.insertRow(draft, ctx.r + 1);
    else if (op === 'col-left') ctx.c = Tables.insertCol(draft, ctx.c);
    else if (op === 'col-right') ctx.c = Tables.insertCol(draft, ctx.c + 1);
    else if (op === 'row-append') ctx.r = Tables.insertRow(draft, draft.rows.length);
    else if (op === 'col-append') ctx.c = Tables.insertCol(draft, draft.rows[0].length);
    else if (op === 'row-del') {
      const res = Tables.deleteRow(draft, ctx.r);
      if (res === false) ok = false;
      else ctx.r = Math.min(res, draft.rows.length - 1);
    } else if (op === 'col-del') {
      const res = Tables.deleteCol(draft, ctx.c);
      if (res === false) ok = false;
      else ctx.c = Math.min(res, draft.rows[0].length - 1);
    }
    if (!ok) { U.toast('至少要保留一行 / 一列'); return; }
    renderGrid();
    const cell = cellAt(ctx.r, ctx.c);
    if (cell) cell.focus();
  }

  /* ---------------- 保存 ---------------- */
  function save() {
    if (!ov) return;
    syncFromDom();
    const id = cur;
    const d = draft;
    const e = Store.el(id);
    close();
    if (!e || !d) return;

    const g = (k, dv) => (d[k] == null ? dv : d[k]);
    Store.begin();
    e.title = (d.title || '').trim() || '表格';
    e.caption = (d.caption || '').trim();
    e.header = g('header', true) !== false;
    e.zebra = g('zebra', true) !== false;
    e.density = g('density', 'normal');
    e.align = g('align', 'left');
    e.firstCol = !!d.firstCol;
    e.rows = d.rows;
    if (Array.isArray(d.widths)) e.widths = d.widths;
    else delete e.widths;
    Store.end('table');

    Canvas.rebuild(id);
    Canvas.select(id);
    if (window.Panels) {
      Panels.refreshOutline();
      Panels.refreshInspector(true);
    }
    U.toast('已更新表格');
  }

  return { open, close, isOpen: () => !!ov };
})();
