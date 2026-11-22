/* ------------------------------------------------------------------
 *  flowchart.js — 流程 / 决策树组件：自动布局 + 手动摆放 + SVG 渲染
 *  node = { id, parentId, kind: start|process|decision|end, text, label,
 *           px, py  ← 手动拖拽后的绝对坐标（无则参与自动布局） }
 * ------------------------------------------------------------------ */
window.FC = (function () {
  const M = U.measure;
  const FONT = '13px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const FONT_B = '600 13px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';

  const PAD = 8;
  const HGAP = 34;
  const VGAP = 46;

  const KINDS = { start: '开始', process: '处理', decision: '判断', end: '结束' };

  function sizeOf(node) {
    const text = node.text || '节点';
    if (node.kind === 'decision') {
      const lines = U.wrapBalanced(text, 158, FONT_B);
      let mw = 0;
      lines.forEach((l) => (mw = Math.max(mw, M(l, FONT_B))));
      return { w: Math.max(186, mw + 72), h: Math.max(84, lines.length * 19 + 54), lines };
    }
    if (node.kind === 'process') {
      const lines = U.wrapBalanced(text, 210, FONT);
      let mw = 0;
      lines.forEach((l) => (mw = Math.max(mw, M(l, FONT))));
      return { w: Math.max(152, mw + 36), h: Math.max(48, lines.length * 19 + 26), lines };
    }
    const lines = U.wrapBalanced(text, 240, FONT_B);
    let mw = 0;
    lines.forEach((l) => (mw = Math.max(mw, M(l, FONT_B))));
    return { w: Math.max(132, mw + 56), h: 44 + (lines.length - 1) * 18, lines };
  }

  /* ---------------- 布局 ---------------- */
  function layout(flow) {
    const nodes = (flow.nodes || []).filter((n) => n && n.text !== '');
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));

    const kids = {};
    nodes.forEach((n) => {
      if (n.parentId && byId[n.parentId]) (kids[n.parentId] = kids[n.parentId] || []).push(n);
    });
    let roots = nodes.filter((n) => !n.parentId || !byId[n.parentId]);
    if (!roots.length && nodes.length) roots = [nodes[0]];

    const geo = {};
    nodes.forEach((n) => {
      const s = sizeOf(n);
      geo[n.id] = { w: s.w, h: s.h, lines: s.lines, x: 0, y: 0 };
    });

    // 1) 深度 → y
    const depthMax = [];
    (function walkDepth(list, d) {
      list.forEach((n) => {
        depthMax[d] = Math.max(depthMax[d] || 0, geo[n.id].h);
        if (kids[n.id]) walkDepth(kids[n.id], d + 1);
      });
    })(roots, 0);
    const yOfDepth = [];
    let acc = 0;
    depthMax.forEach((h, d) => { yOfDepth[d] = acc; acc += (h || 0) + VGAP; });
    (function placeY(list, d) {
      list.forEach((n) => {
        geo[n.id].y = yOfDepth[d] + (depthMax[d] - geo[n.id].h) / 2;
        if (kids[n.id]) placeY(kids[n.id], d + 1);
      });
    })(roots, 0);

    // 2) 后序 → x（叶子按游标排列，父节点居中对齐子节点）
    let cursor = 0;
    function placeX(n) {
      const g = geo[n.id];
      const cs = kids[n.id] || [];
      if (!cs.length) {
        g.x = cursor;
        cursor += g.w + HGAP;
        return g.x + g.w / 2;
      }
      const centers = cs.map((c) => placeX(c));
      const left = geo[cs[0].id].x;
      const right = geo[cs[cs.length - 1].id].x + geo[cs[cs.length - 1].id].w;
      const center = (left + right) / 2;
      g.x = center - g.w / 2;
      return center;
    }
    roots.forEach((r, i) => {
      placeX(r);
      if (i < roots.length - 1) cursor += HGAP;
    });

    // 3) 手动位置覆盖
    nodes.forEach((n) => {
      if (n.px != null && n.py != null) {
        geo[n.id].x = n.px;
        geo[n.id].y = n.py;
      }
    });

    // 4) 包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const g = geo[n.id];
      minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
    });
    if (!nodes.length) { minX = minY = 0; maxX = 320; maxY = 160; }
    const bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

    // 5) 连线
    const edges = [];
    nodes.forEach((n) => {
      if (!n.parentId || !byId[n.parentId]) return;
      const p = geo[n.parentId], c = geo[n.id];
      const pair = anchors(p, c);
      edges.push({
        id: n.parentId + '->' + n.id,
        from: n.parentId,
        to: n.id,
        label: n.label || '',
        kind: pair.dir,
        x1: pair.x1, y1: pair.y1, x2: pair.x2, y2: pair.y2,
        d: pair.dir === 'v'
          ? U.elbow(pair.x1, pair.y1, pair.x2, pair.y2, 12)
          : elbowH(pair.x1, pair.y1, pair.x2, pair.y2, 12),
        lx: pair.lx, ly: pair.ly, anchor: pair.anchor,
      });
    });

    return { bbox: bbox, geo: geo, nodes: nodes, edges: edges, kids: kids, roots: roots };
  }

  // 依据相对位置挑选出入锚点：下方优先垂直，垂直有重叠才走水平
  function anchors(p, c) {
    const acx = p.x + p.w / 2, acy = p.y + p.h / 2;
    const bcx = c.x + c.w / 2, bcy = c.y + c.h / 2;

    if (c.y >= p.y + p.h - 2) {
      const right = bcx >= acx;
      return {
        dir: 'v', x1: acx, y1: p.y + p.h, x2: bcx, y2: c.y,
        lx: acx + (right ? 20 : -20), ly: p.y + p.h + 18,
        anchor: right ? 'start' : 'end',
      };
    }
    if (c.y + c.h <= p.y + 2) {
      const right = bcx >= acx;
      return {
        dir: 'v', x1: acx, y1: p.y, x2: bcx, y2: c.y + c.h,
        lx: acx + (right ? 20 : -20), ly: p.y - 10,
        anchor: right ? 'start' : 'end',
      };
    }
    if (bcx >= acx) {
      return { dir: 'h', x1: p.x + p.w, y1: acy, x2: c.x, y2: bcy, lx: p.x + p.w + 10, ly: acy - 8, anchor: 'start' };
    }
    return { dir: 'h', x1: p.x, y1: acy, x2: c.x + c.w, y2: bcy, lx: p.x - 10, ly: acy - 8, anchor: 'end' };
  }

  function elbowH(x1, y1, x2, y2, r) {
    r = Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
    if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} L${x2},${y2}`;
    const midX = (x1 + x2) / 2;
    const dir = y2 > y1 ? 1 : -1;
    return [
      `M${x1},${y1}`,
      `L${midX - r},${y1}`,
      `Q${midX},${y1} ${midX},${y1 + dir * r}`,
      `L${midX},${y2 - dir * r}`,
      `Q${midX},${y2} ${midX + r},${y2}`,
      `L${x2},${y2}`,
    ].join(' ');
  }

  /* ---------------- 渲染 ---------------- */
  function svg(flow, opts) {
    const o = opts || {};
    const L = layout(flow);
    const uid = o.uid || Math.random().toString(36).slice(2, 8);
    const ox = L.bbox.x - PAD, oy = L.bbox.y - PAD;
    const vw = L.bbox.w + PAD * 2, vh = L.bbox.h + PAD * 2;
    const parts = [];

    parts.push(
      `<svg class="fc-svg${o.interactive ? ' fc-svg-live' : ''}" width="${Math.round(vw)}" height="${Math.round(vh)}" viewBox="${ox} ${oy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`
    );
    parts.push(
      `<defs>
        <filter id="${uid}-sh" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow class="fc-sh" dx="0" dy="2" stdDeviation="2.2" flood-opacity="0.10"/>
        </filter>
        <marker id="${uid}-ar" viewBox="0 0 10 10" refX="8.4" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">
          <path class="fc-arrowhead" d="M1,1.6 L8.4,5 L1,8.4 z"/>
        </marker>
      </defs>`
    );

    // 连线层
    parts.push('<g class="fc-edges">');
    L.edges.forEach((e) => {
      const sel = o.selEdge === e.id ? ' is-sel' : '';
      parts.push(
        `<g class="fc-edge-g${sel}" data-eid="${e.id}" data-from="${e.from}" data-to="${e.to}">` +
          `<path class="fc-edge-hit" d="${e.d}"/>` +
          `<path class="fc-edge" d="${e.d}" marker-end="url(#${uid}-ar)"/>` +
          (e.label
            ? `<text class="fc-elabel" x="${e.lx}" y="${e.ly}" text-anchor="${e.anchor}" data-elabel="${e.id}">${U.esc(e.label)}</text>`
            : `<text class="fc-elabel is-empty" x="${e.lx}" y="${e.ly}" text-anchor="${e.anchor}" data-elabel="${e.id}"></text>`) +
          `</g>`
      );
    });
    parts.push('</g>');

    // 节点层
    parts.push('<g class="fc-nodes">');
    L.nodes.forEach((n) => {
      const g = L.geo[n.id];
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      const ty0 = cy - ((g.lines.length - 1) * 19) / 2;
      const sel = o.selNode === n.id ? ' sel' : '';
      parts.push(`<g class="fc-g${sel}" data-nid="${n.id}">`);

      if (n.kind === 'decision') {
        const pts = [[cx, g.y], [g.x + g.w, cy], [cx, g.y + g.h], [g.x, cy]].map((p) => p.join(',')).join(' ');
        parts.push(`<polygon points="${pts}" class="fc-node fc-decision" filter="url(#${uid}-sh)"/>`);
      } else {
        const r = n.kind === 'start' || n.kind === 'end' ? g.h / 2 : 11;
        parts.push(
          `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${r}" ry="${r}" class="fc-node fc-${n.kind}" filter="url(#${uid}-sh)"/>`
        );
      }

      const tcls = 'fc-t fc-t-' + n.kind;
      if (g.lines.length === 1) {
        parts.push(`<text x="${cx}" y="${ty0 + 4.5}" text-anchor="middle" class="${tcls}">${U.esc(g.lines[0])}</text>`);
      } else {
        const spans = g.lines.map((l, i) => `<tspan x="${cx}" y="${ty0 + i * 19 + 4.5}">${U.esc(l)}</tspan>`).join('');
        parts.push(`<text text-anchor="middle" class="${tcls}">${spans}</text>`);
      }

      if (o.interactive) {
        [['t', cx, g.y], ['r', g.x + g.w, cy], ['b', cx, g.y + g.h], ['l', g.x, cy]].forEach(([pos, x, y]) => {
          parts.push(`<circle class="fc-anchor" data-anchor="${pos}" data-nid="${n.id}" cx="${x}" cy="${y}" r="4.6"/>`);
        });
      }
      parts.push('</g>');
    });
    parts.push('</g>');
    parts.push('</svg>');

    return { html: parts.join(''), w: vw, h: vh, layout: L };
  }

  function blank() {
    const a = U.uid('n'), b = U.uid('n'), c = U.uid('n');
    return {
      nodes: [
        { id: a, parentId: null, kind: 'start', text: '进入流程' },
        { id: b, parentId: a, kind: 'process', text: '第一步操作' },
        { id: c, parentId: b, kind: 'end', text: '流程结束' },
      ],
    };
  }

  function measureFlow(flow) {
    const L = layout(flow);
    return { w: L.bbox.w + PAD * 2, h: L.bbox.h + PAD * 2 };
  }

  return { layout, svg, render: svg, blank, measureFlow, KINDS, anchors, elbowH, PAD };
})();
