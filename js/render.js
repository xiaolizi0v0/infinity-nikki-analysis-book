/* ------------------------------------------------------------------
 *  render.js — 各类组件 → DOM
 * ------------------------------------------------------------------ */
window.Renderer = (function () {
  const E = U.esc;

  const EDIT_BTN =
    `<button class="el-edit" type="button" title="打开编辑窗口">` +
    `<svg viewBox="0 0 14 14" fill="none"><path d="M9.2 1.8l3 3-7.4 7.4-3.6.6.6-3.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>` +
    `编辑</button>`;

  function build(e) {
    const n = U.h('div', { class: 'el el-' + e.type, 'data-id': e.id });
    n.style.left = e.x + 'px';
    n.style.top = e.y + 'px';
    n.style.width = (e.w || 420) + 'px';
    n.style.zIndex = e.z == null ? 1 : e.z;
    if (e.type === 'image') n.style.height = (e.h || 320) + 'px';
    if (e.type === 'group') n.style.height = (e.h || 240) + 'px';
    n.innerHTML = inner(e);
    if (e.type === 'image') n.style.height = (e.h || 320) + 'px';
    if (e.type === 'flowchart') {
      const svg = n.querySelector('svg');
      if (svg) svg.dataset.w = svg.getAttribute('width');
    }
    return n;
  }

  function inner(e) {
    switch (e.type) {
      case 'heading': return heading(e);
      case 'text': return text(e);
      case 'note': return note(e);
      case 'image': return image(e);
      case 'flowchart': return flow(e);
      case 'table': return table(e);
      case 'state': return state(e);
      case 'list': return list(e);
      case 'quote': return quote(e);
      case 'divider': return divider(e);
      case 'metric': return metric(e);
      case 'rating': return rating(e);
      case 'source': return source(e);
      case 'timeline':
      case 'cycle':
      case 'hierarchy':
      case 'matrix':
      case 'er':
      case 'compare':
      case 'columns':
      case 'video':
      case 'semantic':
      case 'group':
        return window.AdvancedComponents ? AdvancedComponents.render(e) + EDIT_BTN : '';
      default: return '';
    }
  }

  function heading(e) {
    const lvl = e.level || 2;
    return (
      `<div class="hd hd-${lvl}">` +
      (e.kicker ? `<div class="hd-kicker" data-edit="kicker">${E(e.kicker)}</div>` : '') +
      `<div class="hd-title" data-edit="text">${E(e.text || '未命名章节')}</div>` +
      `<div class="hd-rule"></div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function text(e) {
    return (
      `<div class="tx tx-${e.variant || 'body'}"><div class="rich" data-edit="html">${e.html || ''}</div></div>` +
      EDIT_BTN
    );
  }

  function note(e) {
    return (
      `<div class="note note-${e.tone || 'idea'}">` +
      `<div class="note-head"><span class="note-dot"></span>` +
      `<span class="note-title" data-edit="title">${E(e.title || '标注')}</span></div>` +
      `<div class="rich" data-edit="html">${e.html || ''}</div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  /* ---------------- P1：列表 / 引用 / 分隔线 / 指标 / 评分 / 来源 ---------------- */
  function list(e) {
    const items = (Array.isArray(e.items) ? e.items : [])
      .map((text, i) => ({ text: String(text || '').trim(), i }))
      .filter((x) => x.text);
    const marks = e.ordered
      ? (i) => String(i + 1)
      : () => '';
    return (
      `<div class="ls-card">` +
      `<div class="ls-title" data-edit="title">${E(e.title || '要点清单')}</div>` +
      (items.length
        ? `<div class="ls-list ${e.ordered ? 'is-num' : 'is-dot'}">` +
          items.map((it, j) =>
            `<div class="ls-item"><span class="ls-mark">${marks(j)}</span>` +
            `<div class="ls-text" data-edit="__list" data-index="${it.i}">${E(it.text)}</div></div>`
          ).join('') +
          `</div>`
        : `<div class="ls-empty">还没有条目。右侧面板里每行写一条。</div>`) +
      `</div>` +
      EDIT_BTN
    );
  }

  function quote(e) {
    const tone = e.tone || 'violet';
    return (
      `<div class="quote-card tone-${tone}">` +
      `<div class="quote-mark" aria-hidden="true">“</div>` +
      `<div class="quote-text" data-edit="text">${E(e.text || '')}</div>` +
      `<div class="quote-by" data-edit="by">${E(e.by || '')}</div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function divider(e) {
    const tone = e.tone || 'violet';
    return (
      `<div class="dv-card tone-${tone}">` +
      `<span class="dv-line"></span>` +
      (e.label ? `<span class="dv-label" data-edit="label">${E(e.label)}</span>` : '') +
      `<span class="dv-line"></span>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function metric(e) {
    const tone = e.tone || 'violet';
    return (
      `<div class="metric-card tone-${tone}">` +
      `<div class="metric-label" data-edit="label">${E(e.label || '关键指标')}</div>` +
      `<div class="metric-row"><span class="metric-value" data-edit="value">${E(e.value !== '' && e.value != null ? e.value : '—')}</span>` +
      `<span class="metric-unit" data-edit="unit">${E(e.unit || '')}</span></div>` +
      `<div class="metric-note" data-edit="note">${E(e.note || '')}</div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function rating(e) {
    const tone = e.tone || 'violet';
    const max = Math.max(1, Number(e.max) || 5);
    const value = Math.min(max, Math.max(0, Number(e.value) || 0));
    const pct = Math.round((value / max) * 100);
    return (
      `<div class="rating-card tone-${tone}">` +
      `<div class="rating-top"><span data-edit="label">${E(e.label || '评分')}</span><b>${value} / ${max}</b></div>` +
      `<div class="rating-track"><i style="width:${pct}%"></i></div>` +
      `<div class="rating-note" data-edit="note">${E(e.note || '')}</div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function source(e) {
    return (
      `<div class="source-card">` +
      `<div class="source-ico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none">` +
      `<path d="M6.6 9.4l2.8-2.8M5.2 7.4l-1.5 1.5a2.6 2.6 0 003.7 3.7l1.5-1.5M10.8 8.6l1.5-1.5a2.6 2.6 0 00-3.7-3.7L7.1 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
      `</svg></div>` +
      `<div class="source-main">` +
      `<div class="source-title" data-edit="title">${E(e.title || '参考来源')}</div>` +
      `<div class="source-url" data-edit="url">${E(e.url || '')}</div>` +
      `<div class="source-note" data-edit="note">${E(e.note || '')}</div>` +
      `</div>` +
      `</div>` +
      EDIT_BTN
    );
  }

  function image(e) {
    const r = e.radius == null ? 14 : e.radius;
    const marks = (Marks.norm(e) || []).length;
    return (
      `<figure class="shot${e.shadow === false ? ' no-shadow' : ''}">` +
      `<div class="shot-frame" style="border-radius:${r}px">` +
      `<canvas class="shot-cv"></canvas>` +
      (e.src ? '' : `<div class="shot-empty">拖入图片 / 在右侧面板上传</div>`) +
      `<button class="shot-edit" type="button" title="打开图片编辑器：箭头 / 文字 / 框选 / 马赛克标注">` +
      `<svg viewBox="0 0 14 14" fill="none"><path d="M9.2 1.8l3 3-7.4 7.4-3.6.6.6-3.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>` +
      `编辑${marks ? `<i class="shot-n">${marks}</i>` : ''}</button>` +
      `</div>` +
      `<figcaption>` +
      `<div class="shot-title" data-edit="title">${E(e.title || '图片')}</div>` +
      (e.caption ? `<div class="shot-cap" data-edit="caption">${E(e.caption)}</div>` : '') +
      `</figcaption>` +
      `</figure>`
    );
  }

  function flow(e) {
    const nodes = e.nodes || [];
    const r = FC.svg({ nodes }, { uid: e.id.replace(/[^a-z0-9]/gi, '') });
    return (
      `<div class="fc-card">` +
      `<div class="fc-head"><span class="fc-chip">流程</span>` +
      `<div class="fc-title" data-edit="title">${E(e.title || '流程图')}</div>` +
      `<span class="fc-count">${nodes.length} 节点</span>` +
      `<button class="fc-edit" type="button" title="打开可视化编辑器：拖拽节点、拖锚点连线">编辑</button></div>` +
      `<div class="fc-body">${r.html}</div>` +
      `</div>`
    );
  }

  function state(e) {
    if (!window.SD) return '';
    const r = SD.svg(e, { uid: e.id.replace(/[^a-z0-9]/gi, '') });
    const nodes = (e.nodes || []).length;
    return (
      `<div class="st-card">` +
      `<div class="st-head"><span class="st-chip">状态</span>` +
      `<div class="st-title" data-edit="title">${E(e.title || '状态图')}</div>` +
      `<span class="st-count">${nodes} 状态</span>` +
      `<button class="st-edit" type="button" title="打开可视化编辑器：拖拽状态、拖锚点连线">编辑</button></div>` +
      `<div class="st-body">${r.html}</div>` +
      `</div>`
    );
  }

  function table(e) {
    if (!window.Tables) return '';
    return Tables.render(e);
  }

  return { build, inner, EDIT_BTN };
})();
