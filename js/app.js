/* ------------------------------------------------------------------
 *  app.js — 启动、保存体系、工具栏、导入导出、演示模式
 * ------------------------------------------------------------------ */
(function () {
  function $(s) { return document.querySelector(s); }

  let pendingSave = false;
  let lastSnapAt = 0;

  function boot() {
    Store.init();
    Canvas.init();
    Panels.init();
    if (window.Boards) Boards.init();
    Canvas.bindKeys();

    Store.on('change', (reason, payload) => {
      if (typeof reason === 'string' && reason.indexOf('board') === 0) {
        Canvas.select(null);
        Canvas.renderAll();
        Panels.refreshOutline();
        Panels.refreshInspector(true);
        if (window.Boards) Boards.refresh();
        return;
      }
      if (reason === 'saved') { pendingSave = false; setSaveState('saved', payload); renderSnaps(); scheduleFileWrite(); return; }
      if (reason === 'save-error') { pendingSave = true; setSaveState('error', payload); return; }
      if (reason === 'dirty') { pendingSave = true; setSaveState('saving'); return; }
      if (reason === 'snaps') { renderSnaps(); return; }
      if (reason === 'restore') { afterRestore(); return; }
      Canvas.renderAll();
      Panels.refreshOutline();
      if (reason !== 'prop') Panels.refreshInspector();
      if (window.Boards && /^(new|import|undo|redo|reset|restore)$/.test(String(reason))) Boards.refresh();
    });
    Canvas.on('select', () => Panels.refreshInspector());
    Canvas.on('view', (v) => {
      const l = $('#zoom-label');
      if (l) l.textContent = Math.round(v.z * 100) + '%';
    });

    bindToolbar();
    if (window.ComponentLibrary) ComponentLibrary.init();
    bindSaveSystem();
    bindGlobal();
    refreshSaveUI();
    initFileLink();

    setTimeout(() => { Canvas.home(); }, 80);
    document.body.classList.add('ready');
    startAutoSnapshot();
  }

  /* ================= 保存体系 ================= */
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (t) => {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  function setSaveState(kind, payload) {
    const el = $('#save-state');
    if (!el) return;
    el.dataset.state = kind;
    const txt = el.querySelector('span');
    if (kind === 'saved') {
      txt.textContent = '已保存 ' + hhmm((payload && payload.at) || Date.now());
      el.title = '已保存到本地浏览器 · 点击立即保存（Ctrl+S）';
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 650);
    } else if (kind === 'saving') {
      txt.textContent = '保存中…';
      el.title = '正在写入本地存储';
    } else if (kind === 'file') {
      txt.textContent = '已写入 ' + hhmm(Date.now());
      el.title = '已写入设备文件' + (payload && payload.name ? '：' + payload.name : '');
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 650);
    } else if (kind === 'error') {
      txt.textContent = '保存失败，请导出';
      el.title = '本地存储空间不足，建议「导出」为 JSON 文件备份';
      U.toast('本地存储空间不足，请导出 JSON 备份');
    } else {
      txt.textContent = '未保存';
    }
  }

  function refreshSaveUI() {
    const info = Store.storageInfo();
    if (info.error) setSaveState('error', info);
    else if (info.savedAt) setSaveState('saved', { at: info.savedAt });
    else setSaveState('idle');
    renderSnaps();
  }

  function bindSaveSystem() {
    $('#save-state').addEventListener('click', () => manualSave());

    // 关掉页面前落盘
    window.addEventListener('beforeunload', (ev) => {
      Store.flush();
      if (pendingSave) {
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      }
    });

    // 切走标签页时补一次
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') Store.flush();
    });
  }

  function manualSave() {
    const ok = Store.saveNow(true);
    if (ok) {
      U.toast('已保存到本地浏览器');
      setSaveState('saved', { at: Date.now() });
    }
    return ok;
  }

  function snapshot(manual) {
    const r = Store.pushSnapshot(manual ? 'manual' : 'auto');
    lastSnapAt = Date.now();
    renderSnaps();
    if (!manual) return r;
    if (r.ok) U.toast('已存为快照 · 可在「更多 → 历史快照」恢复');
    else if (r.reason === 'too-big') U.toast('内容过大（含大图），已跳过快照；请用「导出」备份');
    else U.toast('快照保存失败：本地空间不足');
    return r;
  }

  function renderSnaps() {
    const box = $('#menu-snaps');
    if (!box) return;
    const list = Store.snapshots();
    box.innerHTML = list.length
      ? list
          .map(
            (s) => `<div class="snap-row">
              <div class="snap-main" data-sid="${s.id}" role="button" title="点击恢复该快照">
                <b>${hhmm(s.at)}</b><span>${s.note === 'auto' ? '自动' : '手动'} · ${s.count} 组件</span>
              </div>
              <button class="snap-del" data-del="${s.id}" title="删除该快照">×</button>
            </div>`
          )
          .join('')
      : '<div class="menu-empty">暂无快照</div>';
  }

  function afterRestore() {
    $('#doc-title').value = Store.get().title || '';
    Canvas.renderAll();
    Canvas.select(null);
    Panels.refreshOutline();
    Panels.refreshInspector(true);
    refreshSaveUI();
    U.toast('已恢复到该快照（可 Ctrl+Z 撤销）');
  }

  function startAutoSnapshot() {
    // 每分钟检查：有未保存改动且距上次快照 5 分钟以上，自动留档
    setInterval(() => {
      if (!pendingSave) return;
      if (Date.now() - lastSnapAt < 4.5 * 60 * 1000) return;
      snapshot(false);
    }, 60 * 1000);
    lastSnapAt = Date.now();
  }

  /* ================= 工具栏 ================= */
  function bindToolbar() {
    $('#zoom-in').addEventListener('click', () => Canvas.zoomBy(1.15));
    $('#zoom-out').addEventListener('click', () => Canvas.zoomBy(1 / 1.15));
    $('#zoom-label').addEventListener('click', () => Canvas.zoomBy(1 / Canvas.view.z));
    $('#btn-fit').addEventListener('click', () => Canvas.fit());
    $('#btn-present').addEventListener('click', () => togglePresent());
    $('#btn-undo').addEventListener('click', () => Store.undo());
    $('#btn-redo').addEventListener('click', () => Store.redo());

    $('#btn-save').addEventListener('click', () => saveToFile());
    $('#file-chip').addEventListener('click', () => saveToFile());

    $('#btn-new').addEventListener('click', () => { if (window.NewDoc) NewDoc.open(); });

    $('#btn-load').addEventListener('click', () => openFromDevice());
    $('#file-json').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      openFileObject(f);
    });

    const btnPrint = $('#btn-print');
    if (btnPrint) btnPrint.addEventListener('click', doPrint);
    $('#menu-print').addEventListener('click', () => { doPrint(); closeMenu(); });

    $('#btn-more').addEventListener('click', (ev) => {
      ev.stopPropagation();
      renderSnaps();
      const unlink = $('#menu-unlink');
      if (unlink) unlink.style.display = Files.handle ? '' : 'none';
      $('#menu-more').classList.toggle('on');
    });
    document.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('#menu-more')) return;
      $('#menu-more').classList.remove('on');
    });
    $('#menu-more').addEventListener('click', (ev) => ev.stopPropagation());

    const closeMenu = () => $('#menu-more').classList.remove('on');

    $('#menu-theme').addEventListener('click', () => { closeMenu(); if (window.Theme) Theme.open(); });
    $('#menu-new').addEventListener('click', () => { closeMenu(); if (window.NewDoc) NewDoc.open(); });
    $('#menu-save').addEventListener('click', () => { manualSave(); closeMenu(); });
    $('#menu-save-as').addEventListener('click', () => { saveToFile(true); closeMenu(); });
    $('#menu-open-file').addEventListener('click', () => { openFromDevice(); closeMenu(); });
    $('#menu-export-nk').addEventListener('click', () => { exportPacked(); closeMenu(); });
    $('#menu-export').addEventListener('click', () => { exportJson(); closeMenu(); });
    $('#menu-export-md').addEventListener('click', () => { exportMarkdown(); closeMenu(); });
    $('#menu-unlink').addEventListener('click', () => {
      Files.forget();
      updateFileChip(null);
      closeMenu();
      U.toast('已取消与本地文件的关联（浏览器本地存档仍在）');
    });
    $('#menu-snap').addEventListener('click', () => { snapshot(true); closeMenu(); });

    $('#menu-snaps').addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (del) {
        Store.deleteSnapshot(del.dataset.del);
        renderSnaps();
        return;
      }
      const row = ev.target.closest('[data-sid]');
      if (!row) return;
      const s = Store.snapshots().find((x) => x.id === row.dataset.sid);
      if (!s) return;
      if (!confirm('恢复到 ' + hhmm(s.at) + ' 的快照？当前内容会被替换（可用 Ctrl+Z 撤销）。')) return;
      Store.restoreSnapshot(row.dataset.sid);
      $('#menu-more').classList.remove('on');
    });

    $('#menu-clear').addEventListener('click', () => {
      closeMenu();
      if (!confirm('清除浏览器里的本地存档与快照？将回到示例内容，此操作不可撤销。建议先「导出」备份。')) return;
      Store.clearLocal();
      location.reload();
    });

    $('#menu-reset').addEventListener('click', () => {
      closeMenu();
      if (!confirm('重置为示例拆解书？当前修改会丢失（建议先导出 JSON 备份）。')) return;
      snapshot(false);
      Store.reset();
      Canvas.renderAll();
      Canvas.select(null);
      Canvas.fit();
      $('#doc-title').value = Store.get().title;
      U.toast('已重置为示例内容');
    });

    $('#menu-shortcuts').addEventListener('click', () => {
      closeMenu();
      U.toast('Ctrl+S 保存 · Ctrl+E 导出 ' + NK.EXT + ' · 空格拖动 · Ctrl+滚轮缩放 · F 适应 · P 演示 · T 换主题');
    });

    const title = $('#doc-title');
    title.value = Store.get().title || '';
    title.addEventListener('input', () => Store.commit(() => (Store.get().title = title.value), 'title'));
    title.addEventListener('change', () => Store.flush());

    $('#minimap-canvas').addEventListener('pointerdown', (ev) => {
      Canvas.miniJump(ev);
      const move = (e) => Canvas.miniJump(e);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function slug(doc) {
    return String((doc && doc.title) || '拆解书').replace(/[\\/:*?"<>|]+/g, '').trim() || '拆解书';
  }

  // 导出原生格式（ZIP 容器，图片以真实文件存放）
  async function exportPacked() {
    const doc = Store.get();
    try {
      const bytes = await NK.pack(doc);
      U.downloadBlob(NK.fileName(doc), new Blob([bytes], { type: NK.MIME }));
      Store.flush();
      U.toast('已导出 ' + NK.fileName(doc) + '（' + fmtSize(bytes.length) + '）');
    } catch (e) {
      U.toast('导出失败：' + e.message);
    }
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // 旧版 JSON（纯文本，便于 diff / 手动改）
  function exportJson() {
    const doc = Store.get();
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = slug(doc) + '-' + stamp + '.json';
    U.download(name, JSON.stringify(doc, null, 2));
    Store.flush();
    U.toast('已导出 JSON（旧格式，可再次导入继续编辑）');
  }

  // 面向 AI 阅读 / 学习的 Markdown：按页与阅读顺序重排，去掉画布坐标
  function exportMarkdown() {
    const doc = Store.get();
    if (!window.MDExport || typeof MDExport.build !== 'function') {
      U.toast('Markdown 导出模块未加载，请刷新页面后重试');
      return;
    }
    try {
      const stats = MDExport.stats(doc);
      const d = new Date();
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      const text = MDExport.build(doc);
      const name = slug(doc) + '-' + stamp + '.md';
      U.download(name, text, 'text/markdown;charset=utf-8');
      Store.flush();
      U.toast('已导出 Markdown 学习资料（' + stats.boards + ' 页 / ' + stats.components + ' 个组件）');
    } catch (e) {
      U.toast('导出 Markdown 失败：' + e.message);
    }
  }

  /* ================= 设备文件（自选目录） ================= */
  let fileWriteTimer = null;

  function updateFileChip(info) {
    const chip = $('#file-chip');
    if (!chip) return;
    const name = info && info.name ? info.name : '';
    if (name) {
      chip.hidden = false;
      chip.textContent = Files.fileLabel();
      chip.title = '已关联设备文件：' + name + '（点击立即写入）';
    } else {
      chip.hidden = true;
      chip.textContent = '';
    }
  }

  async function initFileLink() {
    Files.onChange = (info) => updateFileChip(info);
    if (!Files.supported) return;
    const r = await Files.restore();
    if (r && r.handle) {
      updateFileChip({ name: r.name });
      if (r.permission === 'granted') U.toast('已关联上次的文件：' + r.name + '（Ctrl+S 直接写回）');
      else U.toast('上次的文件：' + r.name + '，点击「保存文件」继续写入');
    }
  }

  let writing = false;
  function scheduleFileWrite() {
    if (!Files.handle) return;
    clearTimeout(fileWriteTimer);
    fileWriteTimer = setTimeout(async () => {
      if (writing) return;
      writing = true;
      try { await Files.autoSave(await NK.pack(Store.get())); } catch (e) { /* 静默 */ }
      writing = false;
    }, 900);
  }

  async function saveToFile(forceAs) {
    const doc = Store.get();
    if (!Files.supported) {
      manualSave();
      exportPacked();
      U.toast('此浏览器不支持直接写文件，已下载 ' + NK.EXT);
      return;
    }
    // 关联的是旧版 .json：不覆盖它，另存为 .nkdraw
    const legacyLink = Files.handle && !/\.nkdraw$/i.test(Files.name || '');
    const useAs = forceAs || !Files.handle || legacyLink;
    if (legacyLink) U.toast('原文件是旧版 .json，已改为另存为 ' + NK.EXT);

    let size = 0;
    const produce = async () => {
      const bytes = await NK.pack(Store.get());
      size = bytes.length;
      return bytes;
    };

    let r;
    try {
      r = useAs
        ? await Files.saveAs(produce, NK.fileName(doc), NK.saveTypes)
        : await Files.save(await produce());
    } catch (e) {
      U.toast('保存失败：' + e.message);
      return;
    }
    if (r.ok) {
      setSaveState('file', { name: r.name });
      updateFileChip({ name: r.name });
      Store.flush();
      U.toast('已写入 ' + r.name + (size ? '（' + fmtSize(size) + '）' : ''));
      return;
    }
    if (r.reason === 'cancel') return;
    if (r.reason === 'denied') U.toast('没有写入权限，请用「保存」重新选择位置授权');
    else if (r.reason === 'unsupported') U.toast('此浏览器不支持选择目录');
    else U.toast('写入失败：' + ((r.error && r.error.message) || r.reason));
  }

  async function openFromDevice() {
    if (!Files.supported) { $('#file-json').click(); return; }
    const r = await Files.openFile(NK.openTypes);
    if (r.ok) {
      const ok = await applyImportedBytes(r.bytes, r.name);
      if (!ok) Files.forget(); // 解析失败就别把这个文件当成当前文件
      return;
    }
    if (r.reason === 'unsupported') $('#file-json').click();
    else if (r.reason !== 'cancel') U.toast('打开失败：' + ((r.error && r.error.message) || r.reason));
  }

  async function openFileObject(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await applyImportedBytes(bytes, file.name);
    } catch (e) {
      U.toast('打开失败：' + e.message);
    }
  }

  async function applyImportedBytes(bytes, name) {
    try {
      let doc;
      let legacy = true;
      if (NK.isPacked(bytes)) {
        const r = await NK.unpack(bytes);
        doc = r.doc;
        legacy = false;
      } else {
        const text = new TextDecoder().decode(bytes);
        doc = JSON.parse(text);
        if (!doc || !(Array.isArray(doc.boards) || Array.isArray(doc.elements))) throw new Error('不是画布文件');
      }
      loadDoc(doc, name, legacy);
      return true;
    } catch (e) {
      U.toast('打开失败：' + e.message);
      return false;
    }
  }

  function loadDoc(d, name, legacy) {
    snapshot(false); // 导入前留底
    const src = Store.normalize(d);
    Store.commit(() => {
      const doc = Store.get();
      doc.title = d.title || doc.title;
      doc.boards = src.boards;
      doc.activeId = src.activeId;
    }, 'import');
    if (window.Boards) Boards.refresh();
    // 导入后画布条重算视图
    setTimeout(() => { if (window.Boards) Boards.applyActiveView(); }, 0);
    const title = $('#doc-title');
    if (title) title.value = Store.get().title || '';
    Canvas.renderAll();
    Canvas.select(null);
    Canvas.fit();
    Panels.refreshOutline();
    Panels.refreshInspector(true);
    U.toast('已打开：' + (name || '画布文件') + (legacy ? ' · 旧版 JSON，建议另存为 ' + NK.EXT : ''));
  }

  function togglePresent() {
    const on = !document.body.classList.contains('present');
    document.body.classList.toggle('present', on);
    $('#btn-present').textContent = on ? '退出演示' : '演示';
    if (on) { Canvas.select(null); Canvas.fit(40); }
    else Canvas.fit();
  }

  // 打印 / 存为 PDF：按当前视图输出（先缩放到想展示的区域再打印）
  function doPrint() {
    document.body.classList.add('printing');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('printing'), 400);
    }, 120);
  }

  function bindGlobal() {
    // 把 .nkdraw / .json 拖进窗口就能打开
    window.addEventListener('dragover', (ev) => {
      if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) ev.preventDefault();
    });
    window.addEventListener('drop', (ev) => {
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!f) return;
      if (!/\.(nkdraw|json)$/i.test(f.name)) return;
      ev.preventDefault();
      openFileObject(f);
    });

    window.addEventListener('paste', (ev) => {
      const t = ev.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName))) return;
      const items = (ev.clipboardData && ev.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          const f = items[i].getAsFile();
          if (f) { ev.preventDefault(); Canvas.importImageFile(f); }
          return;
        }
      }
    });

    window.addEventListener('keydown', (ev) => {
      const t = ev.target;
      const typing = t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
      const meta = ev.ctrlKey || ev.metaKey;

      // 保存 / 导出：任何焦点下都生效
      if (meta && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveToFile(); return; }
      if (meta && ev.key.toLowerCase() === 'e' && !typing) { ev.preventDefault(); exportPacked(); return; }
      if (typing) return;
      if (meta || ev.altKey) return;

      const k = ev.key.toLowerCase();
      if (k === 'f') { ev.preventDefault(); Canvas.fit(); }
      if (k === '0') { ev.preventDefault(); Canvas.zoomBy(1 / Canvas.view.z); }
      if (k === '=' || k === '+') { ev.preventDefault(); Canvas.zoomBy(1.12); }
      if (k === '-') { ev.preventDefault(); Canvas.zoomBy(1 / 1.12); }
      if (k === 'p') togglePresent();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
