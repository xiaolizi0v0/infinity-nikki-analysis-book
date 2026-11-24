/* ------------------------------------------------------------------
 *  component-library.js — 分类组件库浮层
 *  顶栏只留一个入口，组件按用途分组；支持搜索、最近使用、收藏和拖拽落点。
 * ------------------------------------------------------------------ */
window.ComponentLibrary = (function () {
  const E = U.esc;
  const PREF_KEY = 'nk.componentPrefs.v1';
  const DEFAULT_RECENT = ['heading', 'text', 'note', 'image'];
  let btn = null, panel = null, searchEl = null, catsEl = null, bodyEl = null;
  let prefs = { recent: [], fav: [], cat: 'recent' };
  let open = false;
  let current = 'recent';
  let query = '';
  let dragType = '';

  const STAR = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.3l1.5 3.1 3.4.5-2.5 2.4.6 3.4L8 10.1l-3 1.6.6-3.4L3.1 5.9l3.4-.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const CLOCK = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.7" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.8v3.4l2.2 1.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  const SEARCH = '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.2" stroke="currentColor" stroke-width="1.4"/><path d="M10.2 10.2l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const glyph = (path) => '<svg viewBox="0 0 16 16" fill="none">' + (path || '') + '</svg>';

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
      const valid = (arr) => (Array.isArray(arr) ? arr.filter((t) => ComponentRegistry.has(t)) : []);
      return {
        recent: valid(p.recent).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6),
        fav: valid(p.fav).filter((t, i, a) => a.indexOf(t) === i),
        cat: typeof p.cat === 'string' ? p.cat : 'recent',
      };
    } catch (e) {
      return { recent: [], fav: [], cat: 'recent' };
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function remember(type) {
    prefs.recent = [type].concat(prefs.recent.filter((t) => t !== type)).slice(0, 6);
    savePrefs();
  }

  function recentTypes() {
    const out = prefs.recent.filter((t) => ComponentRegistry.has(t));
    DEFAULT_RECENT.forEach((t) => { if (out.indexOf(t) < 0) out.push(t); });
    return out.slice(0, 6);
  }

  function visibleCategories() {
    return ComponentRegistry.categories();
  }

  function categoryName(id) {
    const c = visibleCategories().find((x) => x.id === id);
    return c ? c.name : '';
  }

  function init() {
    btn = document.getElementById('btn-add-component');
    panel = document.getElementById('component-library');
    if (!btn || !panel || !window.ComponentRegistry) return;
    prefs = loadPrefs();
    current = prefs.cat && (prefs.cat === 'recent' || prefs.cat === 'fav' || visibleCategories().some((c) => c.id === prefs.cat))
      ? prefs.cat : 'recent';

    panel.innerHTML =
      '<div class="clib-head">' +
        '<div class="clib-title"><b>组件库</b><span>' + ComponentRegistry.all().length + ' 个组件</span></div>' +
        '<button class="clib-close" type="button" aria-label="关闭组件库" title="关闭（Esc）">' +
          '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="clib-searchwrap">' +
        '<span class="clib-search-ico">' + SEARCH + '</span>' +
        '<input id="clib-search" class="clib-search" type="search" autocomplete="off" placeholder="搜索组件、用途或同义词…">' +
        '<kbd>Ctrl K</kbd>' +
      '</div>' +
      '<div class="clib-main">' +
        '<nav class="clib-cats" id="clib-cats" aria-label="组件分类"></nav>' +
        '<div class="clib-body" id="clib-body"></div>' +
      '</div>' +
      '<div class="clib-foot"><span><kbd>点击</kbd> 插入画布中心 · <kbd>拖拽</kbd> 放到指定位置</span><span><kbd>Esc</kbd> 关闭</span></div>';

    searchEl = panel.querySelector('#clib-search');
    catsEl = panel.querySelector('#clib-cats');
    bodyEl = panel.querySelector('#clib-body');

    btn.addEventListener('click', () => (open ? close() : openPanel(true)));
    panel.addEventListener('click', onClick);
    panel.addEventListener('keydown', onKeyDown);
    panel.addEventListener('dragstart', onDragStart);
    panel.addEventListener('dragend', onDragEnd);
    searchEl.addEventListener('input', () => {
      query = searchEl.value;
      renderBody();
    });
    document.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('keydown', onWinKey, true);
  }

  function openPanel(focusSearch) {
    if (!panel) return;
    query = '';
    if (searchEl) searchEl.value = '';
    render();
    panel.hidden = false;
    open = true;
    btn.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    if (focusSearch) setTimeout(() => { try { searchEl.focus(); } catch (e) {} }, 0);
  }

  function close() {
    if (!panel || !open) return;
    open = false;
    panel.hidden = true;
    btn.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
  }

  function render() {
    renderCats();
    renderBody();
  }

  function renderCats() {
    const cats = visibleCategories();
    const totalRecent = recentTypes().length;
    const totalFav = prefs.fav.length;
    let html =
      '<button class="clib-cat ' + (current === 'recent' ? 'on' : '') + '" data-cat="recent" type="button">' +
        '<span class="clib-cat-ico">' + CLOCK + '</span><span class="clib-cat-name">常用</span><em>' + totalRecent + '</em>' +
      '</button>' +
      '<button class="clib-cat ' + (current === 'fav' ? 'on' : '') + '" data-cat="fav" type="button">' +
        '<span class="clib-cat-ico">' + STAR + '</span><span class="clib-cat-name">收藏</span><em>' + totalFav + '</em>' +
      '</button>';
    html += cats.map((c) =>
      '<button class="clib-cat cat-' + c.tone + ' ' + (current === c.id ? 'on' : '') + '" data-cat="' + c.id + '" type="button">' +
        '<span class="clib-cat-ico">' + glyph(c.icon) + '</span><span class="clib-cat-name">' + E(c.name) + '</span><em>' + c.types.length + '</em>' +
      '</button>'
    ).join('');
    catsEl.innerHTML = html;
  }

  function renderBody() {
    const q = query.trim().toLowerCase();
    let list = [];
    let title = '';
    let sub = '';

    if (q) {
      list = ComponentRegistry.all().filter((t) => {
        const cat = ComponentRegistry.categoryOf(t.type);
        const hay = [t.label, t.desc].concat(t.keywords || []).concat(cat ? [cat.name] : []).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      title = '搜索结果';
      sub = '“' + query.trim() + '”';
    } else if (current === 'recent') {
      list = recentTypes().map((t) => ComponentRegistry.get(t)).filter(Boolean);
      title = '常用';
      sub = '最近使用的组件，默认置顶';
    } else if (current === 'fav') {
      list = prefs.fav.map((t) => ComponentRegistry.get(t)).filter(Boolean);
      title = '收藏';
      sub = '星标组件会固定出现在这里';
    } else {
      const cat = visibleCategories().find((c) => c.id === current);
      list = cat ? cat.types : [];
      title = cat ? cat.name : '组件';
      sub = cat ? cat.desc : '';
    }

    const head = '<div class="clib-sec"><div><b>' + E(title) + '</b><em>' + E(sub) + '</em></div><span>' + list.length + ' 个</span></div>';
    if (!list.length) {
      bodyEl.innerHTML = head + '<div class="clib-empty">' + STAR + '<b>' + (current === 'fav' ? '还没有收藏组件' : '没有找到匹配组件') + '</b><span>' +
        (current === 'fav' ? '点组件卡片右上角的星标，把常用组件钉在这里。' : '换一个关键词，或从左侧分类里找。') + '</span></div>';
      return;
    }
    bodyEl.innerHTML = head + '<div class="clib-grid">' + list.map(card).join('') + '</div>';
  }

  function card(t) {
    const cat = ComponentRegistry.categoryOf(t.type);
    const fav = prefs.fav.indexOf(t.type) >= 0;
    return '<div class="clib-card cat-' + (cat ? cat.tone : 'violet') + '" data-type="' + t.type + '" draggable="true" role="button" tabindex="0" aria-label="添加' + E(t.label) + '">' +
      '<span class="clib-ico">' + glyph(t.icon) + '</span>' +
      '<span class="clib-txt"><b>' + E(t.label) + '</b><small>' + E(t.desc) + '</small></span>' +
      '<button class="clib-fav ' + (fav ? 'on' : '') + '" type="button" data-fav="' + t.type + '" title="' + (fav ? '取消收藏' : '收藏') + '" aria-label="' + (fav ? '取消收藏' : '收藏') + '">' + STAR + '</button>' +
    '</div>';
  }

  function onClick(ev) {
    const fav = ev.target.closest('.clib-fav');
    if (fav) {
      ev.preventDefault();
      ev.stopPropagation();
      const type = fav.dataset.fav;
      if (prefs.fav.indexOf(type) >= 0) prefs.fav = prefs.fav.filter((t) => t !== type);
      else prefs.fav.push(type);
      savePrefs();
      renderCats();
      renderBody();
      return;
    }
    const cat = ev.target.closest('.clib-cat');
    if (cat) {
      current = cat.dataset.cat;
      prefs.cat = current;
      savePrefs();
      renderCats();
      renderBody();
      return;
    }
    const c = ev.target.closest('.clib-card');
    if (c) insert(c.dataset.type);
    if (ev.target.closest('.clib-close')) close();
  }

  function onKeyDown(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    const c = ev.target.closest && ev.target.closest('.clib-card');
    if (c && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      insert(c.dataset.type);
    }
  }

  function onDragStart(ev) {
    const c = ev.target.closest && ev.target.closest('.clib-card');
    if (!c || !ev.dataTransfer) return;
    dragType = c.dataset.type;
    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData('application/x-nk-component', dragType);
    ev.dataTransfer.setData('text/plain', dragType);
    c.classList.add('dragging');
  }

  function onDragEnd(ev) {
    const c = ev.target.closest && ev.target.closest('.clib-card');
    if (c) c.classList.remove('dragging');
    dragType = '';
    setTimeout(close, 0);
  }

  function onDocDown(ev) {
    if (!open) return;
    if (panel.contains(ev.target) || btn.contains(ev.target)) return;
    close();
  }

  function onWinKey(ev) {
    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && ev.key.toLowerCase() === 'k') {
      const t = ev.target;
      const typing = t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
      if (typing && !open) return;
      ev.preventDefault();
      if (open) { searchEl.focus(); searchEl.select(); }
      else openPanel(true);
      return;
    }
    if (ev.key === 'Escape' && open) { ev.preventDefault(); close(); }
  }

  function insert(type) {
    if (!ComponentRegistry.has(type)) return;
    remember(type);
    if (type === 'image') {
      const inp = document.getElementById('file-image');
      if (inp) {
        inp.dataset.mode = 'new';
        inp.click();
      }
    } else {
      Canvas.addAtCenter(type);
    }
    close();
  }

  return { init, open: () => openPanel(true), close, isOpen: () => open };
})();
