/* ------------------------------------------------------------------
 *  marks.js — 图片标注绘制引擎（卡片与编辑器共用）
 *  一次 canvas 绘制：底图 + 所有标注，保证所见即所得、可导出 PNG
 *
 *  mark 数据（坐标为相对图片框的 0~1 归一化值）：
 *    { id, kind:'arrow'|'pen'|'text'|'rect'|'ellipse'|'mosaic'|'highlight',
 *      color, x1,y1,x2,y2,                     // arrow / rect / ellipse / mosaic / highlight
 *      points:[[x,y],...],                     // pen
 *      x,y, text,                              // text
 *      label }                                 // arrow 尾端标签
 * ------------------------------------------------------------------ */
window.Marks = (function () {
  const FONT = '700 11.5px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  const COLORS = ['#D93E5C', '#C98A2E', '#7C5CFF', '#22A98D', '#241B3A'];

  const cache = new Map();      // src -> HTMLImageElement
  const pending = new Map();    // src -> [{canvas, e, opt}]

  /* ---------------- 图片缓存 ---------------- */
  function imgFor(src) {
    if (!src) return null;
    let img = cache.get(src);
    if (img) return img;
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    cache.set(src, img);
    return img;
  }

  function whenReady(src, job) {
    const img = imgFor(src);
    if (!img) return null;
    if (img.complete && img.naturalWidth) return img;
    let list = pending.get(src);
    if (!list) { list = []; pending.set(src, list); }
    if (!list.some((x) => x.canvas === job.canvas)) list.push(job);
    img.addEventListener('load', () => {
      const jobs = pending.get(src) || [];
      pending.delete(src);
      jobs.forEach((j) => { if (j.canvas.isConnected !== false) paint(j.canvas, j.e, j.opt); });
    }, { once: true });
    return null;
  }

  /* ---------------- 工具 ---------------- */
  function rgba(hex, a) {
    const h = String(hex || '#D93E5C').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rr); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxW) {
    const out = [];
    String(text || '').split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    });
    return out.length ? out : [''];
  }

  /* ---------------- 旧版标注 → 新 mark ---------------- */
  function fromAnnotations(list) {
    return (list || []).map((a) => ({
      id: a.id || U.uid('mk'),
      kind: 'arrow',
      color: a.tone === 'amber' ? '#C98A2E' : '#D93E5C',
      x1: a.lx / 100, y1: a.ly / 100, x2: a.ax / 100, y2: a.ay / 100,
      label: a.text || '',
    }));
  }

  function norm(e) {
    if (e && Array.isArray(e.marks)) return e.marks;
    return fromAnnotations(e && e.annotations);
  }

  /* ---------------- 底图 ---------------- */
  function drawPhoto(ctx, img, e, w, h) {
    if (!img || !img.naturalWidth) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const cover = (e.fit || 'contain') === 'cover';
    const base = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const z = e.zoom || 1;
    const dw = iw * base * z, dh = ih * base * z;
    const ox = ((e.ox || 0) / 100) * w, oy = ((e.oy || 0) / 100) * h;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
  }

  /* ---------------- 标签小卡片 ---------------- */
  function chip(ctx, cx, cy, text, color, w, h) {
    if (!String(text || '').trim()) return;
    ctx.font = FONT;
    const fs = 11.5, lh = 17, padX = 7, padY = 3.5;
    const maxW = Math.min(w * 0.52, 230);
    const lines = wrapText(ctx, text, maxW);
    let tw = 0;
    lines.forEach((l) => { tw = Math.max(tw, ctx.measureText(l).width); });
    const bw = tw + padX * 2;
    const bh = lines.length * lh + padY * 2 - 3;
    let bx = cx - bw / 2, by = cy - bh / 2;
    bx = Math.max(2, Math.min(bx, w - bw - 2));
    by = Math.max(2, Math.min(by, h - bh - 2));

    ctx.save();
    ctx.shadowColor = rgba(color, 0.16);
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.fill();
    ctx.restore();

    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.strokeStyle = rgba(color, 0.34);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + lh / 2 + i * lh + 0.5));
  }

  /* ---------------- 单个 mark ---------------- */
  function drawMark(ctx, m, w, h, dpr) {
    const col = m.color || COLORS[0];
    const k = dpr || 1;

    if (m.kind === 'pen') {
      const pts = m.points || [];
      if (pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = m.width || 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h)));
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (m.kind === 'text') {
      chip(ctx, (m.x == null ? 0.5 : m.x) * w, (m.y == null ? 0.5 : m.y) * h, m.text, col, w, h);
      return;
    }

    const x1 = Math.min(m.x1, m.x2) * w, y1 = Math.min(m.y1, m.y2) * h;
    const x2 = Math.max(m.x1, m.x2) * w, y2 = Math.max(m.y1, m.y2) * h;

    if (m.kind === 'arrow') {
      const ax = m.x1 * w, ay = m.y1 * h, bx = m.x2 * w, by = m.y2 * h;
      const ang = Math.atan2(by - ay, bx - ax);
      const head = U.clamp(Math.min(w, h) * 0.045, 7, 13);
      const tipX = bx, tipY = by;
      const sx = bx - Math.cos(ang) * head * 0.55;
      const sy = by - Math.sin(ang) * head * 0.55;

      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = m.width || 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang - 0.42) * head, tipY - Math.sin(ang - 0.42) * head);
      ctx.lineTo(tipX - Math.cos(ang + 0.42) * head, tipY - Math.sin(ang + 0.42) * head);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (m.label) {
        const lx = (m.labelAt === 'tip' ? bx : ax);
        const ly = (m.labelAt === 'tip' ? by : ay);
        chip(ctx, lx, ly + (m.labelAt === 'tip' ? 0 : 0), m.label, col, w, h);
      }
      return;
    }

    if (m.kind === 'rect') {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = m.width || 2;
      if (m.fill) { ctx.fillStyle = rgba(col, 0.1); roundRect(ctx, x1, y1, x2 - x1, y2 - y1, 4); ctx.fill(); }
      roundRect(ctx, x1, y1, x2 - x1, y2 - y1, 4);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (m.kind === 'ellipse') {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = m.width || 2;
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(1, (x2 - x1) / 2), Math.max(1, (y2 - y1) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (m.kind === 'highlight') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.32;
      const r = Math.min(6, (y2 - y1) / 2);
      roundRect(ctx, x1, y1, x2 - x1, y2 - y1, r);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (m.kind === 'mosaic') {
      const sx = Math.max(0, Math.round(x1)), sy = Math.max(0, Math.round(y1));
      const sw = Math.min(w, Math.round(x2)) - sx, sh = Math.min(h, Math.round(y2)) - sy;
      if (sw < 3 || sh < 3) return;
      const block = Math.max(5, Math.min(14, Math.round(Math.min(sw, sh) / 8)));
      const tw = Math.max(1, Math.round(sw / block)), th = Math.max(1, Math.round(sh / block));
      const small = document.createElement('canvas');
      small.width = tw; small.height = th;
      const sctx = small.getContext('2d');
      try {
        sctx.drawImage(ctx.canvas, sx * k, sy * k, sw * k, sh * k, 0, 0, tw, th);
      } catch (err) { return; }
      // 像素化 + 轻微去色，读起来更像「打码」
      const data = sctx.getImageData(0, 0, tw, th);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const g = px[i] * 0.32 + px[i + 1] * 0.5 + px[i + 2] * 0.18;
        px[i] = px[i] * 0.55 + g * 0.45;
        px[i + 1] = px[i + 1] * 0.55 + g * 0.45;
        px[i + 2] = px[i + 2] * 0.55 + g * 0.45;
      }
      sctx.putImageData(data, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, tw, th, sx, sy, sw, sh);
      ctx.restore();
    }
  }

  /* ---------------- 主绘制 ---------------- */
  function render(ctx, e, w, h, dpr) {
    const img = e.src ? imgFor(e.src) : null;
    if (img && img.complete) drawPhoto(ctx, img, e, w, h);
    const list = norm(e);
    list.forEach((m) => { try { drawMark(ctx, m, w, h, dpr || 1); } catch (err) { /* 单个标注失败不影响其它 */ } });
  }

  function paint(canvas, e, opt) {
    if (!canvas) return;
    opt = opt || {};
    const w = Math.round(opt.w || canvas.clientWidth || 0);
    const h = Math.round(opt.h || canvas.clientHeight || 0);
    if (!w || !h) return;
    const dpr = Math.min(2.6, Math.max(window.devicePixelRatio || 1, 1.7));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (e.src) {
      const img = whenReady(e.src, { canvas, e, opt: { w, h } });
      if (img) {
        drawPhoto(ctx, img, e, w, h);
        norm(e).forEach((m) => { try { drawMark(ctx, m, w, h, dpr); } catch (err) {} });
      }
    } else {
      norm(e).forEach((m) => { try { drawMark(ctx, m, w, h, dpr); } catch (err) {} });
    }
  }

  /* ---------------- 导出 PNG ---------------- */
  function exportPng(e, size, cb) {
    if (typeof size === 'function') { cb = size; size = null; }
    const img = e.src ? imgFor(e.src) : null;
    if (!img || !img.complete || !img.naturalWidth) { cb && cb(null, '图片尚未加载完成'); return; }
    const node = document.querySelector('.el[data-id="' + e.id + '"] .shot-cv');
    const w = (size && size.w) || (node && node.clientWidth) || (e.w - 20);
    const h = (size && size.h) || (node && node.clientHeight) || (e.h - 60);
    const k = 2.4;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k);
    cv.height = Math.round(h * k);
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPhoto(ctx, img, e, w, h);
    norm(e).forEach((m) => { try { drawMark(ctx, m, w, h, k); } catch (err) {} });
    cv.toBlob((blob) => {
      if (!blob) { cb && cb(null, '导出失败'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = safeName(e.title) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      cb && cb(true);
    }, 'image/png');
  }

  function safeName(t) {
    return String(t || '标注图').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || '标注图';
  }

  /* ---------------- 重绘整页图片 ---------------- */
  function repaintAll(root) {
    (root || document).querySelectorAll('.el-image').forEach((n) => {
      const e = Store.el(n.dataset.id);
      const cv = n.querySelector('.shot-cv');
      if (e && cv) paint(cv, e);
    });
  }

  let rz = null;
  function bindResize() {
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => repaintAll(), 180);
    });
  }

  return { paint, render, norm, fromAnnotations, repaintAll, bindResize, exportPng, COLORS, rgba, imgFor };
})();
