/* ------------------------------------------------------------------
 *  texteditor.js — 标题 / 文字 / 标注 的编辑窗口
 *  · 标题：眉标 + 标题 + 层级，右侧实时预览
 *  · 文字：版式 + 富文本（所见即所得）
 *  · 标注：色调 + 标题 + 富文本，编辑区直接按标注卡样式呈现
 * ------------------------------------------------------------------ */
window.TextEditor = (function () {
  const E = U.esc;
  const TYPE = { heading: '标题', text: '文字', note: '标注' };
  const TONES = [['idea', '紫 · 观点'], ['risk', '橙 · 风险'], ['todo', '粉 · 待办'], ['data', '青 · 数据']];
  const VARIANTS = [['body', '正文'], ['quote', '引言 / 结论']];

  let ov = null;
  let cur = null;      // 元素 id
  let draft = null;    // 编辑中的副本
  let docEl = null;    // 富文本编辑区
  let titleEl = null;  // 标注标题的实时节点

  function open(id) {
    const e = Store.el(id);
    if (!e || !TYPE[e.type]) return;
    close();
    cur = id;
    draft = JSON.parse(JSON.stringify(e));
    build(e);
  }

  function close() {
    if (!ov) return;
    window.removeEventListener('keydown', onWinKey, true);
    ov.remove();
    ov = null;
    docEl = null;
    titleEl = null;
    cur = null;
    draft = null;
    document.body.classList.remove('ed-open');
  }

  /* ---------------- 结构 ---------------- */
  function build(e) {
    ov = document.createElement('div');
    ov.className = 'ed';
    ov.innerHTML = shell(e);
    document.body.appendChild(ov);
    document.body.classList.add('ed-open');

    docEl = ov.querySelector('.ed-doc');
    if (docEl) {
      docEl.innerHTML = draft.html || '<p></p>';
      docEl.addEventListener('input', () => {
        draft.html = docEl.innerHTML;
        countChars();
      });
    }
    titleEl = ov.querySelector('.note-title');

    bind();
    countChars();
    const first = ov.querySelector('.ed-side input, .ed-side select');
    if (first && e.type !== 'heading') first.focus();
    else if (docEl) docEl.focus();
    else ov.querySelector('.ed-panel').focus();
    window.addEventListener('keydown', onWinKey, true);
  }

  function shell(e) {
    const type = e.type;
    return (
      `<div class="ed-panel${type === 'heading' ? ' compact' : ''}" role="dialog" tabindex="-1" aria-label="${TYPE[type]}编辑">` +
      `<div class="ed-head">` +
      `<span class="ed-chip">${TYPE[type]}</span>` +
      `<div class="ed-headtxt"><b>${TYPE[type]}编辑</b><span>${tipOf(type)}</span></div>` +
      `<button class="ed-x" data-act="close" title="关闭（Esc）">` +
      `<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` +
      `</button>` +
      `</div>` +
      `<div class="ed-body ${docEl === null && type === 'heading' ? 'ed-body-preview' : ''}">` +
      side(type) +
      main(type) +
      `</div>` +
      `<div class="ed-foot">` +
      `<span class="ed-meta" id="ed-meta"></span>` +
      `<span class="ed-tiphint">完成后写回画布</span>` +
      `<button class="ed-btn ghost" data-act="close">取消</button>` +
      `<button class="ed-btn primary" data-act="save">完成</button>` +
      `</div>` +
      `</div>`
    );
  }

  function tipOf(t) {
    if (t === 'heading') return '改完标题，画布上的排版会自动跟着变';
    if (t === 'note') return '标注卡里的正文支持加粗、列表、引用';
    return '正文支持加粗、列表、引用等格式';
  }

  function side(t) {
    if (t === 'heading') {
      return (
        `<div class="ed-side">` +
        `<div class="ed-sec">内容</div>` +
        fld('眉标（小节编号）', `<input class="ed-ipt" id="ed-kicker" value="${E(draft.kicker || '')}" placeholder="01 / 循环层">`) +
        fld('标题', `<input class="ed-ipt" id="ed-text" value="${E(draft.text || '')}" placeholder="这一节的标题">`) +
        fld('层级', `<select class="ed-ipt" id="ed-level">${[[1, '一级标题'], [2, '二级标题']]
          .map((o) => `<option value="${o[0]}" ${(draft.level || 2) === o[0] ? 'selected' : ''}>${o[1]}</option>`)
          .join('')}</select>`) +
        `<p class="ed-note">一级用于封面 / 大章节，二级用于小节。</p>` +
        `</div>`
      );
    }
    if (t === 'note') {
      return (
        `<div class="ed-side">` +
        `<div class="ed-sec">卡片</div>` +
        fld('色调', `<select class="ed-ipt" id="ed-tone">${TONES.map(
          (o) => `<option value="${o[0]}" ${(draft.tone || 'idea') === o[0] ? 'selected' : ''}>${o[1]}</option>`
        ).join('')}</select>`) +
        fld('标题', `<input class="ed-ipt" id="ed-title" value="${E(draft.title || '')}" placeholder="标注标题">`) +
        `<p class="ed-note">色调用来表达这条信息的性质：观点 / 风险 / 待办 / 数据。</p>` +
        `</div>`
      );
    }
    return (
      `<div class="ed-side">` +
      `<div class="ed-sec">版式</div>` +
      fld('段落类型', `<select class="ed-ipt" id="ed-variant">${VARIANTS.map(
        (o) => `<option value="${o[0]}" ${(draft.variant || 'body') === o[0] ? 'selected' : ''}>${o[1]}</option>`
      ).join('')}</select>`) +
      `<p class="ed-note">「引言 / 结论」会把整段放进带底色的引用框里。</p>` +
      `<div class="ed-sec">快捷</div>` +
      `<div class="ed-keys">` +
      `<div><kbd>回车</kbd> 新段落</div>` +
      `<div><kbd>Shift</kbd>+<kbd>回车</kbd> 段内换行</div>` +
      `<div><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 完成</div>` +
      `<div><kbd>Esc</kbd> 取消</div>` +
      `</div>` +
      `</div>`
    );
  }

  function main(t) {
    if (t === 'heading') {
      return (
        `<div class="ed-main ed-preview">` +
        `<div class="ed-sec">预览</div>` +
        `<div class="ed-canvas" id="ed-preview"></div>` +
        `<p class="ed-note">标题在画布上不带底色，靠眉标 + 细线建立层级。</p>` +
        `</div>`
      );
    }
    const toolbar =
      `<div class="ed-tool" id="ed-tool">` +
      tb('bold', 'B', '加粗', 'b') +
      tb('italic', 'I', '斜体', 'i') +
      tb('underline', 'U', '下划线', 'u') +
      tb('strikeThrough', 'S', '删除线', 's') +
      `<i class="ed-sep"></i>` +
      tb('insertUnorderedList', '•', '无序列表') +
      tb('insertOrderedList', '1.', '有序列表') +
      tb('formatBlock', 'H', '小标题', null, 'h4') +
      tb('formatBlock', '❝', '引用', null, 'blockquote') +
      tb('formatBlock', '¶', '正文段落', null, 'p') +
      `<i class="ed-sep"></i>` +
      tb('removeFormat', '⌫', '清除格式') +
      `</div>`;

    if (t === 'note') {
      return (
        `<div class="ed-main">` +
        toolbar +
        `<div class="ed-stage"><div class="ed-board"><div class="ed-note-wrap note note-${draft.tone || 'idea'}" id="ed-note-wrap">` +
        `<div class="note-head"><span class="note-dot"></span><span class="note-title">${E(draft.title || '标注')}</span></div>` +
        `<div class="rich ed-doc" contenteditable="true" spellcheck="false"></div>` +
        `</div></div></div>` +
        `</div>`
      );
    }
    return (
      `<div class="ed-main">` +
      toolbar +
      `<div class="ed-stage"><div class="ed-text-wrap tx tx-${draft.variant || 'body'}">` +
      `<div class="rich ed-doc" contenteditable="true" spellcheck="false"></div>` +
      `</div></div>` +
      `</div>`
    );
  }

  function tb(cmd, label, title, tag, val) {
    return `<button class="ed-tb" type="button" data-cmd="${cmd}" data-val="${val || ''}" title="${title}">${label}</button>`;
  }

  function fld(label, inner) {
    return `<label class="ed-f"><span>${label}</span>${inner}</label>`;
  }

  // 焦点可能落在窗口外（例如从右侧面板点开），用捕获阶段兜住键盘
  function onWinKey(ev) {
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

  /* ---------------- 交互 ---------------- */
  function bind() {
    ov.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.ed-tb')) ev.preventDefault(); // 保住选区
    });

    ov.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'close') close();
        else if (a === 'save') save();
        return;
      }
      const t = ev.target.closest('.ed-tb');
      if (t) {
        exec(t.dataset.cmd, t.dataset.val);
        return;
      }
      if (ev.target === ov) close();
    });

    ov.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'ed-title' && titleEl) titleEl.textContent = t.value || '标注';
      if (t.id === 'ed-tone') {
        const wrap = ov.querySelector('#ed-note-wrap');
        if (wrap) wrap.className = 'ed-note-wrap note note-' + t.value;
      }
      if (t.id === 'ed-variant') {
        const wrap = ov.querySelector('.ed-text-wrap');
        if (wrap) wrap.className = 'ed-text-wrap tx tx-' + t.value;
      }
      if (t.id === 'ed-kicker' || t.id === 'ed-text' || t.id === 'ed-level') paintPreview();
    });
    ov.addEventListener('change', (ev) => {
      if (ev.target.id === 'ed-tone' || ev.target.id === 'ed-variant') ev.target.dispatchEvent(new Event('input', { bubbles: true }));
    });

    ov.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); save(); return; }
      if (ev.key === 'Tab' && docEl && ev.target === docEl) return; // 允许在正文里退格
      ev.stopPropagation();
    });

    paintPreview();
  }

  function exec(cmd, val) {
    if (!docEl) return;
    docEl.focus();
    try {
      document.execCommand(cmd, false, val || null);
    } catch (e) {}
    if (cmd === 'formatBlock' && val === 'blockquote') {
      // 引用块内部再嵌一层 p 会显得空旷，压平一层
      U.$$('blockquote p', docEl).forEach((p) => {
        while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
        p.remove();
      });
    }
    draft.html = docEl.innerHTML;
    countChars();
  }

  function paintPreview() {
    const box = ov && ov.querySelector('#ed-preview');
    if (!box) return;
    const kicker = (ov.querySelector('#ed-kicker') || {}).value || '';
    const text = (ov.querySelector('#ed-text') || {}).value || '未命名章节';
    const lvl = (ov.querySelector('#ed-level') || {}).value || 2;
    box.innerHTML =
      `<div class="hd hd-${lvl}">` +
      (kicker ? `<div class="hd-kicker">${E(kicker)}</div>` : '') +
      `<div class="hd-title">${E(text)}</div>` +
      `<div class="hd-rule"></div>` +
      `</div>`;
  }

  function countChars() {
    const meta = ov && ov.querySelector('#ed-meta');
    if (!meta) return;
    const t = docEl ? U.plainText(docEl.innerHTML) : '';
    meta.textContent = docEl ? t.length + ' 字' : '';
  }

  /* ---------------- 保存 ---------------- */
  function collect() {
    if (!ov) return;
    const g = (id) => ov.querySelector('#' + id);
    if (draft.type === 'heading') {
      draft.kicker = g('ed-kicker').value.trim();
      draft.text = g('ed-text').value.trim() || '未命名章节';
      draft.level = Number(g('ed-level').value) || 2;
    } else if (draft.type === 'note') {
      draft.tone = g('ed-tone').value;
      draft.title = g('ed-title').value.trim() || '标注';
      draft.html = sanitize(docEl.innerHTML);
    } else {
      draft.variant = g('ed-variant').value;
      draft.html = sanitize(docEl.innerHTML);
    }
  }

  function save() {
    if (!ov) return;
    collect();
    const id = cur;
    const d = draft;
    const e = Store.el(id);
    close();
    if (!e || !d) return;
    Store.begin();
    Object.keys(d).forEach((k) => {
      if (k === 'id' || k === 'type') return;
      e[k] = d[k];
    });
    Store.end('edit');
    Canvas.rebuild(id);
    Canvas.select(id);
    if (window.Panels) {
      Panels.refreshOutline();
      Panels.refreshInspector(true);
    }
    U.toast('已更新' + TYPE[e.type]);
  }

  function sanitize(html) {
    const t = document.createElement('div');
    t.innerHTML = html || '';
    t.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    U.$$('*', t).forEach((n) => {
      [...n.attributes].forEach((a) => {
        if (/^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value))) n.removeAttribute(a.name);
        if (a.name === 'style' && /position|z-index/i.test(a.value)) n.removeAttribute('style');
      });
    });
    // 浏览器在 contenteditable 里常用 div 分行，统一成 p，保持文档排版一致
    U.$$('div', t).forEach((d) => {
      const p = document.createElement('p');
      while (d.firstChild) p.appendChild(d.firstChild);
      d.parentNode.replaceChild(p, d);
    });
    if (!t.querySelector('p,ul,ol,blockquote,h4')) {
      const p = document.createElement('p');
      p.innerHTML = t.innerHTML;
      t.innerHTML = '';
      t.appendChild(p);
    }
    return t.innerHTML;
  }

  return { open, close, isOpen: () => !!ov };
})();
