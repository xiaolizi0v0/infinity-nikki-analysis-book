/* ------------------------------------------------------------------
 *  util.js — 基础工具（无依赖，file:// 直接打开可运行）
 * ------------------------------------------------------------------ */
window.U = (function () {
  let seq = 0;
  const uid = (p) => (p || 'el') + '_' + Date.now().toString(36).slice(-4) + '_' + (++seq).toString(36);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /* ---------- 文本度量 ---------- */
  const _c = document.createElement('canvas');
  const _ctx = _c.getContext('2d');
  const FONT = '13px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';

  function measure(text, font) {
    _ctx.font = font || FONT;
    return _ctx.measureText(text).width;
  }

  // 中英混排断行：CJK 按字断，英文按词断
  function tokenize(str) {
    return (
      String(str).match(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]|[A-Za-z0-9_@#$%&*+\-/.:]+|\s+|[\s\S]/g) || []
    );
  }

  function wrap(text, maxW, font) {
    const lines = [];
    String(text)
      .split('\n')
      .forEach((para) => {
        const toks = tokenize(para);
        let line = '';
        toks.forEach((t) => {
          if (t === '\n') return;
          const test = line + t;
          if (line && measure(test, font) > maxW) {
            lines.push(line.trimEnd());
            line = t === ' ' ? '' : t;
          } else {
            line = test;
          }
        });
        lines.push(line.trimEnd());
      });
    return lines.length ? lines : [''];
  }

  // 平衡断行：在不增加行数的前提下，让各行长度更接近（避免末行只有一两个字）
  function wrapBalanced(text, maxW, font) {
    const base = wrap(text, maxW, font);
    if (base.length < 2) return base;
    let best = base;
    let bestScore = Infinity;
    for (let w = maxW; w > maxW * 0.45; w -= 4) {
      const lines = wrap(text, w, font);
      if (lines.length !== base.length) continue;
      let mx = 0;
      lines.forEach((l) => (mx = Math.max(mx, measure(l, font))));
      const score = mx;
      if (score < bestScore) { bestScore = score; best = lines; }
    }
    return best;
  }

  /* ---------- 数学 / 路径 ---------- */
  const snap = (v, g) => Math.round(v / g) * g;

  // 正交折线 + 圆角
  function elbow(x1, y1, x2, y2, r) {
    r = Math.min(r == null ? 10 : r, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
    if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} L${x2},${y2}`;
    const midY = (y1 + y2) / 2;
    const dir = x2 > x1 ? 1 : -1;
    return [
      `M${x1},${y1}`,
      `L${x1},${midY - r}`,
      `Q${x1},${midY} ${x1 + dir * r},${midY}`,
      `L${x2 - dir * r},${midY}`,
      `Q${x2},${midY} ${x2},${midY + r}`,
      `L${x2},${y2}`,
    ].join(' ');
  }

  /* ---------- DOM ---------- */
  function h(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 其他 ---------- */
  function plainText(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 保留段落换行的纯文本（供面板 textarea 使用）
  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h4|h3|blockquote|div)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '· ');
    let t = d.textContent || '';
    return t.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function textToHtml(text) {
    return String(text || '')
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length)
      .map((l) => `<p>${esc(l)}</p>`)
      .join('');
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const a = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, a), ms);
    };
  }

  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1500);
  }

  function download(name, text, mime) {
    downloadBlob(name, new Blob([text], { type: mime || 'application/json;charset=utf-8' }));
  }

  let toastT;
  function toast(msg) {
    let box = document.getElementById('toast');
    if (!box) {
      box = h('div', { id: 'toast', class: 'toast' });
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => box.classList.remove('show'), 1900);
  }

  // 首次拦截：屏蔽 contenteditable 粘贴富文本样式
  function pastePlain(e) {
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (t == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, t);
  }

  return {
    uid, clamp, esc, measure, wrap, wrapBalanced, snap, elbow, h, $, $$,
    plainText, htmlToText, textToHtml, debounce, download, downloadBlob, toast, pastePlain, FONT,
  };
})();
