/* ------------------------------------------------------------------
 *  files.js — 本地文件读写（File System Access API）
 *  · 另存为：弹出系统对话框，自己选设备上的目录与文件名
 *  · 打开：从设备任意目录读取 .nkdraw / .json
 *  · 记住上次的文件句柄（IndexedDB），下次保存可一键写回同一文件
 *  · 与具体格式无关：只管字节，打包/解包交给 nkformat.js
 *  不支持时自动降级为「下载 / 上传」
 * ------------------------------------------------------------------ */
window.Files = (function () {
  const SUPPORTED = typeof window.showSaveFilePicker === 'function';
  const DB_NAME = 'nikki-teardown-fs';
  const STORE = 'kv';
  const KEY_HANDLE = 'file-handle';

  let handle = null;
  let name = '';
  let lastWrite = 0;
  let onChange = null;
  let autoWrite = true;

  /* ---------- IndexedDB ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function kvSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function kvGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvDel(key) {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res(true);
    });
  }

  /* ---------- 内部 ---------- */
  function fire() {
    if (onChange) onChange({ handle, name, supported: SUPPORTED, autoWrite });
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async function writeHandle(h, data) {
    const w = await h.createWritable();
    await w.write(data);
    await w.close();
    lastWrite = Date.now();
  }

  async function ensurePermission(h) {
    if (!h) return false;
    const opts = { mode: 'readwrite' };
    if ((await h.queryPermission(opts)) === 'granted') return true;
    if ((await h.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  /* ---------- 对外 ---------- */
  async function restore() {
    if (!SUPPORTED) return null;
    try {
      const h = await kvGet(KEY_HANDLE);
      if (!h) return null;
      const opts = { mode: 'readwrite' };
      const perm = await h.queryPermission(opts);
      handle = h;
      name = h.name || '拆解书.nkdraw';
      fire();
      return { handle: h, name, permission: perm };
    } catch (e) {
      return null;
    }
  }

  // dataOrFn: Uint8Array | Blob | string | (() => Promise<data>)
  // 先弹系统对话框、再执行 dataOrFn：保证「用户手势」在 showSaveFilePicker 时仍然有效
  async function saveAs(dataOrFn, suggestedName, types) {
    if (!SUPPORTED) return { ok: false, reason: 'unsupported' };
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: suggestedName || '未命名.nkdraw',
        types: types || [{ description: 'NK 画布文件', accept: { 'application/x-nkdraw': ['.nkdraw'] } }],
        excludeAcceptAllOption: false,
      });
      const data = typeof dataOrFn === 'function' ? await dataOrFn() : dataOrFn;
      await writeHandle(h, data);
      handle = h;
      name = h.name;
      try { await kvSet(KEY_HANDLE, h); } catch (e) {}
      fire();
      return { ok: true, name, dir: describeDir(h) };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancel' };
      return { ok: false, reason: 'error', error: e };
    }
  }

  async function save(data) {
    if (!handle) return saveAs(data);
    try {
      if (!(await ensurePermission(handle))) return { ok: false, reason: 'denied' };
      await writeHandle(handle, data);
      fire();
      return { ok: true, name, dir: describeDir(handle) };
    } catch (e) {
      return { ok: false, reason: 'error', error: e };
    }
  }

  // 自动写回（已授权时静默执行）
  async function autoSave(data) {
    if (!autoWrite || !handle) return;
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
      await writeHandle(handle, data);
      fire();
    } catch (e) {}
  }

  async function openFile(types) {
    if (typeof window.showOpenFilePicker !== 'function') return { ok: false, reason: 'unsupported' };
    try {
      const [h] = await window.showOpenFilePicker({
        multiple: false,
        types: types || [{ description: '画布 / 工程文件', accept: { 'application/x-nkdraw': ['.nkdraw'], 'application/json': ['.json'] } }],
      });
      const file = await h.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      handle = h;
      name = h.name;
      try { await kvSet(KEY_HANDLE, h); } catch (e) {}
      fire();
      return { ok: true, bytes, name, size: file.size };
    } catch (e) {
      return { ok: false, reason: e && e.name === 'AbortError' ? 'cancel' : 'error', error: e };
    }
  }

  async function forget() {
    handle = null;
    name = '';
    try { await kvDel(KEY_HANDLE); } catch (e) {}
    fire();
  }

  // 各浏览器对目录的暴露程度不同，能拿到就展示，拿不到返回空串
  function describeDir(h) {
    try {
      if (h && typeof h.resolve === 'function') return ''; // 需要目录权限才能解析，跳过
    } catch (e) {}
    return '';
  }

  function fileLabel() {
    if (!name) return '';
    return name.length > 14 ? name.slice(0, 12) + '…' : name;
  }

  return {
    get supported() { return SUPPORTED; },
    get handle() { return handle; },
    get name() { return name; },
    get autoWrite() { return autoWrite; },
    set autoWrite(v) { autoWrite = !!v; fire(); },
    get lastWrite() { return lastWrite; },
    set onChange(fn) { onChange = fn; },
    restore, saveAs, save, autoSave, openFile, forget, fileLabel,
  };
})();
