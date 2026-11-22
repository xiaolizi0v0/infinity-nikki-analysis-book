/* ------------------------------------------------------------------
 *  canvas.js — 无限画布：平移 / 缩放 / 选择 / 拖拽 / 缩放元素 / 编辑 / 小地图
 * ------------------------------------------------------------------ */
window.Canvas = (function () {
  let wrap, world, grid, overlay, mini;
  let nodes = new Map();
  let selId = null;
  let selNodeId = null;
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
    });
    if (selId && !nodes.has(selId)) { selId = null; selNodeId = null; }
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
    if (e.type === 'flowchart') {
      const svg = n.querySelector('svg');
      if (svg) {
        const natural = parseFloat(svg.getAttribute('width')) + 60;
        if (e.w < natural) { e.w = Math.round(natural); n.style.width = e.w + 'px'; }
      }
    }
    highlightNode();
    updateOverlay();
    drawMini();
  }

  function highlightNode() {
    U.$$('.fc-g.sel', world).forEach((g) => g.classList.remove('sel'));
    U.$$('.el.sel', world).forEach((n) => n.classList.remove('sel'));
    if (!selId) return;
    const host = nodes.get(selId);
    if (host) host.classList.add('sel');
    if (!selNodeId || !host) return;
    const g = host.querySelector(`.fc-g[data-nid="${selNodeId}"]`);
    if (g) g.classList.add('sel');
    if (window.Tables) Tables.reapply();
  }

  /* ---------------- 选择框 ---------------- */
  function updateOverlay() {
    const n = selId && nodes.get(selId);
    const cellEditing = !!(window.Tables && Tables.isEditing());
    if (!n || editing || cellEditing) { overlay.style.display = 'none'; overlay.innerHTML = ''; return; }
    const wr = wrap.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    const l = r.left - wr.left, t = r.top - wr.top, w = r.width, h = r.height;
    const type = (Store.el(selId) || {}).type;
    const dirs =
      type === 'image'
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
    return { flowchart: '流程图', image: '图片', text: '文字', note: '标注', heading: '标题', table: '表格' }[t] || '元素';
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
  function select(id, nodeId) {
    if (selId === id && selNodeId === nodeId) { updateOverlay(); return; }
    if (editing) finishEdit();
    selId = id || null;
    selNodeId = nodeId || null;
    highlightNode();
    updateOverlay();
    fire('select', selId);
  }
  function getSel() { return selId; }
  function getSelNode() { return selNodeId; }

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
      if ((Store.el(host.dataset.id) || {}).type === 'image' && window.ImgEditor) {
        ImgEditor.open(host.dataset.id);
      }
    });

    wrap.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('.el-edit, .fc-edit, .shot-edit, .tb-edit');
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
    if (e.type === 'image' && window.ImgEditor) return ImgEditor.open(id);
    if (e.type === 'table' && window.TableEditor) return TableEditor.open(id);
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

    if (ev.target.closest('.fc-edit, .shot-edit, .el-edit')) return; // 交给 click 打开编辑器

    const handle = ev.target.closest('.sel-h');
    if (handle) {
      ev.preventDefault();
      startResize(ev, handle.dataset.dir);
      return;
    }

    const host = ev.target.closest('.el');
    if (!host) {
      select(null);
      if (window.Tables) Tables.setActive(null, null, null, true);
      drag = { mode: 'marquee-ignore', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
      return;
    }
    if (ev.target.isContentEditable && ev.target.closest('.el') === host) {
      return; // 正在编辑文字
    }

    const id = host.dataset.id;
    const nodeG = ev.target.closest('.fc-g');
    select(id, nodeG ? nodeG.dataset.nid : null);

    const e = Store.el(id);
    if (!e) return;
    Store.begin();
    drag = {
      mode: 'move', id, sx: ev.clientX, sy: ev.clientY,
      ex: e.x, ey: e.y, moved: false, host,
    };
    ev.preventDefault();
  }

  function startResize(ev, dir) {
    const e = Store.el(selId);
    if (!e) return;
    const r = nodes.get(selId).getBoundingClientRect();
    Store.begin();
    drag = {
      mode: 'resize', id: selId, dir,
      sx: ev.clientX, sy: ev.clientY,
      ex: e.x, ey: e.y, ew: e.w, eh: r.height / view.z,
      ratio: r.width / r.height,
    };
  }

  function onMove(ev) {
    if (!drag) return;

    if (drag.mode === 'pan') {
      view.x = drag.vx + (ev.clientX - drag.sx);
      view.y = drag.vy + (ev.clientY - drag.sy);
      applyView();
      return;
    }
    if (drag.mode === 'marquee-ignore') {
      if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4) drag.mode = 'pan';
      return;
    }

    const dx = (ev.clientX - drag.sx) / view.z;
    const dy = (ev.clientY - drag.sy) / view.z;

    if (drag.mode === 'move') {
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const e = Store.el(drag.id);
      if (!e) return;
      const nx = Math.round(drag.ex + dx);
      const ny = Math.round(drag.ey + dy);
      e.x = nx; e.y = ny;
      drag.host.style.left = nx + 'px';
      drag.host.style.top = ny + 'px';
      updateOverlay();
      drawMini();
      return;
    }

    if (drag.mode === 'resize') {
      const e = Store.el(drag.id);
      if (!e) return;
      const d = drag.dir;
      let x = drag.ex, y = drag.ey, w = drag.ew, h = drag.eh;
      const minW = e.type === 'flowchart' ? 320 : e.type === 'image' ? 180 : e.type === 'table' ? 300 : 220;
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
    if (d.mode === 'move' || d.mode === 'resize') {
      Store.end('layout');
      if (d.mode === 'resize' && d.id) rebuild(d.id);
    }
  }

  /* ---------------- 内联编辑 ---------------- */
  function startEdit(host, node) {
    if (node.isContentEditable) return;
    const e = Store.el(host.dataset.id);
    if (!e) return;
    editing = { host, node, id: e.id, field: node.dataset.edit };
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
    const { node, id, field, host } = editing;
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
    e[field] = val;
    Store.end('edit');
    if (field === 'html' || field === 'text' || field === 'title') {
      // 内容可能改变高度 / 需要重排
      rebuild(id);
    }
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

    const colors = { flowchart: '#8E76E8', image: '#F08CB4', text: '#B7B2C9', note: '#E9B45E', heading: '#6E5BC0', table: '#6FA8DC' };
    nodes.forEach((n, id) => {
      const e = Store.el(id); if (!e) return;
      const [x, y] = map(e.x, e.y);
      const w = Math.max(n.offsetWidth * z, 2), h = Math.max(n.offsetHeight * z, 2);
      ctx.fillStyle = colors[e.type] || '#ccc';
      ctx.globalAlpha = id === selId ? 0.95 : 0.5;
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
    const id = U.uid(type);
    switch (type) {
      case 'heading':
        return { id, type, x, y, w: 720, level: 2, kicker: 'NEW / 小节', text: '新的小节标题' };
      case 'text':
        return { id, type, x, y, w: 560, html: '<p>在这里写下你的拆解……</p>', variant: 'body' };
      case 'note':
        return { id, type, x, y, w: 420, tone: 'idea', title: '标注标题', html: '<p>要点说明。</p>' };
      case 'image':
        return {
          id, type, x, y, w: 560, h: 340, src: '', fit: 'contain', zoom: 1, ox: 0, oy: 0,
          radius: 14, shadow: true, title: '截图', caption: '补充说明', marks: [],
        };
      case 'flowchart':
        return { id, type, x, y, w: 520, title: '新流程图', nodes: FC.blank().nodes };
      case 'table': {
        const base = window.Tables ? Tables.blank() : { rows: [['维度', '表现', '判断'], ['', '', ''], ['', '', '']] };
        return Object.assign(
          { id, type, x, y, w: 620, title: '新表格', caption: '' },
          base
        );
      }
      default:
        return { id, type: 'text', x, y, w: 480, html: '<p>新组件</p>' };
    }
  }

  function addAtCenter(type) {
    const r = wrap.getBoundingClientRect();
    const c = s2w(r.left + r.width / 2, r.top + r.height / 2);
    let x = Math.round(c.x - 240), y = Math.round(c.y - 160);
    // 避让：若与已有元素重叠，向下偏移
    for (let i = 0; i < 12; i++) {
      const hit = [...nodes.values()].some((n) => {
        const nx = parseFloat(n.style.left), ny = parseFloat(n.style.top);
        return Math.abs(nx - x) < 40 && Math.abs(ny - y) < 40;
      });
      if (!hit) break;
      y += 60;
    }
    const e = defaults(type, x, y);
    Store.add(e);
    renderAll();
    select(e.id);
    if (type === 'text' || type === 'note') {
      const n = nodes.get(e.id);
      const ed = n && n.querySelector('[data-edit="html"]');
      if (ed) setTimeout(() => startEdit(n, ed), 30);
    }
    return e;
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
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && id) {
        ev.preventDefault();
        if (selNodeId) { Panels.deleteNode(); return; }
        Store.remove(id);
        renderAll();
        select(null);
        return;
      }
      if (ev.key === 'Escape') { select(null); fire('edit', 'escape'); return; }
      if (id && /^Arrow/.test(ev.key)) {
        const e = Store.el(id); if (!e) return;
        ev.preventDefault();
        const step = ev.shiftKey ? 40 : 4;
        Store.begin();
        if (ev.key === 'ArrowLeft') e.x -= step;
        if (ev.key === 'ArrowRight') e.x += step;
        if (ev.key === 'ArrowUp') e.y -= step;
        if (ev.key === 'ArrowDown') e.y += step;
        Store.end('nudge');
        const n = nodes.get(id);
        if (n) { n.style.left = e.x + 'px'; n.style.top = e.y + 'px'; }
        updateOverlay();
      }
    });
  }

  return {
    init, on, applyView, fit, home, zoomBy, focus, select, getSel, getSelNode,
    renderAll, rebuild, updateOverlay, addAtCenter, setImageSrc, importImageFile, openEditor,
    bindKeys, miniJump, contentBounds,
    get view() { return view; },
    startEditById(id) {
      const n = nodes.get(id); if (!n) return;
      const ed = n.querySelector('[data-edit="html"]') || n.querySelector('[data-edit="text"]');
      if (ed) startEdit(n, ed);
    },
  };
})();
