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
    n.style.zIndex = e.z || 1;
    if (e.type === 'image') n.style.height = (e.h || 320) + 'px';
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

  function table(e) {
    if (!window.Tables) return '';
    return Tables.render(e);
  }

  return { build, inner, EDIT_BTN };
})();
