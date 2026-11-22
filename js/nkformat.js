/* ------------------------------------------------------------------
 *  nkformat.js — .nkdraw 画布文件格式（单文件 ZIP 容器，类似 .drawio）
 *
 *  容器结构：
 *    meta.json        格式版本 / 标题 / 时间 / 组件数
 *    document.json    画布数据（组件、样式、标注），图片以 asset: 引用
 *    assets/img-1.png 真实图片字节（不再是 base64）
 *
 *  · 写入用 deflate-raw 压缩（浏览器支持时），不支持则退化为 stored
 *  · 读取同时支持 .nkdraw 与旧版 .json（按首字节判断）
 * ------------------------------------------------------------------ */
window.NK = (function () {
  const EXT = '.nkdraw';
  const MIME = 'application/x-nkdraw';
  const FORMAT = 1;
  const APP = '无限暖暖 · 系统拆解书';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const strBytes = (s) => enc.encode(s);
  const bytesStr = (b) => dec.decode(b);

  /* ---------------- CRC32 ---------------- */
  let CRC = null;
  function crc32(buf) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------------- deflate / inflate ---------------- */
  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(st).arrayBuffer());
    } catch (e) { return null; }
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压 .nkdraw');
    const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }

  /* ---------------- base64 ---------------- */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
  const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
  const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp' };
  const mimeOf = (name) => MIME_OF[(name.split('.').pop() || '').toLowerCase()] || 'image/png';

  /* ---------------- ZIP 写 ---------------- */
  function dosTime(d) {
    const t = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const dt = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { t, d: dt };
  }

  async function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const { t, d } = dosTime(new Date());

    for (const f of files) {
      const raw = f.data;
      const name = strBytes(f.name);
      const crc = crc32(raw);
      const def = await deflateRaw(raw);
      const useDef = !!def && def.length < raw.length;
      const body = useDef ? def : raw;
      const method = useDef ? 8 : 0;

      const lh = new Uint8Array(30 + name.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 文件名
      dv.setUint16(8, method, true);
      dv.setUint16(10, t, true);
      dv.setUint16(12, d, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, body.length, true);
      dv.setUint32(22, raw.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);

      chunks.push(lh, body);
      central.push({ name, method, crc, csize: body.length, usize: raw.length, offset });
      offset += lh.length + body.length;
    }

    const cd = [];
    let cdSize = 0;
    for (const c of central) {
      const h = new Uint8Array(46 + c.name.length);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, c.method, true);
      dv.setUint16(12, t, true);
      dv.setUint16(14, d, true);
      dv.setUint32(16, c.crc, true);
      dv.setUint32(20, c.csize, true);
      dv.setUint32(24, c.usize, true);
      dv.setUint16(28, c.name.length, true);
      dv.setUint32(42, c.offset, true);
      h.set(c.name, 46);
      cd.push(h);
      cdSize += h.length;
    }

    const eocd = new Uint8Array(22);
    const dv2 = new DataView(eocd.buffer);
    dv2.setUint32(0, 0x06054b50, true);
    dv2.setUint16(8, central.length, true);
    dv2.setUint16(10, central.length, true);
    dv2.setUint32(12, cdSize, true);
    dv2.setUint32(16, offset, true);

    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach((b) => { out.set(b, p); p += b.length; });
    cd.forEach((b) => { out.set(b, p); p += b.length; });
    out.set(eocd, p);
    return out;
  }

  /* ---------------- ZIP 读 ---------------- */
  function unzip(buf) {
    let eocd = -1;
    const min = Math.max(0, buf.length - 66000);
    for (let i = buf.length - 22; i >= min; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ' + EXT + ' 文件');

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));

      const lnl = dv.getUint16(lo + 26, true);
      const lel = dv.getUint16(lo + 28, true);
      const start = lo + 30 + lnl + lel;
      out[name] = { method, data: buf.subarray(start, start + csize) };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  async function readEntry(ent) {
    if (!ent) return null;
    if (ent.method === 0) return ent.data;
    if (ent.method === 8) return inflateRaw(ent.data);
    throw new Error('不支持的压缩方式：' + ent.method);
  }

  /* 多画布：把 doc 里的元素列表都取出来（兼容旧版单画布） */
  function elLists(doc) {
    if (doc && Array.isArray(doc.boards) && doc.boards.length) {
      return doc.boards.map((b) => (b && Array.isArray(b.elements) ? b.elements : []));
    }
    return [doc && Array.isArray(doc.elements) ? doc.elements : []];
  }

  /* ---------------- 打包 / 解包 ---------------- */
  async function pack(doc) {
    const copy = JSON.parse(JSON.stringify(doc));
    const assets = [];
    let n = 0;

    const lists = elLists(copy);
    const allEls = [].concat.apply([], lists);
    for (const e of allEls) {
      if (e.type !== 'image' || !e.src) continue;
      const src = String(e.src);

      if (src.startsWith('data:')) {
        const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
        if (!m) continue;
        let bytes;
        try { bytes = m[2] ? b64ToBytes(m[3]) : strBytes(decodeURIComponent(m[3])); } catch (err) { continue; }
        const name = 'assets/img-' + ++n + '.' + (EXT_OF[m[1]] || 'png');
        assets.push({ name, data: bytes });
        e.src = 'asset:' + name;
        continue;
      }

      // 相对路径（如 assets/ref-jingling.jpg）：尽量内联，文件拷走后图片不丢
      if (/^(https?:|asset:|blob:)/.test(src)) continue;
      try {
        const resp = await fetch(src);
        if (!resp.ok) continue;
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (bytes.length > 16 * 1024 * 1024) continue;
        const ext = ((/\.([a-z0-9]{2,5})(?:$|\?)/i.exec(src) || [])[1] || 'png').toLowerCase();
        const name = 'assets/img-' + ++n + '.' + ext;
        assets.push({ name, data: bytes });
        e.src = 'asset:' + name;
      } catch (err) { /* 取不到就保持原样 */ }
    }

    const meta = {
      app: APP,
      kind: 'nikki-canvas',
      format: FORMAT,
      title: copy.title || '',
      created: new Date().toISOString(),
      elements: allEls.length,
      boards: lists.length,
      assets: assets.length,
      generator: '拆解书系统',
      layout: ['meta.json', 'document.json', 'assets/*'],
    };

    return zip([
      { name: 'meta.json', data: strBytes(JSON.stringify(meta, null, 2)) },
      { name: 'document.json', data: strBytes(JSON.stringify(copy)) },
      ...assets,
    ]);
  }

  async function unpack(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!buf.length) throw new Error('文件是空的');

    // 旧版 .json（以 { 开头）直接当文本解析
    if (buf[0] === 0x7b) {
      const doc = JSON.parse(bytesStr(buf));
      if (!doc || !(Array.isArray(doc.boards) || Array.isArray(doc.elements))) throw new Error('不是画布文件');
      return { doc, meta: null, legacy: true };
    }

    const entries = unzip(buf);
    const docEnt = entries['document.json'];
    if (!docEnt) throw new Error('缺少 document.json，可能不是 ' + EXT + ' 文件');

    const doc = JSON.parse(bytesStr(await readEntry(docEnt)));
    if (!doc || !(Array.isArray(doc.boards) || Array.isArray(doc.elements))) throw new Error('document.json 结构不正确');

    let meta = null;
    if (entries['meta.json']) {
      try { meta = JSON.parse(bytesStr(await readEntry(entries['meta.json']))); } catch (e) {}
    }

    for (const list of elLists(doc)) {
      for (const e of list) {
        if (e.type !== 'image' || typeof e.src !== 'string' || !e.src.startsWith('asset:')) continue;
        const key = e.src.slice(6);
        const ent = entries[key];
        if (!ent) { e.src = ''; continue; }
        const bytes = await readEntry(ent);
        e.src = 'data:' + mimeOf(key) + ';base64,' + bytesToB64(bytes);
      }
    }

    return { doc, meta, legacy: false };
  }

  /* ---------------- 文件命名 / 选择器配置 ---------------- */
  function fileName(doc) {
    const t = String((doc && doc.title) || '拆解书').replace(/[\\/:*?"<>|]+/g, '').trim() || '拆解书';
    return t + EXT;
  }

  const saveTypes = [
    { description: 'NK 画布文件（' + EXT + '）', accept: { [MIME]: [EXT] } },
    { description: '旧版 JSON 工程', accept: { 'application/json': ['.json'] } },
  ];
  const openTypes = [
    { description: '画布 / 工程文件', accept: { [MIME]: [EXT], 'application/json': ['.json'] } },
  ];

  // 是否为本格式（用于导入时区分 .json / .nkdraw）
  function isPacked(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
  }

  return { EXT, MIME, FORMAT, pack, unpack, fileName, saveTypes, openTypes, isPacked };
})();
