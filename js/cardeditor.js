/* ------------------------------------------------------------------
 *  cardeditor.js — 列表 / 引用 / 分隔线 / 指标卡 / 评分条 / 来源卡
 *  每种组件一套针对性操作：列表管条目、评分点圆点、来源可复制/打开链接。
 * ------------------------------------------------------------------ */
window.CardEditor = (function () {
  const E = U.esc;
  const TYPE = {
    list: '列表',
    quote: '引用',
    divider: '分隔线',
    metric: '指标卡',
    rating: '评分条',
    source: '来源卡',
  };
  const TIP = {
    list: '管理条目顺序与样式，右侧卡片里的文字可直接改。',
    quote: '引文支持多行；右侧实时显示字数，出处可快速选。',
    divider: '挑一个章节标签和强调色，标签留空只显示线条。',
    metric: '数值可步进加减，单位可快速切换，右侧文字可直接改。',
    rating: '点圆点打分，也可以精确输入当前分与满分。',
    source: '链接可复制、可打开；画布上的卡片仍保持纯文本。',
  };
  const TONES = [
    ['violet', '紫 · 强调'],
    ['mint', '青 · 数据'],
    ['amber', '橙 · 风险'],
    ['pink', '粉 · 待办'],
    ['blue', '蓝 · 冷静'],
  ];

  let ov = null;
  let cur = null;
  let draft = null;
  let previewEl = null;

  const can = (type) => !!TYPE[type];
  const isOpen = () => !!ov;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const fld = (label, inner, hint) =>
    `<label class="ed-f"><span>${label}</span>${inner}` +
    (hint ? `<em class="ce-hint">${hint}</em>` : '') +
    `</label>`;
  const inp = (field, val, ph, opt) =>
    `<input class="ed-ipt" data-field="${field}"${opt || ''} value="${E(val == null ? '' : val)}" placeholder="${E(ph || '')}">`;
  const ta = (field, val, rows, ph) =>
    `<textarea class="ed-ipt ce-ta" rows="${rows || 4}" data-field="${field}" placeholder="${E(ph || '')}">${E(val == null ? '' : val)}</textarea>`;
  const section = (title, dim) =>
    `<div class="ed-sec">${title}${dim ? ` <span class="dim">· ${dim}</span>` : ''}</div>`;

  function toneSwatches(active) {
    return (
      `<div class="ce-swatches" data-tone-group>` +
      TONES.map(([v, l]) =>
        `<button class="ce-swatch tone-${v}${v === active ? ' active' : ''}" type="button" data-tone="${v}">` +
        `<i></i><span>${l.split(' · ')[0]}</span></button>`
      ).join('') +
      `</div>`
    );
  }

  function chips(items, action, extra) {
    return (
      `<div class="ce-chips">` +
      items.map((it) => {
        const val = Array.isArray(it) ? it[0] : it;
        const label = Array.isArray(it) ? it[1] : it;
        return `<button class="ce-chip" type="button" ${action}="${E(val)}" ${extra || ''}>${E(label)}</button>`;
      }).join('') +
      `</div>`
    );
  }

  function listRows() {
    const items = Array.isArray(draft.items) ? draft.items : [];
    if (!items.length) return `<div class="ce-empty">还没有条目。点下方「＋ 添加条目」开始。</div>`;
    return items.map((text, i) =>
      `<div class="ce-li" data-item-row="${i}">` +
      `<span class="ce-li-num">${i + 1}</span>` +
      `<input class="ed-ipt ce-li-ipt" data-item="${i}" value="${E(text)}" placeholder="写一条要点">` +
      `<button class="ce-li-btn" type="button" data-item-up="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>` +
      `<button class="ce-li-btn" type="button" data-item-down="${i}" title="下移" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>` +
      `<button class="ce-li-btn danger" type="button" data-item-del="${i}" title="删除">×</button>` +
      `</div>`
    ).join('');
  }

  function scoreDots(value, max) {
    let out = '';
    for (let i = 1; i <= max; i++) {
      out += `<button class="ce-dot${i <= value ? ' on' : ''}" type="button" data-score="${i}" aria-label="评 ${i} 分">${i}</button>`;
    }
    return out;
  }

  function ratingSummary() {
    const mq = ov && ov.querySelector('[data-field="max"]');
    const vq = ov && ov.querySelector('[data-field="value"]');
    const max = clamp(Number(mq ? mq.value : draft.max) || 5, 1, 20);
    const value = clamp(Number(vq ? vq.value : draft.value) || 0, 0, max);
    return `${value} / ${max}`;
  }

  function urlStateText(url) {
    url = String(url || '').trim();
    if (!url) return ['', '还没填链接，卡片上会留空'];
    if (/^https?:\/\/[^\s]+$/i.test(url)) return ['ok', '链接格式有效，可复制或打开'];
    return ['warn', '建议以 https:// 或 http:// 开头'];
  }

  function quoteCount() {
    const q = ov && ov.querySelector('[data-field="text"]');
    const text = q ? q.value : (draft.text || '');
    const n = String(text).replace(/\s/g, '').length;
    return `${n} 字`;
  }

  function valueOf(field) {
    const q = ov && ov.querySelector(`[data-field="${field}"]`);
    return q ? q.value : '';
  }

  function side(e) {
    if (e.type === 'list') {
      return (
        section('列表') +
        fld('标题', inp('title', e.title, '要点清单')) +
        `<div class="ce-block">
          <span class="ce-label">样式</span>
          <div class="ce-seg">
            <button type="button" data-ordered="off" class="${!e.ordered ? 'on' : ''}">● 圆点</button>
            <button type="button" data-ordered="on" class="${e.ordered ? 'on' : ''}">1. 编号</button>
          </div>
        </div>` +
        section('条目', '上移 / 下移 / 删除') +
        `<div class="ce-list-manager" id="ce-list-manager">${listRows()}</div>` +
        `<button class="ce-add" type="button" data-item-add>＋ 添加条目</button>` +
        `<p class="ce-hint">在条目输入框按回车，会在下方新增一条；右侧卡片里的条目文字也能直接改。</p>`
      );
    }
    if (e.type === 'quote') {
      return (
        section('引文') +
        fld('正文', ta('text', e.text, 7, '1–2 句最有力'), '支持换行；右侧卡片可直接改') +
        `<div class="ce-meta-line"><span id="ce-quote-count">${quoteCount()}</span><span class="dim">建议 1–2 句</span></div>` +
        fld('出处', inp('by', e.by, '— 拆解结论 / 来源')) +
        section('常用出处') +
        chips([
          ['— 拆解结论', '— 拆解结论'],
          ['— 体验观察', '— 体验观察'],
          ['— 官方说明', '— 官方说明'],
          ['— 访谈记录', '— 访谈记录'],
        ], 'data-quick-by') +
        section('强调色') +
        toneSwatches(e.tone)
      );
    }
    if (e.type === 'divider') {
      return (
        section('章节标签') +
        fld('小标签', inp('label', e.label, 'SECTION 01'), '留空则只显示中间的分隔线') +
        section('常用标签') +
        chips([
          ['SECTION 01', 'SECTION 01'],
          ['SECTION 02', 'SECTION 02'],
          ['PART 01', 'PART 01'],
          ['章节分隔', '章节分隔'],
          ['', '只留线条'],
        ], 'data-quick-label') +
        section('强调色') +
        toneSwatches(e.tone)
      );
    }
    if (e.type === 'metric') {
      return (
        section('指标') +
        fld('指标名', inp('label', e.label, '关键指标')) +
        fld(
          '数值',
          `<div class="ce-stepper">` +
          `<button type="button" data-metric-step="-1" aria-label="减 1">−</button>` +
          inp('value', e.value, '42') +
          `<button type="button" data-metric-step="1" aria-label="加 1">＋</button>` +
          `</div>`,
          '右侧大数字也能直接改'
        ) +
        fld('单位', inp('unit', e.unit, '% / h / 次')) +
        chips([
          ['%', '%'],
          ['x', 'x'],
          ['h', 'h'],
          ['次', '次'],
          ['人', '人'],
          ['¥', '¥'],
        ], 'data-quick-unit') +
        fld('注释', inp('note', e.note, '对比、口径或时间范围')) +
        section('强调色') +
        toneSwatches(e.tone)
      );
    }
    if (e.type === 'rating') {
      const max = Math.max(1, Number(e.max) || 5);
      const value = clamp(Number(e.value) || 0, 0, max);
      return (
        section('评分') +
        fld('标题', inp('label', e.label, '完成度')) +
        `<div class="ce-block">
          <span class="ce-label">点圆点打分</span>
          <div class="ce-score tone-${e.tone || 'violet'}" id="ce-score-picker">${scoreDots(value, max)}</div>
          <div class="ce-rating-line">
            <label>当前分 <input class="ed-ipt ce-num" type="number" data-field="value" min="0" max="${max}" step="1" value="${value}"></label>
            <span class="ce-slash">/</span>
            <label>满分 <input class="ed-ipt ce-num" type="number" data-field="max" min="1" max="20" step="1" value="${max}"></label>
            <button type="button" class="ce-clear" data-score-clear>清除</button>
          </div>
        </div>` +
        section('快速评分') +
        chips([
          ['3,5', '3 / 5'],
          ['4,5', '4 / 5'],
          ['5,5', '5 / 5'],
          ['3,10', '3 / 10'],
          ['8,10', '8 / 10'],
        ], 'data-rating-preset') +
        fld('备注', inp('note', e.note, '评估口径 / 待验证点')) +
        section('强调色') +
        toneSwatches(e.tone)
      );
    }
    const u = String(e.url || '').trim();
    const [uc, ut] = urlStateText(u);
    return (
      section('来源') +
      fld('标题', inp('title', e.title, '参考来源')) +
      `<div class="ce-block">
        <span class="ce-label">链接</span>
        <div class="ce-url-line">
          ${inp('url', e.url, 'https://…')}
          <button type="button" class="ed-btn sm" data-source-copy>复制</button>
          <button type="button" class="ed-btn sm" data-source-open>打开</button>
        </div>
        <div class="ce-url-state ${uc}" id="ce-url-state">${ut}</div>
      </div>` +
      fld('备注', ta('note', e.note, 4, '记录截图、访谈或版本信息')) +
      `<p class="ed-note">链接在画布上保持纯文本，避免拖动时误触；这里可以复制或在浏览器中打开。</p>`
    );
  }

  function current() {
    const d = JSON.parse(JSON.stringify(draft));
    if (d.type === 'list') {
      d.title = valueOf('title').trim();
      d.items = (Array.isArray(draft.items) ? draft.items : []).map((s) => String(s || '').trim()).filter(Boolean);
      d.ordered = !!draft.ordered;
    } else if (d.type === 'quote') {
      d.text = valueOf('text');
      d.by = valueOf('by').trim();
      d.tone = draft.tone || 'violet';
    } else if (d.type === 'divider') {
      d.label = valueOf('label').trim();
      d.tone = draft.tone || 'violet';
    } else if (d.type === 'metric') {
      d.label = valueOf('label').trim();
      d.value = valueOf('value').trim();
      d.unit = valueOf('unit').trim();
      d.note = valueOf('note').trim();
      d.tone = draft.tone || 'violet';
    } else if (d.type === 'rating') {
      const max = clamp(Number(valueOf('max')) || 5, 1, 20);
      d.label = valueOf('label').trim();
      d.max = max;
      d.value = clamp(Number(valueOf('value')) || 0, 0, max);
      d.note = valueOf('note').trim();
      d.tone = draft.tone || 'violet';
    } else if (d.type === 'source') {
      d.title = valueOf('title').trim();
      d.url = valueOf('url').trim();
      d.note = valueOf('note');
    }
    return d;
  }

  function paint() {
    if (!previewEl) return;
    const d = current();
    previewEl.innerHTML = `<div class="ce-canvas">${Renderer.inner(d)}</div>`;
    wirePreview();
  }

  function isMultiline(field) {
    return field === 'text' || (draft.type === 'source' && field === 'note');
  }

  function syncField(field, value) {
    if (!ov) return;
    const q = ov.querySelector(`[data-field="${field}"]`);
    if (q && q.value !== value) q.value = value;
  }

  function syncItemInput(i, value) {
    const q = ov && ov.querySelector(`[data-item="${i}"]`);
    if (q && q.value !== value) q.value = value;
  }

  function updateQuoteCount() {
    const el = ov && ov.querySelector('#ce-quote-count');
    if (el) el.textContent = quoteCount();
  }

  function updateUrlState() {
    const el = ov && ov.querySelector('#ce-url-state');
    if (!el) return;
    const [uc, ut] = urlStateText(valueOf('url'));
    el.className = 'ce-url-state ' + uc;
    el.textContent = ut;
  }

  function refreshHeaderCount() {
    const el = ov && ov.querySelector('#ce-head-count');
    if (!el) return;
    let text = '直接编辑';
    if (draft.type === 'list') text = (draft.items || []).filter((x) => String(x || '').trim()).length + ' 条';
    if (draft.type === 'quote') text = quoteCount();
    if (draft.type === 'divider') text = valueOf('label') || '无线条标签';
    if (draft.type === 'metric') text = (valueOf('value') || '—') + (valueOf('unit') || '');
    if (draft.type === 'rating') text = ratingSummary();
    if (draft.type === 'source') text = valueOf('url') ? '链接已填写' : '待填链接';
    el.textContent = text;
  }

  function refreshListManager() {
    const mgr = ov && ov.querySelector('#ce-list-manager');
    if (mgr) mgr.innerHTML = listRows();
    refreshHeaderCount();
  }

  function refreshRatingPicker() {
    const picker = ov && ov.querySelector('#ce-score-picker');
    if (!picker) return;
    const max = clamp(Number(valueOf('max')) || 5, 1, 20);
    let value = clamp(Number(valueOf('value')) || 0, 0, max);
    const vi = ov.querySelector('[data-field="value"]');
    if (Number(valueOf('value')) > max) {
      if (vi) vi.value = String(value);
      draft.value = value;
    }
    if (Number(valueOf('value')) < 0) {
      if (vi) vi.value = '0';
      value = 0;
    }
    picker.className = 'ce-score tone-' + (draft.tone || 'violet');
    picker.innerHTML = scoreDots(value, max);
    refreshHeaderCount();
  }

  function updateToneUI() {
    if (!ov) return;
    ov.querySelectorAll('[data-tone]').forEach((b) => b.classList.toggle('active', b.dataset.tone === (draft.tone || 'violet')));
    if (draft.type === 'rating') refreshRatingPicker();
  }

  function updateOrderedUI() {
    if (!ov) return;
    ov.querySelectorAll('[data-ordered]').forEach((b) => b.classList.toggle('on', (b.dataset.ordered === 'on') === !!draft.ordered));
  }

  function addListItem(at) {
    if (!Array.isArray(draft.items)) draft.items = [];
    const i = at == null ? draft.items.length : clamp(at, 0, draft.items.length);
    draft.items.splice(i, 0, '');
    refreshListManager();
    paint();
    const input = ov.querySelector(`[data-item="${i}"]`);
    if (input) { input.focus(); input.select(); }
  }

  function deleteListItem(i) {
    draft.items.splice(i, 1);
    refreshListManager();
    paint();
    const input = ov.querySelector(`[data-item="${clamp(i, 0, draft.items.length - 1)}"]`);
    if (input) input.focus();
  }

  function moveListItem(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= draft.items.length) return;
    const tmp = draft.items[i];
    draft.items[i] = draft.items[j];
    draft.items[j] = tmp;
    refreshListManager();
    paint();
    const input = ov.querySelector(`[data-item="${j}"]`);
    if (input) input.focus();
  }

  function setField(field, value) {
    const q = ov.querySelector(`[data-field="${field}"]`);
    if (q) q.value = value;
    draft[field] = value;
    paint();
    if (draft.type === 'quote' && field === 'text') updateQuoteCount();
    if (draft.type === 'source' && field === 'url') updateUrlState();
    if (draft.type === 'rating' && (field === 'value' || field === 'max')) refreshRatingPicker();
    refreshHeaderCount();
  }

  function setRating(value, max) {
    const m = clamp(Number(max) || (Number(valueOf('max')) || 5), 1, 20);
    const v = clamp(Number(value) || 0, 0, m);
    const mi = ov.querySelector('[data-field="max"]');
    const vi = ov.querySelector('[data-field="value"]');
    if (mi) mi.value = String(m);
    if (vi) vi.value = String(v);
    draft.max = m;
    draft.value = v;
    refreshRatingPicker();
    paint();
    refreshHeaderCount();
  }

  function stepMetric(delta) {
    const n = Number(valueOf('value')) || 0;
    const next = Math.round((n + delta) * 100) / 100;
    setField('value', String(next));
  }

  async function copySourceUrl() {
    const url = valueOf('url').trim();
    if (!url) return U.toast('先填写链接');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const q = ov.querySelector('[data-field="url"]');
        q.focus(); q.select(); document.execCommand('copy');
      }
      U.toast('链接已复制');
    } catch (e) {
      const q = ov.querySelector('[data-field="url"]');
      q.focus(); q.select(); U.toast('已选中链接，按 Ctrl+C 复制');
    }
  }

  function openSourceUrl() {
    const url = valueOf('url').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return U.toast('先填写完整的 http(s) 链接');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function wirePreview() {
    const root = previewEl && previewEl.querySelector('.ce-canvas');
    if (!root) return;
    root.querySelectorAll('[data-edit]').forEach((el) => {
      const field = el.getAttribute('data-edit');
      if (!field || (field === '__list' && el.dataset.index == null)) return;
      el.setAttribute('contenteditable', 'plaintext-only');
      el.setAttribute('spellcheck', 'false');
      el.dataset.ceEdit = '1';

      el.addEventListener('focus', () => {
        el.classList.add('ce-editing');
        if (field === 'value' && el.innerText.trim() === '—' && !draft.value) el.innerText = '';
      });
      el.addEventListener('blur', () => {
        el.classList.remove('ce-editing');
        if (field === 'value' && !el.innerText.trim()) el.innerText = '—';
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !isMultiline(field)) {
          ev.preventDefault();
          el.blur();
        }
      });
      el.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const text = ((ev.clipboardData && ev.clipboardData.getData('text/plain')) || '').replace(/\r/g, '');
        document.execCommand('insertText', false, text);
      });
      el.addEventListener('input', () => {
        if (field === '__list') {
          const i = Number(el.dataset.index);
          if (!Number.isInteger(i) || !Array.isArray(draft.items)) return;
          draft.items[i] = el.innerText;
          syncItemInput(i, el.innerText);
        } else {
          draft[field] = el.innerText;
          syncField(field, el.innerText);
          if (draft.type === 'quote' && field === 'text') updateQuoteCount();
          if (draft.type === 'source' && field === 'url') updateUrlState();
        }
        refreshHeaderCount();
      });
    });
  }

  function shell() {
    const title = TYPE[draft.type];
    let count = '直接编辑';
    if (draft.type === 'list') count = (draft.items || []).filter((x) => String(x || '').trim()).length + ' 条';
    else if (draft.type === 'quote') count = quoteCount();
    else if (draft.type === 'rating') count = ratingSummary();
    else if (draft.type === 'metric') count = (draft.value || '—') + (draft.unit || '');
    else if (draft.type === 'divider') count = draft.label || '无线条标签';
    else if (draft.type === 'source') count = draft.url ? '链接已填写' : '待填链接';

    return (
      `<div class="ed-panel compact ce-panel" role="dialog" tabindex="-1" aria-label="${E(title)}编辑">` +
      `<div class="ed-head">` +
      `<span class="ed-chip">${E(title)}</span>` +
      `<div class="ed-headtxt"><b>编辑${E(title)}</b><span>${E(TIP[draft.type])}</span></div>` +
      `<span class="ed-count" id="ce-head-count">${E(count)}</span>` +
      `<button class="ed-x" type="button" data-ce="close" aria-label="关闭">` +
      `<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3"/></svg></button>` +
      `</div>` +
      `<div class="ed-body">` +
      `<div class="ed-side">${side(draft)}</div>` +
      `<div class="ed-main ed-preview">` +
      `<div class="ed-sec">编辑卡片 <span class="dim">· 点文字就能改</span></div>` +
      `<div class="ce-preview" id="ce-preview"></div>` +
      `<p class="ed-note">右侧卡片就是编辑区：点标题 / 条目 / 引文等文字直接改，左侧操作会同步。位置和尺寸仍在画布上拖拽。</p>` +
      `</div>` +
      `</div>` +
      `<div class="ed-foot">` +
      `<span class="ed-meta">${E(title)} · 完成后写回画布</span>` +
      `<span class="ed-tiphint"><kbd>Esc</kbd> 取消 · <kbd>Ctrl/⌘ + Enter</kbd> 完成</span>` +
      `<button class="ed-btn ghost" type="button" data-ce="cancel">取消</button>` +
      `<button class="ed-btn primary" type="button" data-ce="save">完成</button>` +
      `</div>` +
      `</div>`
    );
  }

  function onSideInput(ev) {
    const t = ev.target;
    if (t.closest('[data-ce-edit]')) return;
    if (t.matches('[data-item]')) {
      const i = Number(t.dataset.item);
      if (Number.isInteger(i) && Array.isArray(draft.items)) draft.items[i] = t.value;
      paint();
      refreshHeaderCount();
      return;
    }
    paint();
    if (draft.type === 'quote' && t.matches('[data-field="text"]')) updateQuoteCount();
    if (draft.type === 'source' && t.matches('[data-field="url"]')) updateUrlState();
    if (draft.type === 'rating' && (t.matches('[data-field="value"]') || t.matches('[data-field="max"]'))) refreshRatingPicker();
    refreshHeaderCount();
  }

  function onSideKeydown(ev) {
    if (ev.target.matches('[data-item]') && ev.key === 'Enter') {
      ev.preventDefault();
      addListItem(Number(ev.target.dataset.item) + 1);
    }
  }

  function onSideClick(ev) {
    const t = ev.target;
    const ce = t.closest('[data-ce]');
    if (ce) {
      if (ce.dataset.ce === 'close' || ce.dataset.ce === 'cancel') return close();
      if (ce.dataset.ce === 'save') return save();
      return;
    }

    if (t.closest('[data-item-add]')) return addListItem();
    const del = t.closest('[data-item-del]');
    if (del) return deleteListItem(Number(del.dataset.itemDel));
    const up = t.closest('[data-item-up]');
    if (up) return moveListItem(Number(up.dataset.itemUp), -1);
    const down = t.closest('[data-item-down]');
    if (down) return moveListItem(Number(down.dataset.itemDown), 1);

    const tone = t.closest('[data-tone]');
    if (tone) {
      draft.tone = tone.dataset.tone;
      updateToneUI();
      paint();
      refreshHeaderCount();
      return;
    }
    const ordered = t.closest('[data-ordered]');
    if (ordered) {
      draft.ordered = ordered.dataset.ordered === 'on';
      updateOrderedUI();
      paint();
      return;
    }
    const quickBy = t.closest('[data-quick-by]');
    if (quickBy) { setField('by', quickBy.dataset.quickBy); return; }
    const quickLabel = t.closest('[data-quick-label]');
    if (quickLabel) { setField('label', quickLabel.dataset.quickLabel); return; }
    const quickUnit = t.closest('[data-quick-unit]');
    if (quickUnit) { setField('unit', quickUnit.dataset.quickUnit); return; }

    const step = t.closest('[data-metric-step]');
    if (step) return stepMetric(Number(step.dataset.metricStep));
    if (t.closest('[data-score-clear]')) return setRating(0, valueOf('max'));
    const score = t.closest('[data-score]');
    if (score) return setRating(Number(score.dataset.score), valueOf('max'));
    const preset = t.closest('[data-rating-preset]');
    if (preset) {
      const parts = preset.dataset.ratingPreset.split(',');
      return setRating(parts[0], parts[1]);
    }

    if (t.closest('[data-source-copy]')) { copySourceUrl(); return; }
    if (t.closest('[data-source-open]')) { openSourceUrl(); return; }
  }

  function build() {
    ov = document.createElement('div');
    ov.className = 'ed';
    ov.innerHTML = shell();
    document.body.appendChild(ov);
    previewEl = ov.querySelector('#ce-preview');
    ov.addEventListener('input', onSideInput);
    ov.addEventListener('keydown', onSideKeydown);
    ov.addEventListener('click', (ev) => {
      if (ev.target === ov) return close();
      onSideClick(ev);
    });
    ov.addEventListener('keydown', (ev) => ev.stopPropagation());
    document.body.classList.add('ed-open');
    window.addEventListener('keydown', onKey, true);
    paint();
    const first = ov.querySelector('.ed-side input, .ed-side textarea, .ed-side select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function onKey(ev) {
    if (!ov) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      save();
    }
  }

  function close() {
    if (!ov) return;
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
    ov = null;
    previewEl = null;
    cur = null;
    draft = null;
    document.body.classList.remove('ed-open');
  }

  function save() {
    if (!ov) return;
    const id = cur;
    const d = current();
    const e = Store.el(id);
    close();
    if (!e || !d) return;
    Store.begin();
    Object.keys(d).forEach((k) => {
      if (k === 'id' || k === 'type') return;
      e[k] = d[k];
    });
    Store.end('edit');
    Canvas.rebuild(id);
    Canvas.select(id);
    if (window.Panels) {
      Panels.refreshOutline();
      Panels.refreshInspector(true);
    }
    U.toast('已更新' + TYPE[e.type]);
  }

  function open(id) {
    const e = Store.el(id);
    if (!e || !can(e.type)) return;
    close();
    cur = id;
    draft = JSON.parse(JSON.stringify(e));
    build();
  }

  return { open, close, isOpen, can };
})();
