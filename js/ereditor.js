/* ------------------------------------------------------------------
 *  ereditor.js — E-R 图编辑器（流程图式全屏画布）
 *  左侧：添加入口 + 选中项属性；右侧：大画布 + 缩放条。
 *  数据仍写回 entities/relations，坐标继续保存为百分比。
 * ------------------------------------------------------------------ */
window.EREditor = (function () {
  const W = 920;
  const H = 600;
  const NODE_W = 210;
  const MAX_ENTITIES = 6;
  const MAX_RELATIONS = 10;

  const E = (s) => U.esc(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const PRESETS = {
    blank: {
      label: '空白',
      dot: 'var(--violet-l2)',
      name: '新实体',
      fields: [
        { name: 'id', key: 'PK' },
        { name: '名称', key: '' },
      ],
    },
    player: {
      label: '玩家',
      dot: 'var(--violet)',
      name: '玩家',
      fields: [
        { name: 'player_id', key: 'PK' },
        { name: '昵称', key: '' },
        { name: '探索进度', key: '' },
      ],
    },
    outfit: {
      label: '服装',
      dot: 'var(--mint)',
      name: '服装',
      fields: [
        { name: 'outfit_id', key: 'PK' },
        { name: '名称', key: '' },
        { name: '能力标签', key: '' },
      ],
    },
    level: {
      label: '关卡',
      dot: 'var(--amber)',
      name: '关卡',
      fields: [
        { name: 'level_id', key: 'PK' },
        { name: '目标', key: '' },
        { name: '奖励', key: '' },
      ],
    },
  };

  const SPOTS = [
    [8, 8], [63, 7], [35, 54], [7, 55], [63, 55], [35, 8],
  ];

  const TONES = ['violet', 'mint', 'amber', 'pink', 'blue', 'slate'];

  let el = null;
  let elId = null;
  let overlay = null;
  let canvasEl = null;
  let worldEl = null;
  let svgEl = null;
  let propEl = null;
  let countEl = null;
  let view = { x: 0, y: 0, z: 1 };
  let sel = null;
  let drag = null;
  let connect = null;
  let inlineEdit = null;
  let endTimer = null;
  let raf = 0;

  /* ---------- 事务 ---------- */
  function begin() {
    Store.begin();
  }
  function endSoon(reason) {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => Store.end(reason || 'er-edit'), 520);
  }
  function endNow(reason) {
    clearTimeout(endTimer);
    endTimer = null;
    Store.end(reason || 'er-edit');
  }

  /* ---------- 数据与查找 ---------- */
  function normalize() {
    if (!Array.isArray(el.entities)) el.entities = [];
    if (!Array.isArray(el.relations)) el.relations = [];
    el.entities.forEach((ent, i) => {
      if (!ent.id) ent.id = 'e' + (i + 1);
      if (!Array.isArray(ent.fields)) ent.fields = [];
      ent.name = String(ent.name == null ? '实体' : ent.name);
      ent.x = Number.isFinite(Number(ent.x)) ? Number(ent.x) : 0;
      ent.y = Number.isFinite(Number(ent.y)) ? Number(ent.y) : 0;
    });
    el.relations.forEach((rel, i) => {
      if (!rel.id) rel.id = 'r' + (i + 1);
      rel.label = String(rel.label == null ? '关联' : rel.label);
      rel.card = rel.card || '1:N';
    });
  }

  const entById = (id) => el.entities.find((n) => n.id === id);
  const relById = (id) => el.relations.find((r) => r.id === id);

  function nodeDom(id) {
    return Array.from(worldEl.querySelectorAll('.ere-node')).find((n) => n.dataset.nid === id) || null;
  }
  function edgeDom(id) {
    return Array.from(worldEl.querySelectorAll('.ere-edge')).find((n) => n.dataset.rid === id) || null;
  }

  function validRel(rel) {
    return !!(rel && rel.from !== rel.to && entById(rel.from) && entById(rel.to));
  }

  function nodeGeo(id) {
    const n = nodeDom(id);
    if (!n) return null;
    return {
      x: parseFloat(n.style.left) || 0,
      y: parseFloat(n.style.top) || 0,
      w: n.offsetWidth || NODE_W,
      h: n.offsetHeight || 116,
    };
  }

  function portPoint(g, side) {
    if (side === 't') return { x: g.x + g.w / 2, y: g.y };
    if (side === 'r') return { x: g.x + g.w, y: g.y + g.h / 2 };
    if (side === 'b') return { x: g.x + g.w / 2, y: g.y + g.h };
    return { x: g.x, y: g.y + g.h / 2 };
  }

  function cardParts(card) {
    const c = String(card || '1:N').replace(':', '').toUpperCase();
    return [c[0] || '1', c[1] || 'N'];
  }

  /* ---------- 画布 ---------- */
  function nodeHtml(ent, idx) {
    const fields = (ent.fields || []).map((f, j) => {
      const key = String(f.key || '');
      return (
        '<div class="er-field">' +
        `<span class="er-field-key${key ? ' has-key' : ''}" data-fkey="${j}" title="点击切换 PK / FK / 无">${E(key)}</span>` +
        `<span class="er-field-name" data-fname="${j}" title="双击修改字段名">${E(f.name || '字段')}</span>` +
        `<button type="button" class="er-field-del" data-fdel="${j}" title="删除这个字段" aria-label="删除字段">×</button>` +
        '</div>'
      );
    }).join('');

    return (
      `<div class="ere-node" data-nid="${E(ent.id)}" style="left:${(ent.x / 100) * W}px;top:${(ent.y / 100) * H}px">` +
        '<div class="er-entity-head">' +
          `<span class="er-entity-kind">ENTITY ${String(idx + 1).padStart(2, '0')}</span>` +
          `<div class="er-entity-name" data-ename title="双击修改实体名">${E(ent.name || '实体')}</div>` +
          '<button type="button" class="er-field-add" data-fadd title="添加字段" aria-label="添加字段">＋</button>' +
        '</div>' +
        `<div class="er-fields">${fields || '<div class="ere-no-fields">暂无字段</div>'}</div>` +
        ['t', 'r', 'b', 'l'].map((side) =>
          `<button type="button" class="ere-port" data-side="${side}" data-nid="${E(ent.id)}" title="从这里拖到另一个实体，建立关系"></button>`
        ).join('') +
      '</div>'
    );
  }

  function edgeHtml(rel) {
    return (
      `<g class="ere-edge" data-rid="${E(rel.id)}">` +
        '<path class="ere-hit"></path>' +
        '<path class="ere-line"></path>' +
        '<g class="ere-label"><rect rx="9"></rect><text></text></g>' +
        '<g class="ere-tag ere-tag-from"><rect x="-9" y="-9" width="18" height="18" rx="4"></rect><text></text></g>' +
        '<g class="ere-tag ere-tag-to"><rect x="-9" y="-9" width="18" height="18" rx="4"></rect><text></text></g>' +
      '</g>'
    );
  }

  function renderWorld() {
    worldEl.style.width = W + 'px';
    worldEl.style.height = H + 'px';

    const rels = el.relations.map(edgeHtml).join('');
    const nodes = el.entities.map(nodeHtml).join('');

    worldEl.innerHTML =
      `<svg class="ere-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
        `<g class="ere-edges">${rels}</g>` +
        '<g class="ere-temp"></g>' +
      '</svg>' +
      nodes;

    svgEl = worldEl.querySelector('.ere-svg');
    layoutEdges();
  }

  function edgeLabelWidth(text) {
    const w = U.measure(text || '关联', '650 9.5px "PingFang SC","Microsoft YaHei",system-ui,sans-serif');
    return clamp(w + 20, 32, 124);
  }

  function layoutEdges() {
    if (!svgEl) return;
    const geo = {};
    worldEl.querySelectorAll('.ere-node').forEach((n) => {
      geo[n.dataset.nid] = {
        x: parseFloat(n.style.left) || 0,
        y: parseFloat(n.style.top) || 0,
        w: n.offsetWidth || NODE_W,
        h: n.offsetHeight || 116,
      };
    });

    worldEl.querySelectorAll('.ere-edge').forEach((g) => {
      const rel = relById(g.dataset.rid);
      if (!validRel(rel)) {
        g.style.display = 'none';
        return;
      }
      g.style.display = '';
      const a = geo[rel.from];
      const b = geo[rel.to];
      if (!a || !b) {
        g.style.display = 'none';
        return;
      }

      const p0 = edgePoint(a, b);
      const p3 = edgePoint(b, a);
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const c1 = { x: p0.x + dx * 0.34, y: p0.y + dy * 0.18 };
      const c2 = { x: p0.x + dx * 0.66, y: p0.y + dy * 0.82 };
      const d = `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`;
      const mid = bezier(p0, c1, c2, p3, 0.5);
      const len = Math.hypot(dx, dy);
      const gap = Math.min(34, Math.max(24, len * 0.32));

      g.querySelector('.ere-line').setAttribute('d', d);
      g.querySelector('.ere-hit').setAttribute('d', d);

      const lw = edgeLabelWidth(rel.label);
      const lg = g.querySelector('.ere-label');
      const rect = lg.querySelector('rect');
      const text = lg.querySelector('text');
      lg.setAttribute('transform', `translate(${mid.x},${mid.y})`);
      rect.setAttribute('x', -lw / 2);
      rect.setAttribute('y', -9);
      rect.setAttribute('width', lw);
      rect.setAttribute('height', 18);
      text.setAttribute('x', 0);
      text.setAttribute('y', 3.2);
      text.textContent = rel.label || '关联';

      const [fromCard, toCard] = cardParts(rel.card);
      const tf = g.querySelector('.ere-tag-from');
      const tt = g.querySelector('.ere-tag-to');
      const pf = along(p0, p3, gap);
      const pt = along(p3, p0, gap);
      tf.setAttribute('transform', `translate(${pf.x},${pf.y})`);
      tt.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      tf.querySelector('text').textContent = fromCard;
      tt.querySelector('text').textContent = toCard;
    });
  }

  function edgePoint(a, b) {
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    const dx = bcx - acx;
    const dy = bcy - acy;
    const nx = Math.abs(dx) / (a.w / 2 || 1);
    const ny = Math.abs(dy) / (a.h / 2 || 1);
    if (nx >= ny) return { x: dx >= 0 ? a.x + a.w : a.x, y: acy };
    return { x: acx, y: dy >= 0 ? a.y + a.h : a.y };
  }

  function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function along(a, b, d) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x + ((b.x - a.x) / len) * d, y: a.y + ((b.y - a.y) / len) * d };
  }

  /* ---------- 左侧属性 ---------- */
  function renderProp() {
    if (!propEl) return;
    if (!sel) {
      propEl.innerHTML = '<div class="fe-empty">点击画布中的实体卡或关系线，在这里编辑它的内容。</div>';
      return;
    }
    if (sel.type === 'entity') {
      const ent = entById(sel.id);
      if (!ent) {
        sel = null;
        renderProp();
        return;
      }
      const fields = ent.fields.map((f, j) => (
        '<div class="ere-fieldrow">' +
          `<input class="fe-ipt ere-keyinp" data-field-key="${j}" maxlength="4" value="${E(f.key || '')}" placeholder="PK/FK" aria-label="字段标记">` +
          `<input class="fe-ipt ere-fname" data-field-name="${j}" value="${E(f.name || '')}" placeholder="字段名" aria-label="字段名">` +
          `<button type="button" class="ere-fdel" data-field-del="${j}" title="删除字段">×</button>` +
        '</div>'
      )).join('');

      propEl.innerHTML =
        '<div class="fe-row"><span>类型</span><b>实体 · 字段表</b></div>' +
        `<label class="fe-f"><span>实体名</span><input id="ere-name" class="fe-ipt" maxlength="18" value="${E(ent.name)}" placeholder="例如：玩家"></label>` +
        `<div class="fe-row"><span>字段</span><b>${ent.fields.length} 个字段</b></div>` +
        `<div class="ere-fieldlist">${fields || '<div class="fe-empty">还没有字段</div>'}</div>` +
        `<button type="button" class="fe-btn wide" data-act="add-field">＋ 添加字段</button>` +
        `<div class="fe-row ere-posrow"><span>位置</span><b>X ${Math.round(ent.x)}% · Y ${Math.round(ent.y)}%</b></div>` +
        '<button type="button" class="fe-btn danger wide" data-act="del-entity">删除实体</button>';
      bindEntityInputs(ent);
      return;
    }

    const rel = relById(sel.id);
    if (!rel) {
      sel = null;
      renderProp();
      return;
    }
    const opts = (value) => el.entities.map((n) =>
      `<option value="${E(n.id)}"${n.id === value ? ' selected' : ''}>${E(n.name || '实体')}</option>`
    ).join('');

    propEl.innerHTML =
      '<div class="fe-row"><span>类型</span><b>关系</b></div>' +
      '<label class="fe-f"><span>起点实体</span><select class="fe-ipt" id="ere-from">' + opts(rel.from) + '</select></label>' +
      '<label class="fe-f"><span>终点实体</span><select class="fe-ipt" id="ere-to">' + opts(rel.to) + '</select></label>' +
      `<label class="fe-f"><span>关系名</span><input id="ere-label" class="fe-ipt" maxlength="16" value="${E(rel.label)}" placeholder="例如：拥有"></label>` +
      '<label class="fe-f"><span>基数</span><select class="fe-ipt" id="ere-card">' +
        ['1:1', '1:N', 'N:1', 'N:M'].map((v) => `<option value="${v}"${rel.card === v ? ' selected' : ''}>${v}</option>`).join('') +
      '</select></label>' +
      `<div class="fe-row"><span>连接</span><b>${E(entById(rel.from)?.name || '?')} → ${E(entById(rel.to)?.name || '?')}</b></div>` +
      '<button type="button" class="fe-btn danger wide" data-act="del-relation">删除关系</button>';

    bindRelationInputs(rel);
  }

  function bindEntityInputs(ent) {
    const name = propEl.querySelector('#ere-name');
    if (name) {
      name.addEventListener('focus', begin);
      name.addEventListener('input', () => {
        ent.name = name.value;
        const nameEl = nodeDom(ent.id)?.querySelector('[data-ename]');
        if (nameEl) nameEl.textContent = ent.name || '实体';
        endSoon('er-entity-name');
      });
      name.addEventListener('blur', () => endNow('er-entity-name'));
    }

    propEl.querySelectorAll('[data-field-key]').forEach((inp) => {
      inp.addEventListener('focus', begin);
      inp.addEventListener('input', () => {
        const j = Number(inp.dataset.fieldKey);
        if (!ent.fields[j]) return;
        ent.fields[j].key = inp.value;
        const k = nodeDom(ent.id)?.querySelector(`[data-fkey="${j}"]`);
        if (k) {
          k.textContent = inp.value;
          k.classList.toggle('has-key', !!inp.value.trim());
        }
        endSoon('er-field-key');
      });
      inp.addEventListener('blur', () => endNow('er-field-key'));
    });

    propEl.querySelectorAll('[data-field-name]').forEach((inp) => {
      inp.addEventListener('focus', begin);
      inp.addEventListener('input', () => {
        const j = Number(inp.dataset.fieldName);
        if (!ent.fields[j]) return;
        ent.fields[j].name = inp.value;
        const n = nodeDom(ent.id)?.querySelector(`[data-fname="${j}"]`);
        if (n) n.textContent = inp.value || '字段';
        endSoon('er-field-name');
      });
      inp.addEventListener('blur', () => endNow('er-field-name'));
    });
  }

  function bindRelationInputs(rel) {
    const label = propEl.querySelector('#ere-label');
    if (label) {
      label.addEventListener('focus', begin);
      label.addEventListener('input', () => {
        rel.label = label.value;
        const text = edgeDom(rel.id)?.querySelector('.ere-label text');
        if (text) text.textContent = rel.label || '关联';
        layoutEdges();
        endSoon('er-relation-label');
      });
      label.addEventListener('blur', () => endNow('er-relation-label'));
    }

    const from = propEl.querySelector('#ere-from');
    const to = propEl.querySelector('#ere-to');
    const card = propEl.querySelector('#ere-card');

    from?.addEventListener('change', () => {
      if (from.value === rel.to) {
        U.toast('起点和终点不能是同一个实体');
        renderProp();
        return;
      }
      begin();
      rel.from = from.value;
      endNow('er-relation-from');
      render();
      paintSelection();
    });
    to?.addEventListener('change', () => {
      if (to.value === rel.from) {
        U.toast('起点和终点不能是同一个实体');
        renderProp();
        return;
      }
      begin();
      rel.to = to.value;
      endNow('er-relation-to');
      render();
      paintSelection();
    });
    card?.addEventListener('change', () => {
      begin();
      rel.card = card.value;
      layoutEdges();
      endNow('er-relation-card');
      renderProp();
    });
  }

  function paintSelection() {
    worldEl.querySelectorAll('.ere-node').forEach((n) =>
      n.classList.toggle('sel', !!(sel && sel.type === 'entity' && n.dataset.nid === sel.id)));
    worldEl.querySelectorAll('.ere-edge').forEach((g) =>
      g.classList.toggle('is-sel', !!(sel && sel.type === 'relation' && g.dataset.rid === sel.id)));
  }

  function select(type, id) {
    sel = type && id ? { type, id } : null;
    paintSelection();
    renderProp();
  }

  function updateCount() {
    if (countEl) countEl.textContent = `${el.entities.length} 实体 · ${el.relations.length} 关系`;
    const addRel = overlay?.querySelector('.ere-addrel');
    if (addRel) addRel.disabled = el.entities.length < 2;
  }

  function render() {
    renderWorld();
    paintSelection();
    renderProp();
    updateCount();
    applyView();
  }

  /* ---------- 视图 ---------- */
  function applyView() {
    if (!worldEl) return;
    worldEl.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
    const zl = overlay?.querySelector('#ere-zoom');
    if (zl) zl.textContent = Math.round(view.z * 100) + '%';
  }

  function fit() {
    if (!canvasEl || !worldEl) return;
    const nodes = Array.from(worldEl.querySelectorAll('.ere-node'));
    const cw = canvasEl.clientWidth;
    const ch = canvasEl.clientHeight;
    if (!nodes.length) {
      const z = clamp(Math.min((cw - 80) / W, (ch - 90) / H), 0.2, 1.45);
      view = { x: (cw - W * z) / 2, y: (ch - H * z) / 2, z };
      applyView();
      return;
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    nodes.forEach((n) => {
      const x = parseFloat(n.style.left) || 0;
      const y = parseFloat(n.style.top) || 0;
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x + n.offsetWidth);
      y2 = Math.max(y2, y + n.offsetHeight);
    });
    const bw = Math.max(160, x2 - x1);
    const bh = Math.max(100, y2 - y1);
    const z = clamp(Math.min((cw - 100) / (bw + 90), (ch - 100) / (bh + 80)), 0.2, 1.45);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    view = { x: cw / 2 - cx * z, y: ch / 2 - cy * z, z };
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    const px = cx == null ? r.left + r.width / 2 : cx;
    const py = cy == null ? r.top + r.height / 2 : cy;
    const ox = (px - r.left - view.x) / view.z;
    const oy = (py - r.top - view.y) / view.z;
    const nz = clamp(view.z * factor, 0.25, 2.4);
    view.z = nz;
    view.x = px - r.left - ox * nz;
    view.y = py - r.top - oy * nz;
    applyView();
  }

  function toWorld(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }

  function autoLayout() {
    const n = el.entities.length;
    if (!n) return;
    const pts = [];
    if (n === 1) {
      pts.push([(W - NODE_W) / 2, (H - 130) / 2]);
    } else if (n === 2) {
      pts.push([W * 0.14, H * 0.38], [W * 0.58, H * 0.38]);
    } else if (n === 3) {
      pts.push([W * 0.12, H * 0.08], [W * 0.63, H * 0.07], [W * 0.38, H * 0.57]);
    } else if (n === 4) {
      pts.push([W * 0.08, H * 0.08], [W * 0.61, H * 0.08], [W * 0.08, H * 0.56], [W * 0.61, H * 0.56]);
    } else {
      const xs = [W * 0.04, W * 0.37, W * 0.70];
      [0, 1].forEach((row) => {
        xs.forEach((x) => {
          if (pts.length < n) pts.push([x, row ? H * 0.56 : H * 0.07]);
        });
      });
    }

    begin();
    el.entities.forEach((ent, i) => {
      const p = pts[i] || [0, 0];
      ent.x = clamp((p[0] / W) * 100, 0, 100);
      ent.y = clamp((p[1] / H) * 100, 0, 100);
    });
    endNow('er-auto-layout');
    render();
    fit();
    U.toast('已重新排布实体');
  }

  /* ---------- 增删改 ---------- */
  function addEntity(kind) {
    if (el.entities.length >= MAX_ENTITIES) {
      U.toast(`最多 ${MAX_ENTITIES} 个实体`);
      return;
    }
    const p = PRESETS[kind] || PRESETS.blank;
    const spot = SPOTS[Math.min(el.entities.length, SPOTS.length - 1)];
    const id = U.uid('e');
    begin();
    el.entities.push({
      id,
      name: p.name,
      x: spot[0],
      y: spot[1],
      fields: p.fields.map((f) => ({ name: f.name, key: f.key })),
    });
    endNow('er-entity-add');
    sel = { type: 'entity', id };
    render();
    setTimeout(() => propEl?.querySelector('#ere-name')?.focus(), 40);
    U.toast('已添加实体，可在卡片或左侧改名和字段');
  }

  function deleteEntity() {
    if (!sel || sel.type !== 'entity') return;
    if (el.entities.length <= 1) {
      U.toast('至少保留 1 个实体');
      return;
    }
    const ent = entById(sel.id);
    if (!ent) return;
    begin();
    el.entities = el.entities.filter((n) => n.id !== ent.id);
    el.relations = el.relations.filter((r) => r.from !== ent.id && r.to !== ent.id);
    endNow('er-entity-delete');
    sel = null;
    render();
    U.toast('已删除实体及其关系');
  }

  function addField(opts) {
    const ent = (opts && opts.ent) || (sel && sel.type === 'entity' ? entById(sel.id) : null);
    if (!ent) return;
    begin();
    const field = { name: '新字段', key: '' };
    ent.fields.push(field);
    endNow('er-field-add');
    sel = { type: 'entity', id: ent.id };
    render();
    if (opts && opts.inline) {
      const idx = ent.fields.length - 1;
      const nameEl = nodeDom(ent.id)?.querySelector(`[data-fname="${idx}"]`);
      if (nameEl) beginInlineField(nameEl, ent, field, idx);
      return;
    }
    const rows = propEl.querySelectorAll('.ere-fname');
    rows[rows.length - 1]?.focus();
  }

  function deleteField(j, entArg) {
    const ent = entArg || (sel && sel.type === 'entity' ? entById(sel.id) : null);
    if (!ent || !ent.fields[j]) return;
    if (inlineEdit) commitInline(false);
    begin();
    ent.fields.splice(j, 1);
    endNow('er-field-delete');
    sel = { type: 'entity', id: ent.id };
    render();
  }

  function cycleFieldKey(ent, j) {
    if (!ent || !ent.fields[j]) return;
    const cur = String(ent.fields[j].key || '').toUpperCase();
    const next = cur === 'PK' ? 'FK' : cur === 'FK' ? '' : 'PK';
    begin();
    ent.fields[j].key = next;
    endNow('er-field-key');
    sel = { type: 'entity', id: ent.id };
    render();
  }

  function addRelation(auto) {
    if (el.entities.length < 2) {
      U.toast('至少需要 2 个实体才能建立关系');
      return;
    }
    if (el.relations.length >= MAX_RELATIONS) {
      U.toast(`最多 ${MAX_RELATIONS} 条关系`);
      return;
    }
    const fromId = sel && sel.type === 'entity' && entById(sel.id)
      ? sel.id
      : el.entities[0].id;
    const to = el.entities.find((n) => n.id !== fromId);
    if (!to) return;
    createRelation(fromId, to.id, true);
  }

  function createRelation(fromId, toId, toast) {
    if (fromId === toId) return;
    const rel = { id: U.uid('r'), from: fromId, to: toId, label: '关联', card: '1:N' };
    begin();
    el.relations.push(rel);
    endNow('er-relation-add');
    sel = { type: 'relation', id: rel.id };
    render();
    if (toast) U.toast('已添加关系，可在左侧改名称和基数');
    setTimeout(() => propEl?.querySelector('#ere-label')?.focus(), 40);
  }

  function deleteRelation() {
    if (!sel || sel.type !== 'relation') return;
    begin();
    el.relations = el.relations.filter((r) => r.id !== sel.id);
    endNow('er-relation-delete');
    sel = null;
    render();
    U.toast('已删除关系');
  }

  /* ---------- 拖动 ---------- */
  function startDrag(n, ent, ev) {
    const startLeft = parseFloat(n.style.left) || 0;
    const startTop = parseFloat(n.style.top) || 0;
    const sx = ev.clientX;
    const sy = ev.clientY;
    let moved = false;
    let began = false;

    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 2) {
        moved = true;
        if (!began) {
          began = true;
          begin();
        }
        n.classList.add('dragging');
      }
      if (!moved) return;

      // 世界坐标不设边界；靠近可见画布的边缘时只平移视口，让卡片一直留在视野里，
      // 因而可以持续向左/右/上/下拖，不会再撞到 920×600 的隐形墙。
      const nx = startLeft + dx / view.z;
      const ny = startTop + dy / view.z;
      n.style.left = nx + 'px';
      n.style.top = ny + 'px';
      ent.x = (nx / W) * 100;
      ent.y = (ny / H) * 100;

      const cr = canvasEl.getBoundingClientRect();
      const EDGE = 76, MARGIN = 24;
      let vx = view.x, vy = view.y;
      if (e.clientX < cr.left + EDGE) vx = MARGIN - nx * view.z;
      else if (e.clientX > cr.right - EDGE) vx = cr.width - MARGIN - n.offsetWidth * view.z - nx * view.z;
      if (e.clientY < cr.top + EDGE) vy = MARGIN - ny * view.z;
      else if (e.clientY > cr.bottom - EDGE) vy = cr.height - MARGIN - n.offsetHeight * view.z - ny * view.z;
      if (vx !== view.x || vy !== view.y) {
        view.x = vx;
        view.y = vy;
        applyView();
      }

      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layoutEdges);
      const pos = propEl?.querySelector('.ere-posrow b');
      if (pos) pos.textContent = `X ${Math.round(ent.x)}% · Y ${Math.round(ent.y)}%`;
    };

    const up = () => {
      n.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (began) endNow('er-move');
      drag = null;
      if (moved) layoutEdges();
    };

    drag = { kind: 'node', id: ent.id };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startPan(ev) {
    const sx = ev.clientX;
    const sy = ev.clientY;
    const ox = view.x;
    const oy = view.y;
    canvasEl.classList.add('grabbing');

    const move = (e) => {
      view.x = ox + e.clientX - sx;
      view.y = oy + e.clientY - sy;
      applyView();
    };
    const up = () => {
      canvasEl.classList.remove('grabbing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- 锚点连线 ---------- */
  function startConnect(port, ev) {
    const fromId = port.dataset.nid;
    const ent = entById(fromId);
    if (!ent) return;
    ev.preventDefault();
    ev.stopPropagation();
    const g = nodeGeo(fromId);
    if (!g) return;
    const start = portPoint(g, port.dataset.side);
    const layer = svgEl.querySelector('.ere-temp');
    layer.innerHTML =
      '<path class="ere-temp-line"></path><circle class="ere-temp-dot" r="4"></circle>';
    const path = layer.querySelector('.ere-temp-line');
    const dot = layer.querySelector('.ere-temp-dot');
    let target = null;
    document.body.classList.add('fc-connecting');

    const move = (e) => {
      const p = toWorld(e.clientX, e.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const c1 = { x: start.x + dx * 0.38, y: start.y + dy * 0.18 };
      const c2 = { x: p.x - dx * 0.38, y: p.y - dy * 0.18 };
      path.setAttribute('d', `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p.x} ${p.y}`);
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);

      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const node = hit && hit.closest ? hit.closest('.ere-node') : null;
      const nid = node && node.dataset.nid !== fromId ? node.dataset.nid : null;
      if (nid !== target) {
        if (target) nodeDom(target)?.classList.remove('drop');
        target = nid;
        if (target) nodeDom(target)?.classList.add('drop');
      }
    };

    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('fc-connecting');
      layer.innerHTML = '';
      if (target) nodeDom(target)?.classList.remove('drop');
      if (target) createRelation(fromId, target, true);
      connect = null;
      ev.preventDefault();
    };

    connect = { fromId, target };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- 双击行内改名 ---------- */
  function beginInlineName(n, ent) {
    const nameEl = n.querySelector('[data-ename]');
    if (!nameEl) return;
    if (inlineEdit) commitInline(false);
    begin();
    const original = ent.name;
    nameEl.setAttribute('contenteditable', 'plaintext-only');
    nameEl.classList.add('editing');
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);

    let cancelled = false;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        nameEl.textContent = original;
        nameEl.blur();
      }
    };
    const onInput = () => {
      ent.name = nameEl.textContent;
      const side = propEl?.querySelector('#ere-name');
      if (side) side.value = ent.name;
    };
    const onBlur = () => {
      nameEl.removeEventListener('keydown', onKey);
      nameEl.removeEventListener('input', onInput);
      nameEl.removeEventListener('blur', onBlur);
      nameEl.removeAttribute('contenteditable');
      nameEl.classList.remove('editing');
      if (!cancelled) {
        ent.name = String(nameEl.textContent || '').trim() || '未命名实体';
        nameEl.textContent = ent.name;
      } else {
        ent.name = original;
      }
      endNow('er-inline-name');
      inlineEdit = null;
      renderProp();
    };
    nameEl.addEventListener('keydown', onKey);
    nameEl.addEventListener('input', onInput);
    nameEl.addEventListener('blur', onBlur);
    inlineEdit = { nameEl, ent, commit: onBlur };
  }

  function beginInlineField(nameEl, ent, field, j) {
    if (!nameEl || !field) return;
    if (inlineEdit) commitInline();
    begin();
    const original = String(field.name || '');
    nameEl.setAttribute('contenteditable', 'plaintext-only');
    nameEl.classList.add('editing');
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);

    let cancelled = false;
    const sideInput = () => propEl?.querySelector(`[data-field-name="${j}"]`);
    const syncSide = (value) => {
      const inp = sideInput();
      if (inp) inp.value = value;
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        nameEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelled = true;
        nameEl.textContent = original || '字段';
        nameEl.blur();
      }
    };
    const onInput = () => {
      field.name = nameEl.textContent;
      syncSide(field.name);
    };
    const onBlur = () => {
      nameEl.removeEventListener('keydown', onKey);
      nameEl.removeEventListener('input', onInput);
      nameEl.removeEventListener('blur', onBlur);
      nameEl.removeAttribute('contenteditable');
      nameEl.classList.remove('editing');
      if (!cancelled) {
        field.name = String(nameEl.textContent || '').trim() || '字段';
        nameEl.textContent = field.name;
        syncSide(field.name);
      } else {
        field.name = original;
        nameEl.textContent = original || '字段';
        syncSide(original);
      }
      endNow('er-inline-field');
      inlineEdit = null;
      renderProp();
    };
    nameEl.addEventListener('keydown', onKey);
    nameEl.addEventListener('input', onInput);
    nameEl.addEventListener('blur', onBlur);
    inlineEdit = { nameEl, ent, field, commit: onBlur };
  }

  function commitInline(blur) {
    if (!inlineEdit) return;
    const cur = inlineEdit;
    inlineEdit = null;
    if (blur !== false && cur.nameEl) cur.nameEl.blur();
  }

  /* ---------- 事件 ---------- */
  function onPointerDown(ev) {
    if (ev.button === 1) {
      ev.preventDefault();
      startPan(ev);
      return;
    }
    if (ev.button !== 0) return;
    if (!ev.target.closest || !ev.target.closest('.fe-canvas')) return;
    if (ev.target.closest('[data-act],[data-add],.ere-tone,.fe-zoombar')) return;

    const cardCtrl = ev.target.closest('.er-field-add,.er-field-del,.er-field-key');
    if (cardCtrl) {
      const node = cardCtrl.closest('.ere-node');
      const ent = node && entById(node.dataset.nid);
      if (ent && (!sel || sel.type !== 'entity' || sel.id !== ent.id)) select('entity', ent.id);
      return;
    }

    const port = ev.target.closest('.ere-port');
    if (port) {
      startConnect(port, ev);
      return;
    }

    const node = ev.target.closest('.ere-node');
    if (node) {
      if (ev.target.isContentEditable) return;
      const ent = entById(node.dataset.nid);
      if (!ent) return;
      if (!sel || sel.type !== 'entity' || sel.id !== ent.id) select('entity', ent.id);
      ev.preventDefault();
      startDrag(node, ent, ev);
      return;
    }

    const edge = ev.target.closest('.ere-edge');
    if (edge) {
      select('relation', edge.dataset.rid);
      ev.preventDefault();
      return;
    }

    select(null, null);
    startPan(ev);
  }

  function onDblClick(ev) {
    if (!ev.target.closest || !ev.target.closest('.fe-canvas')) return;
    if (ev.target.closest('[data-fkey],[data-fdel],[data-fadd]')) return;
    const node = ev.target.closest('.ere-node');
    if (node) {
      const ent = entById(node.dataset.nid);
      if (!ent) return;
      ev.preventDefault();
      select('entity', ent.id);
      const fname = ev.target.closest('[data-fname]');
      if (fname) {
        const j = Number(fname.dataset.fname);
        const field = ent.fields[j];
        if (field) beginInlineField(fname, ent, field, j);
        return;
      }
      beginInlineName(node, ent);
      return;
    }
    const edge = ev.target.closest('.ere-edge');
    if (edge) {
      ev.preventDefault();
      select('relation', edge.dataset.rid);
      setTimeout(() => propEl?.querySelector('#ere-label')?.focus(), 30);
    }
  }

  function onOverlayClick(ev) {
    const add = ev.target.closest('[data-add]');
    if (add) {
      addEntity(add.dataset.add);
      return;
    }
    const tone = ev.target.closest('.ere-tone');
    if (tone) {
      setTone(tone.dataset.tone);
      return;
    }
    const node = ev.target.closest('.ere-node');
    const cardFieldDel = ev.target.closest('[data-fdel]');
    if (cardFieldDel && node) {
      const ent = entById(node.dataset.nid);
      if (ent) deleteField(Number(cardFieldDel.dataset.fdel), ent);
      return;
    }
    const cardFieldAdd = ev.target.closest('[data-fadd]');
    if (cardFieldAdd && node) {
      const ent = entById(node.dataset.nid);
      if (ent) addField({ ent, inline: true });
      return;
    }
    const fieldKey = ev.target.closest('[data-fkey]');
    if (fieldKey && node) {
      const ent = entById(node.dataset.nid);
      if (ent) cycleFieldKey(ent, Number(fieldKey.dataset.fkey));
      return;
    }
    const fdel = ev.target.closest('[data-field-del]');
    if (fdel) {
      deleteField(Number(fdel.dataset.fieldDel));
      return;
    }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'auto') autoLayout();
    else if (a === 'fit') fit();
    else if (a === 'undo') undo();
    else if (a === 'done') close();
    else if (a === 'add-relation') addRelation(true);
    else if (a === 'add-field') addField();
    else if (a === 'del-entity') deleteEntity();
    else if (a === 'del-relation') deleteRelation();
  }

  function setTone(tone) {
    if (!TONES.includes(tone) || tone === el.tone) return;
    begin();
    el.tone = tone;
    overlay.dataset.tone = tone;
    endNow('er-tone');
    overlay.querySelectorAll('[data-tone]').forEach((b) =>
      b.classList.toggle('on', b.dataset.tone === tone));
  }

  function onWheel(ev) {
    if (!canvasEl) return;
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      zoomAt(ev.deltaY < 0 ? 1.08 : 0.92, ev.clientX, ev.clientY);
      return;
    }
    ev.preventDefault();
    view.x -= ev.shiftKey ? ev.deltaY : ev.deltaX;
    view.y -= ev.shiftKey ? 0 : ev.deltaY;
    applyView();
  }

  function onKeyDown(ev) {
    if (!overlay) return;
    if (ev.key === 'Escape') {
      if (inlineEdit || ev.target.isContentEditable) return;
      if (ev.target.closest('.fe-left') && ev.target.tagName === 'INPUT' && ev.target.id === 'ere-name') {
        ev.target.blur();
        return;
      }
      ev.preventDefault();
      close();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      if (ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      ev.preventDefault();
      undo();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && !ev.target.closest('input,select,textarea') && !ev.target.isContentEditable) {
      if (sel && sel.type === 'entity') {
        ev.preventDefault();
        deleteEntity();
      } else if (sel && sel.type === 'relation') {
        ev.preventDefault();
        deleteRelation();
      }
    }
  }

  function undo() {
    commitInline(false);
    endNow('er-before-undo');
    if (!Store.undo()) {
      U.toast('没有可撤销的操作');
      return;
    }
    el = Store.el(elId);
    if (!el) {
      close();
      return;
    }
    normalize();
    overlay.dataset.tone = el.tone || 'violet';
    overlay.querySelectorAll('.ere-tone').forEach((b) =>
      b.classList.toggle('on', b.dataset.tone === (el.tone || 'violet')));
    const title = overlay.querySelector('#ere-title');
    if (title) title.value = el.title || 'E-R 图';
    sel = el.entities[0] ? { type: 'entity', id: el.entities[0].id } : null;
    render();
    fit();
    U.toast('已撤销上一步');
  }

  /* ---------- 外壳 ---------- */
  function buildDom() {
    overlay = document.createElement('div');
    overlay.className = 'fe er-fe';
    overlay.dataset.tone = el.tone || 'violet';
    overlay.innerHTML =
      '<div class="fe-panel">' +
        '<header class="fe-head">' +
          '<span class="fc-chip">编辑 E-R 图</span>' +
          `<input class="fe-title" id="ere-title" maxlength="30" value="${E(el.title || 'E-R 图')}" aria-label="E-R 图标题">` +
          '<span class="fe-count" id="ere-count"></span>' +
          '<div class="fe-tools">' +
            '<button type="button" class="fe-btn" data-act="auto">自动布局</button>' +
            '<button type="button" class="fe-btn" data-act="fit">适应</button>' +
            '<button type="button" class="fe-btn ghost" data-act="undo">撤销</button>' +
            '<button type="button" class="fe-btn primary" data-act="done">完成</button>' +
          '</div>' +
        '</header>' +
        '<div class="fe-body">' +
          '<aside class="fe-left">' +
            '<div class="fe-sec-t">添加实体</div>' +
            '<div class="fe-addgrid">' +
              Object.keys(PRESETS).map((k) =>
                `<button type="button" class="fe-add" data-add="${k}"><i class="nd" style="background:${PRESETS[k].dot}"></i>${PRESETS[k].label}</button>`
              ).join('') +
            '</div>' +
            '<div class="fe-sec-t">添加关系</div>' +
            `<button type="button" class="fe-btn wide ere-addrel" data-act="add-relation"${el.entities.length < 2 ? ' disabled' : ''}>＋ 自动连接关系</button>` +
            '<div class="fe-sec-t" style="margin-top:18px">选中项</div>' +
            '<div class="fe-prop" id="ere-prop"></div>' +
            '<div class="fe-sec-t" style="margin-top:18px">强调色</div>' +
            '<div class="ere-tones">' +
              TONES.map((t) =>
                `<button type="button" class="ere-tone${(el.tone || 'violet') === t ? ' on' : ''}" data-tone="${t}" title="${t}" aria-label="${t}"></button>`
              ).join('') +
            '</div>' +
            '<div class="fe-hint">' +
              '<b>拖动</b> 实体卡可自由摆放，靠近边缘会自动平移<br>' +
              '<b>画布</b> 拖空白处平移，滚轮缩放<br>' +
              '<b>字段</b> 双击改名，× 删除，＋ 添加<br>' +
              '<b>锚点</b> 从卡片四边拖到另一个实体，建立关系<br>' +
              '<b>双击</b> 实体名可直接改字<br>' +
              '<b>Delete</b> 删除选中的实体或关系<br>' +
              '<kbd>Ctrl/⌘ + Z</kbd> 撤销，<kbd>Esc</kbd> 完成' +
            '</div>' +
          '</aside>' +
          '<div class="fe-canvas" id="ere-canvas">' +
            '<div class="fe-world ere-world" id="ere-world"></div>' +
            '<div class="fe-zoombar">' +
              '<button type="button" data-zoom="out" title="缩小">−</button>' +
              '<span id="ere-zoom">100%</span>' +
              '<button type="button" data-zoom="in" title="放大">＋</button>' +
              '<button type="button" data-zoom="fit" title="适应窗口">⤢</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    canvasEl = overlay.querySelector('#ere-canvas');
    worldEl = overlay.querySelector('#ere-world');
    propEl = overlay.querySelector('#ere-prop');
    countEl = overlay.querySelector('#ere-count');

    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('dblclick', onDblClick);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown, true);

    overlay.querySelector('[data-zoom="in"]').addEventListener('click', () => zoomAt(1.12));
    overlay.querySelector('[data-zoom="out"]').addEventListener('click', () => zoomAt(0.89));
    overlay.querySelector('[data-zoom="fit"]').addEventListener('click', fit);

    const title = overlay.querySelector('#ere-title');
    title.addEventListener('focus', begin);
    title.addEventListener('input', () => {
      el.title = title.value;
      endSoon('er-title');
    });
    title.addEventListener('blur', () => endNow('er-title'));
  }

  function open(id) {
    const e = Store.el(id);
    if (!e || e.type !== 'er') return;
    if (overlay) close();
    elId = id;
    el = e;
    normalize();
    sel = el.entities[0] ? { type: 'entity', id: el.entities[0].id } : null;
    buildDom();
    document.body.classList.add('fe-open');
    render();
    requestAnimationFrame(() => {
      fit();
      setTimeout(fit, 80);
    });
  }

  function close() {
    if (!overlay) return;
    commitInline(true);
    endNow('er-close');
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    overlay = null;
    canvasEl = null;
    worldEl = null;
    svgEl = null;
    propEl = null;
    countEl = null;
    sel = null;
    drag = null;
    connect = null;
    document.body.classList.remove('fe-open');
    document.body.classList.remove('fc-connecting');
    if (elId) {
      Canvas.rebuild(elId);
      Canvas.select(elId);
      Panels.refreshOutline?.();
      Panels.refreshInspector?.(true);
    }
    el = null;
    elId = null;
  }

  return { open, close, isOpen: () => !!overlay };
})();
