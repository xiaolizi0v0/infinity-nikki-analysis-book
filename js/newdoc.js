/* ------------------------------------------------------------------
 *  newdoc.js — 新建拆解书对话框
 *  · 三种起点：空白画布 / 章节骨架 / 示例拆解书
 *  · 新建前自动留一份快照，并断开与原文件的关联（避免误写旧文件）
 * ------------------------------------------------------------------ */
window.NewDoc = (function () {
  const E = U.esc;
  let ov = null;
  let sel = 'skeleton';

  const TPLS = [
    {
      id: 'blank',
      name: '空白画布',
      desc: '只有一个封面标题，从零开始',
      svg: '<rect x="3.2" y="3.2" width="13.6" height="13.6" rx="3" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 2.6" fill="none"/><path d="M8 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    },
    {
      id: 'skeleton',
      name: '章节骨架',
      desc: '封面 + 循环 / 界面 / 判断三段',
      svg: '<rect x="3" y="3" width="14" height="3.4" rx="1.4" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M3 9.6h8M3 12.6h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="3" y="15.2" width="10" height="1.6" rx="0.8" fill="currentColor" opacity=".5"/>',
    },
    {
      id: 'demo',
      name: '示例拆解书',
      desc: '完整的无限暖暖拆解样本',
      svg: '<path d="M6.4 6.6c-2 0-3.6 1.5-3.6 3.4s1.6 3.4 3.6 3.4c2.6 0 4.6-6.8 7.2-6.8 2 0 3.6 1.5 3.6 3.4s-1.6 3.4-3.6 3.4c-2.6 0-4.6-6.8-7.2-6.8z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
    },
  ];

  function open() {
    if (ov) return;
    const doc = Store.get();
    const count = (doc.elements || []).length;

    ov = document.createElement('div');
    ov.className = 'ndlg';
    ov.innerHTML = `
      <div class="ndlg-card" role="dialog" aria-label="新建拆解书">
        <header class="ndlg-head">
          <span class="ndlg-chip">新建</span>
          <div class="ndlg-ht">
            <h3>新建拆解书</h3>
            <p>选一个起点，之后画布上的一切都可以改</p>
          </div>
          <button class="ndlg-x" data-act="cancel" title="取消（Esc）">
            <svg viewBox="0 0 16 16" fill="none"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </header>

        <div class="ndlg-body">
          <label class="ndlg-f">
            <span>文档标题</span>
            <input class="ndlg-ipt" id="ndlg-title" value="未命名拆解书" spellcheck="false" placeholder="例如：无限暖暖 · 精灵系统拆解">
          </label>

          <div class="ndlg-sec">选择起点</div>
          <div class="ndlg-tpls">
            ${TPLS.map(
              (t) => `<button class="ndlg-tpl ${t.id === sel ? 'on' : ''}" data-tpl="${t.id}" type="button">
                <span class="ndlg-ic"><svg viewBox="0 0 20 20" fill="none">${t.svg}</svg></span>
                <b>${t.name}</b>
                <em>${t.desc}</em>
              </button>`
            ).join('')}
          </div>

          <p class="ndlg-tip">
            当前内容（<b>${E(doc.title || '未命名')}</b> · ${count} 个组件）会先自动存一份快照，
            之后可在「更多 → 历史快照」找回${Files.handle ? '；同时会解除与原文件的关联，下次保存重新选位置' : ''}。
          </p>
        </div>

        <footer class="ndlg-foot">
          <span class="ndlg-hint"><kbd>Enter</kbd> 创建 · <kbd>Esc</kbd> 取消</span>
          <button class="ndlg-btn ghost" data-act="cancel">取消</button>
          <button class="ndlg-btn primary" data-act="create">创建并打开</button>
        </footer>
      </div>`;

    document.body.appendChild(ov);
    document.body.classList.add('ndlg-open');

    const input = ov.querySelector('#ndlg-title');
    setTimeout(() => { input.focus(); input.select(); }, 30);

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); create(); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    });

    ov.addEventListener('click', (ev) => {
      const tpl = ev.target.closest('[data-tpl]');
      if (tpl) {
        sel = tpl.dataset.tpl;
        ov.querySelectorAll('.ndlg-tpl').forEach((b) => b.classList.toggle('on', b === tpl));
        // 标题还停留在默认值时，跟着模板换一个合适的名字
        const cur = input.value.trim();
        if (!cur || cur === '未命名拆解书' || cur === '无限暖暖 · 系统拆解书') {
          input.value = sel === 'demo' ? '无限暖暖 · 系统拆解书' : '未命名拆解书';
          input.select();
        } else {
          input.focus();
        }
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (!act) { if (ev.target === ov) close(); return; }
      if (act.dataset.act === 'cancel') close();
      if (act.dataset.act === 'create') create();
    });

    ov.addEventListener('dblclick', (ev) => {
      const tpl = ev.target.closest('[data-tpl]');
      if (tpl) create();
    });

    window.addEventListener('keydown', onKey, true);
  }

  function onKey(ev) {
    if (!ov) return;
    if (ev.target && ev.target.id === 'ndlg-title') return; // 输入框自己处理
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Enter') { ev.stopPropagation(); create(); }
    ev.stopPropagation();
  }

  function close() {
    if (!ov) return;
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
    ov = null;
    document.body.classList.remove('ndlg-open');
  }

  function create() {
    const input = ov && ov.querySelector('#ndlg-title');
    const title = (input && input.value || '').trim() || '未命名拆解书';
    const tpl = sel;

    close();
    // 1) 先给旧内容留底（最多 6 条，可在历史快照里恢复）
    Store.pushSnapshot('auto');
    // 2) 建新文档（清空撤销栈、立即落盘、触发一次全量重绘）
    const doc = Store.newDoc({ title, template: tpl });
    // 3) 断开与原文件的关联，避免 Ctrl+S 把新文档写进上一个文件
    if (Files.handle) Files.forget();
    // 4) 视图与面板归位
    const titleEl = document.getElementById('doc-title');
    if (titleEl) titleEl.value = doc.title || '';
    Canvas.select(null);
    Panels.refreshOutline();
    Panels.refreshInspector(true);
    setTimeout(() => Canvas.home(), 30);
    U.toast(tpl === 'demo' ? '已新建：示例拆解书' : '已新建：' + doc.title);
  }

  return { open, close };
})();
