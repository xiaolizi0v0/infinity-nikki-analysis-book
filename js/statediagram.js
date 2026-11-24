/* ------------------------------------------------------------------
 *  statediagram.js — 状态图：节点尺寸、连线路由、SVG 渲染
 *  数据结构：
 *    { title, caption,
 *      nodes: [{ id, name, note, kind:'state'|'initial'|'final', x, y }],
 *      edges: [{ id, from, to, label }] }
 *  坐标为图内自由坐标（节点左上角），渲染时按包围盒自动加 viewBox 偏移。
 * ------------------------------------------------------------------ */
window.SD = (function () {
  const PAD = 26;
  const KINDS = [
    { v: 'state', t: '状态' },
    { v: 'initial', t: '初始' },
    { v: 'final', t: '结束' },
  ];

  // 估算文本宽度：中文按 13px，其余按 7.2px
  function textW(s) {
    let w = 0;
    for (const ch of String(s == null ? '' : s)) {
      w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 13 : 7.2;
    }
    return w;
  }

  function lines(s) {
    return String(s == null ? '' : s).split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function sizeOf(n) {
    const kind = n.kind || 'state';
    if (kind === 'initial') return { w: 22, h: 22 };
    if (kind === 'final') return { w: 30, h: 30 };
    const ls = lines(n.name).length ? lines(n.name) : ['状态'];
    const ns = lines(n.note);
    let maxw = 0;
    ls.forEach((l) => (maxw = Math.max(maxw, textW(l))));
    ns.forEach((l) => (maxw = Math.max(maxw, textW(l))));
    const w = Math.max(136, Math.round(maxw + 40));
    const h = 46 + (ls.length - 1) * 18 + (ns.length ? ns.length * 15 + 8 : 0);
    return { w, h };
  }

  /* ---------- 折线转圆角路径 ---------- */
  function roundPath(pts, r) {
    if (!pts.length) return '';
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const v1 = [p1[0] - p0[0], p1[1] - p0[1]];
      const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const l1 = Math.hypot(v1[0], v1[1]) || 1;
      const l2 = Math.hypot(v2[0], v2[1]) || 1;
      const rr = Math.max(0, Math.min(r, l1 / 2, l2 / 2));
      const a = [p1[0] - (v1[0] / l1) * rr, p1[1] - (v1[1] / l1) * rr];
      const b = [p1[0] + (v2[0] / l2) * rr, p1[1] + (v2[1] / l2) * rr];
      d += ` L${a[0].toFixed(1)},${a[1].toFixed(1)} Q${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
    return d;
  }

  /* ---------- 两个状态之间的路由 ---------- */
  // 同一对状态之间的多条转移（含「来回线」A→B / B→A）走平行线，避免路径重叠
  const LANE_GAP = 22;        // 平行线之间的间距
  const LANE_LABEL_GAP = 13;  // 平行线的标签再往外推一点（不压线）

  // 从矩形中心朝目标方向求边界交点
  function borderPoint(r, toward) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const hw = r.w / 2 + 3;
    const hh = r.h / 2 + 3;
    const sx = dx ? hw / Math.abs(dx) : Infinity;
    const sy = dy ? hh / Math.abs(dy) : Infinity;
    const k = Math.min(sx, sy);
    return { x: cx + dx * k, y: cy + dy * k };
  }

  // 把点收进框内（偏移后不至于脱离状态框）
  function clampBox(p, box) {
    return {
      x: U.clamp(p.x, box.x, box.x + box.w),
      y: U.clamp(p.y, box.y, box.y + box.h),
    };
  }

  function inBox(x, y, box, pad) {
    return x > box.x - pad && x < box.x + box.w + pad && y > box.y - pad && y < box.y + box.h + pad;
  }

  // 三次贝塞尔取点
  function cubicAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  }

  // 标签落点：在基准线上取一个位置，再沿法线推到线的外侧，避开状态框
  // side = 该条线在组内的外侧方向（最上/最下才往外，中间线贴着自己的线）
  function pickLabel(base, perp, off, side, A, B) {
    const anchor = cubicAt(base.p1, base.c1, base.c2, base.p2, 0.7);
    // 推离本组所有线的中心带：外侧的线往外推，中间的线只做小幅偏移
    const cands = [
      [anchor.x + perp.x * (off + side * LANE_LABEL_GAP), anchor.y + perp.y * (off + side * LANE_LABEL_GAP)],
      [anchor.x + perp.x * (off + side * (LANE_LABEL_GAP + 14)), anchor.y + perp.y * (off + side * (LANE_LABEL_GAP + 14))],
      [anchor.x + perp.x * off, anchor.y + perp.y * off - 11],
      [anchor.x + perp.x * off, anchor.y + perp.y * off + 18],
      [anchor.x + perp.x * (off - side * 13), anchor.y + perp.y * (off - side * 13)],
    ];
    for (const c of cands) {
      if (!inBox(c[0], c[1], A, 8) && !inBox(c[0], c[1], B, 8)) return { lx: c[0], ly: c[1] };
    }
    return { lx: cands[0][0], ly: cands[0][1] };
  }

  // 两点之间的基准曲线（a → b 方向）
  function baseCurve(a, b) {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = borderPoint(a, bc);
    const p2 = borderPoint(b, ac);
    const n1 = { x: p1.x - ac.x, y: p1.y - ac.y };
    const n2 = { x: p2.x - bc.x, y: p2.y - bc.y };
    const l1 = Math.hypot(n1.x, n1.y) || 1;
    const l2 = Math.hypot(n2.x, n2.y) || 1;
    const dist = Math.hypot(bc.x - ac.x, bc.y - ac.y);
    const k = U.clamp(dist * 0.38, 34, 150);
    return {
      ac: ac, bc: bc, dist: dist,
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      c1: { x: p1.x + (n1.x / l1) * k, y: p1.y + (n1.y / l1) * k },
      c2: { x: p2.x + (n2.x / l2) * k, y: p2.y + (n2.y / l2) * k },
    };
  }

  // 自环：右上角甩一个小圈
  function selfLoop(a, dy) {
    const x = a.x + a.w;
    const y = a.y + a.h / 2 + (dy || 0);
    const d = `M${x},${y - 7} C${x + 38},${y - 26} ${x + 38},${y + 26} ${x},${y + 7}`;
    return { d, lx: x + 24, ly: y - 16, anchor: 'middle', dir: 'self' };
  }

  // 单条转移
  function route(a, b) {
    if (a.id === b.id) return selfLoop(a, 0);
    const base = baseCurve(a, b);
    const d =
      `M${base.p1.x.toFixed(1)},${base.p1.y.toFixed(1)} ` +
      `C${base.c1.x.toFixed(1)},${base.c1.y.toFixed(1)} ${base.c2.x.toFixed(1)},${base.c2.y.toFixed(1)} ${base.p2.x.toFixed(1)},${base.p2.y.toFixed(1)}`;

    const mx = (base.p1.x + 3 * base.c1.x + 3 * base.c2.x + base.p2.x) / 8;
    const my = (base.p1.y + 3 * base.c1.y + 3 * base.c2.y + base.p2.y) / 8;
    let lx = mx;
    let ly = my - 8;

    // 两个框贴太近时，标签挪到连线侧面，并挑一个不落在框里的方向
    if (base.dist < 84) {
      const dx = base.bc.x - base.ac.x;
      const dy = base.bc.y - base.ac.y;
      const px = -dy / (base.dist || 1);
      const py = dx / (base.dist || 1);
      const cands = [
        [px * 36, py * 36],
        [-px * 36, -py * 36],
        [Math.max(a.x + a.w, b.x + b.w) + 28 - mx, 0],
        [Math.min(a.x, b.x) - 28 - mx, 0],
        [0, -34],
      ];
      let pick = cands[0];
      for (const c of cands) {
        if (!inBox(mx + c[0], my + c[1], a, 10) && !inBox(mx + c[0], my + c[1], b, 10)) { pick = c; break; }
      }
      lx = mx + pick[0];
      ly = my + pick[1];
    }
    return { d, lx, ly, anchor: 'middle', dir: 'curve' };
  }

  /* ---------- 同一对状态之间的多条转移：平行线（来回线） ---------- */
  function routeGroup(list, byId) {
    const n = list.length;
    const A = byId[list[0].from];
    const B = byId[list[0].to];
    const out = [];
    if (!A || !B) {
      for (let i = 0; i < n; i++) out.push(null);
      return out;
    }

    // 自环：同状态上的多条自环上下错开
    if (A.id === B.id) {
      list.forEach((e, i) => out.push(selfLoop(A, (i - (n - 1) / 2) * 18)));
      return out;
    }

    const base = baseCurve(A, B);
    const dx = base.bc.x - base.ac.x;
    const dy = base.bc.y - base.ac.y;
    const len = Math.hypot(dx, dy) || 1;
    // 垂直于 A→B 的单位向量：平行线就沿着它错开
    const perp = { x: -dy / len, y: dx / len };

    list.forEach((e, i) => {
      const off = (i - (n - 1) / 2) * LANE_GAP;
      const p1 = clampBox({ x: base.p1.x + perp.x * off, y: base.p1.y + perp.y * off }, A);
      const p2 = clampBox({ x: base.p2.x + perp.x * off, y: base.p2.y + perp.y * off }, B);
      const c1 = { x: base.c1.x + perp.x * off, y: base.c1.y + perp.y * off };
      const c2 = { x: base.c2.x + perp.x * off, y: base.c2.y + perp.y * off };

      // 反向转移（B→A）把同一条基准线倒过来走
      const rev = e.from !== A.id;
      const s1 = rev ? p2 : p1;
      const s2 = rev ? p1 : p2;
      const k1 = rev ? c2 : c1;
      const k2 = rev ? c1 : c2;

      const d =
        `M${s1.x.toFixed(1)},${s1.y.toFixed(1)} ` +
        `C${k1.x.toFixed(1)},${k1.y.toFixed(1)} ${k2.x.toFixed(1)},${k2.y.toFixed(1)} ${s2.x.toFixed(1)},${s2.y.toFixed(1)}`;

      // 标签往本组外侧推：最上/最下的线往外，中间线贴着自己那条，各不压线
      const isOuter = n === 2 ? true : (i === 0 || i === n - 1);
      const side = off < 0 ? -1 : 1;
      const gap = isOuter ? LANE_LABEL_GAP : 0;
      const lab = pickLabel(base, perp, off + (isOuter ? side * gap : 0), side, A, B);
      out.push({ d, lx: lab.lx, ly: lab.ly, anchor: 'middle', dir: 'lane', lane: off });
    });
    return out;
  }

  /* ---------- 标签防重叠 ---------- */
  // 平行线上的标签已经分开，但不同连线之间仍可能压字，这里统一挪开
  function resolveLabels(edges) {
    const items = edges.filter((e) => e.geo && e.label).map((e) => ({ e: e, w: textW(e.label), h: 13 }));
    if (items.length < 2) return;
    const base = items.map((it) => ({ x: it.e.geo.lx, y: it.e.geo.ly }));
    for (let iter = 0; iter < 24; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = b.e.geo.lx - a.e.geo.lx;
          const dy = b.e.geo.ly - a.e.geo.ly;
          const ox = (a.w + b.w) / 2 + 6 - Math.abs(dx);
          const oy = (a.h + b.h) / 2 + 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (oy < ox) {
            const s = dy >= 0 ? 1 : -1;
            const push = oy / 2 + 0.5;
            a.e.geo.ly -= push * s;
            b.e.geo.ly += push * s;
          } else {
            const s = dx >= 0 ? 1 : -1;
            const push = ox / 2 + 0.5;
            a.e.geo.lx -= push * s;
            b.e.geo.lx += push * s;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    // 限制位移，别离自己的线太远
    const MAX = 20;
    items.forEach((it, i) => {
      const dx = it.e.geo.lx - base[i].x;
      const dy = it.e.geo.ly - base[i].y;
      const d = Math.hypot(dx, dy);
      if (d > MAX) {
        it.e.geo.lx = base[i].x + (dx / d) * MAX;
        it.e.geo.ly = base[i].y + (dy / d) * MAX;
      }
    });
  }

  /* ---------- 布局 ---------- */
  function layout(sd) {
    const list = sd && Array.isArray(sd.nodes) ? sd.nodes : [];
    const nodes = list.map((n, i) => {
      const s = sizeOf(n);
      return {
        id: n.id,
        kind: n.kind || 'state',
        name: n.name == null ? '' : n.name,
        note: n.note == null ? '' : n.note,
        x: n.x == null ? (i % 3) * 230 : n.x,
        y: n.y == null ? Math.floor(i / 3) * 140 : n.y,
        w: s.w,
        h: s.h,
        ls: lines(n.name).length ? lines(n.name) : ['状态'],
        ns: lines(n.note),
      };
    });
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    // 同一对状态之间的多条转移（含来回线）分组处理，走平行线
    const groups = [];
    const gmap = {};
    (sd && Array.isArray(sd.edges) ? sd.edges : []).forEach((e) => {
      if (!byId[e.from] || !byId[e.to]) return;
      const key = e.from < e.to ? e.from + '|' + e.to : e.to + '|' + e.from;
      let g = gmap[key];
      if (!g) { g = { list: [] }; gmap[key] = g; groups.push(g); }
      g.list.push(e);
    });

    const edges = [];
    groups.forEach((g) => {
      const list = g.list;
      const geos = list.length > 1
        ? routeGroup(list, byId)
        : [route(byId[list[0].from], byId[list[0].to])];
      list.forEach((e, i) => {
        edges.push({
          id: e.id,
          from: e.from,
          to: e.to,
          label: e.label || '',
          geo: geos[i] || null,
        });
      });
    });

    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    nodes.forEach((n) => {
      x1 = Math.min(x1, n.x);
      y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w);
      y2 = Math.max(y2, n.y + n.h);
    });
    if (!isFinite(x1)) { x1 = 0; y1 = 0; x2 = 420; y2 = 240; }
    resolveLabels(edges);

    const bbox = { x: x1, y: y1, w: Math.max(120, x2 - x1), h: Math.max(90, y2 - y1) };
    return { nodes, byId, edges, bbox };
  }

  /* ---------- 渲染 ---------- */
  function svg(sd, opts) {
    const o = opts || {};
    const L = layout(sd);
    const uid = o.uid || 'sd' + Math.random().toString(36).slice(2, 8);
    const ox = L.bbox.x - PAD;
    const oy = L.bbox.y - PAD;
    const vw = L.bbox.w + PAD * 2;
    const vh = L.bbox.h + PAD * 2;
    const parts = [];

    parts.push(
      `<svg class="st-svg${o.interactive ? ' st-svg-live' : ''}" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${ox} ${oy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`
    );
    parts.push(
      `<defs>
        <filter id="${uid}-sh" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow class="fc-sh" dx="0" dy="2" stdDeviation="2.2" flood-opacity="0.10"/>
        </filter>
        <marker id="${uid}-ar" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">
          <path class="fc-arrowhead" d="M1,1.6 L8.4,5 L1,8.4 z"/>
        </marker>
      </defs>`
    );

    // 转移层
    parts.push('<g class="st-edges">');
    L.edges.forEach((e) => {
      if (!e.geo) return;
      const sel = o.selEdge === e.id ? ' is-sel' : '';
      parts.push(
        `<g class="st-edge-g${sel}" data-eid="${e.id}" data-from="${e.from}" data-to="${e.to}">` +
          `<path class="st-edge-hit" d="${e.geo.d}"/>` +
          `<path class="st-edge" d="${e.geo.d}" marker-end="url(#${uid}-ar)"/>` +
          (e.label
            ? `<text class="st-elabel" x="${e.geo.lx.toFixed(1)}" y="${e.geo.ly.toFixed(1)}" text-anchor="${e.geo.anchor}" data-elabel="${e.id}">${U.esc(e.label)}</text>`
            : `<text class="st-elabel is-empty" x="${e.geo.lx.toFixed(1)}" y="${e.geo.ly.toFixed(1)}" text-anchor="${e.geo.anchor}" data-elabel="${e.id}"></text>`) +
          `</g>`
      );
    });
    parts.push('</g>');

    // 状态层
    parts.push('<g class="st-nodes">');
    L.nodes.forEach((n) => {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const sel = o.selNode === n.id ? ' sel' : '';
      parts.push(`<g class="st-g${sel}" data-nid="${n.id}">`);

      if (n.kind === 'initial') {
        parts.push(`<circle class="st-node st-initial" cx="${cx}" cy="${cy}" r="8" filter="url(#${uid}-sh)"/>`);
      } else if (n.kind === 'final') {
        parts.push(`<circle class="st-node st-final-out" cx="${cx}" cy="${cy}" r="12" filter="url(#${uid}-sh)"/>`);
        parts.push(`<circle class="st-node st-final-in" cx="${cx}" cy="${cy}" r="7"/>`);
      } else {
        parts.push(
          `<rect class="st-node st-state" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="13" ry="13" filter="url(#${uid}-sh)"/>`
        );
        const total = n.ls.length * 18 + (n.ns.length ? n.ns.length * 15 : 0);
        let ty = cy - total / 2 + 13;
        n.ls.forEach((l) => {
          parts.push(`<text x="${cx}" y="${ty.toFixed(1)}" text-anchor="middle" class="st-t">${U.esc(l)}</text>`);
          ty += 18;
        });
        if (n.ns.length) {
          ty += 2;
          n.ns.forEach((l) => {
            parts.push(`<text x="${cx}" y="${ty.toFixed(1)}" text-anchor="middle" class="st-t-note">${U.esc(l)}</text>`);
            ty += 15;
          });
        }
      }

      if (o.interactive && n.kind === 'state') {
        [['t', cx, n.y], ['r', n.x + n.w, cy], ['b', cx, n.y + n.h], ['l', n.x, cy]].forEach(([pos, x, y]) => {
          parts.push(`<circle class="fc-anchor st-anchor" data-anchor="${pos}" data-nid="${n.id}" cx="${x}" cy="${y}" r="4.6"/>`);
        });
      }
      parts.push('</g>');
    });
    parts.push('</g>');
    parts.push('</svg>');

    return { html: parts.join(''), w: vw, h: vh, layout: L };
  }

  /* ---------- 空白模板 ---------- */
  function blank() {
    const a = U.uid('s'), b = U.uid('s'), c = U.uid('s'), d = U.uid('s');
    return {
      title: '新状态图',
      caption: '',
      nodes: [
        { id: a, name: '待机', note: '', kind: 'state', x: 0, y: 90 },
        { id: b, name: '行动中', note: '', kind: 'state', x: 240, y: 90 },
        { id: c, name: '', note: '', kind: 'initial', x: -70, y: 96 },
        { id: d, name: '', note: '', kind: 'final', x: 480, y: 92 },
      ],
      edges: [
        { id: U.uid('e'), from: c, to: a, label: '开始' },
        { id: U.uid('e'), from: a, to: b, label: '触发' },
        { id: U.uid('e'), from: b, to: d, label: '结束' },
      ],
    };
  }

  /* ---------- 自动排版：按创建顺序网格 ---------- */
  function autoLayout(sd) {
    const nodes = sd.nodes || [];
    const cols = Math.max(2, Math.ceil(Math.sqrt(nodes.length)) + 1);
    const colW = 230, rowH = 140;
    nodes.forEach((n, i) => {
      n.x = (i % cols) * colW;
      n.y = Math.floor(i / cols) * rowH;
    });
    return sd;
  }

  function measure(sd) {
    const L = layout(sd);
    return { w: L.bbox.w + PAD * 2, h: L.bbox.h + PAD * 2 };
  }

  return { svg, layout, blank, autoLayout, measure, sizeOf, route, routeGroup, KINDS, PAD };
})();
