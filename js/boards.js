/* ------------------------------------------------------------------
 *  boards.js — 多画布：底部画布条、新建 / 切换 / 重命名 / 复制 / 删除
 * ------------------------------------------------------------------ */
window.Boards = (function () {
  let bar, tabsBox, panel, menu, addBtn, allBtn;
  let menuFor = null;   // 当前操作菜单对应的画布 id
  let renaming = null;  // 正在重命名的画布 id

  const CARET = '<svg viewBox="0 0 20 20" fill="none"><path d="M6.4 8.2L10 11.8l3.6-3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON = {
    ren: '<svg viewBox="0 0 20 20" fill="none"><path d="M12.6 3.9l3.5 3.5-8 8H4.6v-3.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.3 5.2l3.5 3.5" stroke="currentColor" stroke-width="1.4"/></svg>',
    dup: '<svg viewBox="0 0 20 20" fill="none"><rect x="7" y="7" width="8.4" height="8.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M13 4.6H5.6a1.6 1.6 0 00-1.6 1.6V13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    del: '<svg viewBox="0 0 20 20" fill="none"><path d="M4.6 6.4h10.8M8 6.4V4.8h4v1.6M6 6.4l.7 8.6h6.6l.7-8.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => U.esc(String(s == null ? '' : s));

  function init() {
    bar = $('#boardbar');
    tabsBox = $('#bb-tabs');
    panel = $('#bb-panel');
    menu = $('#bb-menu');
    addBtn = $('#bb-add');
    allBtn = $('#bb-all');
    if (!bar || !tabsBox) return;

    addBtn.addEventListener('click', (ev) => { ev.stopPropagation(); newBoard(); });

    allBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeMenu();
      panel.classList.contains('on') ? closePanel() : openPanel();
    });

    tabsBox.addEventListener('click', (ev) => {
      const more = ev.target.closest('[data-more]');
      if (more) { ev.stopPropagation(); openMenu(more.dataset.more, more); return; }
      const tab = ev.target.closest('.bb-tab');
      if (!tab) return;
      closeMenu(); closePanel();
      if (tab.dataset.id === Store.get().activeId) return;
      switchTo(tab.dataset.id);
    });

    tabsBox.addEventListener('dblclick', (ev) => {
      const tab = ev.target.closest('.bb-tab');
      if (!tab) return;
      startRename(tab.dataset.id);
    });

    // 画布总览
    panel.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const act = ev.target.closest('[data-act]');
      const row = ev.target.closest('.bb-row');
      if (act && row) {
        const id = row.dataset.id;
        const a = act.dataset.act;
        if (a === 'ren') { closePanel(); startRename(id); }
        else if (a === 'dup') { dupBoard(id); }
        else if (a === 'del') { delBoard(id); }
        return;
      }
      if (row) { closePanel(); switchTo(row.dataset.id); }
    });

    // 单个画布菜单
    menu.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest('[data-mact]');
      if (!b || !menuFor) return;
      const id = menuFor;
      const a = b.dataset.mact;
      closeMenu();
      if (a === 'ren') startRename(id);
      else if (a === 'dup') dupBoard(id);
      else if (a === 'left') { if (!Store.moveBoard(id, -1)) U.toast('已经在最左边'); refresh(); }
      else if (a === 'right') { if (!Store.moveBoard(id, 1)) U.toast('已经在最右边'); refresh(); }
      else if (a === 'del') delBoard(id);
    });

    document.addEventListener('click', () => { closeMenu(); closePanel(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { closeMenu(); closePanel(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.altKey && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        newBoard();
      }
    });

    refresh();
  }

  /* ---------------- 视图 ---------------- */
  function saveView() {
    const b = Store.board();
    if (!b) return;
    const v = Canvas.view;
    b.view = { x: v.x, y: v.y, z: v.z };
  }

  function applyActiveView() {
    const b = Store.board();
    if (!b) return;
    const v = Canvas.view;
    if (b.view && isFinite(b.view.x) && isFinite(b.view.z)) {
      v.x = b.view.x; v.y = b.view.y; v.z = b.view.z;
      Canvas.applyView();
    } else {
      Canvas.fit(70);
    }
  }

  function switchTo(id) {
    if (!id || id === Store.get().activeId) return;
    saveView();
    Store.setActive(id);       // 同步触发重绘（app.js 的 board 事件）
    applyActiveView();
  }

  /* ---------------- 增删改 ---------------- */
  function newBoard() {
    closeMenu(); closePanel();
    saveView();
    const b = Store.addBoard();  // 默认名字：第 N 页
    applyActiveView();
    refresh();
    // 新建后直接进入改名状态，省一次点击
    setTimeout(() => startRename(b.id), 30);
    U.toast('已新建画布「' + b.name + '」');
  }

  function dupBoard(id) {
    closeMenu(); closePanel();
    saveView();
    const b = Store.duplicateBoard(id);
    if (!b) return;
    applyActiveView();
    refresh();
    U.toast('已复制为「' + b.name + '」');
  }

  function delBoard(id) {
    closeMenu(); closePanel();
    const list = Store.boards();
    if (list.length <= 1) { U.toast('至少要保留一个画布'); return; }
    const b = list.find((x) => x.id === id);
    if (!b) return;
    const n = (b.elements || []).length;
    if (!confirm('删除画布「' + b.name + '」？' + (n ? '其中 ' + n + ' 个组件会一起删除，' : '') + '可用 Ctrl+Z 撤销。')) return;
    Store.removeBoard(id);
    if (Store.board()) applyActiveView();
    refresh();
    U.toast('已删除画布「' + b.name + '」');
  }

  /* ---------------- 重命名（原地输入） ---------------- */
  function startRename(id) {
    closeMenu(); closePanel();
    const tab = tabsBox.querySelector('.bb-tab[data-id="' + id + '"]');
    if (!tab) {
      // 当前不在可视区（总览里点重命名）→ 先切过去
      switchTo(id);
      return startRename(id);
    }
    const nameEl = tab.querySelector('.bb-name');
    if (!nameEl || renaming) return;
    const old = nameEl.textContent;
    renaming = id;
    tab.classList.add('renaming');
    const ipt = document.createElement('input');
    ipt.className = 'bb-ipt';
    ipt.value = old;
    ipt.spellcheck = false;
    ipt.maxLength = 40;
    nameEl.replaceWith(ipt);
    ipt.focus();
    ipt.select();

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      renaming = null;
      const val = ipt.value;
      ipt.replaceWith(Object.assign(document.createElement('span'), { className: 'bb-name', textContent: old }));
      tab.classList.remove('renaming');
      if (ok && Store.renameBoard(id, val)) {
        // renameBoard 已广播，refresh 由 app.js 触发
        U.toast('已重命名为「' + String(val).trim() + '」');
      }
      refresh();
    };
    ipt.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    ipt.addEventListener('blur', () => finish(true));
    ipt.addEventListener('click', (ev) => ev.stopPropagation());
    ipt.addEventListener('dblclick', (ev) => ev.stopPropagation());
  }

  /* ---------------- 面板 ---------------- */
  function openPanel() {
    panel.innerHTML =
      '<div class="bb-p-head"><b>全部画布</b><span>' + Store.boards().length + '</span></div>' +
      '<div class="bb-p-list">' +
      Store.boards()
        .map((b) => {
          const on = b.id === Store.get().activeId;
          return '<div class="bb-row' + (on ? ' on' : '') + '" data-id="' + b.id + '">' +
            '<span class="bb-row-name">' + esc(b.name) + '</span>' +
            '<span class="bb-row-ct">' + (b.elements || []).length + '</span>' +
            '<span class="bb-row-act">' +
              '<button data-act="ren" title="重命名">' + ICON.ren + '</button>' +
              '<button data-act="dup" title="复制画布">' + ICON.dup + '</button>' +
              '<button data-act="del" title="删除画布">' + ICON.del + '</button>' +
            '</span>' +
          '</div>';
        })
        .join('') +
      '</div>' +
      '<button class="bb-p-new" id="bb-p-new">＋ 新建画布</button>';
    panel.classList.add('on');
    const nb = $('#bb-p-new');
    if (nb) nb.addEventListener('click', (ev) => { ev.stopPropagation(); newBoard(); });
  }

  function closePanel() { if (panel) panel.classList.remove('on'); }

  function openMenu(id, anchor) {
    menuFor = id;
    const b = Store.boards().find((x) => x.id === id);
    if (!b) return;
    const i = Store.boardIndex(id);
    const last = Store.boards().length - 1;
    menu.innerHTML =
      '<div class="bb-menu-cap">' + esc(b.name) + '</div>' +
      '<button data-mact="ren">重命名</button>' +
      '<button data-mact="dup">复制画布</button>' +
      '<div class="bb-menu-sep"></div>' +
      '<button data-mact="left"' + (i <= 0 ? ' disabled' : '') + '>左移</button>' +
      '<button data-mact="right"' + (i >= last ? ' disabled' : '') + '>右移</button>' +
      '<div class="bb-menu-sep"></div>' +
      '<button data-mact="del" class="bb-menu-del"' + (Store.boards().length <= 1 ? ' disabled' : '') + '>删除画布</button>';
    panel.classList.remove('on');
    menu.classList.add('on');
  }

  function closeMenu() { if (menu) menu.classList.remove('on'); menuFor = null; }

  /* ---------------- 刷新 ---------------- */
  function refresh() {
    if (!tabsBox) return;
    const list = Store.boards();
    const activeId = Store.get().activeId;
    tabsBox.innerHTML = list
      .map((b) => {
        const on = b.id === activeId;
        return '<div class="bb-tab' + (on ? ' on' : '') + '" data-id="' + b.id + '" title="' + esc(b.name) + '（双击改名）">' +
          '<span class="bb-name">' + esc(b.name) + '</span>' +
          (on ? '<button class="bb-more" data-more="' + b.id + '" title="画布操作">' + CARET + '</button>' : '') +
        '</div>';
      })
      .join('');
    bar.classList.toggle('single', list.length <= 1);
    const ob = document.getElementById('outline-board');
    if (ob) {
      const cur0 = list.find((x) => x.id === activeId);
      ob.hidden = list.length <= 1;
      ob.textContent = cur0 ? cur0.name : '';
      ob.title = cur0 ? '当前画布：' + cur0.name : '';
    }
    // 让当前画布标签可见
    const cur = tabsBox.querySelector('.bb-tab.on');
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    }
    if (panel && panel.classList.contains('on')) openPanel();
  }

  return {
    init, refresh, applyActiveView, saveView,
    new: newBoard, rename: startRename,
    switchTo, openPanel, closePanel, openMenu, closeMenu,
  };
})();
