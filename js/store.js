/* ------------------------------------------------------------------
 *  store.js — 文档数据模型 / 撤销栈 / 本地持久化 / 示例内容
 * ------------------------------------------------------------------ */
window.Store = (function () {
  const KEY = 'nikki-teardown-doc-v7';
  const SNAP_KEY = 'nikki-teardown-snaps-v7';
  let doc = null;
  let undoStack = [];
  let redoStack = [];
  let txn = null;
  let subs = [];
  let saveTimer = null;
  let lastSavedAt = 0;
  let lastError = null;
  let rev = 0;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- 多画布（boards） ----------
   * doc.boards = [{ id, name, elements, view?, cover? }]
   * doc.activeId 指向当前画布；doc.elements 是「当前画布元素」的只读视图（不可枚举，
   * 不会写进存档），这样老代码里所有 doc.elements 的读写都不用改。
   */
  function activeBoard() {
    if (!doc || !Array.isArray(doc.boards) || !doc.boards.length) return null;
    return doc.boards.find((b) => b.id === doc.activeId) || doc.boards[0];
  }

  function defElements(d) {
    Object.defineProperty(d, 'elements', {
      get: function () {
        const b = (this.boards || []).find((x) => x.id === this.activeId) || (this.boards || [])[0];
        return b ? b.elements : [];
      },
      set: function (v) { // 兼容旧代码 doc.elements = [...]：写回当前画布
        const b = (this.boards || []).find((x) => x.id === this.activeId) || (this.boards || [])[0];
        if (b) b.elements = Array.isArray(v) ? v : [];
      },
      enumerable: false,
      configurable: true,
    });
    return d;
  }

  function normalize(d) {
    if (!d || typeof d !== 'object') d = buildDemo();
    let boards = Array.isArray(d.boards) ? d.boards.filter((b) => b && typeof b === 'object') : null;
    if (!boards || !boards.length) {
      boards = [{
        id: U.uid('bd'),
        name: d.boardName || '第 1 页',
        elements: Array.isArray(d.elements) ? d.elements : [],
        cover: d.cover || null,
      }];
    }
    const seen = {};
    boards.forEach((b, i) => {
      if (!b.id || seen[b.id]) b.id = U.uid('bd');
      seen[b.id] = 1;
      if (!b.name || !String(b.name).trim()) b.name = '第 ' + (i + 1) + ' 页';
      if (!Array.isArray(b.elements)) b.elements = [];
    });
    delete d.elements; // 旧字段（可能来自 JSON.parse）先挪进 boards
    d.boards = boards;
    if (!d.activeId || !boards.some((b) => b.id === d.activeId)) d.activeId = boards[0].id;
    return defElements(d);
  }

  function defaultBoardName() {
    let n = (doc.boards || []).length + 1;
    const used = {};
    (doc.boards || []).forEach((b) => { used[b.name] = 1; });
    while (used['第 ' + n + ' 页']) n++;
    return '第 ' + n + ' 页';
  }

  function boards() { return (doc && doc.boards) || []; }
  function board() { return activeBoard(); }

  function setActive(id) {
    if (!doc || !id || id === doc.activeId) return false;
    if (!doc.boards.some((b) => b.id === id)) return false;
    begin();
    doc.activeId = id;
    end('board-switch');
    return true;
  }

  function addBoard(name, afterId) {
    begin();
    const id = U.uid('bd');
    const b = { id: id, name: (name || '').trim() || defaultBoardName(), elements: [] };
    const at = afterId ? doc.boards.findIndex((x) => x.id === afterId) : -1;
    if (at >= 0) doc.boards.splice(at + 1, 0, b);
    else doc.boards.push(b);
    doc.activeId = id;
    end('board-add');
    return b;
  }

  function renameBoard(id, name) {
    const b = doc.boards.find((x) => x.id === id);
    if (!b) return false;
    const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!n || n === b.name) return false;
    begin();
    b.name = n;
    end('board-rename');
    return true;
  }

  function removeBoard(id) {
    if (!doc || doc.boards.length <= 1) return false;
    const i = doc.boards.findIndex((b) => b.id === id);
    if (i < 0) return false;
    begin();
    doc.boards.splice(i, 1);
    if (doc.activeId === id) doc.activeId = doc.boards[Math.max(0, i - 1)].id;
    end('board-remove');
    return true;
  }

  function duplicateBoard(id) {
    const src = doc.boards.find((b) => b.id === id);
    if (!src) return null;
    begin();
    const copy = clone({ name: src.name, elements: src.elements || [], view: src.view || null, cover: null });
    const b = {
      id: U.uid('bd'),
      name: copy.name + ' 副本',
      elements: (copy.elements || []).map((e) => reid(clone(e))),
      view: copy.view ? { x: copy.view.x, y: copy.view.y, z: copy.view.z } : null,
    };
    b.cover = b.elements.length ? b.elements[0].id : null;
    const at = doc.boards.findIndex((x) => x.id === id);
    doc.boards.splice(at + 1, 0, b);
    doc.activeId = b.id;
    end('board-duplicate');
    return b;
  }

  // 复制画布时给元素（以及流程图节点、标注）换新 id，避免跨画布重复
  function reid(e) {
    e.id = U.uid(e.type || 'el');
    if (e.type === 'flowchart' && Array.isArray(e.nodes)) {
      const map = {};
      e.nodes.forEach((n) => { map[n.id] = U.uid('n'); });
      e.nodes.forEach((n) => {
        n.id = map[n.id];
        if (n.parentId) n.parentId = map[n.parentId] || null;
      });
    }
    if (Array.isArray(e.annotations)) {
      e.annotations = e.annotations.map((a) => ({ ...a, id: U.uid('an') }));
    }
    return e;
  }

  function moveBoard(id, dir) {
    const i = doc.boards.findIndex((b) => b.id === id);
    const j = i + (dir > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= doc.boards.length) return false;
    begin();
    const b = doc.boards.splice(i, 1)[0];
    doc.boards.splice(j, 0, b);
    end('board-move');
    return true;
  }

  function boardIndex(id) { return doc.boards.findIndex((b) => b.id === id); }

  function emit(reason, payload) {
    subs.forEach((fn) => {
      if (typeof fn === 'function') fn(reason || 'change', payload);
    });
  }
  function on(evt, fn) { subs.push(typeof evt === 'function' ? evt : fn); }

  /* ---------- 事务 / 撤销 ---------- */
  function begin() {
    if (txn == null) txn = JSON.stringify(doc);
  }
  function end(reason) {
    if (txn == null) return;
    let changed = true;
    try {
      changed = JSON.stringify(JSON.parse(txn)) !== JSON.stringify(doc);
      if (changed) {
        undoStack.push(txn);
        if (undoStack.length > 60) undoStack.shift();
        redoStack.length = 0;
        markDirty();
      }
    } catch (e) { changed = true; }
    txn = null;
    // 空事务（例如只是点选了一下组件）不广播，避免整块画布重绘、
    // 也避免双击时节点被替换掉导致第二次点击打空
    if (changed) emit(reason || 'commit');
  }
  function commit(fn, reason) { begin(); fn(); end(reason); }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(JSON.stringify(doc));
    doc = normalize(JSON.parse(undoStack.pop()));
    markDirty(); emit('undo');
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(JSON.stringify(doc));
    doc = normalize(JSON.parse(redoStack.pop()));
    markDirty(); emit('redo');
    return true;
  }

  /* ---------- 持久化 ---------- */
  // 变更后 500ms 落盘（同一批编辑只写一次），并对外广播保存状态
  function markDirty() {
    rev++;
    emit('dirty', { rev: rev });
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(false), 500);
  }

  function saveNow(manual) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const payload = JSON.stringify(doc);
    try {
      localStorage.setItem(KEY, payload);
      lastSavedAt = Date.now();
      lastError = null;
      emit('saved', { at: lastSavedAt, manual: !!manual, bytes: payload.length });
      return true;
    } catch (e) {
      lastError = e && e.name === 'QuotaExceededError' ? 'quota' : 'unknown';
      emit('save-error', { reason: lastError, error: e });
      return false;
    }
  }

  function flush() {
    if (saveTimer) saveNow(false);
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && (Array.isArray(d.boards) || Array.isArray(d.elements)) ? d : null;
    } catch (e) { return null; }
  }

  function reset() {
    begin();
    doc = normalize(buildDemo());
    undoStack.length = 0; redoStack.length = 0;
    end('reset');
    saveNow(false);
  }

  /* ---------- 快照（历史版本） ---------- */
  function snapshots() {
    try {
      const list = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeSnaps(list) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  // note: 'auto' | 'manual'
  function pushSnapshot(note) {
    const payload = JSON.stringify(doc);
    if (payload.length > 900000) return { ok: false, reason: 'too-big' };
    const list = snapshots();
    list.unshift({
      id: 's' + Date.now().toString(36),
      at: Date.now(),
      note: note || 'manual',
      title: doc.title || '未命名',
      count: (doc.boards || []).reduce((n, b) => n + (b.elements || []).length, 0),
      bytes: payload.length,
      doc: JSON.parse(payload),
    });
    while (list.length > 6) list.pop();
    if (!writeSnaps(list)) return { ok: false, reason: 'quota' };
    return { ok: true, list: list };
  }

  function restoreSnapshot(id) {
    const s = snapshots().find((x) => x.id === id);
    if (!s || !s.doc) return false;
    begin();
    doc = normalize(clone(s.doc));
    undoStack.push(txn); // 快照恢复也可撤销
    txn = null;
    saveNow(false);
    emit('restore');
    return true;
  }

  function deleteSnapshot(id) {
    const list = snapshots().filter((x) => x.id !== id);
    writeSnaps(list);
    emit('snaps');
    return list;
  }

  /* ---------- 存储信息 ---------- */
  function storageInfo() {
    let bytes = 0;
    try {
      bytes = ((localStorage.getItem(KEY) || '').length + (localStorage.getItem(SNAP_KEY) || '').length) * 2;
    } catch (e) {}
    return {
      bytes: bytes,
      savedAt: lastSavedAt,
      error: lastError,
      snaps: snapshots().length,
    };
  }

  function clearLocal() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SNAP_KEY);
    } catch (e) {}
  }

  /* ---------- 元素操作 ---------- */
  function get() { return doc; }
  function el(id) { return (doc.elements || []).find((e) => e.id === id) || null; }
  function add(e, opts) {
    begin();
    e.z = e.z || nextZ();
    doc.elements.push(e);
    end((opts && opts.reason) || 'add');
    return e;
  }
  function remove(id) {
    begin();
    const arr = doc.elements;
    const i = arr.findIndex((e) => e.id === id);
    if (i >= 0) arr.splice(i, 1);
    end('remove');
  }
  function update(id, patch, silent) {
    const e = el(id);
    if (!e) return null;
    if (!silent) begin();
    Object.assign(e, patch);
    if (!silent) end('update');
    else markDirty();
    return e;
  }
  function nextZ() {
    return (doc.elements || []).reduce((m, e) => Math.max(m, e.z || 0), 0) + 1;
  }
  function front(id) {
    const e = el(id); if (!e) return;
    begin(); e.z = nextZ(); end('z');
  }
  function back(id) {
    const e = el(id); if (!e) return;
    const min = (doc.elements || []).reduce((m, x) => Math.min(m, x.z || 0), 0);
    begin(); e.z = min - 1; end('z');
  }
  function duplicate(id) {
    const e = el(id); if (!e) return null;
    begin();
    const c = clone(e);
    c.id = U.uid(e.type);
    c.x = (e.x || 0) + 28;
    c.y = (e.y || 0) + 28;
    if (c.type === 'flowchart' && c.nodes) {
      const map = {};
      c.nodes.forEach((n) => { map[n.id] = U.uid('n'); });
      c.nodes.forEach((n) => {
        n.id = map[n.id];
        if (n.parentId) n.parentId = map[n.parentId] || null;
      });
    }
    if (c.type === 'image' && c.annotations) c.annotations = c.annotations.map((a) => ({ ...a, id: U.uid('an') }));
    c.z = nextZ();
    doc.elements.push(c);
    end('duplicate');
    return c;
  }
  function bbox() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    (doc.elements || []).forEach((e) => {
      // 文本类高度由 DOM 决定，这里用记录值兜底
      x1 = Math.min(x1, e.x); y1 = Math.min(y1, e.y);
      x2 = Math.max(x2, e.x + (e.w || 400));
      y2 = Math.max(y2, e.y + (e.h || 200));
    });
    if (!isFinite(x1)) return { x: 0, y: 0, w: 1200, h: 800 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /* ================= 示例内容 ================= */
  function estH(html, w) {
    const t = U.plainText(html);
    const cpl = Math.max(10, Math.floor((w - 54) / 15.2));
    const paras = (html.match(/<p|<li|<h4|<blockquote/g) || []).length || 1;
    const lines = Math.ceil(t.length / cpl);
    return Math.round((lines * 27 + paras * 12 + 56) * 1.08);
  }

  /* ================= 新建：空白 / 章节骨架 ================= */
  function buildBlank(title) {
    const t = (title || '未命名拆解书').trim() || '未命名拆解书';
    const els = [];
    els.push({
      id: U.uid('hd'), type: 'heading', x: 0, y: 40, w: 800, level: 1, z: 1,
      kicker: 'SYSTEM TEARDOWN · ' + new Date().getFullYear(),
      text: t,
    });
    return { version: 2, title: t, boardName: '第 1 页', elements: els, cover: els[0].id };
  }

  function buildSkeleton(title) {
    const t = (title || '未命名拆解书').trim() || '未命名拆解书';
    const els = [];
    const add = (e) => { e.z = els.length + 1; els.push(e); return e; };
    let y = 40;

    const cover = add({
      id: U.uid('hd'), type: 'heading', x: 0, y, w: 800, level: 1,
      kicker: 'SYSTEM TEARDOWN · ' + new Date().getFullYear(),
      text: t,
    });
    y += 118;

    add({
      id: U.uid('tx'), type: 'text', x: 0, y, w: 680, variant: 'body',
      html: '<p>一句话说清这份拆解要回答的问题：<b>这个系统在解决什么、靠什么留住玩家、哪一步最值得学或最该改</b>。</p>',
    });
    y += 128;

    const secs = [
      ['01 / 循环层', '核心循环',
        '<p>玩家在这套系统里重复做什么？每次循环的产出是什么，产出又如何推进下一次循环？</p>' +
        '<p>把「进入 → 操作 → 反馈 → 奖励 → 回到起点」写成一条线，再标出卡点。</p>'],
      ['02 / 界面层', '界面与信息结构',
        '<p>这一屏分成几块？每块承担哪一类判断（我在哪 / 我能做什么 / 我现在怎么样）。</p>' +
        '<p>把截图拖进画布，用「编辑」标出关键区域与状态差异。</p>'],
      ['03 / 判断', '观察与可改进点',
        '<p>做得好的地方三条，可以更好的地方三条；每条都尽量落到具体的界面元素或数值上。</p>'],
    ];

    secs.forEach(([kicker, name, html]) => {
      add({ id: U.uid('hd'), type: 'heading', x: 0, y, w: 800, level: 2, kicker, text: name });
      y += 98;
      const th = Math.round(estH(html, 680) * 0.68);
      add({ id: U.uid('tx'), type: 'text', x: 0, y, w: 680, variant: 'body', html, h: th });
      y += th + 62;
    });

    return { version: 2, title: t, boardName: '第 1 页', elements: els, cover: cover.id };
  }

  // 新建一份文档：清空历史、立即落盘、广播 new
  function newDoc(opt) {
    opt = opt || {};
    const tpl = opt.template || 'skeleton';
    doc = normalize(tpl === 'demo' ? buildDemo() : tpl === 'skeleton' ? buildSkeleton(opt.title) : buildBlank(opt.title));
    if (opt.title && opt.title.trim()) doc.title = opt.title.trim();
    undoStack.length = 0;
    redoStack.length = 0;
    txn = null;
    saveNow(false);
    emit('new', { template: tpl });
    return doc;
  }

  function buildDemo() {
    const els = [];
    const add = (e) => { e.z = els.length + 1; els.push(e); return e; };
    const AX = 0, AW = 760;
    const BX = 880, BW = 600;
    let yA = 40, yB = 40;

    /* ---------- 封面 ---------- */
    const cover = add({
      id: U.uid('hd'), type: 'heading', x: AX, y: 40, w: 800, level: 1,
      kicker: 'SYSTEM TEARDOWN · 2026 / 面试作品',
      text: '无限暖暖 系统拆解书',
    });
    yA = 40 + 104;

    const leadH = estH(
      '<p class="lead">拆的不是画面，是「玩家为什么愿意再来一次」。</p>' +
      '<p>拆解对象：叠纸游戏《无限暖暖》（Infinity Nikki）——开放世界换装冒险。拆解范围：核心循环、界面引导、能力与关卡的耦合关系。</p>' +
      '<p>这份拆解书不复述玩法，只回答三个问题：<strong>循环靠什么转起来</strong>、<strong>界面如何降低理解成本</strong>、<strong>系统之间如何互相喂养</strong>。</p>',
      AW);
    add({
      id: U.uid('tx'), type: 'text', x: AX, y: yA, w: AW, h: leadH, variant: 'body',
      html:
        '<p class="lead">拆的不是画面，是「玩家为什么愿意再来一次」。</p>' +
        '<p>拆解对象：叠纸游戏《无限暖暖》（Infinity Nikki）——开放世界换装冒险。拆解范围：核心循环、界面引导、能力与关卡的耦合关系。</p>' +
        '<p>这份拆解书不复述玩法，只回答三个问题：<strong>循环靠什么转起来</strong>、<strong>界面如何降低理解成本</strong>、<strong>系统之间如何互相喂养</strong>。</p>',
    });
    yA += leadH + 24;

    add({
      id: U.uid('nt'), type: 'note', x: BX, y: 40, w: BW, h: 300, tone: 'idea',
      title: '五层拆解框架',
      html:
        '<p><b>体验层</b>｜玩家实际感受到的节奏与情绪</p>' +
        '<p><b>循环层</b>｜驱动玩家持续游玩的动机回路</p>' +
        '<p><b>系统层</b>｜规则、资源、成长之间的关系</p>' +
        '<p><b>界面层</b>｜信息如何被呈现、如何被引导</p>' +
        '<p><b>数值层</b>｜产出、消耗、概率与时间成本</p>' +
        '<p class="dim">本册重点：循环层 + 界面层</p>',
    });

    add({
      id: U.uid('nt'), type: 'note', x: BX, y: 380, w: BW, h: 190, tone: 'todo',
      title: '这是无限画布 · 先看这里',
      html:
        '<p>拖动空白处平移，滚轮平移 / <b>Ctrl + 滚轮</b> 缩放，<b>双击</b>任何文字即可直接改。</p>' +
        '<p>左侧大纲可跳转，右侧面板改样式；拖入图片文件可直接插入截图。</p>',
    });
    yB = 600;

    /* ---------- 01 循环层 ---------- */
    yA += 40;
    add({
      id: U.uid('hd'), type: 'heading', x: AX, y: yA, w: 760, level: 2,
      kicker: '01 / 循环层', text: '核心循环：能力即钥匙',
    });
    yA += 96;

    const flowA = {
      title: '核心玩法循环 · 探索 → 换装 → 解锁',
      nodes: [
        { id: 'a0', parentId: null, kind: 'start', text: '进入开放世界' },
        { id: 'a1', parentId: 'a0', kind: 'process', text: '探索场景 / 触发兴趣点' },
        { id: 'a2', parentId: 'a1', kind: 'decision', text: '当前障碍需要特定服装能力？' },
        { id: 'a3', parentId: 'a2', kind: 'process', text: '切换对应奇迹套装', label: '是' },
        { id: 'a4', parentId: 'a3', kind: 'process', text: '解谜 · 净化 · 收集' },
        { id: 'a5', parentId: 'a4', kind: 'process', text: '获得材料 / 图纸 / 灵感' },
        { id: 'a6', parentId: 'a5', kind: 'decision', text: '是否解锁新区域？' },
        { id: 'a7', parentId: 'a6', kind: 'end', text: '进入新区域，能力扩展', label: '是' },
        { id: 'a8', parentId: 'a6', kind: 'end', text: '转向目标收集（套装 / 拍照）', label: '否' },
        { id: 'a9', parentId: 'a2', kind: 'process', text: '直接采集 · 交互', label: '否' },
        { id: 'a10', parentId: 'a9', kind: 'process', text: '素材入库' },
        { id: 'a11', parentId: 'a10', kind: 'end', text: '继续探索' },
      ],
    };
    const fA = FC.measureFlow(flowA);
    add({
      id: U.uid('fc'), type: 'flowchart', x: AX, y: yA, w: Math.max(AW, fA.w + 40),
      title: flowA.title, nodes: flowA.nodes,
    });
    const fAh = fA.h + 86;

    const textAH = estH(
      '<h4>一句话结构</h4><p>大世界抛出「看得见但过不去」的障碍，服装能力是唯一的钥匙，而收集与制作是把钥匙变多的过程。</p>' +
      '<h4>三层动机叠加</h4><ul><li><b>即时</b>：解谜成功、跳跃落地的操作反馈</li><li><b>中期</b>：套装收集与外观表达（换装本身就是奖励）</li><li><b>长期</b>：区域解锁与图鉴完成度</li></ul>',
      BW);
    add({
      id: U.uid('tx'), type: 'text', x: BX, y: yB, w: BW, h: textAH, variant: 'body',
      html:
        '<h4>一句话结构</h4><p>大世界抛出「看得见但过不去」的障碍，服装能力是唯一的钥匙，而收集与制作是把钥匙变多的过程。</p>' +
        '<h4>三层动机叠加</h4><ul><li><b>即时</b>：解谜成功、跳跃落地的操作反馈</li><li><b>中期</b>：套装收集与外观表达（换装本身就是奖励）</li><li><b>长期</b>：区域解锁与图鉴完成度</li></ul>',
    });

    const textAH2 = estH(
      '<h4>设计取舍</h4><p>把「能力」做成服装，等价于把成长包装成审美消费：玩家为了一件好看的衣服去开图，而不是为了数值去开图。</p>' +
      '<p>代价是能力切换必须<b>在图内即时完成</b>——一旦需要回主城换装，循环的节奏就会断。</p>',
      BW);
    add({
      id: U.uid('tx'), type: 'text', x: BX, y: yB + textAH + 26, w: BW, h: textAH2, variant: 'body',
      html:
        '<h4>设计取舍</h4><p>把「能力」做成服装，等价于把成长包装成审美消费：玩家为了一件好看的衣服去开图，而不是为了数值去开图。</p>' +
        '<p>代价是能力切换必须<b>在图内即时完成</b>——一旦需要回主城换装，循环的节奏就会断。</p>',
    });
    const noteAH = 200;
    add({
      id: U.uid('nt'), type: 'note', x: BX, y: yB + textAH + textAH2 + 52, w: BW, h: noteAH, tone: 'risk',
      title: '可质疑之处',
      html: '<p>能力与外观强绑定后，玩家可能为「好看」而非「好用」选装，解谜体验会过度依赖界面提示强度。</p>',
    });
    yB = yB + textAH + textAH2 + noteAH + 80;
    yA += fAh + 24;

    /* ---------- 02 界面层 ---------- */
    yA += 30;
    add({
      id: U.uid('hd'), type: 'heading', x: AX, y: yA, w: 760, level: 2,
      kicker: '02 / 界面层', text: '界面拆解：玩家放置精灵界面',
    });
    yA += 96;

    const flowB = {
      title: '精灵界面 · 交互路径与状态分支',
      nodes: [
        { id: 'b0', parentId: null, kind: 'start', text: '进入精灵页面' },
        { id: 'b1', parentId: 'b0', kind: 'process', text: '点击左下角「精灵」入口' },
        { id: 'b2', parentId: 'b1', kind: 'process', text: '进入功能界面：左侧 3 个驯化槽位' },
        { id: 'b3', parentId: 'b2', kind: 'decision', text: '该槽位是否已有精灵？' },
        { id: 'b4', parentId: 'b3', kind: 'process', text: '槽内展示图标 · 名称 · 驯化进度', label: '是' },
        { id: 'b5', parentId: 'b4', kind: 'decision', text: '是否持有驯化材料？' },
        { id: 'b6', parentId: 'b5', kind: 'process', text: '放置道具，激活驯化列表', label: '是' },
        { id: 'b7', parentId: 'b6', kind: 'end', text: '选中精灵：顶部进度条 + 白色高亮框' },
        { id: 'b8', parentId: 'b5', kind: 'process', text: '引导前往获取「精灵铃铛」', label: '否' },
        { id: 'b9', parentId: 'b3', kind: 'process', text: '中部显示空态：「暂无放置精灵」', label: '否' },
        { id: 'b10', parentId: 'b9', kind: 'process', text: '引导玩家进行放置操作' },
        { id: 'b11', parentId: 'b10', kind: 'end', text: '完成放置，回到槽位判断' },
      ],
    };
    const fB = FC.measureFlow(flowB);
    add({
      id: U.uid('fc'), type: 'flowchart', x: AX, y: yA, w: Math.max(860, fB.w + 40),
      title: flowB.title, nodes: flowB.nodes,
    });
    const fBh = fB.h + 86;

    const imgY = yB;
    add({
      id: U.uid('im'), type: 'image', x: BX, y: imgY, w: 700, h: 448,
      src: 'assets/ref-jingling.jpg', fit: 'contain', zoom: 1, ox: 0, oy: 0, radius: 14,
      title: '自制示意图 · 精灵（伙伴）界面',
      caption: '为图片标注功能制作的示意图。可在属性面板替换为自己的截图。',
      annotations: [
        { id: 'an1', text: '左侧三槽位 = 可操作对象', ax: 17, ay: 42, lx: 26, ly: 93 },
        { id: 'an2', text: '中部空态：把引导放在视线中心', ax: 63, ay: 60, lx: 68, ly: 93 },
      ],
    });

    const textBH = estH(
      '<h4>三段式分区</h4><p>左侧承载「可操作对象」（三个驯化槽位），中部承载「当前对象的详情与操作」，周边承载「消耗材料槽位」。</p>' +
      '<h4>三种槽位状态</h4><ul><li><b>空槽</b>：中部给出「暂无放置精灵」空态文案</li><li><b>有精灵 · 未选中</b>：只给图标、名称、驯化进度等判断信息</li><li><b>有精灵 · 已选中</b>：中部切 3D 模型 + 基础信息，顶部出现进度条与高亮框</li></ul>',
      700);
    add({
      id: U.uid('tx'), type: 'text', x: BX, y: imgY + 448 + 30, w: 700, h: textBH, variant: 'body',
      html:
        '<h4>三段式分区</h4><p>左侧承载「可操作对象」（三个驯化槽位），中部承载「当前对象的详情与操作」，周边承载「消耗材料槽位」。</p>' +
        '<h4>三种槽位状态</h4><ul><li><b>空槽</b>：中部给出「暂无放置精灵」空态文案</li><li><b>有精灵 · 未选中</b>：只给图标、名称、驯化进度等判断信息</li><li><b>有精灵 · 已选中</b>：中部切 3D 模型 + 基础信息，顶部出现进度条与高亮框</li></ul>',
    });

    const textBH2 = estH(
      '<h4>值得学的两点</h4><p><b>空态即引导</b>：空槽不是「没有内容」，而是「下一步该做什么」，把系统入口与教学合并，省掉一次独立新手引导。</p>' +
      '<p><b>状态用位置与颜色同时表达</b>：选中态同时改了高亮框、模型区、顶部进度条，玩家在任一处都能确认自己在操作谁。</p>',
      700);
    add({
      id: U.uid('tx'), type: 'text', x: BX, y: imgY + 448 + 30 + textBH + 24, w: 700, h: textBH2, variant: 'body',
      html:
        '<h4>值得学的两点</h4><p><b>空态即引导</b>：空槽不是「没有内容」，而是「下一步该做什么」，把系统入口与教学合并，省掉一次独立新手引导。</p>' +
        '<p><b>状态用位置与颜色同时表达</b>：选中态同时改了高亮框、模型区、顶部进度条，玩家在任一处都能确认自己在操作谁。</p>',
    });

    yB = imgY + 448 + 30 + textBH + textBH2 + 60;
    yA += fBh + 24;

    /* ---------- 03 观察 ---------- */
    const y3 = Math.max(yA, yB) + 60;
    add({
      id: U.uid('hd'), type: 'heading', x: AX, y: y3, w: 760, level: 2,
      kicker: '03 / 判断', text: '观察与可改进点',
    });

    const noteY = y3 + 100;
    const NW = 470, NGAP = 30;
    add({
      id: U.uid('nt'), type: 'note', x: AX, y: noteY, w: NW, h: 230, tone: 'idea',
      title: '值得复用的模式',
      html: '<p>「空槽位 + 中心空态文案」的组合，本质是把系统入口和教学合并成同一块界面，减少一次打断式的引导。</p>',
    });
    add({
      id: U.uid('nt'), type: 'note', x: AX + NW + NGAP, y: noteY, w: NW, h: 230, tone: 'risk',
      title: '信息密度风险',
      html: '<p>材料槽位与精灵槽位同屏出现时，两个层级的「槽」容易混淆。可用容器分组或轻微降饱和来区分层级。</p>',
    });
    add({
      id: U.uid('nt'), type: 'note', x: AX + (NW + NGAP) * 2, y: noteY, w: NW, h: 230, tone: 'todo',
      title: '待实机验证',
      html: '<p>材料不足时的引导是否直达获取入口？驯化失败的反馈是否解释了原因？—— 截到图后回填此处。</p>',
    });

    /* ---------- 03.5 对照表 ---------- */
    const tblY = noteY + 230 + 36;
    add({
      id: U.uid('tb'), type: 'table', x: AX, y: tblY, w: 1000, z: 3,
      title: '三层动机对照',
      caption: '把「为什么继续玩」拆成三个时间尺度，各层用不同的设计手段承接。',
      header: true, zebra: true, density: 'normal', align: 'left', firstCol: true,
      widths: [1, 1.3, 1.5, 1.2],
      rows: [
        ['层级', '玩家追求', '设计手段', '可观察指标'],
        ['即时', '操作与解谜的即时反馈', '跳跃手感、净化光效与音效、镜头演出', '单次交互的停留时长'],
        ['中期', '套装收集与外观表达', '图纸 · 材料 · 染色，产出可预期', '单套套装的收集周期'],
        ['长期', '区域解锁与图鉴完成度', '把服装能力做成地图钥匙', '区域完成率 / 图鉴进度'],
      ],
    });

    /* ---------- 04 结论 ---------- */
    const y4 = tblY + 300 + 70;
    add({
      id: U.uid('hd'), type: 'heading', x: AX, y: y4, w: 760, level: 2,
      kicker: '04 / 结论', text: '三条可复用的结论',
    });
    add({
      id: U.uid('tx'), type: 'text', x: AX, y: y4 + 100, w: 1000, h: 220, variant: 'quote',
      html:
        '<blockquote>① 把成长做成审美消费：能力获取 = 外观获取，玩家为喜欢的东西付出时间。<br>' +
        '② 让界面承担教学：空态、提示、进度条三件套，比一次性弹窗更持久。<br>' +
        '③ 循环必须有「回到起点」的钩子：每次解锁都要让玩家看见新的、够得着的目标。</blockquote>' +
        '<p class="dim">本册为面试用拆解样本，界面截图与系统表述以实机为准；数值与概率部分留待补充。</p>',
    });

    return { version: 2, title: '无限暖暖 · 系统拆解书', boardName: '总览', elements: els, cover: cover.id };
  }

  function init() {
    const local = loadLocal();
    doc = local ? normalize(local) : normalize(buildDemo());
    if (!local) saveNow(false);
    emit('init', { restored: !!local });
    return doc;
  }

  function setTitle(t) {
    begin(); doc.title = t; end('title');
  }

  return {
    init, get, on, emit, el, add, remove, update, duplicate, front, back,
    begin, end, commit, undo, redo, reset, bbox, setTitle, buildDemo,
    newDoc, buildBlank, buildSkeleton,
    saveNow, scheduleSave, flush, storageInfo, clearLocal,
    snapshots, pushSnapshot, restoreSnapshot, deleteSnapshot,
    boards, board, activeBoard, setActive, addBoard, renameBoard, removeBoard,
    duplicateBoard, moveBoard, boardIndex, defaultBoardName, normalize,
  };
})();
