/* ------------------------------------------------------------------
 *  theme.js — 配色主题：切换、持久化、选择面板
 * ------------------------------------------------------------------ */
(function () {
  const KEY = 'nk.theme.v1';
  const DEFAULT = 'snow';

  /* 主题清单：c = [画布底色, 面/卡片色, 主色] 用于预览色块 */
  const THEMES = [
    { id: 'snow', name: '雪绒紫', desc: '默认 · 清透淡紫', c: ['#F6F3FC', '#FFFFFF', '#7C5CFF'] },
    { id: 'warm', name: '晨光米', desc: '暖纸 · 赤陶', c: ['#FBF5EC', '#FFFDF9', '#C2703C'] },
    { id: 'mint', name: '青瓷', desc: '冷调 · 湖水绿', c: ['#F1F7F5', '#FFFFFF', '#1F9E86'] },
    { id: 'rose', name: '樱雾', desc: '柔粉 · 樱花', c: ['#FDF4F7', '#FFFFFF', '#D9638F'] },
    { id: 'night', name: '夜航', desc: '深色 · 亮紫', c: ['#15121F', '#201B2E', '#9C82FF'] },
  ];

  const IDS = THEMES.map((t) => t.id);
  let cur = DEFAULT;
  let pop = null;
  let btn = null;

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return IDS.indexOf(v) >= 0 ? v : DEFAULT;
    } catch (e) {
      return DEFAULT;
    }
  }

  function meta(id) {
    const m = THEMES.find((t) => t.id === id) || THEMES[0];
    return m;
  }

  function apply(id, persist) {
    if (IDS.indexOf(id) < 0) id = DEFAULT;
    cur = id;
    document.documentElement.dataset.theme = id;
    if (persist !== false) {
      try { localStorage.setItem(KEY, id); } catch (e) { /* 隐私模式忽略 */ }
    }
    const m = meta(id);
    const tm = document.querySelector('meta[name="theme-color"]');
    if (tm) tm.setAttribute('content', m.c[0]);
    sync();
    try {
      window.dispatchEvent(new CustomEvent('nk:theme', { detail: { id: id } }));
    } catch (e) { /* 老浏览器 */ }
  }

  function sync() {
    if (!pop) return;
    pop.querySelectorAll('.tp-card').forEach((card) => {
      const on = card.dataset.theme === cur;
      card.classList.toggle('on', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (btn) btn.title = '配色主题：' + meta(cur).name + '（点击切换 · T）';
  }

  function build() {
    pop = document.getElementById('theme-pop');
    btn = document.getElementById('btn-theme');
    const grid = document.getElementById('tp-grid');
    if (!pop || !btn || !grid) return false;

    grid.innerHTML = THEMES.map(
      (t) => `<button class="tp-card" data-theme="${t.id}" aria-pressed="false" title="${t.name}">
        <span class="tp-prev" style="background:${t.c[0]}">
          <span class="tp-win" style="background:${t.c[1]}">
            <b style="background:${t.c[2]}"></b><i></i><i></i>
          </span>
        </span>
        <span class="tp-name">${t.name}</span>
        <span class="tp-desc">${t.desc}</span>
        <span class="tp-check">✓</span>
      </button>`
    ).join('');

    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.tp-card');
      if (!card) return;
      apply(card.dataset.theme);
      close();
    });

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pop.classList.contains('on') ? close() : open();
    });

    pop.addEventListener('click', (ev) => ev.stopPropagation());
    document.addEventListener('click', () => close());
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && pop.classList.contains('on')) close();
    });

    return true;
  }

  function open() {
    if (!pop) return;
    const more = document.getElementById('menu-more');
    if (more) more.classList.remove('on');
    pop.classList.add('on');
    if (btn) { btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
  }

  function close() {
    if (!pop) return;
    pop.classList.remove('on');
    if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
  }

  function cycle() {
    const i = IDS.indexOf(cur);
    apply(IDS[(i + 1) % IDS.length]);
    U.toast('配色：' + meta(cur).name);
  }

  function init() {
    // 头部内联脚本已先把 data-theme 落到 <html>，这里只做同步与交互
    cur = read();
    apply(cur, false);
    if (!build()) return;
    sync();
  }

  window.Theme = {
    init: init,
    set: (id) => apply(id),
    get: () => cur,
    list: () => THEMES.slice(),
    open: open,
    close: close,
    toggle: () => (pop && pop.classList.contains('on') ? close() : open()),
    cycle: cycle,
  };

  // 单键快捷键 T：在输入框、编辑窗口内不触发
  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
    if (/ed-open|fe-open|ie-open|ndlg-open/.test(document.body.className)) return;
    if (ev.key === 't' || ev.key === 'T') {
      ev.preventDefault();
      cycle();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 打印/导出 PDF 时临时回到浅色，避免深色主题印成大黑页
  window.addEventListener('beforeprint', () => {
    if (cur !== 'snow') document.documentElement.dataset.theme = 'snow';
  });
  window.addEventListener('afterprint', () => {
    if (cur !== 'snow') document.documentElement.dataset.theme = cur;
  });
})();
