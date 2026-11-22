/* ------------------------------------------------------------------
 *  imgeditor.js — 图片标注编辑器（QQ 截图式）
 *  · 顶部浮条：尺寸 / 圆角 / 阴影 / 清除标注
 *  · 蓝色选框 + 8 个手柄：拖手柄改卡片尺寸（Shift 等比）
 *  · 底部工具条：选择 / 箭头 / 画笔 / 文字 / 矩形 / 椭圆 / 马赛克 / 高亮
 *    + 颜色、撤销重做、导出 PNG、取消、完成
 *  · 双击图形可加文字标签；Delete 删除选中；Ctrl+Z 撤销
 * ------------------------------------------------------------------ */
window.ImgEditor = (function () {
  const E = U.esc;
  let ov = null;
  let st = null;
  let drag = null;
  let inline = null;

  const SVG = {
    select: '<path d="M4 2.6l10.6 6.2-4.6 1.1-1.7 4.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>',
    arrow: '<path d="M4 16L16 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16 4h-6.2M16 4v6.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    pen: '<path d="M3.4 16.6l.8-3.5L13.6 3.7a1.7 1.7 0 012.4 0l.3.3a1.7 1.7 0 010 2.4L6.9 15.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>',
    text: '<path d="M4 4.6h12M10 4.6v11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    rect: '<rect x="3.4" y="4.4" width="13.2" height="11.2" rx="2" stroke="currentColor" stroke-width="1.4" fill="none"/>',
    ellipse: '<ellipse cx="10" cy="10" rx="6.7" ry="6.7" stroke="currentColor" stroke-width="1.4" fill="none"/>',
    mosaic: '<rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    highlight: '<path d="M6.6 12.4l6-6 3 3-6 6H6.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/><path d="M3.4 17h13.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    undo: '<path d="M7.6 6.2H12a3.8 3.8 0 010 7.6H8.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M9.8 3.8L7.2 6.2l2.6 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    redo: '<path d="M12.4 6.2H8a3.8 3.8 0 000 7.6h3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M10.2 3.8l2.6 2.4-2.6 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    download: '<path d="M10 3v8.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6.6 8.4L10 11.8l3.4-3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M4 15.6h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    close: '<path d="M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    check: '<path d="M4.6 10.4l3.6 3.6 7.2-7.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  };

  const TOOLS = [
    ['select', '选择 / 移动 (V)'],
    ['arrow', '箭头 (A)'],
    ['pen', '画笔 (P)'],
    ['text', '文字 (T)'],
    ['rect', '矩形 (R)'],
    ['ellipse', '椭圆 (O)'],
    ['mosaic', '马赛克 (M)'],
    ['highlight', '高亮 (H)'],
  ];

  const ico = (k) => `<svg viewBox="0 0 20 20" fill="none">${SVG[k]}</svg>`;

  /* ================= 打开 / 关闭 ================= */
  function open(id) {
    if (ov) return;
    const el = Store.el(id);
    if (!el || el.type !== 'image') return;

    const node = document.querySelector('.el[data-id="' + id + '"]');
    const cv = node && node.querySelector('.shot-cv');
    const fw = (cv && cv.clientWidth) || Math.max(80, (el.w || 560) - 20);
    const fh = (cv && cv.clientHeight) || Math.max(60, (el.h || 340) - 60);

    st = {
      id,
      el,
      marks: JSON.parse(JSON.stringify(Marks.norm(el))),
      radius: el.radius == null ? 14 : el.radius,
      shadow: el.shadow !== false,
      fw,
      fh,
      capH: Math.max(28, (el.h || 340) - 18 - fh),
      tool: 'select',
      color: '#D93E5C',
      sel: null,
      undo: [],
      redo: [],
      scale: 1,
    };
    buildDom();
    document.body.appendChild(ov);
    document.body.classList.add('ie-open');
    layout();
    bind();
    draw();
    setTool('select');
    syncTop();
  }

  function close(applied) {
    commitInline(true);
    unbind();
    if (ov) ov.remove();
    ov = null;
    document.body.classList.remove('ie-open');
    const id = st && st.id;
    st = null;
    drag = null;
    if (id) {
      Canvas.rebuild(id);
      Canvas.select(id);
      Panels.refreshInspector(true);
    }
    if (applied) U.toast('图片已更新');
  }

  /* ================= DOM ================= */
  function buildDom() {
    ov = document.createElement('div');
    ov.className = 'ie';
    ov.innerHTML = `
      <div class="ie-row">
        <div class="ie-pill ie-top">
          <span class="ie-dim"><b id="ie-w">0</b><i>*</i><b id="ie-h">0</b></span>
          <span class="ie-vline"></span>
          <label class="ie-rl">圆角
            <input type="range" id="ie-radius" min="0" max="30" step="1">
            <em id="ie-rv">14</em>
          </label>
          <label class="ie-chk"><input type="checkbox" id="ie-shadow"><span>阴影</span></label>
          <span class="ie-vline"></span>
          <button class="ie-clear" id="ie-clear" title="清除这张图的全部标注">清除标注</button>
        </div>
      </div>

      <div class="ie-stage" id="ie-stage">
        <div class="ie-wrap">
          <div class="ie-boardwrap">
            <div class="ie-board" id="ie-board">
              <canvas class="ie-cv" id="ie-cv"></canvas>
              <div class="ie-empty" id="ie-empty" hidden>这张图还没有图片源<br><span>先关闭编辑器，在右侧属性面板上传图片</span></div>
              <div class="ie-selbox" id="ie-selbox" hidden><button class="ie-selx" id="ie-selx" title="删除选中标注">×</button></div>
            </div>
            <div class="ie-hd">
              <i data-dir="nw"></i><i data-dir="n"></i><i data-dir="ne"></i>
              <i data-dir="w"></i><i data-dir="e"></i>
              <i data-dir="sw"></i><i data-dir="s"></i><i data-dir="se"></i>
            </div>
          </div>
          <div class="ie-tag">
            <b>图片</b><span id="ie-tagtxt"></span>
            <em>双击图形加文字 · Delete 删除 · Shift 等比</em>
          </div>
        </div>
      </div>

      <div class="ie-row">
        <div class="ie-pill ie-bar">
          <div class="ie-group" id="ie-tools">
            ${TOOLS.map(([k, t]) => `<button class="ie-tool" data-tool="${k}" title="${t}">${ico(k)}</button>`).join('')}
          </div>
          <span class="ie-vline"></span>
          <div class="ie-colors" id="ie-colors">
            ${Marks.COLORS.map((c, i) => `<button class="ie-color${i === 0 ? ' on' : ''}" data-color="${c}" style="--c:${c}" title="颜色"></button>`).join('')}
          </div>
          <span class="ie-vline"></span>
          <button class="ie-tool" data-act="undo" title="撤销 Ctrl+Z">${ico('undo')}</button>
          <button class="ie-tool" data-act="redo" title="重做 Ctrl+Shift+Z">${ico('redo')}</button>
          <button class="ie-tool" data-act="download" title="导出标注图 PNG">${ico('download')}</button>
          <span class="ie-vline"></span>
          <button class="ie-tool ie-x" data-act="cancel" title="取消（Esc）">${ico('close')}</button>
          <button class="ie-tool ie-ok" data-act="done" title="完成（Ctrl+Enter）">${ico('check')}</button>
        </div>
      </div>`;

    ov.addEventListener('click', onClick);
    ov.addEventListener('dblclick', onDblClick);

    const radius = ov.querySelector('#ie-radius');
    radius.addEventListener('input', () => {
      st.radius = Number(radius.value);
      applyFrame();
      syncTop();
    });
    ov.querySelector('#ie-shadow').addEventListener('change', (ev) => {
      st.shadow = ev.target.checked;
      applyFrame();
    });
    ov.querySelector('#ie-clear').addEventListener('click', () => {
      if (!st.marks.length) { U.toast('还没有标注'); return; }
      pushUndo();
      st.marks = [];
      st.sel = null;
      draw();
      U.toast('已清除标注，可用 Ctrl+Z 撤销');
    });
    ov.querySelector('#ie-selx').addEventListener('click', (ev) => {
      ev.stopPropagation();
      delSel();
    });

    const board = ov.querySelector('#ie-board');
    board.addEventListener('pointerdown', onDown);
    ov.querySelectorAll('.ie-hd i').forEach((h) => h.addEventListener('pointerdown', onHandleDown));
    ov.querySelector('#ie-stage').addEventListener('pointerdown', (ev) => {
      if (ev.target === ev.currentTarget) { st.sel = null; draw(); }
    });
  }

  function layout() {
    const stage = ov.querySelector('#ie-stage');
    const availW = Math.max(200, stage.clientWidth - 110);
    const availH = Math.max(160, stage.clientHeight - 30);
    st.scale = Math.min(1, availW / st.fw, availH / st.fh);
    applyFrame();
  }

  function bw() { return Math.max(40, Math.round(st.fw * st.scale)); }
  function bh() { return Math.max(30, Math.round(st.fh * st.scale)); }

  function applyFrame() {
    const board = ov.querySelector('#ie-board');
    board.style.width = bw() + 'px';
    board.style.height = bh() + 'px';
    board.style.borderRadius = st.radius + 'px';
    board.classList.toggle('no-shadow', !st.shadow);
    board.dataset.tool = st.tool;
    const empty = ov.querySelector('#ie-empty');
    if (empty) empty.hidden = !!st.el.src;
    syncTag();
  }

  function syncTop() {
    const w = ov.querySelector('#ie-w'), h = ov.querySelector('#ie-h');
    if (w) w.textContent = Math.round(st.fw);
    if (h) h.textContent = Math.round(st.fh);
    const r = ov.querySelector('#ie-radius');
    if (r) r.value = st.radius;
    const rv = ov.querySelector('#ie-rv');
    if (rv) rv.textContent = st.radius;
    const ck = ov.querySelector('#ie-shadow');
    if (ck) ck.checked = st.shadow;
    syncTag();
  }

  function syncTag() {
    const t = ov && ov.querySelector('#ie-tagtxt');
    if (t) t.textContent = Math.round(st.fw) + ' × ' + Math.round(st.fh) + ' px';
  }

  /* ================= 绘制 ================= */
  function draw() {
    if (!ov) return;
    const cv = ov.querySelector('#ie-cv');
    Marks.paint(cv, {
      src: st.el.src, fit: st.el.fit, zoom: st.el.zoom, ox: st.el.ox, oy: st.el.oy,
      marks: st.marks,
    }, { w: bw(), h: bh() });
    drawSelBox();
  }

  function drawSelBox() {
    const box = ov.querySelector('#ie-selbox');
    if (!box) return;
    if (!st.sel) { box.hidden = true; return; }
    const b = bbox(st.sel);
    const w = bw(), h = bh();
    box.hidden = false;
    box.style.left = Math.round(b.x1 * w) - 3 + 'px';
    box.style.top = Math.round(b.y1 * h) - 3 + 'px';
    box.style.width = Math.max(12, Math.round((b.x2 - b.x1) * w) + 6) + 'px';
    box.style.height = Math.max(12, Math.round((b.y2 - b.y1) * h) + 6) + 'px';
  }

  /* ================= 几何 ================= */
  function toNorm(ev) {
    const r = ov.querySelector('#ie-board').getBoundingClientRect();
    return {
      x: U.clamp((ev.clientX - r.left) / r.width, 0, 1),
      y: U.clamp((ev.clientY - r.top) / r.height, 0, 1),
    };
  }

  function bbox(m) {
    if (m.kind === 'text') return { x1: m.x - 0.11, y1: m.y - 0.055, x2: m.x + 0.11, y2: m.y + 0.055 };
    if (m.kind === 'pen') {
      const pts = m.points || [];
      let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
      pts.forEach((p) => { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); });
      return { x1, y1, x2, y2 };
    }
    if (m.kind === 'arrow' && m.label) {
      const x1 = Math.min(m.x1, m.x2, m.x1 - 0.1);
      const x2 = Math.max(m.x1, m.x2, m.x1 + 0.1);
      return { x1, y1: Math.min(m.y1, m.y2) - 0.05, x2, y2: Math.max(m.y1, m.y2) + 0.05 };
    }
    return {
      x1: Math.min(m.x1, m.x2), y1: Math.min(m.y1, m.y2),
      x2: Math.max(m.x1, m.x2), y2: Math.max(m.y1, m.y2),
    };
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0;
    t = U.clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function hit(m, p) {
    const tol = 0.016;
    if (m.kind === 'text') {
      const b = bbox(m);
      return p.x >= b.x1 - 0.01 && p.x <= b.x2 + 0.01 && p.y >= b.y1 - 0.01 && p.y <= b.y2 + 0.01;
    }
    if (m.kind === 'pen') {
      const pts = m.points || [];
      for (let i = 1; i < pts.length; i++) {
        if (segDist(p.x, p.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < tol) return true;
      }
      return false;
    }
    if (m.kind === 'arrow') {
      if (segDist(p.x, p.y, m.x1, m.y1, m.x2, m.y2) < tol) return true;
      const b = bbox(m);
      return !!m.label && p.x > b.x1 && p.x < b.x2 && p.y > b.y1 && p.y < b.y2;
    }
    const b = bbox(m);
    return p.x >= b.x1 - 0.008 && p.x <= b.x2 + 0.008 && p.y >= b.y1 - 0.008 && p.y <= b.y2 + 0.008;
  }

  function pick(p) {
    for (let i = st.marks.length - 1; i >= 0; i--) if (hit(st.marks[i], p)) return st.marks[i];
    return null;
  }

  function moveMark(m, dx, dy) {
    if (m.kind === 'pen') { (m.points || []).forEach((q) => { q[0] += dx; q[1] += dy; }); return; }
    if (m.kind === 'text') { m.x += dx; m.y += dy; return; }
    m.x1 += dx; m.y1 += dy; m.x2 += dx; m.y2 += dy;
  }

  /* ================= 指针交互 ================= */
  function onDown(ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest('.ie-selx') || ev.target.closest('.ie-hd')) return;
    if (!st.el.src) return;
    ev.preventDefault();
    const p = toNorm(ev);
    st.sel = null;

    if (st.tool === 'select') {
      const m = pick(p);
      if (!m) { draw(); return; }
      st.sel = m;
      drag = { mode: 'move', m, base: JSON.parse(JSON.stringify(m)), start: p, moved: false };
      draw();
      return;
    }

    if (st.tool === 'text') {
      const m = { id: U.uid('mk'), kind: 'text', x: p.x, y: p.y, text: '', color: st.color };
      pushUndo();
      st.marks.push(m);
      st.sel = m;
      drag = { mode: 'text', m };
      draw();
      openInline(m, true);
      return;
    }

    if (st.tool === 'pen') {
      const m = { id: U.uid('mk'), kind: 'pen', points: [[p.x, p.y]], color: st.color, width: 2.4 };
      pushUndo();
      st.marks.push(m);
      drag = { mode: 'draw', m, base: [p.x, p.y], moved: false };
      draw();
      return;
    }

    const m = {
      id: U.uid('mk'), kind: st.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color,
    };
    pushUndo();
    st.marks.push(m);
    drag = { mode: 'draw', m, base: [p.x, p.y], moved: false };
    draw();
  }

  function onMove(ev) {
    if (!drag) return;
    const p = toNorm(ev);

    if (drag.mode === 'move') {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved) {
        if (Math.hypot(dx * bw(), dy * bh()) < 2) return;
        drag.moved = true;
      }
      const b = drag.base;
      Object.keys(b).forEach((k) => {
        if (k !== 'id' && k !== 'kind' && k !== 'color' && k !== 'label' && k !== 'text') drag.m[k] = b[k];
      });
      if (drag.m.kind === 'pen') drag.m.points = b.points.map((q) => [q[0] + dx, q[1] + dy]);
      else if (drag.m.kind === 'text') { drag.m.x = b.x + dx; drag.m.y = b.y + dy; }
      else { drag.m.x1 = b.x1 + dx; drag.m.y1 = b.y1 + dy; drag.m.x2 = b.x2 + dx; drag.m.y2 = b.y2 + dy; }
      draw();
      return;
    }

    if (drag.mode === 'draw') {
      drag.moved = true;
      if (drag.m.kind === 'pen') {
        const pts = drag.m.points;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 0.003) pts.push([p.x, p.y]);
      } else {
        drag.m.x2 = p.x;
        drag.m.y2 = p.y;
      }
      draw();
      return;
    }

    if (drag.mode === 'resize') {
      const dx = ev.clientX - drag.cx, dy = ev.clientY - drag.cy;
      const d = drag.dir;
      const s = st.scale || 1;
      let nw = drag.w0, nh = drag.h0;
      if (d.indexOf('e') > -1) nw = drag.w0 + dx / s;
      if (d.indexOf('w') > -1) nw = drag.w0 - dx / s;
      if (d.indexOf('s') > -1) nh = drag.h0 + dy / s;
      if (d.indexOf('n') > -1) nh = drag.h0 - dy / s;
      nw = Math.max(120, nw);
      nh = Math.max(80, nh);
      if (ev.shiftKey) {
        const ratio = drag.w0 / drag.h0;
        if (Math.abs(nw / drag.w0 - 1) > Math.abs(nh / drag.h0 - 1)) nh = nw / ratio;
        else nw = nh * ratio;
        nw = Math.max(120, nw);
        nh = Math.max(80, nw / ratio);
      }
      st.fw = Math.round(nw);
      st.fh = Math.round(nh);
      applyFrame();
      draw();
      syncTop();
      return;
    }
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'move' && !d.moved) { draw(); return; }
    if (d.mode === 'draw') {
      if (d.m.kind !== 'pen') {
        const w = Math.abs(d.m.x2 - d.m.x1), h = Math.abs(d.m.y2 - d.m.y1);
        if (w < 0.012 && h < 0.012) {
          st.marks = st.marks.filter((x) => x !== d.m);
          st.undo.pop();
          draw();
          return;
        }
      } else if ((d.m.points || []).length < 2) {
        st.marks = st.marks.filter((x) => x !== d.m);
        st.undo.pop();
        draw();
        return;
      }
      st.sel = d.m;
      draw();
      return;
    }
    draw();
  }

  function onHandleDown(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const dir = ev.currentTarget.dataset.dir;
    drag = { mode: 'resize', dir, cx: ev.clientX, cy: ev.clientY, w0: st.fw, h0: st.fh };
  }

  function onDblClick(ev) {
    if (!st.el.src) return;
    const p = toNorm(ev);
    const m = pick(p);
    if (!m) return;
    if (m.kind === 'text' || m.kind === 'arrow') {
      st.sel = m;
      draw();
      openInline(m, false);
    }
  }

  /* ================= 内联文字 ================= */
  function openInline(m, isNew) {
    commitInline(true);
    const r = ov.querySelector('#ie-board').getBoundingClientRect();
    const nx = m.kind === 'text' ? m.x : m.x1;
    const ny = m.kind === 'text' ? m.y : m.y1;
    const ta = document.createElement('textarea');
    ta.className = 'ie-inline';
    ta.value = m.kind === 'text' ? (m.text || '') : (m.label || '');
    ta.placeholder = m.kind === 'text' ? '输入标注文字' : '输入标签（如：入口 / 反馈）';
    ta.spellcheck = false;
    ta.style.left = Math.round(U.clamp(r.left + nx * r.width - 70, 12, window.innerWidth - 200)) + 'px';
    ta.style.top = Math.round(U.clamp(r.top + ny * r.height - 20, 60, window.innerHeight - 130)) + 'px';
    ta.style.width = '186px';
    document.body.appendChild(ta);
    inline = { ta, m, isNew };
    setTimeout(() => { ta.focus(); ta.select(); }, 10);
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); cancelInline(); }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitInline(); }
    });
    ta.addEventListener('blur', () => commitInline());
  }

  function commitInline(silent) {
    if (!inline) return;
    const { ta, m, isNew } = inline;
    inline = null;
    const val = ta.value.replace(/\s+$/, '');
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    if (m.kind === 'text') {
      if (!val.trim()) {
        st.marks = st.marks.filter((x) => x !== m);
        if (st.sel === m) st.sel = null;
      } else {
        m.text = val;
      }
    } else {
      m.label = val.trim();
    }
    if (!silent) draw();
    else if (ov) draw();
  }

  function cancelInline() {
    if (!inline) return;
    const { ta, m, isNew } = inline;
    inline = null;
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    if (isNew) {
      st.marks = st.marks.filter((x) => x !== m);
      if (st.sel === m) st.sel = null;
    }
    draw();
  }

  /* ================= 撤销 / 删除 ================= */
  function pushUndo() {
    st.undo.push(JSON.stringify(st.marks));
    if (st.undo.length > 50) st.undo.shift();
    st.redo.length = 0;
  }

  function undo() {
    if (!st.undo.length) { U.toast('没有可撤销的标注操作'); return; }
    st.redo.push(JSON.stringify(st.marks));
    st.marks = JSON.parse(st.undo.pop());
    st.sel = null;
    draw();
  }

  function redo() {
    if (!st.redo.length) return;
    st.undo.push(JSON.stringify(st.marks));
    st.marks = JSON.parse(st.redo.pop());
    st.sel = null;
    draw();
  }

  function delSel() {
    if (!st.sel) return;
    pushUndo();
    st.marks = st.marks.filter((m) => m !== st.sel);
    st.sel = null;
    draw();
  }

  /* ================= 工具 / 顶栏 ================= */
  function setTool(t) {
    st.tool = t;
    if (ov) {
      ov.querySelectorAll('.ie-tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
      ov.querySelector('#ie-board').dataset.tool = t;
    }
  }

  function onClick(ev) {
    const tb = ev.target.closest('.ie-tool[data-tool]');
    if (tb) { setTool(tb.dataset.tool); return; }

    const cb = ev.target.closest('.ie-color');
    if (cb) {
      st.color = cb.dataset.color;
      ov.querySelectorAll('.ie-color').forEach((b) => b.classList.toggle('on', b === cb));
      if (st.sel) {
        pushUndo();
        st.sel.color = st.color;
        draw();
      }
      return;
    }

    const ab = ev.target.closest('[data-act]');
    if (!ab) return;
    const act = ab.dataset.act;
    if (act === 'undo') { undo(); return; }
    if (act === 'redo') { redo(); return; }
    if (act === 'cancel') { close(false); return; }
    if (act === 'done') { commit(); return; }
    if (act === 'download') {
      Marks.exportPng(
        Object.assign({}, st.el, { marks: st.marks }),
        { w: st.fw, h: st.fh },
        (ok, err) => { if (!ok) U.toast(err || '导出失败'); else U.toast('已导出 PNG'); }
      );
      return;
    }
  }

  /* ================= 提交 ================= */
  function commit() {
    commitInline(true);
    const el = st.el;
    Store.begin();
    el.marks = st.marks;
    if (el.annotations) delete el.annotations;
    el.radius = st.radius;
    el.shadow = st.shadow;
    el.w = Math.round(st.fw + 20);
    el.h = Math.round(st.fh + 18 + st.capH);
    Store.end('image-edit');
    close(true);
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
  }

  function unbind() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
  }

  let rzTimer = null;
  function onResize() {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { if (ov) { layout(); draw(); } }, 120);
  }

  function onKey(ev) {
    if (!ov) return;
    if (inline) return; // textarea 自己处理
    const k = ev.key.toLowerCase();
    const meta = ev.ctrlKey || ev.metaKey;
    ev.stopPropagation();

    if (k === 'escape') { ev.preventDefault(); close(false); return; }
    if (meta && k === 'enter') { ev.preventDefault(); commit(); return; }
    if (meta && k === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (meta && k === 'y') { ev.preventDefault(); redo(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (st.sel) { ev.preventDefault(); delSel(); }
      return;
    }
    if (meta) return;
    const map = { v: 'select', a: 'arrow', p: 'pen', t: 'text', r: 'rect', o: 'ellipse', m: 'mosaic', h: 'highlight' };
    if (map[k]) { ev.preventDefault(); setTool(map[k]); }
  }

  return { open, close };
})();
