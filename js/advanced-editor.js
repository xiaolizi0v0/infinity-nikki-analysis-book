/* ------------------------------------------------------------------
 *  advanced-editor.js — 时间轴 / 循环图 / 层级图 / 矩阵 / 对比卡 /
 *  分组框 / 分栏 / 视频 GIF / 语义卡 的独立可视化编辑窗口。
 *
 *  卡片本身就是编辑区：文字可点改，节点 / 点位可直接拖，
 *  每个类型有自己的可编辑子组件和一条轻量工具栏。
 *  所有修改先写在草稿里，点「完成」才写回 Store，可 Esc 取消。
 * ------------------------------------------------------------------ */
window.AdvancedEditor = (function () {
  const E = U.esc;
  const TYPE = {
    timeline: '时间轴',
    cycle: '循环图',
    hierarchy: '层级图',
    matrix: '矩阵',
    compare: '对比卡',
    group: '分组框',
    columns: '分栏',
    video: '视频 / GIF',
    semantic: '语义卡',
  };
  const TIP = {
    timeline: '在卡片上直接改日期、标题和说明；用 ↑↓ 调整顺序，拖节点重排。',
    cycle: '拖动节点环绕中心调整顺序；点节点文字改标签与说明。',
    hierarchy: '点每层的文字直接改；拖层条或 ↑↓ 调整上下关系。',
    matrix: '拖圆点改变 X / Y 位置；点标签、象限和轴标题直接改。',
    compare: '点 A / B 两栏的标题和正文直接改写，底部结论也能直接编辑。',
    group: '分组框里的成员卡可直接移出；标题和强调色在卡片上改。',
    columns: '点每栏标题和正文直接改；上方切换两栏 / 三栏。',
    video: '点画面换媒体；标题和说明直接改；URL 或本地文件都在上方。',
    semantic: '点标题、正文和出处直接改；上方切换观点 / 证据 / 结论 / 问题。',
  };
  const TONES = [
    ['violet', '紫 · 强调'],
    ['mint', '青 · 数据'],
    ['amber', '橙 · 风险'],
    ['pink', '粉 · 待办'],
    ['blue', '蓝 · 冷静'],
    ['slate', '灰 · 容器'],
  ];
  const NODE_MAX = { timeline: 6, cycle: 6, hierarchy: 5, matrix: 10 };
  const NODE_MIN = { timeline: 3, cycle: 3, hierarchy: 2, matrix: 1 };

  let ov = null;
  let cur = null;
  let draft = null;
  let barEl = null;
  let prevEl = null;
  let fileEl = null;
  let drag = null;

  const can = (type) => !!TYPE[type];
  const isOpen = () => !!ov;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const cut = (s, n) => {
    s = s == null ? '' : String(s).trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  /* ---------------- 基础工具 ---------------- */
  function toneOf(el, fallback) {
    return el && el.tone || fallback || 'violet';
  }
  function advHead(chip, title, count) {
    return `<div class="adv-head"><span class="adv-chip">${E(chip)}</span>` +
      `<div class="adv-title" data-edit="title">${E(title || '')}</div>` +
      `<span class="adv-count">${E(count || '')}</span></div>`;
  }
  function toneButtons(value) {
    return `<div class="ae-tone-row">` +
      TONES.map(([v, l]) =>
        `<button type="button" class="ae-tone tone-${v}${v === value ? ' on' : ''}" data-tone="${v}" title="${E(l)}" aria-label="${E(l)}"></button>`
      ).join('') + `</div>`;
  }
  function seg(opts, current, attr) {
    return `<div class="ae-seg">` +
      opts.map(([v, l]) =>
        `<button type="button" class="ae-tbtn${String(v) === String(current) ? ' on' : ''}" data-${attr}="${E(v)}">${E(l)}</button>`
      ).join('') + `</div>`;
  }
  function addBtn(kind, label, disabled) {
    return `<button type="button" class="ae-tbtn primary" data-add="${E(kind)}"${disabled ? ' disabled' : ''}>＋ ${E(label)}</button>`;
  }
  function bar() {
    const t = draft.type;
    let tools = '';
    if (t === 'timeline') {
      tools = seg([['h', '横向'], ['v', '纵向']], draft.orientation || 'h', 'set-orientation') +
        toneButtons(toneOf(draft, 'blue')) +
        addBtn('nodes', '添加节点', (draft.nodes || []).length >= NODE_MAX.timeline);
    } else if (t === 'cycle') {
      tools = toneButtons(toneOf(draft, 'violet')) +
        addBtn('nodes', '添加节点', (draft.nodes || []).length >= NODE_MAX.cycle);
    } else if (t === 'hierarchy') {
      tools = seg([['pyramid', '金字塔'], ['layers', '等宽分层']], draft.style || 'pyramid', 'set-style') +
        toneButtons(toneOf(draft, 'blue')) +
        addBtn('nodes', '添加层', (draft.nodes || []).length >= NODE_MAX.hierarchy);
    } else if (t === 'matrix') {
      tools = toneButtons(toneOf(draft, 'blue')) +
        addBtn('points', '添加点位', (draft.points || []).length >= NODE_MAX.matrix);
    } else if (t === 'compare') {
      tools = toneButtons(toneOf(draft, 'blue'));
    } else if (t === 'columns') {
      tools = seg([['2', '两栏'], ['3', '三栏']], String((draft.cols || []).length || 2), 'set-cols') +
        toneButtons(toneOf(draft, 'slate'));
    } else if (t === 'video') {
      const dataSrc = /^data:/i.test(draft.src || '');
      tools = `<input class="ae-url" data-video-url value="${dataSrc ? '' : E(draft.src || '')}" placeholder="${dataSrc ? '已嵌入本地媒体，粘贴 URL 可替换' : '粘贴视频 / GIF URL'}">` +
        `<button type="button" class="ae-tbtn" data-video-apply>应用</button>` +
        `<button type="button" class="ae-tbtn primary" data-video-pick>上传本地媒体</button>` +
        (draft.src ? `<button type="button" class="ae-tbtn ghost" data-video-clear>清除</button>` : '') +
        `<button type="button" class="ae-tbtn${draft.fit === 'contain' ? ' on' : ''}" data-video-fit>完整显示</button>` +
        `<button type="button" class="ae-tbtn${draft.loop ? ' on' : ''}" data-video-loop>循环</button>`;
    } else if (t === 'semantic') {
      const variants = [['insight', '观点'], ['evidence', '证据'], ['conclusion', '结论'], ['question', '问题']];
      tools = `<div class="ae-seg is-type">` +
        variants.map(([v, l]) => `<button type="button" class="ae-tbtn${(draft.variant || 'insight') === v ? ' on' : ''}" data-set-variant="${v}">${l}</button>`).join('') +
        `</div>`;
    } else if (t === 'group') {
      tools = toneButtons(toneOf(draft, 'slate'));
    }
    return `<div class="ae-bar" id="ae-bar">` +
      `<div class="ae-bar-title"><span class="ae-mode-dot"></span><b>可视化编辑</b>` +
      `<span class="ae-bar-hint">${E(TIP[t])}</span></div>` +
      `<div class="ae-bar-tools">${tools}</div>` +
      `</div>`;
  }

  /* ---------------- 场景 ---------------- */
  function timelineScene() {
    return `<div class="ae-live-card type-timeline">${Renderer.inner(draft)}</div>`;
  }
  function hierarchyScene() {
    return `<div class="ae-live-card type-hierarchy">${Renderer.inner(draft)}</div>`;
  }
  function compareScene() {
    return `<div class="ae-live-card type-compare">${Renderer.inner(draft)}</div>`;
  }
  function columnsScene() {
    return `<div class="ae-live-card type-columns">${Renderer.inner(draft)}</div>`;
  }
  function semanticScene() {
    return `<div class="ae-live-card type-semantic">${Renderer.inner(draft)}</div>`;
  }
  function videoScene() {
    return `<div class="ae-live-card type-video">${Renderer.inner(draft)}</div>`;
  }
  function groupScene() {
    return `<div class="ae-live-card type-group">${Renderer.inner(draft)}</div>`;
  }

  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function cycleScene() {
    const all = Array.isArray(draft.nodes) ? draft.nodes : [];
    const visible = all.map((n, i) => ({ n, i })).filter(({ n }) => n && n.label);
    const list = visible.slice(0, 6);
    const n = Math.max(1, list.length);
    const W = 460, H = 390, cx = W / 2, cy = H / 2 + 4, R = 128, NR = 40;
    const uid = 'aec-' + String(draft.id || 'cycle').replace(/[^a-z0-9-]/gi, '');
    let arcs = '';
    if (n > 1) {
      for (let i = 0; i < n; i++) {
        const a1 = i * 360 / n, a2 = (i + 1) * 360 / n;
        const gap = Math.min(26, 360 / n * 0.28);
        const s = polar(cx, cy, R + 22, a1 + gap);
        const t = polar(cx, cy, R + 22, a2 - gap);
        arcs += `<path class="cyc-arc" d="M${s.x.toFixed(1)} ${s.y.toFixed(1)} A${R + 22} ${R + 22} 0 0 1 ${t.x.toFixed(1)} ${t.y.toFixed(1)}" marker-end="url(#${uid}-ar)"/>`;
      }
    }
    const nodeHtml = list.map(({ n: item, i: raw }, vi) => {
      const p = polar(cx, cy, R, vi * 360 / n);
      return `<div class="ae-cy-node" data-cy-index="${raw}" style="left:${(p.x / W * 100).toFixed(2)}%;top:${(p.y / H * 100).toFixed(2)}%">` +
        `<span class="ae-drag-handle" data-node-drag="nodes" data-nidx="${raw}" title="拖动排序">⠿</span>` +
        `<div class="ae-cy-label" data-node-field="label" data-coll="nodes" data-index="${raw}">${E(item.label || '')}</div>` +
        `<div class="ae-cy-note" data-node-field="note" data-coll="nodes" data-index="${raw}">${E(item.note || '')}</div>` +
        `<div class="ae-node-tools">` +
        `<button type="button" data-nup="nodes" data-nidx="${raw}" title="上移"${raw === 0 ? ' disabled' : ''}>↑</button>` +
        `<button type="button" data-ndown="nodes" data-nidx="${raw}" title="下移"${raw === all.length - 1 ? ' disabled' : ''}>↓</button>` +
        `<button type="button" class="danger" data-ndel="nodes" data-nidx="${raw}" title="删除">×</button>` +
        `</div>` +
        `</div>`;
    }).join('');
    return `<div class="adv-card cyc-card ae-live-card tone-${toneOf(draft, 'violet')}">` +
      advHead('循环', draft.title || '核心循环', `${list.length} 节点`) +
      `<div class="cyc-stage ae-cy-stage">` +
      `<svg class="cyc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${E(draft.title || '核心循环')}">` +
      `<defs><marker id="${uid}-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>` +
      `<circle class="cyc-orbit" cx="${cx}" cy="${cy}" r="${R + 22}"/>` +
      arcs +
      `<circle class="cyc-center" cx="${cx}" cy="${cy}" r="46"/>` +
      `</svg>` +
      `<div class="ae-cy-center" data-edit="center" contenteditable="true" spellcheck="false">${E(draft.center || '留存')}</div>` +
      (list.length ? nodeHtml : `<div class="ae-cy-empty">至少添加 3 个节点，才能形成循环。</div>`) +
      `</div>` +
      `</div>`;
  }

  function matrixScene() {
    const all = Array.isArray(draft.points) ? draft.points : [];
    const visible = all.map((p, i) => ({ p, i })).filter(({ p }) => p && p.label);
    const list = visible;
    const q = draft.quadrants || {};
    const W = 460, H = 386, X = 60, Y = 42, PW = 340, PH = 286;
    const xLeft = (v) => (X + clamp(Number(v) || 0, 0, 100) / 100 * PW) / W * 100;
    const yTop = (v) => (Y + (100 - clamp(Number(v) || 0, 0, 100)) / 100 * PH) / H * 100;
    const quad = [
      ['tr', q.tr || '重点投入', 75, 6.2],
      ['tl', q.tl || '谨慎评估', 25, 6.2],
      ['br', q.br || '快速试点', 75, 77.7],
      ['bl', q.bl || '暂缓', 25, 77.7],
    ].map(([key, name, left, top]) =>
      `<div class="ae-mx-q is-${key}" data-edit="quadrants.${key}" style="left:${left}%;top:${top}%">${E(name)}</div>`
    ).join('');
    const points = list.map(({ p, i: raw }) =>
      `<div class="ae-mx-point" data-point-index="${raw}" style="left:${xLeft(p.x).toFixed(2)}%;top:${yTop(p.y).toFixed(2)}%">` +
      `<button type="button" class="ae-mx-tone tone-${p.tone || 'violet'}" data-point-tone="${raw}" title="切换点位颜色"></button>` +
      `<span class="ae-mx-dot tone-${p.tone || 'violet'}" data-point-dot="${raw}" title="拖动改变 X / Y"></span>` +
      `<span class="ae-mx-plabel" data-node-field="label" data-coll="points" data-index="${raw}">${E(p.label || '')}</span>` +
      `<button type="button" class="ae-mx-del" data-point-del="${raw}" title="删除点位">×</button>` +
      `</div>`
    ).join('');
    return `<div class="adv-card mx-card ae-live-card tone-${toneOf(draft, 'blue')}">` +
      advHead('矩阵', draft.title || '机会判断矩阵', `${list.length} 点`) +
      `<div class="mx-stage ae-mx-stage">` +
      `<div class="ae-mx-board">` +
      `<svg class="mx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${E(draft.title || '矩阵')}">` +
      `<rect class="mx-q is-tr" x="${X + PW / 2}" y="${Y}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-tl" x="${X}" y="${Y}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-br" x="${X + PW / 2}" y="${Y + PH / 2}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-bl" x="${X}" y="${Y + PH / 2}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<path class="mx-axis" d="M${X} ${Y + PH / 2}h${PW}M${X + PW / 2} ${Y}v${PH}"/>` +
      `<rect class="mx-frame" x="${X}" y="${Y}" width="${PW}" height="${PH}"/>` +
      `</svg>` +
      quad +
      `<div class="ae-mx-axis is-x" data-edit="xLabel" contenteditable="true" spellcheck="false">${E(draft.xLabel || '玩家价值 →')}</div>` +
      `<div class="ae-mx-axis is-y" data-edit="yLabel" contenteditable="true" spellcheck="false">${E(draft.yLabel || '实现成本 ↑')}</div>` +
      points +
      (list.length ? '' : `<div class="ae-mx-empty">点上方「＋ 添加点位」，再把圆点拖到目标位置。</div>`) +
      `</div>` +
      `</div>` +
      `</div>`;
  }

  function scene() {
    if (draft.type === 'cycle') return cycleScene();
    if (draft.type === 'matrix') return matrixScene();
    if (draft.type === 'timeline') return timelineScene();
    if (draft.type === 'hierarchy') return hierarchyScene();
    if (draft.type === 'compare') return compareScene();
    if (draft.type === 'columns') return columnsScene();
    if (draft.type === 'video') return videoScene();
    if (draft.type === 'semantic') return semanticScene();
    return groupScene();
  }

  /* ---------------- 计数与重绘 ---------------- */
  function countText() {
    if (draft.type === 'timeline' || draft.type === 'cycle' || draft.type === 'hierarchy') {
      return `${(draft.nodes || []).length} ${draft.type === 'hierarchy' ? '层' : '节点'}`;
    }
    if (draft.type === 'matrix') return `${(draft.points || []).length} 点`;
    if (draft.type === 'compare') return 'A/B 两栏';
    if (draft.type === 'columns') return `${(draft.cols || []).length || 2} 栏`;
    if (draft.type === 'video') return /^data:/i.test(draft.src || '') ? '本地媒体' : (draft.src ? '外部 URL' : '未选媒体');
    if (draft.type === 'semantic') return ({ insight: '观点', evidence: '证据', conclusion: '结论', question: '问题' }[draft.variant] || '观点');
    if (draft.type === 'group') return `${(draft.members || []).length} 个组件`;
    return '直接编辑';
  }
  function refreshCount() {
    const q = ov && ov.querySelector('#ae-count');
    if (q) q.textContent = countText();
  }
  function renderAll() {
    if (!ov) return;
    if (barEl) barEl.innerHTML = bar();
    prevEl.className = 'ae-preview type-' + draft.type;
    try {
      prevEl.innerHTML = scene();
    } catch (err) {
      prevEl.innerHTML = `<div class="ae-empty">工作区渲染失败：${E(err.message || err)}</div>`;
    }
    decorate();
    wireEditable();
    refreshCount();
  }

  function decorateNodeTools() {
    if (draft.type !== 'timeline' && draft.type !== 'hierarchy') return;
    const selector = draft.type === 'timeline' ? '.tl-node[data-node-index]' : '.hier-row[data-node-index]';
    prevEl.querySelectorAll(selector).forEach((node) => {
      const i = Number(node.dataset.nodeIndex);
      if (!Number.isInteger(i)) return;
      const all = draft.nodes || [];
      node.insertAdjacentHTML('afterbegin', `<span class="ae-drag-handle" data-node-drag="nodes" data-nidx="${i}" title="拖动排序">⠿</span>`);
      node.insertAdjacentHTML('beforeend',
        `<div class="ae-node-tools">` +
        `<button type="button" data-nup="nodes" data-nidx="${i}" title="上移"${i === 0 ? ' disabled' : ''}>↑</button>` +
        `<button type="button" data-ndown="nodes" data-nidx="${i}" title="下移"${i === all.length - 1 ? ' disabled' : ''}>↓</button>` +
        `<button type="button" class="danger" data-ndel="nodes" data-nidx="${i}" title="删除">×</button>` +
        `</div>`);
    });
  }

  function decorateCompare() {
    if (draft.type !== 'compare') return;
    const v = prevEl.querySelector('.cmp-verdict');
    if (v) {
      const span = v.querySelector('span');
      if (span) {
        span.setAttribute('data-edit', 'verdict');
        v.removeAttribute('data-edit');
      }
    } else {
      const card = prevEl.querySelector('.cmp-card');
      if (card) card.insertAdjacentHTML('beforeend', `<div class="ae-add-inline" data-add="verdict">＋ 添加底部结论</div>`);
    }
  }

  function decorateGroup() {
    if (draft.type !== 'group') return;
    const card = prevEl.querySelector('.grp-card');
    if (!card) return;
    const body = card.querySelector('.grp-body');
    const members = Array.isArray(draft.members) ? draft.members : [];
    if (!body) return;
    body.innerHTML = members.length
      ? `<div class="ae-grp-members">` + members.map((id, i) => {
          const child = Store.el(id);
          const label = window.Groups && Groups.labelOfMember ? Groups.labelOfMember(id) : (child ? (Store.typeLabel ? Store.typeLabel(child.type) : child.type) : '已删除组件');
          return `<div class="ae-grp-member">` +
            `<span class="ae-grp-num">${String(i + 1).padStart(2, '0')}</span>` +
            `<b>${E(label)}</b>` +
            `<small>${E(child ? (Store.typeLabel ? Store.typeLabel(child.type) : child.type) : '已删除')}</small>` +
            `<button type="button" class="ae-grp-remove" data-grm="${i}" title="移出分组">移出</button>` +
            `</div>`;
        }).join('') + `</div>`
      : `<div class="ae-grp-empty">空分组 · 关闭窗口后多选组件，再点「组合为分组框」加入成员</div>`;
  }

  function decorateVideo() {
    if (draft.type !== 'video') return;
    const frame = prevEl.querySelector('.vid-frame');
    if (frame && !draft.src) frame.classList.add('is-empty');
  }

  function decorate() {
    decorateNodeTools();
    decorateCompare();
    decorateGroup();
    decorateVideo();
  }

  /* ---------------- 直接编辑 ---------------- */
  function targetOf(el) {
    if (el.dataset.nodeField) {
      return {
        kind: 'node',
        coll: el.dataset.ncoll || el.dataset.coll,
        index: Number(el.dataset.nindex == null ? el.dataset.index : el.dataset.nindex),
        key: el.dataset.nodeField,
      };
    }
    const field = el.dataset.edit;
    if (!field) return null;
    if (el.dataset.coll != null && el.dataset.index != null) {
      return { kind: 'node', coll: el.dataset.coll, index: Number(el.dataset.index), key: field };
    }
    if (el.dataset.obj) return { kind: 'obj', obj: el.dataset.obj, key: field };
    return { kind: 'path', path: field, key: field };
  }
  function isHtmlTarget(t) {
    return t && ((t.kind === 'node' && t.key === 'html') || (t.kind === 'obj' && t.key === 'html') || (t.kind === 'path' && String(t.path).endsWith('.html')));
  }
  function isMultiline(t) {
    return isHtmlTarget(t) || ['body', 'note', 'caption', 'verdict'].includes(t && t.key);
  }
  function writeTarget(t, value) {
    if (!t) return;
    if (t.kind === 'node') {
      const row = (draft[t.coll] || [])[t.index];
      if (row) row[t.key] = value;
    } else if (t.kind === 'obj') {
      if (!draft[t.obj] || typeof draft[t.obj] !== 'object') draft[t.obj] = {};
      draft[t.obj][t.key] = value;
    } else if (t.kind === 'path') {
      const parts = String(t.path).split('.');
      const last = parts.pop();
      let obj = draft;
      parts.forEach((k) => {
        if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = /^\d+$/.test(k) ? [] : {};
        obj = obj[k];
      });
      obj[last] = value;
    }
  }

  function wireEditable() {
    prevEl.querySelectorAll('[data-edit],[data-node-field]').forEach((el) => {
      if (el.closest('.ae-node-tools')) return;
      const t = targetOf(el);
      if (!t) return;
      const html = isHtmlTarget(t);
      el.setAttribute('contenteditable', html ? 'true' : 'plaintext-only');
      el.setAttribute('spellcheck', 'false');
      el.dataset.aeEdit = '1';
      el.addEventListener('focus', () => el.classList.add('ae-editing'));
      el.addEventListener('blur', () => {
        el.classList.remove('ae-editing');
        if (html && !el.innerHTML.trim()) writeTarget(t, '');
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !isMultiline(t) && !ev.ctrlKey && !ev.metaKey) {
          ev.preventDefault();
          el.blur();
        }
      });
      el.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const text = ((ev.clipboardData && ev.clipboardData.getData('text/plain')) || '').replace(/\r/g, '');
        document.execCommand('insertText', false, text);
      });
      el.addEventListener('input', () => {
        const value = html ? el.innerHTML : el.innerText;
        writeTarget(t, value);
        refreshCount();
      });
    });
  }

  /* ---------------- 节点操作 ---------------- */
  function newNode(coll) {
    const t = draft.type;
    const n = ((Array.isArray(draft[coll]) ? draft[coll].length : 0) + 1);
    if (t === 'timeline') return { date: `0${n} 新阶段`, title: `新节点 ${n}`, note: '补充说明' };
    if (t === 'cycle') return { label: `新节点 ${n}`, note: '补充说明' };
    if (t === 'hierarchy') return { label: `新层级 ${n}`, note: '补充说明' };
    if (t === 'matrix') return { label: `新点位 ${n}`, x: 50, y: 50, tone: 'violet' };
    return {};
  }
  function focusNode(coll, index, field) {
    const q = prevEl.querySelector(`[data-ncoll="${coll}"][data-nindex="${index}"]`) ||
      prevEl.querySelector(`[data-coll="${coll}"][data-index="${index}"]`);
    if (!q) return;
    const target = field && q.querySelector ? q.querySelector(`[data-${field}]`) : q;
    const el = (target && target.isContentEditable) ? target : (q.matches('[contenteditable]') ? q : q.querySelector('[contenteditable]'));
    if (el) setTimeout(() => { el.focus(); el.select?.(); }, 20);
  }
  function addNode(coll) {
    const arr = draft[coll];
    if (!Array.isArray(arr)) return;
    const max = NODE_MAX[draft.type] || 10;
    if (arr.length >= max) return U.toast(`最多 ${max} 个节点，先删掉一个再加`);
    arr.push(newNode(coll));
    renderAll();
    focusNode(coll, arr.length - 1);
    U.toast('已添加，直接点文字改名');
  }
  function deleteNode(coll, i) {
    const arr = draft[coll];
    if (!Array.isArray(arr) || !arr[i]) return;
    const min = NODE_MIN[draft.type] || 1;
    if (arr.length <= min) return U.toast(`至少保留 ${min} 个节点`);
    arr.splice(i, 1);
    renderAll();
    refreshCount();
  }
  function moveNode(coll, i, dir) {
    const arr = draft[coll];
    if (!Array.isArray(arr)) return;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    renderAll();
    refreshCount();
  }
  function addPoint() {
    if (!Array.isArray(draft.points)) draft.points = [];
    if (draft.points.length >= NODE_MAX.matrix) return U.toast(`最多 ${NODE_MAX.matrix} 个点位`);
    draft.points.push(newNode('points'));
    renderAll();
    focusNode('points', draft.points.length - 1, 'label');
  }
  function deletePoint(i) {
    const arr = draft.points;
    if (!Array.isArray(arr) || !arr[i]) return;
    if (arr.length <= 1) return U.toast('至少保留 1 个点位');
    arr.splice(i, 1);
    renderAll();
    refreshCount();
  }
  function setCols(n) {
    n = clamp(Number(n) || 2, 2, 3);
    if (!Array.isArray(draft.cols)) draft.cols = [];
    while (draft.cols.length < n) draft.cols.push({ title: '新栏目', html: '<p>补充说明</p>' });
    while (draft.cols.length > n) draft.cols.pop();
  }

  /* ---------------- 视频 ---------------- */
  function readVideoFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      U.toast('本地媒体超过 2MB，建议改用视频 URL，避免工程文件过大');
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      draft.src = String(fr.result || '');
      draft.isGif = /gif/i.test(file.type) || /\.gif$/i.test(file.name);
      renderAll();
      U.toast(draft.isGif ? 'GIF 已嵌入，点完成写回' : '视频已嵌入，点完成写回');
    };
    fr.onerror = () => U.toast('读取文件失败');
    fr.readAsDataURL(file);
  }
  function clearVideo() {
    draft.src = '';
    draft.isGif = false;
    renderAll();
    U.toast('已清除媒体');
  }
  function applyVideoUrl() {
    const q = ov && ov.querySelector('[data-video-url]');
    if (!q) return;
    const v = q.value.trim();
    if (!v) return U.toast('先粘贴视频 URL');
    draft.src = v;
    draft.isGif = /\.(gif|webp)(\?|#|$)/i.test(v);
    renderAll();
    U.toast('媒体 URL 已更新，点完成写回');
  }

  /* ---------------- 事件 ---------------- */
  function action(el) {
    if (!el) return false;
    const add = el.closest('[data-add]');
    if (add) {
      if (add.dataset.add === 'nodes') addNode('nodes');
      else if (add.dataset.add === 'points') addPoint();
      else if (add.dataset.add === 'verdict') {
        draft.verdict = '一句话结论';
        renderAll();
        const v = prevEl.querySelector('[data-edit="verdict"]');
        if (v) setTimeout(() => { v.focus(); v.select?.(); }, 20);
      }
      return true;
    }
    const up = el.closest('[data-nup]');
    if (up) { moveNode(up.dataset.nup, Number(up.dataset.nidx), -1); return true; }
    const down = el.closest('[data-ndown]');
    if (down) { moveNode(down.dataset.ndown, Number(down.dataset.nidx), 1); return true; }
    const del = el.closest('[data-ndel]');
    if (del) { deleteNode(del.dataset.ndel, Number(del.dataset.nidx)); return true; }
    const rm = el.closest('[data-grm]');
    if (rm) {
      draft.members.splice(Number(rm.dataset.grm), 1);
      renderAll();
      return true;
    }
    const pd = el.closest('[data-point-del]');
    if (pd) { deletePoint(Number(pd.dataset.pointDel)); return true; }
    const pt = el.closest('[data-point-tone]');
    if (pt) {
      const i = Number(pt.dataset.pointTone);
      const p = (draft.points || [])[i];
      if (p) {
        const at = TONES.findIndex(([v]) => v === (p.tone || 'violet'));
        p.tone = TONES[(at + 1) % TONES.length][0];
        renderAll();
        refreshCount();
      }
      return true;
    }
    const tone = el.closest('[data-tone]');
    if (tone) { draft.tone = tone.dataset.tone; renderAll(); return true; }
    const ori = el.closest('[data-set-orientation]');
    if (ori) { draft.orientation = ori.dataset.setOrientation; renderAll(); return true; }
    const style = el.closest('[data-set-style]');
    if (style) { draft.style = style.dataset.setStyle; renderAll(); return true; }
    const cols = el.closest('[data-set-cols]');
    if (cols) { setCols(Number(cols.dataset.setCols)); renderAll(); return true; }
    const variant = el.closest('[data-set-variant]');
    if (variant) { draft.variant = variant.dataset.setVariant; renderAll(); return true; }
    if (el.closest('[data-video-pick]')) { if (fileEl) fileEl.click(); return true; }
    if (el.closest('[data-video-apply]')) { applyVideoUrl(); return true; }
    if (el.closest('[data-video-clear]')) { clearVideo(); return true; }
    if (el.closest('[data-video-fit]')) { draft.fit = draft.fit === 'contain' ? 'cover' : 'contain'; renderAll(); return true; }
    if (el.closest('[data-video-loop]')) { draft.loop = !draft.loop; renderAll(); return true; }
    return false;
  }

  function onOverlayClick(ev) {
    if (ev.target === ov) return close();
    const ae = ev.target.closest('[data-ae]');
    if (ae) {
      if (ae.dataset.ae === 'close' || ae.dataset.ae === 'cancel') return close();
      if (ae.dataset.ae === 'save') return save();
      return;
    }
    if (action(ev.target)) return;
    if (draft.type === 'video' && ev.target.closest('.vid-frame') && !draft.src) {
      if (fileEl) fileEl.click();
    }
  }

  function onOverlayChange(ev) {
    if (ev.target && ev.target.id === 'ae-video-file') readVideoFile(ev.target.files && ev.target.files[0]);
  }

  function onPointerDown(ev) {
    if (!ov) return;
    const dot = ev.target.closest('[data-point-dot]');
    if (dot) {
      const i = Number(dot.dataset.pointDot);
      const item = (draft.points || [])[i];
      if (!item) return;
      const board = prevEl && prevEl.querySelector('.ae-mx-board');
      if (!board) return;
      const r = board.getBoundingClientRect();
      drag = { kind: 'matrix', i, board: board, item: item, pointEl: dot.closest('.ae-mx-point'), moved: false };
      try { dot.setPointerCapture(ev.pointerId); } catch (err) {}
      ev.preventDefault();
      return;
    }
    if (!['timeline', 'hierarchy', 'cycle'].includes(draft.type)) return;
    const t = ev.target;
    if (t.closest('[contenteditable], button, .ae-node-tools, .ae-cy-label, .ae-cy-note')) return;
    const node = t.closest('.tl-node[data-node-index], .hier-row[data-node-index], .ae-cy-node');
    if (!node) return;
    const raw = Number(node.dataset.nodeIndex == null ? node.dataset.cyIndex : node.dataset.nodeIndex);
    if (!Number.isInteger(raw)) return;
    drag = { kind: 'reorder', node: node, from: raw, moved: false, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY };
    node.classList.add('is-dragging');
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (!drag) return;
    if (drag.kind === 'matrix') {
      const r = drag.board.getBoundingClientRect();
      const plot = {
        x: r.left + r.width * (60 / 460),
        y: r.top + r.height * (42 / 386),
        w: r.width * (340 / 460),
        h: r.height * (286 / 386),
      };
      const x = clamp((ev.clientX - plot.x) / plot.w * 100, 0, 100);
      const y = clamp(100 - (ev.clientY - plot.y) / plot.h * 100, 0, 100);
      drag.item.x = Math.round(x * 10) / 10;
      drag.item.y = Math.round(y * 10) / 10;
      drag.pointEl.style.left = ((60 + drag.item.x / 100 * 340) / 460 * 100).toFixed(2) + '%';
      drag.pointEl.style.top = ((42 + (100 - drag.item.y) / 100 * 286) / 386 * 100).toFixed(2) + '%';
      drag.moved = true;
      return;
    }
    if (drag.kind === 'reorder') {
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      if (Math.abs(ev.clientX - drag.sx) > 3 || Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
      const target = reorderTarget(ev.clientX, ev.clientY);
      prevEl.querySelectorAll('.ae-drop-target').forEach((el) => el.classList.remove('ae-drop-target'));
      if (target && target.node !== drag.node) target.node.classList.add('ae-drop-target');
    }
  }

  function reorderTarget(clientX, clientY) {
    const selector = draft.type === 'timeline' ? '.tl-node[data-node-index]' : draft.type === 'hierarchy' ? '.hier-row[data-node-index]' : '.ae-cy-node';
    const nodes = Array.from(prevEl.querySelectorAll(selector));
    if (!nodes.length) return null;
    let best = null;
    nodes.forEach((node) => {
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.pow(clientX - cx, 2) + Math.pow(clientY - cy, 2);
      if (!best || d < best.d) best = { node, d };
    });
    if (!best) return null;
    const raw = Number(best.node.dataset.nodeIndex == null ? best.node.dataset.cyIndex : best.node.dataset.nodeIndex);
    return Number.isInteger(raw) ? { node: best.node, raw: raw } : null;
  }

  function commitReorder(clientX, clientY) {
    if (!drag || drag.kind !== 'reorder' || !drag.moved) return;
    const target = reorderTarget(clientX, clientY);
    if (!target || target.raw === drag.from) return;
    const arr = draft.nodes;
    if (!Array.isArray(arr)) return;
    const item = arr.splice(drag.from, 1)[0];
    arr.splice(target.raw, 0, item);
    renderAll();
    U.toast('节点顺序已调整，点完成写回');
  }

  function onPointerUp(ev) {
    if (!drag) return;
    if (drag.kind === 'matrix' && drag.moved) {
      U.toast(`点位位置：X ${drag.item.x} / Y ${drag.item.y}`);
    } else if (drag.kind === 'reorder') {
      drag.node.classList.remove('is-dragging');
      prevEl.querySelectorAll('.ae-drop-target').forEach((el) => el.classList.remove('ae-drop-target'));
      commitReorder(ev.clientX, ev.clientY);
    }
    drag = null;
  }

  /* ---------------- 窗口壳 ---------------- */
  function shell() {
    const title = TYPE[draft.type];
    return `<div class="ed-panel wide ae-panel ae-visual" role="dialog" tabindex="-1" aria-label="${E(title)}编辑窗口">
      <div class="ed-head">
        <span class="ed-chip">${['group', 'columns', 'video', 'semantic'].includes(draft.type) ? 'P3 · 容器 / 素材' : 'P2 · 图解'}</span>
        <div class="ed-headtxt"><b>编辑${E(title)}</b><span>${E(TIP[draft.type])}</span></div>
        <span class="ed-count" id="ae-count">${E(countText())}</span>
        <button class="ed-x" type="button" data-ae="close" aria-label="关闭">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
      </div>
      <div class="ed-body ae-body">
        <div class="ae-main">
          <div class="ae-bar" id="ae-bar"></div>
          <div class="ae-stage"><div class="ae-preview" id="ae-preview"></div></div>
          <p class="ed-note ae-footnote">卡片就是编辑区：点文字直接改，拖节点 / 点位调整；点「完成」后写回画布。位置和尺寸仍在画布上调整。</p>
        </div>
      </div>
      <input type="file" class="ae-file" id="ae-video-file" accept="video/*,image/gif,image/*">
      <div class="ed-foot">
        <span class="ed-meta">${E(title)} · 草稿编辑，完成后写回</span>
        <span class="ed-tiphint"><kbd>Esc</kbd> 取消 · <kbd>Ctrl/⌘ + Enter</kbd> 完成</span>
        <button class="ed-btn ghost" type="button" data-ae="cancel">取消</button>
        <button class="ed-btn primary" type="button" data-ae="save">完成</button>
      </div>
    </div>`;
  }

  function onGlobalKey(ev) {
    if (!ov) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      save();
    }
  }

  function build() {
    ov = document.createElement('div');
    ov.className = 'ed ae-overlay';
    ov.innerHTML = shell();
    document.body.appendChild(ov);
    barEl = ov.querySelector('#ae-bar');
    prevEl = ov.querySelector('#ae-preview');
    fileEl = ov.querySelector('#ae-video-file');
    ov.addEventListener('click', onOverlayClick);
    ov.addEventListener('change', onOverlayChange);
    ov.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onGlobalKey, true);
    document.body.classList.add('ed-open');
    renderAll();
  }

  function close() {
    if (!ov) return;
    window.removeEventListener('keydown', onGlobalKey, true);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    ov.remove();
    ov = null;
    barEl = null;
    prevEl = null;
    fileEl = null;
    cur = null;
    draft = null;
    drag = null;
    document.body.classList.remove('ed-open');
  }

  function save() {
    if (!ov) return;
    const id = cur;
    const d = clone(draft);
    close();
    const e = Store.el(id);
    if (!e) return;
    Store.begin();
    Object.keys(d).forEach((k) => {
      if (k === 'id' || k === 'type' || k.startsWith('__')) return;
      e[k] = d[k];
    });
    Store.end('edit');
    Canvas.rebuild(id);
    Canvas.select(id);
    if (window.Panels) {
      Panels.refreshOutline?.();
      Panels.refreshInspector?.(true);
    }
  }

  function open(id) {
    const e = Store.el(id);
    if (!e || !can(e.type)) return;
    close();
    cur = id;
    draft = clone(e);
    if (!Array.isArray(draft.nodes)) draft.nodes = [];
    if (!Array.isArray(draft.points)) draft.points = [];
    if (!Array.isArray(draft.cols)) draft.cols = [];
    if (!Array.isArray(draft.members)) draft.members = [];
    if (draft.type === 'columns') setCols((draft.cols || []).length || 2);
    build();
  }

  return { open, close, isOpen, can };
})();
