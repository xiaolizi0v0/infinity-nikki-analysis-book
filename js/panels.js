/* ------------------------------------------------------------------
 *  panels.js — 大纲 / 属性面板
 * ------------------------------------------------------------------ */
window.Panels = (function () {
  let outlineEl, inspector, addImageInput;
  let commitTimer = null;
  let openNode = null;
  let builtKey = '';

  const E = U.esc;

  const ICONS = {
    heading: '<path d="M4 3v10M12 3v10M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    text: '<path d="M3 4h10M3 7.5h10M3 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    note: '<path d="M3 3.5h10v7.2L9.7 13H3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 10.5H9.6V13" stroke="currentColor" stroke-width="1.4"/>',
    image: '<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M3 10.4l3-2.8 2.6 2.4 1.8-1.6 2.6 2.4" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="5.6" cy="6.2" r="1" fill="currentColor"/>',
    flowchart: '<rect x="5" y="1.8" width="6" height="3.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><rect x="5" y="10.8" width="6" height="3.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.2v2.2M8 7.4L3.4 7.4v1.6M8 7.4l4.6 0v1.6" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    table: '<rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M2.4 6.4h11.2M2.4 9.6h11.2M6.2 6.4v6.4" stroke="currentColor" stroke-width="1.3"/>',
  };
  const icon = (t) => `<svg class="ico" viewBox="0 0 16 16" fill="none">${ICONS[t] || ICONS.text}</svg>`;
  const TYPE_LABEL = { heading: '标题', text: '文字', note: '标注', image: '图片', flowchart: '流程图', table: '表格' };

  function init() {
    outlineEl = document.getElementById('outline');
    inspector = document.getElementById('inspector');
    addImageInput = document.getElementById('file-image');
    if (addImageInput) {
      addImageInput.addEventListener('change', () => {
        const f = addImageInput.files && addImageInput.files[0];
        const mode = addImageInput.dataset.mode;
        addImageInput.value = '';
        if (!f || !/^image\//.test(f.type)) return;
        if (mode === 'replace') upstreamImage(f);
        else Canvas.importImageFile(f);
      });
    }
    inspector.addEventListener('input', onInput);
    inspector.addEventListener('change', onInput);
    inspector.addEventListener('click', onClick);
    outlineEl.addEventListener('click', (ev) => {
      const it = ev.target.closest('.ol-item');
      if (it) Canvas.focus(it.dataset.id);
    });
    refreshOutline();
    refreshInspector();
  }

  function upstreamImage(file) {
    let id = Canvas.getSel();
    if (!id || (Store.el(id) || {}).type !== 'image') {
      Canvas.addAtCenter('image');
      id = Canvas.getSel();
    }
    if (!id) return;
    const r = new FileReader();
    r.onload = () => {
      Canvas.setImageSrc(id, r.result);
      setTimeout(refreshInspector, 60);
    };
    r.readAsDataURL(file);
  }

  /* ---------------- 大纲 ---------------- */
  function labelOf(e) {
    if (e.type === 'heading') return e.text || '未命名标题';
    if (e.type === 'flowchart') return e.title || '流程图';
    if (e.type === 'image') return e.title || '图片';
    if (e.type === 'table') return e.title || '表格';
    if (e.type === 'note') return e.title || '标注';
    const t = U.plainText(e.html).slice(0, 26);
    return t || '文字段落';
  }

  function refreshOutline() {
    const doc = Store.get();
    if (!doc || !outlineEl) return;
    const list = (doc.elements || []).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const counts = list.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
    document.getElementById('el-count').textContent = list.length + ' 个组件';
    outlineEl.innerHTML = list
      .map(
        (e) =>
          `<div class="ol-item ol-${e.type} ${e.id === Canvas.getSel() ? 'active' : ''}" data-id="${e.id}">
             ${icon(e.type)}
             <span class="ol-label">${E(labelOf(e))}</span>
             <span class="ol-kind">${TYPE_LABEL[e.type] || ''}</span>
           </div>`
      )
      .join('') || '<div class="empty-hint">画布还是空的<br>从顶部添加一个组件开始</div>';
    const stat = document.getElementById('type-stat');
    if (stat) {
      stat.innerHTML = Object.keys(TYPE_LABEL)
        .map((t) => `<span class="pill">${TYPE_LABEL[t]} ${counts[t] || 0}</span>`)
        .join('');
    }
  }

  /* ---------------- 属性面板 ---------------- */
  function setActiveOutline() {
    U.$$('.ol-item', outlineEl).forEach((n) =>
      n.classList.toggle('active', n.dataset.id === Canvas.getSel())
    );
  }

  function refreshInspector(force) {
    if (!inspector) return;
    const id = Canvas.getSel();
    const nodeId = Canvas.getSelNode() || null;
    const key = (id || '-') + '|' + (nodeId || '-');
    const ae = document.activeElement;
    if (!force && ae && inspector.contains(ae) && builtKey === key) {
      setActiveOutline();
      return;
    }
    builtKey = key;
    const e = id ? Store.el(id) : null;
    if (!e) {
      inspector.innerHTML = emptyInspector();
      setActiveOutline();
      return;
    }
    openNode = Canvas.getSelNode() || openNode;
    let html = header(e) + body(e) + actions(e);
    inspector.innerHTML = html;
    setActiveOutline();
  }

  function emptyInspector() {
    return `<div class="insp-empty">
      <div class="insp-empty-icon">◎</div>
      <div class="insp-empty-t">未选中组件</div>
      <p>点击画布上的任意组件查看属性；<br>双击文字可直接编辑。</p>
      <div class="tip-list">
        <div><kbd>空格</kbd> + 拖动 平移画布</div>
        <div><kbd>Ctrl</kbd> + 滚轮 缩放</div>
        <div><kbd>F</kbd> 适应整页 · <kbd>0</kbd> 100%</div>
      </div>
    </div>`;
  }

  function header(e) {
    return `<div class="insp-head">
      <div class="insp-type">${icon(e.type)}<span>${TYPE_LABEL[e.type]}</span></div>
      <div class="insp-pos">x ${Math.round(e.x)} · y ${Math.round(e.y)}${e.w ? ' · w ' + Math.round(e.w) : ''}</div>
    </div>`;
  }

  function field(label, inner, hint) {
    return `<label class="fld"><span class="fld-l">${label}</span>${inner}${hint ? `<span class="fld-h">${hint}</span>` : ''}</label>`;
  }
  const input = (path, val, ph) =>
    `<input class="ipt" data-path="${path}" value="${E(val == null ? '' : val)}" placeholder="${E(ph || '')}">`;
  const area = (path, val, rows) =>
    `<textarea class="ipt ta" rows="${rows || 3}" data-path="${path}">${E(val || '')}</textarea>`;
  const select = (path, val, opts) =>
    `<select class="ipt sel" data-path="${path}">${opts
      .map((o) => `<option value="${o[0]}" ${o[0] === val ? 'selected' : ''}>${o[1]}</option>`)
      .join('')}</select>`;

  function body(e) {
    if (e.type === 'heading') {
      return `<div class="sect">
        ${field('眉标（小节编号）', input('kicker', e.kicker, '01 / 循环层'))}
        ${field('标题', input('text', e.text))}
        ${field('层级', select('level', e.level, [[1, '一级标题'], [2, '二级标题']]))}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'text') {
      return `<div class="sect">
        ${field('版式', select('variant', e.variant, [['body', '正文'], ['quote', '引言 / 结论']]))}
        ${field('内容', area('html', U.htmlToText(e.html), 8), '回车分段；画布内双击可富文本编辑')}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'note') {
      return `<div class="sect">
        ${field('色调', select('tone', e.tone, [['idea', '紫 · 观点'], ['risk', '橙 · 风险'], ['todo', '粉 · 待办'], ['data', '青 · 数据']]))}
        ${field('标题', input('title', e.title))}
        ${field('内容', area('html', U.htmlToText(e.html), 5))}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'image') {
      const ms = Marks.norm(e) || [];
      const kinds = ms.reduce((m, k) => ((m[k.kind] = (m[k.kind] || 0) + 1), m), {});
      const KL = { arrow: '箭头', pen: '画笔', text: '文字', rect: '矩形', ellipse: '椭圆', mosaic: '马赛克', highlight: '高亮' };
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('说明', input('caption', e.caption))}
        <div class="row2">
          <button class="btn wide" data-act="pick-image">${e.src ? '替换图片' : '上传图片'}</button>
          <button class="btn wide ghost" data-act="reset-crop">复位裁切</button>
        </div>
        <button class="btn wide violet img-edit-btn" data-act="edit-image">
          <svg viewBox="0 0 14 14" fill="none"><path d="M9.2 1.8l3 3-7.4 7.4-3.6.6.6-3.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          编辑图片 · 标注
        </button>
        <p class="fld-h">打开可视化编辑器：箭头 / 画笔 / 文字 / 框选 / 马赛克 / 高亮，拖蓝色手柄可改尺寸。</p>
        ${field('缩放（裁切）', `<input type="range" class="rng" data-path="zoom" min="1" max="3" step="0.02" value="${e.zoom || 1}">`)}
        <div class="row2">
          ${field('水平偏移', `<input type="range" class="rng" data-path="ox" min="-50" max="50" step="1" value="${e.ox || 0}">`)}
          ${field('垂直偏移', `<input type="range" class="rng" data-path="oy" min="-50" max="50" step="1" value="${e.oy || 0}">`)}
        </div>
        <div class="row2">
          ${field('图片填充', select('fit', e.fit, [['contain', '完整显示'], ['cover', '填满裁切']]))}
          ${field('圆角', `<input type="range" class="rng" data-path="radius" min="0" max="30" step="1" value="${e.radius == null ? 14 : e.radius}">`)}
        </div>
        ${field('投影', select('shadow', e.shadow === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
      </div>
      <div class="sect">
        <div class="sect-t">标注 <span class="dim">${ms.length} 条</span>
          <button class="mini-btn" data-act="edit-image" title="打开编辑器">＋</button>
        </div>
        ${
          ms.length
            ? `<div class="mark-sum">${Object.keys(kinds)
                .map((k) => `<span class="mark-pill">${KL[k] || k} ${kinds[k]}</span>`)
                .join('')}</div>
               <button class="btn wide ghost" data-act="clear-marks">清除全部标注</button>`
            : `<p class="fld-h">还没有标注。点上面的「编辑图片」可以直接在图上画箭头、加文字。</p>`
        }
      </div>`;
    }
    if (e.type === 'table') {
      const s = Tables.size(e);
      const act = Tables.activeCell();
      const cur = act && act.id === e.id ? act : { r: e.header === false ? 0 : Math.min(1, s.rows - 1), c: 0 };
      const rr = Math.min(Math.max(0, cur.r), s.rows - 1);
      const cc = Math.min(Math.max(0, cur.c), s.cols - 1);
      const val = (e.rows[rr] && e.rows[rr][cc]) || '';
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('说明（表下小字）', input('caption', e.caption, '可留空'))}
        <button class="btn wide violet" data-act="edit-window">打开表格编辑窗口…</button>
        <div class="row2">
          ${field('首行表头', select('header', e.header === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
          ${field('斑马纹', select('zebra', e.zebra === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
        </div>
        <div class="row2">
          ${field('行高', select('density', e.density || 'normal', [['compact', '紧凑'], ['normal', '标准'], ['loose', '宽松']]))}
          ${field('对齐', select('align', e.align || 'left', [['left', '居左'], ['center', '居中'], ['right', '居右']]))}
        </div>
        <div class="row2">
          ${field('列宽', select('__widths', Tables.widthMode(e), [['auto', '自动'], ['even', '等宽'], ['first', '首列加宽']]))}
          ${field('首列强调', select('firstCol', e.firstCol ? 'on' : 'off', [['on', '加粗'], ['off', '不强调']]))}
        </div>
      </div>
      <div class="sect">
        <div class="sect-t">单元格 <span class="dim">R${rr + 1} · C${cc + 1} / 共 ${s.rows}×${s.cols}</span></div>
        ${field('内容', area(`rows.${rr}.${cc}`, val, 3), '画布内双击格子也能直接改；Tab 下一格 · Enter 下一行')}
        <div class="tbl-ops">
          <button class="btn sm ghost" data-act="row-above">上方插入行</button>
          <button class="btn sm ghost" data-act="row-below">下方插入行</button>
          <button class="btn sm ghost" data-act="col-left">左侧插入列</button>
          <button class="btn sm ghost" data-act="col-right">右侧插入列</button>
          <button class="btn sm danger" data-act="row-del">删除本行</button>
          <button class="btn sm danger" data-act="col-del">删除本列</button>
        </div>
        <p class="fld-h">点画布里的任一格子可切换当前单元格，行列操作都作用在它上面。</p>
      </div>`;
    }
    if (e.type === 'flowchart') {
      const sel = Canvas.getSelNode() || (e.nodes[0] && e.nodes[0].id);
      const node = e.nodes.find((n) => n.id === sel);
      const depth = {};
      const kids = {};
      e.nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
      const walk = (n, d) => { depth[n.id] = d; (kids[n.id] || []).forEach((c) => walk(c, d + 1)); };
      e.nodes.filter((n) => !n.parentId).forEach((n) => walk(n, 0));

      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        <div class="sect-t">节点 <span class="dim">${e.nodes.length}</span>
          <button class="mini-btn" data-act="add-root" title="新增根节点">＋</button>
        </div>
        <div class="node-list">
          ${e.nodes
            .map(
              (n, i) => `<div class="node-item ${n.id === sel ? 'on' : ''}" data-nid="${n.id}" style="--d:${depth[n.id] || 0}">
                <span class="nd-dot ${n.kind}"></span>
                <span class="nd-t">${E(n.text || '未命名')}</span>
                ${n.label ? `<span class="nd-lb">${E(n.label)}</span>` : ''}
                <span class="nd-i">${i + 1}</span>
              </div>`
            )
            .join('')}
        </div>
        ${
          node
            ? `<div class="node-edit">
                ${field('节点文字', `<textarea class="ipt ta" rows="2" data-path="__node.text">${E(node.text)}</textarea>`)}
                ${field('节点类型', `<select class="ipt sel" data-path="__node.kind">
                  ${[['start', '开始 / 结束胶囊'], ['process', '处理步骤'], ['decision', '判断（菱形）'], ['end', '结束']]
                    .map((o) => `<option value="${o[0]}" ${o[0] === node.kind ? 'selected' : ''}>${o[1]}</option>`)
                    .join('')}
                </select>`)}
                ${node.parentId ? field('分支标签', input('__node.label', node.label, '是 / 否')) : ''}
                <div class="row3">
                  <button class="btn sm" data-act="child">＋ 子节点</button>
                  <button class="btn sm ghost" data-act="sibling">＋ 同级</button>
                  <button class="btn sm danger" data-act="del-node">删除</button>
                </div>
              </div>`
            : ''
        }
        <p class="fld-h">点击节点可在画布中被选中；布局自动计算，无需手动连线。</p>
      </div>`;
    }
    return '';
  }

  function actions(e) {
    return `<div class="sect act-sect">
      <div class="row2">
        <button class="btn sm ghost" data-act="front">置顶</button>
        <button class="btn sm ghost" data-act="back">置底</button>
      </div>
      <div class="row2">
        <button class="btn sm ghost" data-act="dup">复制副本</button>
        <button class="btn sm danger" data-act="del">删除组件</button>
      </div>
      <div class="row2">
        <label class="fld-inline"><span>X</span><input type="number" class="ipt num" data-path="x" value="${Math.round(e.x)}"></label>
        <label class="fld-inline"><span>Y</span><input type="number" class="ipt num" data-path="y" value="${Math.round(e.y)}"></label>
      </div>
    </div>`;
  }

  /* ---------------- 交互 ---------------- */
  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    if (o) o[parts[parts.length - 1]] = val;
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => Store.end('prop'), 550);
  }

  function onInput(ev) {
    const t = ev.target;
    const path = t.dataset.path;
    if (!path) return;
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;
    if (!e) return;

    let val = t.type === 'number' || t.type === 'range' ? Number(t.value) : t.value;
    if (path === 'html') val = U.textToHtml(val);
    if (path === 'shadow' || path === 'header' || path === 'zebra' || path === 'firstCol') val = val === 'on';

    if (path === '__widths') {
      Store.begin();
      Tables.widthPreset(e, val);
      Store.end('table');
      Canvas.rebuild(id);
      refreshInspector(true);
      return;
    }
    Store.begin();

    if (path.indexOf('__node.') === 0) {
      const nodeId = Canvas.getSelNode();
      const node = e.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      node[path.slice(7)] = val;
    } else {
      // 数字路径（annotations.0.lx）
      const parts = path.split('.');
      if (parts.length === 3) {
        const arr = e[parts[0]];
        if (arr && arr[+parts[1]]) arr[+parts[1]][parts[2]] = val;
      } else {
        e[path] = val;
      }
    }
    Canvas.rebuild(id);
    refreshOutline();
    scheduleCommit();
  }

  function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;

    if (ev.target.closest('.node-item')) {
      const nid = ev.target.closest('.node-item').dataset.nid;
      Canvas.select(id, nid);
      refreshInspector(true);
      return;
    }
    if (!btn || !e) return;
    const act = btn.dataset.act;

    if (act === 'pick-image') {
      const inp = document.getElementById('file-image');
      inp.dataset.mode = 'replace';
      inp.click();
      return;
    }
    if (act === 'reset-crop') {
      Store.commit(() => { e.zoom = 1; e.ox = 0; e.oy = 0; }, 'crop');
      Canvas.rebuild(id); refreshInspector(true);
      return;
    }
    if (act === 'edit-image') {
      if (window.ImgEditor) ImgEditor.open(id);
      return;
    }
    if (act === 'edit-window') {
      Canvas.openEditor(id);
      return;
    }
    if (act === 'clear-marks') {
      Store.begin();
      e.marks = [];
      delete e.annotations;
      Store.end('marks');
      Canvas.rebuild(id);
      refreshInspector(true);
      U.toast('已清除标注');
      return;
    }
    if (act === 'front') { Store.front(id); Canvas.renderAll(); refreshInspector(true); return; }
    if (act === 'back') { Store.back(id); Canvas.renderAll(); refreshInspector(true); return; }
    if (act === 'dup') {
      const c = Store.duplicate(id);
      Canvas.renderAll();
      if (c) Canvas.select(c.id);
      refreshInspector(true);
      return;
    }
    if (act === 'del') {
      Store.remove(id);
      Canvas.renderAll();
      Canvas.select(null);
      return;
    }
    if (act === 'add-root') {
      addNode(e, null, 'process');
      return;
    }
    if (act === 'child') { addNode(e, Canvas.getSelNode(), 'process'); return; }
    if (act === 'sibling') {
      const n = e.nodes.find((x) => x.id === Canvas.getSelNode());
      addNode(e, n ? n.parentId : null, n ? n.kind : 'process');
      return;
    }
    if (act === 'del-node') { deleteNode(); return; }
    if (/^(row|col)-(above|below|left|right|del)$/.test(act)) {
      tableOp(e, act);
      return;
    }
  }

  /* ---------------- 表格行列操作 ---------------- */
  function tableOp(e, act) {
    const id = e.id;
    const s0 = Tables.size(e);
    const act0 = Tables.activeCell();
    const r = act0 && act0.id === id ? act0.r : Math.max(0, s0.rows - 1);
    const c = act0 && act0.id === id ? act0.c : Math.max(0, s0.cols - 1);

    Store.begin();
    let curR = r, curC = c;
    if (act === 'row-above') curR = Tables.insertRow(e, r);
    else if (act === 'row-below') curR = Tables.insertRow(e, r + 1);
    else if (act === 'col-left') curC = Tables.insertCol(e, c);
    else if (act === 'col-right') curC = Tables.insertCol(e, c + 1);
    else if (act === 'row-del') {
      const res = Tables.deleteRow(e, r);
      if (res === false) { Store.end('table'); U.toast('至少保留一行'); return; }
      curR = Math.min(res, Tables.size(e).rows - 1);
    } else if (act === 'col-del') {
      const res = Tables.deleteCol(e, c);
      if (res === false) { Store.end('table'); U.toast('至少保留一列'); return; }
      curC = Math.min(res, Tables.size(e).cols - 1);
    }
    Store.end('table');

    const s1 = Tables.size(e);
    Tables.setActive(id, Math.min(curR, s1.rows - 1), Math.min(curC, s1.cols - 1), true);
    Canvas.rebuild(id);
    refreshInspector(true);
    refreshOutline();
  }

  /* ---------------- 流程图节点操作 ---------------- */
  function nodeIndexAfterSubtree(nodes, id) {
    const kids = {};
    nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    let last = nodes.findIndex((n) => n.id === id);
    const walk = (nid) => {
      (kids[nid] || []).forEach((c) => {
        const i = nodes.findIndex((n) => n.id === c.id);
        if (i > last) last = i;
        walk(c.id);
      });
    };
    walk(id);
    return last + 1;
  }

  function addNode(e, parentId, kind) {
    Store.begin();
    const n = { id: U.uid('n'), parentId: parentId || null, kind: kind || 'process', text: '新节点' };
    let idx = e.nodes.length;
    if (parentId) idx = nodeIndexAfterSubtree(e.nodes, parentId);
    e.nodes.splice(idx, 0, n);
    Store.end('node');
    Canvas.renderAll();
    Canvas.select(e.id, n.id);
    refreshInspector(true);
    const ta = inspector.querySelector('textarea[data-path="__node.text"]');
    if (ta) { ta.focus(); ta.select(); }
  }

  function deleteNode() {
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;
    const nid = Canvas.getSelNode();
    if (!e || !nid) return;
    Store.begin();
    const kids = {};
    e.nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    const del = new Set();
    (function walk(x) { del.add(x); (kids[x] || []).forEach((c) => walk(c.id)); })(nid);
    if (del.size >= e.nodes.length) {
      Store.end('node');
      U.toast('至少保留一个节点');
      return;
    }
    e.nodes = e.nodes.filter((n) => !del.has(n.id));
    Store.end('node');
    Canvas.renderAll();
    const next = e.nodes[0];
    Canvas.select(e.id, next ? next.id : null);
    refreshInspector(true);
  }

  return { init, refreshOutline, refreshInspector, deleteNode, refresh: () => { refreshOutline(); refreshInspector(); } };
})();
