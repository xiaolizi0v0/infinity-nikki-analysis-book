/* ------------------------------------------------------------------
 *  stateeditor.js — 状态图可视化编辑器（draw.io 风格）
 *  · 拖拽状态自由摆放（写回 node.x / node.y）
 *  · 从状态四边锚点拖到另一个状态 = 建立转移
 *  · 双击状态改名 / 双击转移改标签；选中后可在左侧面板编辑
 *  · 自动排版 / 适应窗口 / 撤销 / 完成
 * ------------------------------------------------------------------ */
window.StateEditor = (function () {
  let el = null;
  let elId = null;
  let overlay = null;
  let canvasEl = null;
  let worldEl = null;
  let svgEl = null;
  let layoutData = null;
  let view = { x: 0, y: 0, z: 1 };
  let sel = null;            // {type:'node'|'edge', id}
  let inlineInput = null;
  let lastVB = null;
  let liveTimer = null;

  const E = U.esc;

  /* ---------------- 打开 / 关闭 ---------------- */
  function open(id) {
    if (overlay) return;
    elId = id;
    el = Store.el(id);
    if (!el || el.type !== 'state') return;
    if (!Array.isArray(el.nodes)) el.nodes = [];
    if (!Array.isArray(el.edges)) el.edges = [];
    sel = el.nodes.length ? { type: 'node', id: el.nodes[0].id } : null;
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
    overlay.className = 'fe se';
    overlay.innerHTML = `
      <div class="fe-panel">
        <header class="fe-head">
          <span class="st-chip">编辑状态图</span>
          <input class="fe-title" id="se-title" value="${E(el.title || '状态图')}" spellcheck="false">
          <span class="fe-count">${el.nodes.length} 状态</span>
          <div class="fe-tools">
            <button class="fe-btn" data-act="auto" title="按顺序网格排版">自动排版</button>
            <button class="fe-btn" data-act="fit" title="适应窗口">适应</button>
            <button class="fe-btn ghost" data-act="undo" title="撤销 Ctrl+Z">撤销</button>
            <button class="fe-btn primary" data-act="done">完成</button>
          </div>
        </header>
        <div class="fe-body">
          <aside class="fe-left">
            <div class="fe-sec-t">添加状态</div>
            <div class="fe-addgrid">
              <button class="fe-add" data-add="state"><i class="nd process"></i>状态</button>
              <button class="fe-add" data-add="initial"><i class="nd start"></i>初始</button>
              <button class="fe-add" data-add="final"><i class="nd end"></i>结束</button>
            </div>
            <div class="fe-sec-t">选中项</div>
            <div id="se-prop" class="fe-prop"></div>
            <div class="fe-hint">
              <div><b>拖动</b>状态自由摆放</div>
              <div><b>锚点</b>拖到别的状态＝转移</div>
              <div><b>双击</b>状态改名 / 转移改标签</div>
              <div><b>Delete</b>删除状态 / 转移</div>
            </div>
          </aside>
          <div class="fe-canvas" id="se-canvas">
            <div class="fe-world" id="se-world"></div>
            <div class="fe-zoombar">
              <button data-act="zoom-out">−</button>
              <span id="se-zoom">100%</span>
              <button data-act="zoom-in">＋</button>
            </div>
          </div>
        </div>
      </div>`;

    canvasEl = overlay.querySelector('#se-canvas');
    worldEl = overlay.querySelector('#se-world');
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('pointerdown', onPointerDown, true);
    overlay.addEventListener('dblclick', onDblClick);

    const titleEl = overlay.querySelector('#se-title');
    titleEl.addEventListener('input', () => {
      Store.begin();
      el.title = titleEl.value;
      enqueueEnd('state-title');
    });
    titleEl.addEventListener('blur', () => flushEnd());
  }

  /* ---------------- 事务 ---------------- */
  let endTimer = null;
  function enqueueEnd(reason) {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => Store.end(reason), 450);
  }
  function flushEnd() {
    clearTimeout(endTimer);
    Store.end('state-edit');
  }

  /* ---------------- 渲染 ---------------- */
  function renderSvg(keep) {
    const prev = keep && lastVB ? { x: lastVB.x, y: lastVB.y } : null;
    layoutData = SD.layout(el);
    const r = SD.svg(el, {
      uid: 'se' + String(el.id).replace(/[^a-z0-9]/gi, ''),
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
    if (cnt) cnt.textContent = el.nodes.length + ' 状态';
  }

  function render(keep) {
    renderSvg(keep);
    renderProp();
  }

  function applyView() {
    if (!worldEl) return;
    worldEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const zl = overlay.querySelector('#se-zoom');
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

  // 屏幕坐标 → SVG 用户坐标
  function toSvg(clientX, clientY) {
    if (svgEl) {
      const ctm = svgEl.getScreenCTM && svgEl.getScreenCTM();
      if (ctm) {
        const m = ctm.inverse();
        return {
          x: m.a * clientX + m.c * clientY + m.e,
          y: m.b * clientX + m.d * clientY + m.f,
        };
      }
    }
    const r = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - view.x) / view.z + (lastVB ? lastVB.x : 0),
      y: (clientY - r.top - view.y) / view.z + (lastVB ? lastVB.y : 0),
    };
  }

  /* ---------------- 属性面板 ---------------- */
  function renderProp() {
    const box = overlay.querySelector('#se-prop');
    if (!box) return;

    if (!sel) {
      box.innerHTML = '<div class="fe-empty">点击画布中的状态或转移</div>';
      return;
    }

    if (sel.type === 'edge') {
      const ed = (el.edges || []).find((x) => x.id === sel.id);
      if (!ed) { box.innerHTML = '<div class="fe-empty">转移已失效</div>'; return; }
      const a = el.nodes.find((n) => n.id === ed.from);
      const b = el.nodes.find((n) => n.id === ed.to);
      box.innerHTML = `
        <div class="fe-row"><span>转移</span><b>${E((a && a.name) || '?')} → ${E((b && b.name) || '?')}</b></div>
        <label class="fe-f"><span>触发条件 / 事件</span>
          <input class="fe-ipt" id="se-elabel" value="${E(ed.label || '')}" placeholder="如：按跳跃键"></label>
        <button class="fe-btn danger wide" data-act="del-edge">删除转移</button>`;
      const inp = box.querySelector('#se-elabel');
      inp.addEventListener('focus', () => Store.begin());
      inp.addEventListener('input', () => {
        ed.label = inp.value;
        enqueueEnd('state-edge');
        const t = worldEl.querySelector(`.st-elabel[data-elabel="${ed.id}"]`);
        if (t) t.textContent = ed.label;
      });
      inp.addEventListener('blur', flushEnd);
      return;
    }

    const node = el.nodes.find((n) => n.id === sel.id);
    if (!node) { box.innerHTML = '<div class="fe-empty">状态已失效</div>'; return; }
    const outs = (el.edges || []).filter((x) => x.from === node.id).length;
    const ins = (el.edges || []).filter((x) => x.to === node.id).length;
    box.innerHTML = `
      <label class="fe-f"><span>状态名称</span>
        <input class="fe-ipt" id="se-name" value="${E(node.name || '')}" placeholder="如：待机"></label>
      <label class="fe-f"><span>备注（entry / exit）</span>
        <input class="fe-ipt" id="se-note" value="${E(node.note || '')}" placeholder="可留空"></label>
      <label class="fe-f"><span>类型</span>
        <select class="fe-ipt" id="se-kind">
          ${SD.KINDS.map((o) => `<option value="${o.v}" ${o.v === (node.kind || 'state') ? 'selected' : ''}>${o.t}</option>`).join('')}
        </select></label>
      <div class="fe-row"><span>出入</span><b>入 ${ins} · 出 ${outs}</b></div>
      <button class="fe-btn danger wide" data-act="del-node">删除状态</button>`;

    const nm = box.querySelector('#se-name');
    nm.addEventListener('focus', () => Store.begin());
    nm.addEventListener('input', () => {
      node.name = nm.value;
      enqueueEnd('state-node');
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => renderSvg(true), 140);
    });
    nm.addEventListener('blur', flushEnd);

    const nt = box.querySelector('#se-note');
    nt.addEventListener('focus', () => Store.begin());
    nt.addEventListener('input', () => {
      node.note = nt.value;
      enqueueEnd('state-node');
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => renderSvg(true), 140);
    });
    nt.addEventListener('blur', flushEnd);

    const kd = box.querySelector('#se-kind');
    kd.addEventListener('change', () => {
      Store.begin();
      node.kind = kd.value;
      Store.end('state-kind');
      render(true);
    });
  }

  /* ---------------- 选择 ---------------- */
  function select(type, id) {
    sel = type ? { type, id } : null;
    Array.from(worldEl.querySelectorAll('.st-g.sel')).forEach((n) => n.classList.remove('sel'));
    Array.from(worldEl.querySelectorAll('.st-edge-g.is-sel')).forEach((n) => n.classList.remove('is-sel'));
    if (sel) {
      const t = sel.type === 'node'
        ? worldEl.querySelector(`.st-g[data-nid="${sel.id}"]`)
        : worldEl.querySelector(`.st-edge-g[data-eid="${sel.id}"]`);
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
    if (btn) return;

    const anchor = ev.target.closest('.st-anchor');
    if (anchor) { startConnect(anchor.dataset.nid, anchor.dataset.anchor, ev); return; }

    const g = ev.target.closest('.st-g');
    if (g) { select('node', g.dataset.nid); startDrag(g, ev); return; }

    const eg = ev.target.closest('.st-edge-g');
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
    const geo = layoutData.byId[nid];
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
        Store.begin();
        g.classList.add('dragging');
      }
      node.x = Math.round(ox + dx);
      node.y = Math.round(oy + dy);
      geo.x = node.x;
      geo.y = node.y;
      g.setAttribute('transform', `translate(${node.x - ox},${node.y - oy})`);
      refreshEdges(nid);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      g.classList.remove('dragging');
      if (moved) {
        Store.end('state-move');
        renderSvg(true);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }

  // 拖动中即时更新相关转移（走和静态渲染同一套路由，平行线/来回线不会散开）
  function refreshEdges(nid) {
    const L = SD.layout(el);
    layoutData.edges = L.edges;
    layoutData.byId = L.byId;
    (L.edges || []).forEach((e) => {
      if (e.from !== nid && e.to !== nid) return;
      if (!e.geo) return;
      const g = worldEl.querySelector(`.st-edge-g[data-eid="${e.id}"]`);
      if (!g) return;
      g.querySelectorAll('path').forEach((pth) => pth.setAttribute('d', e.geo.d));
      const lbl = g.querySelector('.st-elabel');
      if (lbl) {
        lbl.setAttribute('x', e.geo.lx.toFixed(1));
        lbl.setAttribute('y', e.geo.ly.toFixed(1));
      }
    });
  }

  /* ---------- 锚点连线 ---------- */
  function startConnect(fromId, pos, ev) {
    const fromGeo = layoutData.byId[fromId];
    if (!fromGeo) return;
    const layer = svgEl.querySelector('.st-edges');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'st-edge fc-temp');
    layer.appendChild(path);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'fc-temp-dot');
    dot.setAttribute('r', '4');
    layer.appendChild(dot);

    const sx = pos === 'l' ? fromGeo.x : pos === 'r' ? fromGeo.x + fromGeo.w : fromGeo.x + fromGeo.w / 2;
    const sy = pos === 't' ? fromGeo.y : pos === 'b' ? fromGeo.y + fromGeo.h : fromGeo.y + fromGeo.h / 2;

    let hoverG = null;
    const setHover = (g) => {
      if (hoverG === g) return;
      if (hoverG) hoverG.classList.remove('drop');
      hoverG = g;
      if (hoverG) hoverG.classList.add('drop');
    };

    const move = (e) => {
      const p = toSvg(e.clientX, e.clientY);
      path.setAttribute('d', `M${sx},${sy} L${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const g = hit && hit.closest ? hit.closest('.st-g') : null;
      setHover(g && g.dataset.nid !== fromId ? g : null);
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('fc-connecting');
      path.remove();
      dot.remove();
      setHover(null);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const g = hit && hit.closest ? hit.closest('.st-g') : null;
      if (!g) return;
      const toId = g.dataset.nid;
      if (toId === fromId) return;
      const exist = (el.edges || []).find((x) => x.from === fromId && x.to === toId);
      if (exist) { select('edge', exist.id); return; }
      Store.begin();
      const ed = { id: U.uid('e'), from: fromId, to: toId, label: '' };
      el.edges.push(ed);
      Store.end('state-link');
      render(true);
      select('edge', ed.id);
      const inp = overlay.querySelector('#se-elabel');
      if (inp) { inp.focus(); inp.select(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('fc-connecting');
    ev.preventDefault();
    ev.stopPropagation();
  }

  /* ---------- 双击改字 ---------- */
  function onDblClick(ev) {
    const lbl = ev.target.closest('.st-elabel');
    if (lbl) {
      const ed = (el.edges || []).find((x) => x.id === lbl.dataset.elabel);
      if (ed) { select('edge', ed.id); showEdgeInline(ed, lbl); }
      return;
    }
    const g = ev.target.closest('.st-g');
    if (!g) return;
    const node = el.nodes.find((n) => n.id === g.dataset.nid);
    const geo = layoutData.byId[g.dataset.nid];
    if (!node || !geo) return;
    select('node', node.id);
    showInline(node, geo);
  }

  function showInline(node, geo) {
    commitInline();
    const r = canvasEl.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.className = 'fe-inline';
    ta.value = node.name || '';
    const ox = lastVB ? lastVB.x : 0;
    const oy = lastVB ? lastVB.y : 0;
    ta.style.left = r.left + (geo.x - ox) * view.z + view.x + 'px';
    ta.style.top = r.top + (geo.y - oy) * view.z + view.y + 'px';
    ta.style.width = Math.max(geo.w * view.z, 120) + 'px';
    ta.style.height = Math.max(38, 34 * view.z) + 'px';
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

  function showEdgeInline(ed, anchorEl) {
    commitInline();
    const r = canvasEl.getBoundingClientRect();
    const inp = document.createElement('input');
    inp.className = 'fe-inline st-inline-edge';
    inp.value = ed.label || '';
    const box = anchorEl.getBoundingClientRect();
    inp.style.left = box.left - 60 + 'px';
    inp.style.top = box.top - 30 + 'px';
    inp.style.width = '140px';
    inp.style.height = '26px';
    document.body.appendChild(inp);
    inp.focus();
    inp.select();
    inlineInput = { ta: inp, edge: ed };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelInline(); }
      if (e.key === 'Enter') { e.preventDefault(); commitInline(); }
    });
    inp.addEventListener('blur', () => commitInline());
  }

  function commitInline() {
    if (!inlineInput) return;
    const { ta, node, edge } = inlineInput;
    inlineInput = null;
    const v = ta.value.trim();
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    if (edge) {
      if (v !== (edge.label || '')) {
        Store.begin();
        edge.label = v;
        Store.end('state-edge');
        render(true);
      }
      return;
    }
    if (v && node && v !== node.name) {
      Store.begin();
      node.name = v;
      Store.end('state-text');
      render(true);
    }
  }

  function cancelInline() {
    if (!inlineInput) return;
    const ta = inlineInput.ta;
    inlineInput = null;
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }

  /* ---------- 增删 ---------- */
  function addNode(kind) {
    // 放在图下方留白处，避免压住已有状态
    const geo = layoutData.byId;
    const box = layoutData.bbox;
    let x = Math.round(box.x + 20);
    let y = Math.round(box.y + box.h + 46);
    let guard = 0;
    while (guard++ < 200) {
      const hit = el.nodes.some((n) => {
        const g = geo[n.id];
        return g && Math.abs(g.x - x) < 60 && Math.abs(g.y - y) < 50;
      });
      if (!hit) break;
      y += 56;
    }
    const name = kind === 'state' ? '新状态' : '';
    Store.begin();
    const n = { id: U.uid('s'), name, note: '', kind, x: Math.round(x), y: Math.round(y) };
    el.nodes.push(n);
    Store.end('state-add');
    render(true);
    select('node', n.id);
    if (kind === 'state') {
      const inp = overlay.querySelector('#se-name');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function delNode() {
    if (!sel || sel.type !== 'node') return;
    const id = sel.id;
    if (el.nodes.length <= 1) { U.toast('至少保留一个状态'); return; }
    Store.begin();
    el.nodes = el.nodes.filter((n) => n.id !== id);
    el.edges = (el.edges || []).filter((e) => e.from !== id && e.to !== id);
    Store.end('state-del');
    sel = null;
    render(true);
  }

  function delEdge() {
    if (!sel || sel.type !== 'edge') return;
    Store.begin();
    el.edges = (el.edges || []).filter((e) => e.id !== sel.id);
    Store.end('state-unlink');
    sel = null;
    render(true);
  }

  function autoLayout() {
    Store.begin();
    SD.autoLayout(el);
    Store.end('state-auto');
    render();
    fit();
    U.toast('已按顺序重新排版');
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
    }
  }

  /* ---------- 绑定 ---------------- */
  function bind() {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', onWheel, { passive: false });
  }
  function unbind() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('wheel', onWheel);
  }

  return { open, close };
})();
