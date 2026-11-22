/* ------------------------------------------------------------------
 *  floweditor.js — 流程图可视化编辑器（draw.io 风格）
 *  · 拖拽节点自由摆放（写回 node.px / node.py）
 *  · 从节点四边锚点拖到另一个节点 = 建立 / 修改连线
 *  · 双击节点改文字；选中连线改分支标签
 *  · 自动布局 / 适应窗口 / 撤销 / 完成
 * ------------------------------------------------------------------ */
window.FlowEditor = (function () {
  let el = null;
  let elId = null;
  let overlay = null;
  let canvasEl = null;
  let worldEl = null;
  let svgEl = null;
  let layoutData = null;
  let view = { x: 0, y: 0, z: 1 };
  let sel = null; // {type:'node'|'edge', id}
  let inlineInput = null;
  let lastVB = null;
  let liveTimer = null;

  const E = U.esc;

  /* ---------------- 打开 / 关闭 ---------------- */
  function open(id) {
    if (overlay) return;
    elId = id;
    el = Store.el(id);
    if (!el || el.type !== 'flowchart') return;
    sel = el.nodes[0] ? { type: 'node', id: el.nodes[0].id } : null;
    buildDom();
    document.body.appendChild(overlay);
    document.body.classList.add('fe-open');
    render();
    bind();
    setTimeout(fit, 40);
  }

  function close() {
    commitInline();
    if (overlay) overlay.remove();
    overlay = null;
    document.body.classList.remove('fe-open');
    unbind();
    if (elId) {
      Canvas.rebuild(elId);
      Canvas.select(elId);
    }
    el = null;
    elId = null;
    layoutData = null;
    sel = null;
  }

  /* ---------------- DOM ---------------- */
  function buildDom() {
    overlay = document.createElement('div');
    overlay.className = 'fe';
    overlay.innerHTML = `
      <div class="fe-panel">
        <header class="fe-head">
          <span class="fc-chip">编辑流程图</span>
          <input class="fe-title" id="fe-title" value="${E(el.title || '流程图')}" spellcheck="false">
          <span class="fe-count">${el.nodes.length} 节点</span>
          <div class="fe-tools">
            <button class="fe-btn" data-act="auto" title="按层级重新排版">自动布局</button>
            <button class="fe-btn" data-act="fit" title="适应窗口">适应</button>
            <button class="fe-btn ghost" data-act="undo" title="撤销 Ctrl+Z">撤销</button>
            <button class="fe-btn primary" data-act="done">完成</button>
          </div>
        </header>
        <div class="fe-body">
          <aside class="fe-left">
            <div class="fe-sec-t">添加节点</div>
            <div class="fe-addgrid">
              <button class="fe-add" data-add="start"><i class="nd start"></i>开始</button>
              <button class="fe-add" data-add="process"><i class="nd process"></i>处理</button>
              <button class="fe-add" data-add="decision"><i class="nd decision"></i>判断</button>
              <button class="fe-add" data-add="end"><i class="nd end"></i>结束</button>
            </div>
            <div class="fe-sec-t">选中项</div>
            <div id="fe-prop" class="fe-prop"></div>
            <div class="fe-hint">
              <div><b>拖动</b>节点自由摆放</div>
              <div><b>锚点</b>拖到别的节点＝连线</div>
              <div><b>双击</b>节点改文字</div>
              <div><b>Delete</b>删除节点 / 连线</div>
            </div>
          </aside>
          <div class="fe-canvas" id="fe-canvas">
            <div class="fe-world" id="fe-world"></div>
            <div class="fe-zoombar">
              <button data-act="zoom-out">−</button>
              <span id="fe-zoom">100%</span>
              <button data-act="zoom-in">＋</button>
            </div>
          </div>
        </div>
      </div>`;

    canvasEl = overlay.querySelector('#fe-canvas');
    worldEl = overlay.querySelector('#fe-world');
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('pointerdown', onPointerDown, true);

    const titleEl = overlay.querySelector('#fe-title');
    titleEl.addEventListener('input', () => {
      Store.begin();
      el.title = titleEl.value;
      enqueueEnd('flow-title');
    });
    titleEl.addEventListener('blur', () => flushEnd());
  }

  /* ---------------- 事务（输入过程中合并成一条历史） ---------------- */
  let endTimer = null;
  function enqueueEnd(reason) {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => Store.end(reason), 450);
  }
  function flushEnd() {
    clearTimeout(endTimer);
    Store.end('flow-edit');
  }

  /* ---------------- 渲染 ---------------- */
  function renderSvg(keep) {
    const prev = keep && lastVB ? { x: lastVB.x, y: lastVB.y } : null;
    layoutData = FC.layout({ nodes: el.nodes });
    const r = FC.svg({ nodes: el.nodes }, {
      uid: 'fe' + String(el.id).replace(/[^a-z0-9]/gi, ''),
      interactive: true,
      selNode: sel && sel.type === 'node' ? sel.id : null,
      selEdge: sel && sel.type === 'edge' ? sel.id : null,
    });
    worldEl.innerHTML = r.html;
    svgEl = worldEl.querySelector('svg');
    const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    lastVB = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    if (prev && !isNaN(prev.x) && (prev.x !== vb[0] || prev.y !== vb[1])) {
      view.x -= (prev.x - vb[0]) * view.z;
      view.y -= (prev.y - vb[1]) * view.z;
      applyView();
    }
    const cnt = overlay.querySelector('.fe-count');
    if (cnt) cnt.textContent = el.nodes.length + ' 节点';
  }

  function render(keep) {
    renderSvg(keep);
    renderProp();
  }

  function applyView() {
    if (!worldEl) return;
    worldEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const zl = overlay.querySelector('#fe-zoom');
    if (zl) zl.textContent = Math.round(view.z * 100) + '%';
  }

  function fit() {
    if (!svgEl || !canvasEl) return;
    const cw = canvasEl.clientWidth, ch = canvasEl.clientHeight;
    if (!cw) return;
    const w = Number(svgEl.getAttribute('width')) || 400;
    const h = Number(svgEl.getAttribute('height')) || 300;
    const z = U.clamp(Math.min((cw - 80) / w, (ch - 90) / h), 0.22, 1.5);
    view.z = z;
    view.x = (cw - w * z) / 2;
    view.y = (ch - h * z) / 2;
    applyView();
  }

  function zoomBy(f, cx, cy) {
    const r = canvasEl.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const nz = U.clamp(view.z * f, 0.2, 2.4);
    const k = nz / view.z;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.z = nz;
    applyView();
  }

  function toWorld(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }

  /* ---------------- 属性面板 ---------------- */
  function renderProp() {
    const box = overlay.querySelector('#fe-prop');
    if (!box) return;

    if (!sel) {
      box.innerHTML = '<div class="fe-empty">点击画布中的节点或连线</div>';
      return;
    }

    if (sel.type === 'edge') {
      const childId = sel.id.split('->')[1];
      const child = el.nodes.find((n) => n.id === childId);
      const parent = child ? el.nodes.find((n) => n.id === child.parentId) : null;
      if (!child) { box.innerHTML = '<div class="fe-empty">连线已失效</div>'; return; }
      box.innerHTML = `
        <div class="fe-row"><span>连线</span><b>${E(parent ? parent.text : '')} → ${E(child.text)}</b></div>
        <label class="fe-f"><span>分支标签</span>
          <input class="fe-ipt" id="fe-edge-label" value="${E(child.label || '')}" placeholder="是 / 否 / 条件"></label>
        <button class="fe-btn danger wide" data-act="del-edge">删除连线</button>`;
      const inp = box.querySelector('#fe-edge-label');
      inp.addEventListener('focus', () => Store.begin());
      inp.addEventListener('input', () => {
        child.label = inp.value;
        enqueueEnd('flow-edge');
        const t = worldEl.querySelector(`.fc-edge-g[data-eid="${sel.id}"] .fc-elabel`);
        if (t) t.textContent = child.label;
        else renderSvg(true);
      });
      inp.addEventListener('blur', flushEnd);
      return;
    }

    const node = el.nodes.find((n) => n.id === sel.id);
    if (!node) { box.innerHTML = '<div class="fe-empty">节点已失效</div>'; return; }
    const parent = el.nodes.find((n) => n.id === node.parentId);
    box.innerHTML = `
      <label class="fe-f"><span>节点文字</span>
        <textarea class="fe-ipt ta" id="fe-text" rows="3">${E(node.text || '')}</textarea></label>
      <label class="fe-f"><span>节点类型</span>
        <select class="fe-ipt" id="fe-kind">
          ${[['start', '开始'], ['process', '处理'], ['decision', '判断'], ['end', '结束']]
            .map(([v, t]) => `<option value="${v}" ${node.kind === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
      ${parent ? `<label class="fe-f"><span>分支标签（来自上一节点）</span>
        <input class="fe-ipt" id="fe-label" value="${E(node.label || '')}" placeholder="是 / 否"></label>` : ''}
      <div class="fe-row"><span>上游</span><b>${parent ? E(parent.text || '') : '根节点'}</b></div>
      <button class="fe-btn danger wide" data-act="del-node">删除节点（含子节点）</button>`;

    const txt = box.querySelector('#fe-text');
    txt.addEventListener('focus', () => Store.begin());
    txt.addEventListener('input', () => {
      node.text = txt.value;
      enqueueEnd('flow-node');
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => renderSvg(true), 140); // 只重绘画布，不打断输入
    });
    txt.addEventListener('blur', flushEnd);

    const kind = box.querySelector('#fe-kind');
    kind.addEventListener('change', () => {
      Store.begin();
      node.kind = kind.value;
      Store.end('flow-kind');
      render(true);
    });

    const lb = box.querySelector('#fe-label');
    if (lb) {
      lb.addEventListener('focus', () => Store.begin());
      lb.addEventListener('input', () => {
        node.label = lb.value;
        enqueueEnd('flow-label');
      });
      lb.addEventListener('blur', flushEnd);
    }
  }

  /* ---------------- 选择 ---------------- */
  function select(type, id) {
    sel = type ? { type, id } : null;
    Array.from(worldEl.querySelectorAll('.fc-g.sel')).forEach((n) => n.classList.remove('sel'));
    Array.from(worldEl.querySelectorAll('.fc-edge-g.is-sel')).forEach((n) => n.classList.remove('is-sel'));
    if (sel) {
      const t = sel.type === 'node'
        ? worldEl.querySelector(`.fc-g[data-nid="${sel.id}"]`)
        : worldEl.querySelector(`.fc-edge-g[data-eid="${sel.id}"]`);
      if (t) t.classList.add(sel.type === 'node' ? 'sel' : 'is-sel');
    }
    renderProp();
  }

  /* ---------------- 指针交互 ---------------- */
  function onPointerDown(ev) {
    if (ev.button === 1) { startPan(ev); return; }
    if (ev.button !== 0) return;
    if (!ev.target.closest('.fe-canvas')) return;

    const btn = ev.target.closest('[data-act]');
    if (btn) return; // 交给 click

    const anchor = ev.target.closest('.fc-anchor');
    if (anchor) { startConnect(anchor.dataset.nid, anchor.dataset.anchor, ev); return; }

    const g = ev.target.closest('.fc-g');
    if (g) { select('node', g.dataset.nid); startDrag(g, ev); return; }

    const eg = ev.target.closest('.fc-edge-g');
    if (eg) { select('edge', eg.dataset.eid); return; }

    select(null);
    startPan(ev);
  }

  function startPan(ev) {
    const sx = ev.clientX, sy = ev.clientY, vx = view.x, vy = view.y;
    canvasEl.classList.add('grabbing');
    const move = (e) => {
      view.x = vx + (e.clientX - sx);
      view.y = vy + (e.clientY - sy);
      applyView();
    };
    const up = () => {
      canvasEl.classList.remove('grabbing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }

  function startDrag(g, ev) {
    if (inlineInput) commitInline();
    const nid = g.dataset.nid;
    const node = el.nodes.find((n) => n.id === nid);
    const geo = layoutData.geo[nid];
    if (!node || !geo) return;
    const sx = ev.clientX, sy = ev.clientY;
    const ox = geo.x, oy = geo.y;
    let moved = false;

    const move = (e) => {
      const dx = (e.clientX - sx) / view.z;
      const dy = (e.clientY - sy) / view.z;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!moved) {
        moved = true;
        Store.begin();          // 先拍快照，才能撤销这次移动
        g.classList.add('dragging');
      }
      node.px = Math.round(ox + dx);
      node.py = Math.round(oy + dy);
      geo.x = node.px;
      geo.y = node.py;
      g.setAttribute('transform', `translate(${node.px - ox},${node.py - oy})`);
      refreshEdges(nid);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      g.classList.remove('dragging');
      if (moved) {
        Store.end('flow-move');
        renderSvg(true);   // 重算包围盒，保持视觉位置
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }

  // 拖动中即时更新相关连线
  function refreshEdges(nid) {
    layoutData.edges.forEach((e) => {
      if (e.from !== nid && e.to !== nid) return;
      const p = layoutData.geo[e.from], c = layoutData.geo[e.to];
      if (!p || !c) return;
      const pair = FC.anchors(p, c);
      const d = pair.dir === 'v'
        ? U.elbow(pair.x1, pair.y1, pair.x2, pair.y2, 12)
        : FC.elbowH(pair.x1, pair.y1, pair.x2, pair.y2, 12);
      const g = worldEl.querySelector(`.fc-edge-g[data-eid="${e.id}"]`);
      if (!g) return;
      g.querySelectorAll('path').forEach((pth) => pth.setAttribute('d', d));
      const lbl = g.querySelector('.fc-elabel');
      if (lbl) {
        lbl.setAttribute('x', pair.lx);
        lbl.setAttribute('y', pair.ly);
        lbl.setAttribute('text-anchor', pair.anchor);
      }
    });
  }

  /* ---------- 锚点连线 ---------- */
  function startConnect(fromId, pos, ev) {
    const fromGeo = layoutData.geo[fromId];
    if (!fromGeo) return;
    const layer = svgEl.querySelector('.fc-edges');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'fc-edge fc-temp');
    layer.appendChild(path);

    const sx = pos === 'l' ? fromGeo.x : pos === 'r' ? fromGeo.x + fromGeo.w : fromGeo.x + fromGeo.w / 2;
    const sy = pos === 't' ? fromGeo.y : pos === 'b' ? fromGeo.y + fromGeo.h : fromGeo.y + fromGeo.h / 2;

    const move = (e) => {
      const p = toWorld(e.clientX, e.clientY);
      path.setAttribute('d', U.elbow(sx, sy, p.x, p.y, 10));
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      path.remove();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const g = hit && hit.closest ? hit.closest('.fc-g') : null;
      if (!g) return;
      const toId = g.dataset.nid;
      if (toId === fromId) return;
      const child = el.nodes.find((n) => n.id === toId);
      if (!child) return;
      if (isAncestor(child.id, fromId)) { U.toast('不能连成环：目标在源节点下游'); return; }
      Store.begin();
      child.parentId = fromId;
      Store.end('flow-link');
      render(true);
      select('edge', fromId + '->' + toId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
    ev.stopPropagation();
  }

  function isAncestor(a, b) {
    let cur = el.nodes.find((n) => n.id === b);
    let guard = 0;
    while (cur && cur.parentId && guard++ < 300) {
      if (cur.parentId === a) return true;
      cur = el.nodes.find((n) => n.id === cur.parentId);
    }
    return false;
  }

  /* ---------- 双击改字 ---------- */
  function onDblClick(ev) {
    const g = ev.target.closest('.fc-g');
    if (!g) return;
    const node = el.nodes.find((n) => n.id === g.dataset.nid);
    const geo = layoutData.geo[g.dataset.nid];
    if (!node || !geo) return;
    select('node', node.id);
    showInline(node, geo);
  }

  function showInline(node, geo) {
    commitInline();
    const r = canvasEl.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.className = 'fe-inline';
    ta.value = node.text || '';
    ta.style.left = r.left + geo.x * view.z + view.x + 'px';
    ta.style.top = r.top + geo.y * view.z + view.y + 'px';
    ta.style.width = Math.max(geo.w * view.z, 120) + 'px';
    ta.style.height = Math.max(geo.h * view.z, 40) + 'px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    inlineInput = { ta, node };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelInline(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitInline(); }
    });
    ta.addEventListener('blur', () => commitInline());
  }

  function commitInline() {
    if (!inlineInput) return;
    const { ta, node } = inlineInput;
    inlineInput = null;
    const v = ta.value.trim();
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    if (v && v !== node.text) {
      Store.begin();
      node.text = v;
      Store.end('flow-text');
      render(true);
    }
  }

  function cancelInline() {
    if (!inlineInput) return;
    const ta = inlineInput.ta;
    inlineInput = null;               // 先清状态，避免 blur 里重复移除
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }

  /* ---------- 增删 ---------- */
  function addNode(kind) {
    const parent = sel && sel.type === 'node' ? el.nodes.find((n) => n.id === sel.id) : null;
    const n = { id: U.uid('n'), parentId: parent ? parent.id : null, kind, text: '新节点' };
    Store.begin();
    el.nodes.push(n);
    Store.end('flow-add');
    render(true);
    select('node', n.id);
    const box = overlay.querySelector('#fe-text');
    if (box) { box.focus(); box.select(); }
  }

  function delNode() {
    if (!sel || sel.type !== 'node') return;
    const kids = {};
    el.nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    const del = new Set();
    (function walk(x) { del.add(x); (kids[x] || []).forEach((c) => walk(c.id)); })(sel.id);
    if (del.size >= el.nodes.length) { U.toast('至少保留一个节点'); return; }
    Store.begin();
    el.nodes = el.nodes.filter((n) => !del.has(n.id));
    Store.end('flow-del');
    sel = null;
    render(true);
  }

  function delEdge() {
    if (!sel || sel.type !== 'edge') return;
    const child = el.nodes.find((n) => n.id === sel.id.split('->')[1]);
    if (!child) return;
    Store.begin();
    child.parentId = null;
    Store.end('flow-unlink');
    sel = null;
    render(true);
  }

  function autoLayout() {
    Store.begin();
    el.nodes.forEach((n) => { delete n.px; delete n.py; });
    Store.end('flow-auto');
    render();
    fit();
    U.toast('已按层级重新排版');
  }

  /* ---------- 事件 ---------- */
  function onOverlayClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'done') return close();
      if (act === 'auto') return autoLayout();
      if (act === 'fit') return fit();
      if (act === 'undo') {
        Store.undo();
        el = Store.el(elId);
        sel = null;
        render();
        fit();
        return;
      }
      if (act === 'zoom-in') return zoomBy(1.15);
      if (act === 'zoom-out') return zoomBy(1 / 1.15);
      if (act === 'del-node') return delNode();
      if (act === 'del-edge') return delEdge();
    }
    const add = ev.target.closest('[data-add]');
    if (add) return addNode(add.dataset.add);
  }

  function onWheel(ev) {
    if (!ev.target.closest('.fe-canvas')) return;
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) zoomBy(ev.deltaY > 0 ? 0.92 : 1.08, ev.clientX, ev.clientY);
    else {
      view.x -= ev.deltaX;
      view.y -= ev.deltaY;
      applyView();
    }
  }

  function onKey(ev) {
    if (!overlay) return;
    const t = ev.target;
    const typing = t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    if (ev.key === 'Escape') {
      if (inlineInput) { cancelInline(); return; }
      close();
      return;
    }
    if (typing) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      Store.undo();
      el = Store.el(elId);
      sel = null;
      render();
      fit();
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      if (sel && sel.type === 'edge') delEdge();
      else delNode();
      return;
    }
    if (ev.key === 'Enter' && sel && sel.type === 'node') {
      const node = el.nodes.find((n) => n.id === sel.id);
      const geo = layoutData.geo[sel.id];
      if (node && geo) { ev.preventDefault(); showInline(node, geo); }
    }
  }

  function bind() {
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKey, true);
  }
  function unbind() {
    window.removeEventListener('keydown', onKey, true);
  }

  return { open, close };
})();
