/* ------------------------------------------------------------------
 *  canvas.js — 无限画布：平移 / 缩放 / 选择 / 拖拽 / 缩放元素 / 编辑 / 小地图
 * ------------------------------------------------------------------ */
window.Canvas = (function () {
  let wrap, world, grid, overlay, mini;
  let nodes = new Map();
  let selId = null;
  let selNodeId = null;
  let selIds = new Set();
  let marqueeEl = null;
  let view = { x: 80, y: 60, z: 0.65 };
  const MINZ = 0.18, MAXZ = 2.6;
  let drag = null;
  let spaceDown = false;
  let clipboard = null;
  let editing = null;
  const bus = { select: [], view: [], edit: [] };
  const AUTO_H = { text: 1, note: 1, heading: 1, flowchart: 1 };

  const on = (k, f) => { (bus[k] || (bus[k] = [])).push(f); };
  const fire = (k, d) => (bus[k] || []).forEach((f) => f(d));

  /* ---------------- 初始化 ---------------- */
  function init() {
    wrap = document.getElementById('canvas-wrap');
    world = document.getElementById('world');
    grid = document.getElementById('grid');
    overlay = document.getElementById('sel-overlay');
    mini = document.getElementById('minimap-canvas');
    bind();
    applyView();
    renderAll();
  }

  /* ---------------- 视图 ---------------- */
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const s = 26 * view.z;
    grid.style.backgroundSize = `${s}px ${s}px, ${s * 5}px ${s * 5}px`;
    grid.style.backgroundPosition = `${view.x}px ${view.y}px, ${view.x}px ${view.y}px`;
    fire('view', view);
    drawMini();
    updateOverlay();
  }

  function s2w(cx, cy) {
    const r = wrap.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  }
  function w2s(x, y) {
    return { x: x * view.z + view.x, y: y * view.z + view.y };
  }

  function zoomAt(f, cx, cy) {
    const r = wrap.getBoundingClientRect();
    const px = (cx == null ? r.width / 2 : cx - r.left);
    const py = (cy == null ? r.height / 2 : cy - r.top);
    const nz = U.clamp(view.z * f, MINZ, MAXZ);
    const k = nz / view.z;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.z = nz;
    applyView();
  }
  const zoomBy = (f) => zoomAt(f);

  function contentBounds() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
    nodes.forEach((node) => {
      const x = parseFloat(node.style.left) || 0;
      const y = parseFloat(node.style.top) || 0;
      x1 = Math.min(x1, x); y1 = Math.min(y1, y);
      x2 = Math.max(x2, x + node.offsetWidth);
      y2 = Math.max(y2, y + node.offsetHeight);
      n++;
    });
    if (!n) return { x: 0, y: 0, w: 1200, h: 800 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function fit(pad) {
    const b = contentBounds();
    const r = wrap.getBoundingClientRect();
    const p = pad == null ? 90 : pad;
    const z = U.clamp(Math.min((r.width - p * 2) / b.w, (r.height - p * 2) / b.h), MINZ, 1.3);
    view.z = z;
    view.x = (r.width - b.w * z) / 2 - b.x * z;
    view.y = (r.height - b.h * z) / 2 - b.y * z;
    applyView();
  }

  // 打开时的起始视角：可读的缩放，从封面左上角开始
  function home() {
    const b = contentBounds();
    const r = wrap.getBoundingClientRect();
    view.z = U.clamp(Math.min(r.width / (b.w + 60), 0.82), MINZ, 1);
    view.x = 56 - b.x * view.z;
    view.y = 40 - b.y * view.z;
    applyView();
  }

  function focus(id, nodeId, opt) {
    const n = nodes.get(id);
    if (!n) return;
    select(id, nodeId);
    const r = wrap.getBoundingClientRect();
    const z = (opt && opt.z) || U.clamp(Math.max(view.z, 0.85), MINZ, MAXZ);
    const w = n.offsetWidth, h = n.offsetHeight;
    view.z = z;
    view.x = r.width / 2 - (parseFloat(n.style.left) + w / 2) * z;
    view.y = r.height / 2 - (parseFloat(n.style.top) + h / 2) * z;
    applyView();
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    const doc = Store.get();
    if (!doc) return;
    if (editing && document.activeElement === editing.node) finishEdit();
    nodes.clear();
    world.innerHTML = '';
    const list = (doc.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    list.forEach((e) => {
      let n;
      try {
        n = Renderer.build(e);
      } catch (err) {
        console.error('渲染失败', e.type, err);
        n = U.h('div', { class: 'el el-broken' }, `<div class="broken">组件渲染失败：${U.esc(e.type)}</div>`);
        n.style.left = e.x + 'px'; n.style.top = e.y + 'px'; n.style.width = (e.w || 300) + 'px';
      }
      // 流程图 / 文本类宽度不足时撑开
      if (e.type === 'flowchart') {
        const svg = n.querySelector('svg');
        if (svg) {
          const natural = parseFloat(svg.getAttribute('width')) + 60;
          if (e.w < natural) { e.w = Math.round(natural); n.style.width = e.w + 'px'; }
        }
      }
      world.appendChild(n);
      nodes.set(e.id, n);
      if (e.type === 'image') paintImage(n, e);
      if (e.type === 'er' && window.AdvancedComponents) AdvancedComponents.layout(n);
    });
    if (window.Groups) Groups.syncAll();
    const alive = new Set((Store.get().elements || []).map((e) => e.id));
    selIds.forEach((id) => { if (!alive.has(id)) selIds.delete(id); });
    if (selId && !alive.has(selId)) selId = null;
    if (!selId && selIds.size) selId = Array.from(selIds)[selIds.size - 1];
    highlightNode();
    updateOverlay();
    drawMini();
    fire('select', selId);
  }

  function paintImage(n, e) {
    if (!window.Marks || !n) return;
    const cv = n.querySelector('.shot-cv');
    if (cv) Marks.paint(cv, e);
  }

  function rebuild(id) {
    const e = Store.el(id);
    const old = nodes.get(id);
    if (!e) return;
    const n = Renderer.build(e);
    if (old && old.parentNode) old.parentNode.replaceChild(n, old);
    else world.appendChild(n);
    nodes.set(id, n);
    if (e.type === 'image') paintImage(n, e);
    if (e.type === 'er' && window.AdvancedComponents) AdvancedComponents.layout(n);
    if (e.type === 'flowchart') {
      const svg = n.querySelector('svg');
      if (svg) {
        const natural = parseFloat(svg.getAttribute('width')) + 60;
        if (e.w < natural) { e.w = Math.round(natural); n.style.width = e.w + 'px'; }
      }
    }
    if (window.Groups) Groups.syncAll();
    highlightNode();
    updateOverlay();
    drawMini();
  }

  function highlightNode() {
    U.$$('.fc-g.sel', world).forEach((g) => g.classList.remove('sel'));
    U.$$('.el', world).forEach((n) => {
      const on = selIds.has(n.dataset.id);
      n.classList.toggle('sel', on);
      n.classList.toggle('sel-many', on && selIds.size > 1);
    });
    if (!selId) return;
    const host = nodes.get(selId);
    if (!selNodeId || !host || selIds.size !== 1) return;
    const g = host.querySelector(`.fc-g[data-nid="${selNodeId}"]`);
    if (g) g.classList.add('sel');
    if (window.Tables) Tables.reapply();
  }

  /* ---------------- 选择框 ---------------- */
  function updateOverlay() {
    if (!overlay) return;
    const cellEditing = !!(window.Tables && Tables.isEditing());
    const ids = Array.from(selIds);

    // 多选：只画一个虚线包围盒 + 数量标签，不出缩放手柄
    if (ids.length > 1 && !editing && !cellEditing) {
      const wr = wrap.getBoundingClientRect();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      ids.forEach((id) => {
        const n = nodes.get(id);
        if (!n) return;
        const nr = n.getBoundingClientRect();
        l = Math.min(l, nr.left - wr.left);
        t = Math.min(t, nr.top - wr.top);
        r = Math.max(r, nr.right - wr.left);
        b = Math.max(b, nr.bottom - wr.top);
      });
      if (!isFinite(l)) { overlay.style.display = 'none'; overlay.innerHTML = ''; return; }
      const tagTop = b + 26 > wr.height ? Math.max(0, t - 22) : b + 6;
      overlay.style.display = 'block';
      overlay.innerHTML =
        `<div class="sel-box is-multi" style="left:${l}px;top:${t}px;width:${r - l}px;height:${b - t}px"></div>` +
        `<div class="sel-tag is-multi" style="left:${l}px;top:${tagTop}px">${ids.length} 个组件</div>`;
      return;
    }

    const n = selId && nodes.get(selId);
    if (!n || editing || cellEditing) { overlay.style.display = 'none'; overlay.innerHTML = ''; return; }
    const wr = wrap.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    const l = r.left - wr.left, t = r.top - wr.top, w = r.width, h = r.height;
    const type = (Store.el(selId) || {}).type;
    const dirs =
      type === 'group'
        ? []
        : type === 'image'
          ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
          : ['nw', 'ne', 'sw', 'se', 'e', 'w'];
    overlay.style.display = 'block';
    overlay.innerHTML =
      `<div class="sel-box" style="left:${l}px;top:${t}px;width:${w}px;height:${h}px"></div>` +
      `<div class="sel-tag" style="left:${l}px;top:${t + h + 6}px">${typeLabel(type)}</div>` +
      dirs
        .map((d) => `<div class="sel-h h-${d}" data-dir="${d}" style="${handlePos(d, l, t, w, h)}"></div>`)
        .join('');
  }

  function typeLabel(t) {
    if (window.ComponentRegistry && ComponentRegistry.get(t)) return ComponentRegistry.get(t).label;
    return { flowchart: '流程图', image: '图片', text: '文字', note: '标注', heading: '标题', table: '表格', state: '状态图' }[t] || '元素';
  }

  function handlePos(d, l, t, w, h) {
    const hs = 9;
    const cx = l + w / 2, cy = t + h / 2;
    const map = {
      nw: [l, t], n: [cx, t], ne: [l + w, t],
      w: [l, cy], e: [l + w, cy],
      sw: [l, t + h], s: [cx, t + h], se: [l + w, t + h],
    };
    const p = map[d];
    return `left:${p[0] - hs / 2}px;top:${p[1] - hs / 2}px`;
  }

  /* ---------------- 选择 ---------------- */
  // 统一入口：ids 为全部选中项，列表最后一个作为「主选」（右侧面板的定位基准）
  function applySelection(ids, nodeId) {
    if (editing) finishEdit();
    const list = [];
    (ids || []).forEach((id) => { if (id && list.indexOf(id) < 0) list.push(id); });
    selIds = new Set(list);
    selId = list.length ? list[list.length - 1] : null;
    selNodeId = nodeId || null;
    highlightNode();
    updateOverlay();
  }

  function select(id, nodeId) {
    if (!id) {
      if (!selIds.size && selNodeId == null) { updateOverlay(); return; }
      applySelection([], null);
      fire('select', null);
      return;
    }
    if (selIds.size === 1 && selId === id && selNodeId === (nodeId || null)) { updateOverlay(); return; }
    applySelection([id], nodeId);
    fire('select', selId);
  }

  function selectMany(ids) {
    applySelection(ids, null);
    fire('select', selId);
  }

  function toggleSelect(id) {
    const ids = Array.from(selIds);
    if (selIds.has(id)) applySelection(ids.filter((x) => x !== id), null);
    else applySelection(ids.concat(id), null);
    fire('select', selId);
  }

  function selectAll() {
    const ids = (Store.get().elements || []).map((e) => e.id);
    if (!ids.length) return;
    applySelection(ids, null);
    fire('select', selId);
  }

  // 一次删除所有选中组件（单事务，可一次撤销）
  function removeSelection() {
    if (!selIds.size) return;
    const ids = Array.from(selIds);
    Store.begin();
    const arr = Store.get().elements || [];
    ids.forEach((id) => {
      const i = arr.findIndex((e) => e.id === id);
      if (i >= 0) arr.splice(i, 1);
    });
    selIds = new Set();
    selId = null;
    selNodeId = null;
    Store.end('remove'); // 触发 app 统一重绘
  }

  function getSel() { return selId; }
  function getSelNode() { return selNodeId; }
  function getSelIds() { return Array.from(selIds); }

  /* ---------------- 拖拽 / 缩放 ---------------- */
  function bind() {
    wrap.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    wrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(ev.deltaY > 0 ? 0.92 : 1.08, ev.clientX, ev.clientY);
      } else {
        view.x -= ev.deltaX;
        view.y -= ev.deltaY;
        applyView();
      }
    }, { passive: false });

    wrap.addEventListener('dblclick', (ev) => {
      const cell = ev.target.closest && ev.target.closest('.tb-cell');
      const cellHost = cell && cell.closest('.el');
      if (cell && cellHost && window.Tables) {
        ev.preventDefault();
        Tables.editCell(cellHost, cell);
        return;
      }
      const ed = ev.target.closest && ev.target.closest('[data-edit]');
      const host = ev.target.closest && ev.target.closest('.el');
      if (ed && host) { startEdit(host, ed); return; }
      if (!host) return;
      const hostEl = Store.el(host.dataset.id) || {};
      if (hostEl.type === 'er' && window.EREditor) {
        EREditor.open(hostEl.id);
        return;
      }
      if (hostEl.type === 'image' && window.ImgEditor) {
        ImgEditor.open(hostEl.id);
      }
    });

    wrap.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('.el-edit, .fc-edit, .shot-edit, .tb-edit, .st-edit');
      if (editBtn) {
        const host = editBtn.closest('.el');
        if (host) openEditor(host.dataset.id);
        return;
      }
      const cell = ev.target.closest('.tb-cell');
      if (cell) {
        const host = cell.closest('.el');
        if (host && window.Tables && !Tables.isEditing()) {
          Tables.setActive(host.dataset.id, +cell.dataset.r, +cell.dataset.c);
        }
      }
    });

    wrap.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    wrap.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const compType = ev.dataTransfer && ev.dataTransfer.getData('application/x-nk-component');
      if (compType && window.ComponentRegistry && ComponentRegistry.has(compType)) {
        const p = s2w(ev.clientX, ev.clientY);
        addAt(compType, p.x, p.y);
        return;
      }
      const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) importImageFile(f, s2w(ev.clientX, ev.clientY));
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && !isTyping(ev.target)) {
        spaceDown = true;
        wrap.classList.add('space');
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') { spaceDown = false; wrap.classList.remove('space'); }
    });
  }

  /* 按组件类型打开对应的编辑窗口 */
  function openEditor(id) {
    const e = Store.el(id);
    if (!e) return;
    if (e.type === 'flowchart' && window.FlowEditor) return FlowEditor.open(id);
    if (e.type === 'er' && window.EREditor) return EREditor.open(id);
    if (e.type === 'image' && window.ImgEditor) return ImgEditor.open(id);
    if (e.type === 'table' && window.TableEditor) return TableEditor.open(id);
    if (e.type === 'state' && window.StateEditor) return StateEditor.open(id);
    if (window.CardEditor && CardEditor.can(e.type)) return CardEditor.open(id);
    if (window.AdvancedEditor && AdvancedEditor.can(e.type)) return AdvancedEditor.open(id);
    if ({ timeline: 1, cycle: 1, hierarchy: 1, matrix: 1, compare: 1, columns: 1, video: 1, semantic: 1, group: 1 }[e.type]) {
      if (window.Panels && Panels.focusProps) return Panels.focusProps(id);
    }
    if (window.TextEditor) return TextEditor.open(id);
  }

  const isTyping = (t) =>
    t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

  function onDown(ev) {
    if (ev.button === 1 || spaceDown) { // 中键 / 空格 → 平移
      ev.preventDefault();
      drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
      wrap.classList.add('grabbing');
      return;
    }
    if (ev.button !== 0) return;

    // 画布上的浮动界面（小地图、画布条等）不参与框选 / 拖动
    if (ev.target.closest('.minimap, .boardbar, .bb-panel, .bb-menu, .corner-hint')) return;

    if (ev.target.closest('.fc-edit, .shot-edit, .el-edit, .st-edit')) return; // 交给 click 打开编辑器

    const handle = ev.target.closest('.sel-h');
    if (handle) {
      ev.preventDefault();
      startResize(ev, handle.dataset.dir);
      return;
    }

    const host = ev.target.closest('.el');
    if (!host) {
      if (window.Tables) Tables.setActive(null, null, null, true);
      startMarquee(ev); // 左键拖空白处 = 框选多个组件
      return;
    }
    if (ev.target.isContentEditable && ev.target.closest('.el') === host) {
      return; // 正在编辑文字
    }
    if (ev.target.closest('video, .vid-player, .vid-gif')) {
      return; // 让播放控件接管，视频卡片通过标题 / 说明选中
    }

    const id = host.dataset.id;
    const nodeG = ev.target.closest('.fc-g');
    const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;

    // Ctrl / ⌘ / Shift + 点击：只增减选中项，不进入拖动
    if (additive) {
      ev.preventDefault();
      toggleSelect(id);
      return;
    }

    if (!selIds.has(id) || selIds.size === 1) {
      select(id, nodeG ? nodeG.dataset.nid : null);
    } else if (nodeG && nodeG.dataset.nid) {
      // 多选状态下点到卡片内部节点：只记录节点，不改多选
      selNodeId = nodeG.dataset.nid;
      highlightNode();
    }

    startMove(ev, Array.from(selIds));
    ev.preventDefault();
  }

  /* ---------------- 左键框选 ---------------- */
  function ensureMarquee() {
    if (marqueeEl) return marqueeEl;
    marqueeEl = U.h('div', { class: 'marquee-box' });
    wrap.appendChild(marqueeEl);
    return marqueeEl;
  }

  // 框选命中：与选框有交叠的组件都算选中（和 Figma / Miro 一致）
  function pickInRect(r) {
    const out = [];
    (Store.get().elements || []).forEach((e) => {
      const n = nodes.get(e.id);
      if (!n) return;
      const b = n.getBoundingClientRect();
      const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (ox > 3 && oy > 3) out.push(e.id);
    });
    return out;
  }

  function startMarquee(ev) {
    if (editing) finishEdit();
    const wr = wrap.getBoundingClientRect();
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    const base = additive ? Array.from(selIds) : [];
    if (!additive) {
      applySelection([], null);
      fire('select', null);
    }

    const box = ensureMarquee();
    const sx = ev.clientX, sy = ev.clientY;
    const ox = sx - wr.left, oy = sy - wr.top;
    let moved = false;
    let picked = base;

    wrap.classList.add('marquee');

    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      const cx = e.clientX - wr.left, cy = e.clientY - wr.top;
      if (!moved) {
        moved = true;
        box.style.display = 'block';
        if (window.Tables) Tables.setActive(null, null, null, true);
      }
      box.style.left = Math.min(ox, cx) + 'px';
      box.style.top = Math.min(oy, cy) + 'px';
      box.style.width = Math.abs(cx - ox) + 'px';
      box.style.height = Math.abs(cy - oy) + 'px';
      picked = base.concat(pickInRect({
        left: Math.min(sx, e.clientX), top: Math.min(sy, e.clientY),
        right: Math.max(sx, e.clientX), bottom: Math.max(sy, e.clientY),
      }));
      applySelection(picked, null);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      wrap.classList.remove('marquee');
      box.style.display = 'none';
      if (!moved) { updateOverlay(); return; } // 只是点了一下空白处
      applySelection(picked, null);
      fire('select', selId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }

  function startResize(ev, dir) {
    const e = Store.el(selId);
    if (!e || e.type === 'group') return;
    const r = nodes.get(selId).getBoundingClientRect();
    Store.begin();
    drag = {
      mode: 'resize', id: selId, dir,
      sx: ev.clientX, sy: ev.clientY,
      ex: e.x, ey: e.y, ew: e.w, eh: r.height / view.z,
      ratio: r.width / r.height,
      host: nodes.get(selId),
    };
  }

  function startMove(ev, ids) {
    const moveIds = window.Groups ? Groups.expand(ids) : (ids || []);
    const items = [];
    moveIds.forEach((id) => {
      const e = Store.el(id);
      if (!e) return;
      items.push({ id, x: e.x, y: e.y, n: nodes.get(id) });
    });
    if (!items.length) return;
    drag = { mode: 'move', items, sx: ev.clientX, sy: ev.clientY, moved: false };
  }

  function onMove(ev) {
    if (!drag) return;

    if (drag.mode === 'pan') {
      view.x = drag.vx + (ev.clientX - drag.sx);
      view.y = drag.vy + (ev.clientY - drag.sy);
      applyView();
      return;
    }

    const dx = (ev.clientX - drag.sx) / view.z;
    const dy = (ev.clientY - drag.sy) / view.z;

    if (drag.mode === 'move') {
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        Store.begin();
        drag.items.forEach((it) => { if (it.n) it.n.classList.add('moving'); });
      }
      drag.items.forEach((it) => {
        const e = Store.el(it.id);
        if (!e) return;
        e.x = Math.round(it.x + dx);
        e.y = Math.round(it.y + dy);
        if (it.n) {
          it.n.style.left = e.x + 'px';
          it.n.style.top = e.y + 'px';
        }
      });
      updateOverlay();
      drawMini();
      return;
    }

    if (drag.mode === 'resize') {
      const e = Store.el(drag.id);
      if (!e) return;
      const d = drag.dir;
      let x = drag.ex, y = drag.ey, w = drag.ew, h = drag.eh;
      const minW = e.type === 'flowchart' ? 320 : e.type === 'image' ? 180 : e.type === 'table' ? 300 : e.type === 'state' ? 320 : 220;
      if (d.indexOf('e') > -1) w = drag.ew + dx;
      if (d.indexOf('w') > -1) { w = drag.ew - dx; x = drag.ex + dx; }
      if (d.indexOf('s') > -1) h = drag.eh + dy;
      if (d.indexOf('n') > -1) { h = drag.eh - dy; y = drag.ey + dy; }
      if (w < minW) { if (d.indexOf('w') > -1) x = drag.ex + drag.ew - minW; w = minW; }
      if (e.type === 'image' && h < 120) h = 120;

      e.x = Math.round(x); e.y = Math.round(y); e.w = Math.round(w);
      drag.host.style.left = e.x + 'px';
      drag.host.style.top = e.y + 'px';
      drag.host.style.width = e.w + 'px';
      if (e.type === 'image') {
        e.h = Math.round(h);
        drag.host.style.height = e.h + 'px';
      }
      updateOverlay();
      drawMini();
    }
  }

  function onUp(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    wrap.classList.remove('grabbing');
    if (d.mode === 'move') {
      if (d.items) d.items.forEach((it) => { if (it.n) it.n.classList.remove('moving'); });
      if (d.moved) {
        if (window.Groups) Groups.syncAll();
        Store.end('layout');
      }
      return;
    }
    if (d.mode === 'resize') {
      Store.end('layout');
      if (d.id) rebuild(d.id);
      if (window.Groups) Groups.syncAll();
    }
  }

  /* ---------------- 内联编辑 ---------------- */
  function startEdit(host, node) {
    if (node.isContentEditable) return;
    const e = Store.el(host.dataset.id);
    if (!e) return;
    editing = {
      host, node, id: e.id, field: node.dataset.edit,
      index: node.dataset.index == null ? null : +node.dataset.index,
      coll: node.dataset.coll || null,
      obj: node.dataset.obj || null,
    };
    const plain = editing.field !== 'html';
    // 纯文本字段：用 textContent，避免把 <br> 等当作内容
    node.contentEditable = 'true';
    node.classList.add('editing');
    node.spellcheck = false;
    node.focus();
    node.addEventListener('paste', U.pastePlain);
    if (!(node.innerText || '').trim()) {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }

    node.addEventListener('blur', onBlur, { once: true });
    node.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) || ev.key === 'Escape') {
        ev.preventDefault();
        node.blur();
      }
      if (plain && ev.key === 'Enter') { ev.preventDefault(); node.blur(); }
      ev.stopPropagation();
    });
    node.addEventListener('keyup', (ev) => ev.stopPropagation());
    updateOverlay();
  }

  function onBlur() {
    finishEdit();
  }

  function finishEdit() {
    if (!editing) return;
    const { node, id, field, host, index, coll, obj } = editing;
    editing = null;
    const e = Store.el(id);
    if (!e) return;
    node.contentEditable = 'false';
    node.classList.remove('editing');
    node.removeEventListener('paste', U.pastePlain);

    let val;
    if (field === 'html') val = sanitize(node.innerHTML);
    else val = (node.innerText || '').replace(/\s+\n/g, '\n').trim();

    Store.begin();
    if (field === '__list') {
      if (!Array.isArray(e.items)) e.items = [];
      if (index != null) e.items[index] = val;
    } else if (coll && index != null) {
      const arr = Array.isArray(e[coll]) ? e[coll] : (e[coll] = []);
      if (arr[index]) arr[index][field] = val;
    } else if (obj && e[obj]) {
      e[obj][field] = val;
    } else {
      e[field] = val;
    }
    Store.end('edit');
    // 文字变化可能改变自动高度；所有组件都重建一次，分组边界也随内容适配
    rebuild(id);
    if (window.Groups) Groups.syncAll();
  }

  function sanitize(html) {
    const t = document.createElement('div');
    t.innerHTML = html;
    t.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    t.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => {
        if (/^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value))) n.removeAttribute(a.name);
      });
    });
    return t.innerHTML;
  }

  /* ---------------- 小地图 ---------------- */
  function drawMini() {
    if (!mini) return;
    const dpr = window.devicePixelRatio || 1;
    const W = mini.clientWidth, H = mini.clientHeight;
    if (!W) return;
    if (mini.width !== W * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const ctx = mini.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const b = contentBounds();
    const pad = 14;
    const z = Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h);
    const ox = pad + ((W - pad * 2) - b.w * z) / 2;
    const oy = pad + ((H - pad * 2) - b.h * z) / 2;
    const map = (x, y) => [ox + (x - b.x) * z, oy + (y - b.y) * z];

    const colors = { flowchart: '#8E76E8', image: '#F08CB4', text: '#B7B2C9', note: '#E9B45E', heading: '#6E5BC0', table: '#6FA8DC', state: '#5FBFA8' };
    nodes.forEach((n, id) => {
      const e = Store.el(id); if (!e) return;
      const [x, y] = map(e.x, e.y);
      const w = Math.max(n.offsetWidth * z, 2), h = Math.max(n.offsetHeight * z, 2);
      ctx.fillStyle = colors[e.type] || '#ccc';
      ctx.globalAlpha = selIds.has(id) ? 0.95 : 0.5;
      if (e.type === 'heading') { ctx.fillRect(x, y, w, Math.min(h, 10)); }
      else ctx.fillRect(x, y, w, h);
    });
    ctx.globalAlpha = 1;

    const tl = s2w(wrap.getBoundingClientRect().left + 1, wrap.getBoundingClientRect().top + 1);
    const br = s2w(wrap.getBoundingClientRect().right - 1, wrap.getBoundingClientRect().bottom - 1);
    const [vx, vy] = map(tl.x, tl.y);
    ctx.strokeStyle = 'rgba(124,92,255,.85)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(vx, vy, (br.x - tl.x) * z, (br.y - tl.y) * z);
    ctx.fillStyle = 'rgba(124,92,255,.06)';
    ctx.fillRect(vx, vy, (br.x - tl.x) * z, (br.y - tl.y) * z);

    mini._map = { b, z, ox, oy, map };
  }

  function miniJump(ev) {
    const rect = mini.getBoundingClientRect();
    const m = mini._map;
    if (!m) return;
    const wx = (ev.clientX - rect.left - m.ox) / m.z + m.b.x;
    const wy = (ev.clientY - rect.top - m.oy) / m.z + m.b.y;
    const r = wrap.getBoundingClientRect();
    view.x = r.width / 2 - wx * view.z;
    view.y = r.height / 2 - wy * view.z;
    applyView();
  }

  /* ---------------- 新增元素 ---------------- */
  function defaults(type, x, y) {
    if (window.ComponentRegistry && ComponentRegistry.has(type)) return ComponentRegistry.create(type, x, y);
    return { id: U.uid(type), type: 'text', x, y, w: 480, html: '<p>新组件</p>' };
  }

  function addAt(type, wx, wy) {
    const e = defaults(type, Math.round(wx), Math.round(wy));
    Store.add(e);
    if (type === 'group') Store.update(e.id, { z: 0 }, true);
    renderAll();
    select(e.id);
    if (type === 'text' || type === 'note') {
      const n = nodes.get(e.id);
      const ed = n && n.querySelector('[data-edit="html"]');
      if (ed) setTimeout(() => startEdit(n, ed), 30);
    }
    return e;
  }

  function addAtCenter(type) {
    const r = wrap.getBoundingClientRect();
    const c = s2w(r.left + r.width / 2, r.top + r.height / 2);
    const meta = (window.ComponentRegistry && ComponentRegistry.get(type)) || {};
    const w = meta.w || 240;
    const h = meta.h || ({ heading: 110, text: 220, note: 160, image: 340, flowchart: 360, state: 420, table: 300, list: 190, quote: 170, divider: 80, metric: 120, rating: 110, source: 130 }[type] || 160);
    // 先按组件真实尺寸算中心，再从中心向外找一个不压住已有组件的空位
    const baseX = Math.round(c.x - w / 2), baseY = Math.round(c.y - h / 2);
    const boxes = [...nodes.values()].map((n) => ({
      x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0,
      w: n.offsetWidth || 0, h: n.offsetHeight || 0,
    }));
    const tries = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, 2], [-1, 2], [1, 3], [-1, 3], [0, -1]];
    let x = baseX, y = baseY;
    for (const [dx, dy] of tries) {
      x = baseX + dx * (w + 24);
      y = baseY + dy * (h + 24);
      const hit = boxes.some((b) => x < b.x + b.w + 14 && x + w > b.x - 14 && y < b.y + b.h + 14 && y + h > b.y - 14);
      if (!hit) break;
    }
    return addAt(type, x, y);
  }

  function importImageFile(file, at) {
    const reader = new FileReader();
    reader.onload = () => {
      const r = wrap.getBoundingClientRect();
      const p = at || s2w(r.left + r.width / 2, r.top + r.height / 2);
      const img = new Image();
      img.onload = () => {
        const maxW = 620;
        const w = Math.min(maxW, img.width);
        const h = Math.round((img.height / img.width) * w) + 96;
        const e = {
          id: U.uid('im'), type: 'image',
          x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2),
          w: Math.round(w), h, src: reader.result, fit: 'contain', zoom: 1, ox: 0, oy: 0,
          radius: 14, shadow: true, title: file.name.replace(/\.[^.]+$/, ''), caption: '', marks: [],
        };
        Store.add(e);
        renderAll();
        select(e.id);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function setImageSrc(id, dataUrl) {
    Store.begin();
    const e = Store.el(id);
    if (!e) return;
    e.src = dataUrl;
    Store.end('src');
    rebuild(id);
  }

  /* ---------------- 键盘 ---------------- */
  function bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (isTyping(ev.target)) return;
      const meta = ev.ctrlKey || ev.metaKey;
      const id = selId;

      if (meta && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) Store.redo(); else Store.undo();
        return;
      }
      if (meta && ev.key.toLowerCase() === 'y') { ev.preventDefault(); Store.redo(); return; }
      if (meta && ev.key.toLowerCase() === 'a') {
        ev.preventDefault();
        if (selIds.size) selectAll();
        return;
      }
      if (meta && ev.key.toLowerCase() === 'd' && id) {
        ev.preventDefault();
        const c = Store.duplicate(id);
        renderAll();
        if (c) select(c.id);
        return;
      }
      if (meta && ev.key.toLowerCase() === 'c' && id) {
        clipboard = JSON.stringify(Store.el(id));
        U.toast('已复制组件');
        return;
      }
      if (meta && ev.key.toLowerCase() === 'v') {
        if (clipboard) {
          const copy = JSON.parse(clipboard);
          copy.id = U.uid(copy.type);
          copy.x += 32; copy.y += 32;
          if (copy.type === 'flowchart' && copy.nodes) {
            const map = {};
            copy.nodes.forEach((n) => (map[n.id] = U.uid('n')));
            copy.nodes.forEach((n) => {
              n.id = map[n.id];
              if (n.parentId) n.parentId = map[n.parentId] || null;
            });
          }
          Store.add(copy);
          renderAll();
          select(copy.id);
        }
        return;
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selIds.size) {
        ev.preventDefault();
        if (selNodeId && selIds.size === 1) { Panels.deleteNode(); return; }
        removeSelection();
        return;
      }
      if (ev.key === 'Escape') { select(null); fire('edit', 'escape'); return; }
      if (selIds.size && /^Arrow/.test(ev.key)) {
        ev.preventDefault();
        const step = ev.shiftKey ? 40 : 4;
        Store.begin();
        selIds.forEach((sid) => {
          const e = Store.el(sid);
          if (!e) return;
          if (ev.key === 'ArrowLeft') e.x -= step;
          if (ev.key === 'ArrowRight') e.x += step;
          if (ev.key === 'ArrowUp') e.y -= step;
          if (ev.key === 'ArrowDown') e.y += step;
          const n = nodes.get(sid);
          if (n) { n.style.left = e.x + 'px'; n.style.top = e.y + 'px'; }
        });
        Store.end('nudge');
        updateOverlay();
        drawMini();
      }
    });
  }

  return {
    init, on, applyView, fit, home, zoomBy, focus, select, selectMany, getSel, getSelNode, getSelIds,
    selectAll, removeSelection, toggleSelect,
    renderAll, rebuild, updateOverlay, addAt, addAtCenter, setImageSrc, importImageFile, openEditor,
    bindKeys, miniJump, contentBounds,
    get view() { return view; },
    startEditById(id) {
      const n = nodes.get(id); if (!n) return;
      const ed = n.querySelector('[data-edit="html"]') || n.querySelector('[data-edit="text"]');
      if (ed) startEdit(n, ed);
    },
  };
})();
