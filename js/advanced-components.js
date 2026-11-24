/* ------------------------------------------------------------------
 *  advanced-components.js — P2 图解 / P3 高级素材的 DOM 渲染
 *  时间轴、循环图、层级图、矩阵、对比卡、分栏、视频/GIF、语义卡
 *  分组框的实际容器逻辑在 groups.js，这里只负责它的“外壳”渲染。
 * ------------------------------------------------------------------ */
window.AdvancedComponents = (function () {
  const E = U.esc;
  const f = (v) => (v == null ? '' : String(v));

  function tone(e, fallback) {
    return e.tone || fallback || 'blue';
  }

  function head(chip, title, count, editTitle) {
    return (
      `<div class="adv-head">` +
      `<span class="adv-chip">${E(chip)}</span>` +
      `<div class="adv-title"${editTitle === false ? '' : ' data-edit="title"'}>${E(title || '')}</div>` +
      `<span class="adv-count">${E(count || '')}</span>` +
      `</div>`
    );
  }

  function empty(text) {
    return `<div class="adv-empty">${E(text)}</div>`;
  }

  function blocks(html) {
    const s = f(html).trim();
    if (!s) return `<p class="adv-placeholder">还没有内容。</p>`;
    return /^\s*</.test(s) ? s : `<p>${E(s).replace(/\n/g, '<br>')}</p>`;
  }

  /* ---------------- 时间轴 ---------------- */
  function timeline(e) {
    const all = Array.isArray(e.nodes) ? e.nodes : [];
    const visible = all
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n && (n.title || n.date || n.note));
    const nodes = visible.map(({ n }) => n);
    const vertical = e.orientation === 'v';
    return (
      `<div class="adv-card tl-card tone-${tone(e, 'blue')}">` +
      head('时间轴', e.title || '玩家旅程时间轴', `${nodes.length} 节点`) +
      `<div class="tl-track ${vertical ? 'is-v' : 'is-h'}" style="--tl-n:${Math.max(1, nodes.length)}">` +
      (visible.length
        ? visible.map(({ n, i }) =>
            `<div class="tl-node" data-node-index="${i}">` +
            `<div class="tl-date" data-edit="date" data-coll="nodes" data-index="${i}">${E(n.date || '')}</div>` +
            `<span class="tl-dot"></span>` +
            `<div class="tl-copy">` +
            `<div class="tl-node-title" data-edit="title" data-coll="nodes" data-index="${i}">${E(n.title || '')}</div>` +
            `<div class="tl-note" data-edit="note" data-coll="nodes" data-index="${i}">${E(n.note || '')}</div>` +
            `</div>` +
            `</div>`
          ).join('')
        : empty('还没有节点。点上方「＋ 添加节点」开始。')) +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 循环图 ---------------- */
  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function cut(s, n) {
    s = f(s).trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function cycle(e) {
    const nodes = (Array.isArray(e.nodes) ? e.nodes : []).filter((n) => n && n.label);
    const n = Math.min(6, Math.max(1, nodes.length));
    const uid = ('cy-' + (e.id || '')).replace(/[^a-z0-9-]/gi, '');
    const W = 460, H = 390, cx = W / 2, cy = H / 2 + 4, R = 128, NR = 40;
    const list = nodes.slice(0, 6);
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
    const nodeSvg = list.map((item, i) => {
      const p = polar(cx, cy, R, i * 360 / n);
      const label = cut(item.label, 8);
      return (
        `<g class="cyc-node">` +
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${NR}" />` +
        `<text class="cyc-label" x="${p.x.toFixed(1)}" y="${(p.y + 2).toFixed(1)}" text-anchor="middle">${E(label)}</text>` +
        `<text class="cyc-note" x="${p.x.toFixed(1)}" y="${(p.y + 18).toFixed(1)}" text-anchor="middle">${E(cut(item.note, 9))}</text>` +
        `</g>`
      );
    }).join('');
    return (
      `<div class="adv-card cyc-card tone-${tone(e, 'violet')}">` +
      head('循环', e.title || '核心循环', `${list.length} 节点`) +
      `<div class="cyc-stage">` +
      (list.length
        ? `<svg class="cyc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${E(e.title || '核心循环')}">` +
          `<defs><marker id="${uid}-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>` +
          `<circle class="cyc-orbit" cx="${cx}" cy="${cy}" r="${R + 22}"/>` +
          arcs +
          `<circle class="cyc-center" cx="${cx}" cy="${cy}" r="46"/>` +
          `<text class="cyc-center-label" x="${cx}" y="${cy + 5}" text-anchor="middle">${E(cut(e.center || '留存', 6))}</text>` +
          nodeSvg +
          `</svg>`
        : empty('至少添加 3 个节点，才能形成循环。')) +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 层级图 ---------------- */
  function hierarchy(e) {
    const all = Array.isArray(e.nodes) ? e.nodes : [];
    const visible = all.map((n, i) => ({ n, i })).filter(({ n }) => n && n.label);
    const nodes = visible.map(({ n }) => n);
    const total = Math.max(1, nodes.length);
    const layered = e.style === 'layers';
    const widthOf = (i) => (layered ? 100 : 42 + (i / Math.max(1, total - 1)) * 58);
    return (
      `<div class="adv-card hier-card tone-${tone(e, 'blue')}">` +
      head('层级', e.title || '五层拆解框架', `${nodes.length} 层`) +
      `<div class="hier-stack ${layered ? 'is-layers' : 'is-pyramid'}">` +
      (visible.length
        ? visible.map(({ n, i }, vi) =>
            `<div class="hier-row" style="--hw:${widthOf(vi).toFixed(1)}%" data-level="${vi}" data-node-index="${i}">` +
            `<div class="hier-copy">` +
            `<div class="hier-label" data-edit="label" data-coll="nodes" data-index="${i}">${E(n.label || '')}</div>` +
            `<div class="hier-note" data-edit="note" data-coll="nodes" data-index="${i}">${E(n.note || '')}</div>` +
            `</div>` +
            `<span class="hier-idx">${String(vi + 1).padStart(2, '0')}</span>` +
            `</div>`
          ).join('')
        : empty('还没有层级。点上方「＋ 添加层级」开始。')) +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 矩阵 ---------------- */
  function matrix(e) {
    const pts = (Array.isArray(e.points) ? e.points : []).filter((p) => p && p.label);
    const q = e.quadrants || {};
    const quads = [
      { key: 'tr', name: q.tr || '重点投入', x: 345, y: 24, cls: 'is-tr' },
      { key: 'tl', name: q.tl || '谨慎评估', x: 115, y: 24, cls: 'is-tl' },
      { key: 'br', name: q.br || '快速试点', x: 345, y: 300, cls: 'is-br' },
      { key: 'bl', name: q.bl || '暂缓', x: 115, y: 300, cls: 'is-bl' },
    ];
    const X = 60, Y = 42, PW = 340, PH = 286;
    const px = (v) => X + Math.max(0, Math.min(100, Number(v) || 0)) / 100 * PW;
    const py = (v) => Y + (100 - Math.max(0, Math.min(100, Number(v) || 0))) / 100 * PH;
    return (
      `<div class="adv-card mx-card tone-${tone(e, 'blue')}">` +
      head('矩阵', e.title || '机会判断矩阵', `${pts.length} 点`) +
      `<div class="mx-stage">` +
      `<svg class="mx-svg" viewBox="0 0 460 386" role="img" aria-label="${E(e.title || '矩阵')}">` +
      `<rect class="mx-q is-tr" x="${X + PW / 2}" y="${Y}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-tl" x="${X}" y="${Y}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-br" x="${X + PW / 2}" y="${Y + PH / 2}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<rect class="mx-q is-bl" x="${X}" y="${Y + PH / 2}" width="${PW / 2}" height="${PH / 2}"/>` +
      `<path class="mx-axis" d="M${X} ${Y + PH / 2}h${PW}M${X + PW / 2} ${Y}v${PH}"/>` +
      `<rect class="mx-frame" x="${X}" y="${Y}" width="${PW}" height="${PH}"/>` +
      quads.map((x) => `<text class="mx-quad" x="${x.x}" y="${x.y}" text-anchor="middle">${E(cut(x.name, 9))}</text>`).join('') +
      `<text class="mx-axis-label" x="${X + PW / 2}" y="${Y + PH + 30}" text-anchor="middle">${E(e.xLabel || '')}</text>` +
      `<text class="mx-axis-label mx-y" x="16" y="${Y + PH / 2}" text-anchor="middle">${E(e.yLabel || '')}</text>` +
      pts.map((p) => {
        const x = px(p.x), y = py(p.y);
        return (
          `<g class="mx-point">` +
          `<circle class="mx-dot tone-${p.tone || 'violet'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>` +
          `<text class="mx-point-label" x="${x.toFixed(1)}" y="${(y + 20).toFixed(1)}" text-anchor="middle">${E(cut(p.label, 8))}</text>` +
          `</g>`
        );
      }).join('') +
      `</svg>` +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 对比卡 ---------------- */
  function compare(e) {
    const L = e.left || {}, R = e.right || {};
    return (
      `<div class="adv-card cmp-card tone-${tone(e, 'blue')}">` +
      head('对照', e.title || '两版方案对比', '') +
      `<div class="cmp-grid">` +
      `<div class="cmp-col is-left">` +
      `<div class="cmp-kicker">A</div>` +
      `<div class="cmp-col-title" data-edit="title" data-obj="left">${E(L.title || '原方案')}</div>` +
      `<div class="cmp-body rich" data-edit="html" data-obj="left">${blocks(L.html)}</div>` +
      `</div>` +
      `<div class="cmp-vs">VS</div>` +
      `<div class="cmp-col is-right">` +
      `<div class="cmp-kicker">B</div>` +
      `<div class="cmp-col-title" data-edit="title" data-obj="right">${E(R.title || '改版方案')}</div>` +
      `<div class="cmp-body rich" data-edit="html" data-obj="right">${blocks(R.html)}</div>` +
      `</div>` +
      `</div>` +
      (e.verdict ? `<div class="cmp-verdict" data-edit="verdict"><b>结论</b><span>${E(e.verdict)}</span></div>` : '') +
      `</div>`
    );
  }

  /* ---------------- 分栏 ---------------- */
  function columns(e) {
    const cols = (Array.isArray(e.cols) ? e.cols : []).filter(Boolean);
    const n = Math.min(3, Math.max(2, cols.length || 2));
    return (
      `<div class="adv-card cols-card tone-${tone(e, 'slate')}">` +
      head('分栏', e.title || '并排说明', `${n} 栏`) +
      `<div class="cols-grid" style="--cols:${n}">` +
      (cols.length
        ? cols.slice(0, 3).map((c, i) =>
            `<div class="cols-col">` +
            `<div class="cols-col-head"><span>${String(i + 1).padStart(2, '0')}</span>` +
            `<div class="cols-col-title" data-edit="title" data-coll="cols" data-index="${i}">${E(c.title || '')}</div></div>` +
            `<div class="cols-body rich" data-edit="html" data-coll="cols" data-index="${i}">${blocks(c.html)}</div>` +
            `</div>`
          ).join('')
        : empty('还没有栏目。右侧属性面板可以编辑。')) +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 视频 / GIF ---------------- */
  function video(e) {
    const src = f(e.src).trim();
    const poster = f(e.poster).trim();
    const gif = !!e.isGif || /\.(gif|webp)(\?|#|$)/i.test(src);
    return (
      `<div class="adv-card vid-card">` +
      `<div class="vid-frame">` +
      (src
        ? (gif
            ? `<img class="vid-gif" src="${E(src)}" alt="${E(e.title || 'GIF')}">`
            : `<video class="vid-player ${e.fit === 'contain' ? 'is-contain' : ''}" src="${E(src)}"${poster ? ` poster="${E(poster)}"` : ''} controls preload="metadata" playsinline${e.loop ? ' loop' : ''}></video>`)
        : `<div class="vid-empty"><span class="vid-play">▶</span><b>视频 / GIF</b><small>在属性面板或编辑窗口上传文件 / 粘贴 URL</small></div>`) +
      `</div>` +
      `<div class="vid-meta">` +
      `<span class="adv-chip">${gif ? 'GIF' : '视频'}</span>` +
      `<div class="vid-title" data-edit="title">${E(e.title || '动效参考')}</div>` +
      `<div class="vid-caption" data-edit="caption">${E(e.caption || '')}</div>` +
      `</div>` +
      `</div>`
    );
  }

  /* ---------------- 语义卡 ---------------- */
  const SEM = {
    insight: ['观点', '我的判断是什么？'],
    evidence: ['证据', '什么支撑这个判断？'],
    conclusion: ['结论', '所以意味着什么？'],
    question: ['问题', '还需要验证什么？'],
  };

  function semantic(e) {
    const v = SEM[e.variant] ? e.variant : 'insight';
    const [badge, prompt] = SEM[v];
    return (
      `<div class="adv-card sem-card sem-${v}">` +
      `<div class="sem-head"><span class="sem-badge">${badge}</span><span class="sem-prompt">${prompt}</span></div>` +
      `<div class="sem-title" data-edit="title">${E(e.title || '核心判断')}</div>` +
      `<div class="sem-body" data-edit="body">${E(e.body || '')}</div>` +
      `<div class="sem-source" data-edit="source">${E(e.source || '')}</div>` +
      `</div>`
    );
  }

  /* ---------------- 分组框外壳 ---------------- */
  function group(e) {
    const n = (Array.isArray(e.members) ? e.members : []).filter((id) => window.Store && Store.el(id)).length;
    return (
      `<div class="grp-card tone-${tone(e, 'slate')}">` +
      `<div class="grp-head"><span class="grp-chip">GROUP</span>` +
      `<div class="grp-title" data-edit="title">${E(e.title || '系统分组')}</div>` +
      `<span class="grp-count">${n ? n + ' 个组件' : '空分组'}</span>` +
      `</div>` +
      `<div class="grp-body">${n ? '<span class="grp-hint">拖动标题整体移动 · 删除分组不会删除子组件</span>' : '<span class="grp-hint">选中多个组件后，在右侧属性面板点「组合为分组框」</span>'}</div>` +
      `</div>`
    );
  }

  function render(e) {
    switch (e.type) {
      case 'timeline': return timeline(e);
      case 'cycle': return cycle(e);
      case 'hierarchy': return hierarchy(e);
      case 'matrix': return matrix(e);
      case 'compare': return compare(e);
      case 'columns': return columns(e);
      case 'video': return video(e);
      case 'semantic': return semantic(e);
      case 'group': return group(e);
      default: return '';
    }
  }

  return { render, SEM };
})();
