/* ------------------------------------------------------------------
 *  panels.js — 大纲 / 属性面板
 * ------------------------------------------------------------------ */
window.Panels = (function () {
  let outlineEl, inspector, addImageInput;
  let commitTimer = null;
  let openNode = null;
  let builtKey = '';

  const E = U.esc;
  const FALLBACK_ICON = '<path d="M3 4h10M3 7.5h10M3 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  const typeMeta = (t) => (window.ComponentRegistry ? ComponentRegistry.get(t) : null);
  const icon = (t) => `<svg class="ico" viewBox="0 0 16 16" fill="none">${(typeMeta(t) && typeMeta(t).icon) || FALLBACK_ICON}</svg>`;
  const typeLabel = (t) => (typeMeta(t) && typeMeta(t).label) ||
    ({ heading: '标题', text: '文字', note: '标注', image: '图片', flowchart: '流程图', table: '表格', state: '状态图' }[t] || '');

  function init() {
    outlineEl = document.getElementById('outline');
    inspector = document.getElementById('inspector');
    addImageInput = document.getElementById('file-image');
    if (addImageInput) {
      addImageInput.addEventListener('change', () => {
        const f = addImageInput.files && addImageInput.files[0];
        const mode = addImageInput.dataset.mode;
        addImageInput.value = '';
        if (!f || !/^image\//.test(f.type)) return;
        if (mode === 'replace') upstreamImage(f);
        else Canvas.importImageFile(f);
      });
    }
    inspector.addEventListener('input', onInput);
    inspector.addEventListener('change', onInput);
    inspector.addEventListener('click', onClick);
    outlineEl.addEventListener('click', (ev) => {
      const it = ev.target.closest('.ol-item');
      if (it) Canvas.focus(it.dataset.id);
    });
    refreshOutline();
    refreshInspector();
  }

  function upstreamImage(file) {
    let id = Canvas.getSel();
    if (!id || (Store.el(id) || {}).type !== 'image') {
      Canvas.addAtCenter('image');
      id = Canvas.getSel();
    }
    if (!id) return;
    const r = new FileReader();
    r.onload = () => {
      Canvas.setImageSrc(id, r.result);
      setTimeout(refreshInspector, 60);
    };
    r.readAsDataURL(file);
  }

  /* ---------------- 大纲 ---------------- */
  function labelOf(e) {
    if (e.type === 'heading') return e.text || '未命名标题';
    if (e.type === 'flowchart') return e.title || '流程图';
    if (e.type === 'image') return e.title || '图片';
    if (e.type === 'table') return e.title || '表格';
    if (e.type === 'state') return e.title || '状态图';
    if (e.type === 'note') return e.title || '标注';
    if (e.type === 'list') return e.title || (e.items && e.items[0]) || '列表';
    if (e.type === 'quote') return U.plainText(e.text).slice(0, 26) || '引用';
    if (e.type === 'divider') return e.label || '分隔线';
    if (e.type === 'metric') return ((e.label || '指标') + ' ' + (e.value || '') + (e.unit || '')).trim();
    if (e.type === 'rating') return e.label || '评分条';
    if (e.type === 'source') return e.title || '来源卡';
    if (e.type === 'timeline') return e.title || '时间轴';
    if (e.type === 'cycle') return e.title || '循环图';
    if (e.type === 'hierarchy') return e.title || '层级图';
    if (e.type === 'matrix') return e.title || '矩阵';
    if (e.type === 'compare') return e.title || '对比卡';
    if (e.type === 'group') return e.title || '分组框';
    if (e.type === 'columns') return e.title || '分栏';
    if (e.type === 'video') return e.title || '视频 / GIF';
    if (e.type === 'semantic') return e.title || '语义卡';
    const t = U.plainText(e.html).slice(0, 26);
    return t || '文字段落';
  }

  function refreshOutline() {
    const doc = Store.get();
    if (!doc || !outlineEl) return;
    const list = (doc.elements || []).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const counts = list.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
    const selIds = (Canvas.getSelIds && Canvas.getSelIds()) || [];
    document.getElementById('el-count').textContent = list.length + ' 个组件';
    outlineEl.innerHTML = list
      .map(
        (e) =>
          `<div class="ol-item ol-${e.type} ${selIds.indexOf(e.id) >= 0 ? 'active' : ''}" data-id="${e.id}">
             ${icon(e.type)}
             <span class="ol-label">${E(labelOf(e))}</span>
             <span class="ol-kind">${typeLabel(e.type) || ''}</span>
           </div>`
      )
      .join('') || '<div class="empty-hint">画布还是空的<br>从顶部添加一个组件开始</div>';
    const stat = document.getElementById('type-stat');
    if (stat) {
      stat.innerHTML = (window.ComponentRegistry ? ComponentRegistry.all() : [])
        .filter((t) => counts[t.type])
        .map((t) => `<span class="pill">${E(t.label)} ${counts[t.type]}</span>`)
        .join('');
    }
  }

  /* ---------------- 属性面板 ---------------- */
  function setActiveOutline() {
    const ids = (Canvas.getSelIds && Canvas.getSelIds()) || [];
    U.$$('.ol-item', outlineEl).forEach((n) =>
      n.classList.toggle('active', ids.indexOf(n.dataset.id) >= 0)
    );
  }

  function refreshInspector(force) {
    if (!inspector) return;
    const ids = (Canvas.getSelIds && Canvas.getSelIds()) || [];
    const multi = ids.length > 1;
    const id = multi ? null : (ids[0] || Canvas.getSel() || null);
    const nodeId = multi ? null : (Canvas.getSelNode() || null);
    const key = multi ? 'multi|' + ids.join(',') : (id || '-') + '|' + (nodeId || '-');
    const ae = document.activeElement;
    if (!force && ae && inspector.contains(ae) && builtKey === key) {
      setActiveOutline();
      return;
    }
    builtKey = key;
    if (multi) {
      inspector.innerHTML = multiInspector(ids);
      setActiveOutline();
      return;
    }
    const e = id ? Store.el(id) : null;
    if (!e) {
      inspector.innerHTML = emptyInspector();
      setActiveOutline();
      return;
    }
    openNode = Canvas.getSelNode() || openNode;
    let html = header(e) + body(e) + actions(e);
    inspector.innerHTML = html;
    setActiveOutline();
  }

  function multiInspector(ids) {
    const list = ids.map((id) => Store.el(id)).filter(Boolean);
    return `<div class="insp-head">
      <div class="insp-type"><svg class="ico" viewBox="0 0 16 16" fill="none"><rect x="1.8" y="2.6" width="8.4" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="5.6" y="6" width="8.6" height="7.4" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg><span>已选中 ${list.length} 个组件</span></div>
      <div class="insp-pos">拖动任一组件可整体移动 · Ctrl / Shift + 点击可增减</div>
    </div>
    <div class="sect">
      <div class="sect-t">选中的组件</div>
      <div class="ms-list">${list
        .map(
          (e) => `<div class="ms-row" data-id="${e.id}">
            ${icon(e.type)}<span class="ms-name">${E(labelOf(e))}</span>
            <span class="ms-kind">${typeLabel(e.type) || ''}</span>
          </div>`
        )
        .join('')}</div>
    </div>
    <div class="sect act-sect">
      <div class="row2">
        <button class="btn sm violet" data-act="group-selected">组合为分组框</button>
        <button class="btn sm ghost" data-act="ms-cancel">取消选择</button>
      </div>
      <div class="row2" style="margin-top:6px">
        <button class="btn sm danger" data-act="ms-del">删除所选</button>
      </div>
      <p class="fld-h">选中多个组件后可组合成分组框：拖动分组框标题会带着子组件一起移动；删除分组框不会删除子组件。</p>
    </div>`;
  }

  function emptyInspector() {
    return `<div class="insp-empty">
      <div class="insp-empty-icon">◎</div>
      <div class="insp-empty-t">未选中组件</div>
      <p>点击画布上的任意组件查看属性；<br>双击文字可直接编辑。</p>
      <div class="tip-list">
        <div><kbd>左键</kbd> 拖空白处 框选多个组件</div>
        <div><kbd>空格</kbd> + 拖动 平移画布</div>
        <div><kbd>Ctrl</kbd> + 滚轮 缩放</div>
        <div><kbd>F</kbd> 适应整页 · <kbd>0</kbd> 100%</div>
      </div>
    </div>`;
  }

  function header(e) {
    return `<div class="insp-head">
      <div class="insp-type">${icon(e.type)}<span>${typeLabel(e.type)}</span></div>
      <div class="insp-pos">x ${Math.round(e.x)} · y ${Math.round(e.y)}${e.w ? ' · w ' + Math.round(e.w) : ''}</div>
    </div>`;
  }

  function field(label, inner, hint) {
    return `<label class="fld"><span class="fld-l">${label}</span>${inner}${hint ? `<span class="fld-h">${hint}</span>` : ''}</label>`;
  }
  const input = (path, val, ph) =>
    `<input class="ipt" data-path="${path}" value="${E(val == null ? '' : val)}" placeholder="${E(ph || '')}">`;
  const area = (path, val, rows) =>
    `<textarea class="ipt ta" rows="${rows || 3}" data-path="${path}">${E(val || '')}</textarea>`;
  const select = (path, val, opts) =>
    `<select class="ipt sel" data-path="${path}">${opts
      .map((o) => `<option value="${o[0]}" ${o[0] === val ? 'selected' : ''}>${o[1]}</option>`)
      .join('')}</select>`;
  const TONES = [['violet', '紫'], ['mint', '青'], ['amber', '橙'], ['pink', '粉'], ['blue', '蓝']];

  /* ---------- P2/P3 节点管理器 ---------- */
  function advNodeManager(e, coll, fields, hint, addLabel) {
    const list = Array.isArray(e[coll]) ? e[coll] : [];
    const rows = list.map((item, i) =>
      `<div class="adv-nrow" data-adv-row="${i}">` +
      `<div class="adv-nrow-head"><span class="adv-num">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="adv-nrow-kind">${E((item && (item.title || item.label || item.date)) || '未命名')}</span>` +
      `<button class="mini-btn" type="button" data-act="adv-up" data-coll="${coll}" data-idx="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>` +
      `<button class="mini-btn" type="button" data-act="adv-down" data-coll="${coll}" data-idx="${i}" title="下移" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>` +
      `<button class="mini-btn danger" type="button" data-act="adv-del" data-coll="${coll}" data-idx="${i}" title="删除">×</button></div>` +
      `<div class="adv-nrow-fields">` +
      fields.map((fd) =>
        `<label class="adv-mini"><span>${E(fd.label)}</span>` +
        `<input class="ipt ${fd.type === 'number' ? 'num' : ''}" data-path="${coll}.${i}.${fd.key}"${fd.type === 'number' ? ' type="number" min="0" max="100" step="1"' : ''} value="${E(item && item[fd.key] != null ? item[fd.key] : '')}" placeholder="${E(fd.ph || '')}">` +
        `</label>`
      ).join('') +
      `</div></div>`
    ).join('');
    return (
      `<div class="adv-manager">` +
      (rows || `<div class="adv-empty-panel">还没有节点</div>`) +
      `<button class="btn wide ghost adv-add-btn" type="button" data-act="adv-add" data-coll="${coll}">＋ ${E(addLabel || '添加节点')}</button>` +
      (hint ? `<p class="fld-h">${hint}</p>` : '') +
      `</div>`
    );
  }

  function advPanel(e) {
    if (e.type === 'timeline') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('方向', select('orientation', e.orientation || 'h', [['h', '横向'], ['v', '纵向']]))}
        ${field('强调色', select('tone', e.tone || 'blue', TONES))}
      </div>
      <div class="sect">
        <div class="sect-t">节点 <span class="dim">${(e.nodes || []).length} 个 · 建议 3–6 个</span></div>
        ${advNodeManager(e, 'nodes', [
          { key: 'date', label: '时间 / 阶段', ph: '01 初见' },
          { key: 'title', label: '标题', ph: '进入世界' },
          { key: 'note', label: '说明', ph: '第一眼看到什么' },
        ], '用上移/下移调整旅程顺序；画布上的日期、标题、说明都能直接改。', '添加节点')}
      </div>`;
    }
    if (e.type === 'cycle') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('中心标签', input('center', e.center, '留存'))}
        ${field('强调色', select('tone', e.tone || 'violet', TONES))}
      </div>
      <div class="sect">
        <div class="sect-t">循环节点 <span class="dim">${(e.nodes || []).length} 个 · 建议 3–6 个</span></div>
        ${advNodeManager(e, 'nodes', [
          { key: 'label', label: '节点名', ph: '探索' },
          { key: 'note', label: '说明', ph: '发现内容' },
        ], '箭头按节点顺序首尾相接；中心标签写循环最终留下的东西。', '添加节点')}
      </div>`;
    }
    if (e.type === 'hierarchy') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('形态', select('style', e.style || 'pyramid', [['pyramid', '金字塔（上窄下宽）'], ['layers', '分层条（等宽）']]))}
        ${field('强调色', select('tone', e.tone || 'blue', TONES))}
      </div>
      <div class="sect">
        <div class="sect-t">层级 <span class="dim">${(e.nodes || []).length} 层 · 建议 3–5 层</span></div>
        ${advNodeManager(e, 'nodes', [
          { key: 'label', label: '层级名', ph: '世界' },
          { key: 'note', label: '说明', ph: '开放地图与视觉奇观' },
        ], '第一层在金字塔顶端；画布里的层级名和说明可直接改。', '添加层级')}
      </div>`;
    }
    if (e.type === 'matrix') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        <div class="row2">
          ${field('横轴', input('xLabel', e.xLabel, '玩家价值 →'))}
          ${field('纵轴', input('yLabel', e.yLabel, '实现成本 ↑'))}
        </div>
        ${field('网格色', select('tone', e.tone || 'blue', TONES))}
      </div>
      <div class="sect">
        <div class="sect-t">四象限标签</div>
        <div class="row2">
          ${field('右上', input('quadrants.tr', (e.quadrants || {}).tr, '重点投入'))}
          ${field('左上', input('quadrants.tl', (e.quadrants || {}).tl, '谨慎评估'))}
        </div>
        <div class="row2">
          ${field('右下', input('quadrants.br', (e.quadrants || {}).br, '快速试点'))}
          ${field('左下', input('quadrants.bl', (e.quadrants || {}).bl, '暂缓'))}
        </div>
      </div>
      <div class="sect">
        <div class="sect-t">点位 <span class="dim">${(e.points || []).length} 个 · 坐标 0–100</span></div>
        ${advNodeManager(e, 'points', [
          { key: 'label', label: '标签', ph: '换装拍照' },
          { key: 'x', label: 'X / 价值', type: 'number', ph: '72' },
          { key: 'y', label: 'Y / 成本', type: 'number', ph: '38' },
        ], 'X 向右增大，Y 向上增大；画布里点位会按坐标实时移动。', '添加点位')}
      </div>`;
    }
    if (e.type === 'compare') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('强调色', select('tone', e.tone || 'blue', TONES))}
      </div>
      <div class="sect">
        <div class="sect-t">A 栏 <span class="dim">原方案 / 改前</span></div>
        ${field('小标题', input('left.title', (e.left || {}).title, '原方案'))}
        ${field('内容', area('left.html', U.htmlToText((e.left || {}).html), 5), '回车分段；画布里的 A 栏文字可直接改')}
      </div>
      <div class="sect">
        <div class="sect-t">B 栏 <span class="dim">改版 / 竞品</span></div>
        ${field('小标题', input('right.title', (e.right || {}).title, '改版方案'))}
        ${field('内容', area('right.html', U.htmlToText((e.right || {}).html), 5), '回车分段；画布里的 B 栏文字可直接改')}
      </div>
      <div class="sect">
        ${field('底部结论', input('verdict', e.verdict, '一句话说明差异意味着什么'))}
      </div>`;
    }
    if (e.type === 'columns') {
      const cols = Array.isArray(e.cols) ? e.cols : [];
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('栏数', select('__cols_count', String(cols.length || 2), [['2', '两栏'], ['3', '三栏']]))}
        ${field('强调色', select('tone', e.tone || 'slate', TONES))}
      </div>` +
      cols.map((c, i) => `<div class="sect">
        <div class="sect-t">第 ${i + 1} 栏</div>
        ${field('小标题', input(`cols.${i}.title`, c.title, '栏目名'))}
        ${field('内容', area(`cols.${i}.html`, U.htmlToText(c.html), 4), '回车分段；画布可直接改')}
      </div>`).join('');
    }
    if (e.type === 'video') {
      const src = String(e.src || '');
      const local = /^data:/i.test(src);
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('视频 URL', input('src', local ? '' : src, 'https://… / .mp4 / .webm'))}
        <div class="row2">
          <button class="btn sm violet" data-act="pick-video">上传本地媒体</button>
          <button class="btn sm ghost" data-act="clear-video">清除媒体</button>
        </div>
        <p class="fld-h">${local ? '已使用本地媒体（data URL），建议 ≤ 2MB 以保证保存稳定。' : '本地文件会嵌入文档；较大的视频请使用 URL，避免工程文件过大。'}</p>
        ${field('封面 URL', input('poster', e.poster, '可选，视频加载前显示'))}
        <div class="row2">
          ${field('填充', select('fit', e.fit || 'cover', [['cover', '填满裁切'], ['contain', '完整显示']]))}
          ${field('循环', select('loop', e.loop ? 'on' : 'off', [['off', '不循环'], ['on', '循环播放']]))}
        </div>
        ${field('说明', input('caption', e.caption, '记录镜头 / 动效 / 反馈'))}
        <p class="fld-h">视频默认只加载元数据，不自动播放；点击画布上的播放键才会播放。</p>
      </div>`;
    }
    if (e.type === 'semantic') {
      const V = { insight: '观点 · 我的判断', evidence: '证据 · 支撑材料', conclusion: '结论 · 意味着什么', question: '问题 · 待验证' };
      return `<div class="sect">
        ${field('类型', select('variant', e.variant || 'insight', Object.keys(V).map((k) => [k, V[k]])))}
        ${field('标题', input('title', e.title, '核心判断'))}
        ${field('正文', area('body', e.body, 5), '观点要能被反驳；证据要能指认；结论要能被使用。')}
        ${field('出处', input('source', e.source, '— 体验观察 / 访谈记录'))}
        <p class="fld-h">四种预设会自动切换强调色和引导问题，方便把“判断”和“证据”分开。</p>
      </div>`;
    }
    if (e.type === 'group') {
      const members = (window.Groups ? Groups.memberIds(e) : (e.members || []));
      return `<div class="sect">
        ${field('分组标题', input('title', e.title, '系统分组'))}
        ${field('强调色', select('tone', e.tone || 'slate', [['slate', '灰 · 容器'], ['violet', '紫'], ['mint', '青'], ['amber', '橙'], ['pink', '粉'], ['blue', '蓝']]))}
        <p class="fld-h">拖动分组框标题会整体移动 ${members.length} 个子组件；删除分组框不会删除子组件。</p>
      </div>
      <div class="sect">
        <div class="sect-t">子组件 <span class="dim">${members.length} 个</span></div>
        ${members.length
          ? `<div class="grp-members">${members.map((id) => {
              const me = Store.el(id);
              return `<div class="grp-member"><span>${E(Groups.labelOfMember(id))}</span><small>${E(me ? (typeLabel(me.type) || me.type) : '已删除')}</small><button class="mini-btn danger" type="button" data-act="group-remove" data-id="${id}" title="移出分组">×</button></div>`;
            }).join('')}</div>`
          : `<p class="fld-h">空分组。选中多个组件后，在右侧属性面板点「组合为分组框」即可把它们装进来。</p>`}
        <button class="btn wide ghost" data-act="group-sync">按内容重新适配边界</button>
      </div>`;
    }
    return '';
  }

  function body(e) {
    if (e.type === 'heading') {
      return `<div class="sect">
        ${field('眉标（小节编号）', input('kicker', e.kicker, '01 / 循环层'))}
        ${field('标题', input('text', e.text))}
        ${field('层级', select('level', e.level, [[1, '一级标题'], [2, '二级标题']]))}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'text') {
      return `<div class="sect">
        ${field('版式', select('variant', e.variant, [['body', '正文'], ['quote', '引言 / 结论']]))}
        ${field('内容', area('html', U.htmlToText(e.html), 8), '回车分段；画布内双击可富文本编辑')}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'note') {
      return `<div class="sect">
        ${field('色调', select('tone', e.tone, [['idea', '紫 · 观点'], ['risk', '橙 · 风险'], ['todo', '粉 · 待办'], ['data', '青 · 数据']]))}
        ${field('标题', input('title', e.title))}
        ${field('内容', area('html', U.htmlToText(e.html), 5))}
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
      </div>`;
    }
    if (e.type === 'list') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('样式', select('__ordered', e.ordered ? 'on' : 'off', [['off', '圆点列表'], ['on', '编号列表']]))}
        ${field('条目', area('__list_text', (e.items || []).join('\n'), 6), '一行一条；双击画布里的单条也能直接改')}
        <button class="btn wide violet" data-act="edit-window">打开条目编辑器…</button>
      </div>`;
    }
    if (e.type === 'quote') {
      return `<div class="sect">
        ${field('引文', area('text', e.text, 4), '建议 1–2 句，直接双击画布也能改')}
        ${field('出处', input('by', e.by, '— 拆解结论 / 来源'))}
        ${field('强调色', select('tone', e.tone || 'violet', TONES))}
        <button class="btn wide violet" data-act="edit-window">打开引用编辑器…</button>
      </div>`;
    }
    if (e.type === 'divider') {
      return `<div class="sect">
        ${field('小标签', input('label', e.label, 'SECTION 01；留空则只显示线条'))}
        ${field('强调色', select('tone', e.tone || 'violet', TONES))}
        <button class="btn wide violet" data-act="edit-window">打开分隔线编辑器…</button>
      </div>`;
    }
    if (e.type === 'metric') {
      return `<div class="sect">
        ${field('指标名', input('label', e.label))}
        <div class="row2">
          ${field('数值', input('value', e.value, '42'))}
          ${field('单位', input('unit', e.unit, '% / h / 次'))}
        </div>
        ${field('注释', input('note', e.note, '对比、口径或时间范围'))}
        ${field('强调色', select('tone', e.tone || 'violet', TONES))}
        <button class="btn wide violet" data-act="edit-window">打开指标编辑器…</button>
      </div>`;
    }
    if (e.type === 'rating') {
      const max = Math.max(1, Number(e.max) || 5);
      return `<div class="sect">
        ${field('标题', input('label', e.label))}
        <div class="row2">
          ${field('当前分', `<input class="ipt num" type="number" data-path="value" min="0" max="${max}" step="1" value="${Number(e.value) || 0}">`)}
          ${field('满分', `<input class="ipt num" type="number" data-path="max" min="1" max="20" step="1" value="${max}">`)}
        </div>
        ${field('备注', input('note', e.note, '评估口径 / 待验证点'))}
        ${field('强调色', select('tone', e.tone || 'violet', TONES))}
        <button class="btn wide violet" data-act="edit-window">打开评分编辑器…</button>
      </div>`;
    }
    if (e.type === 'source') {
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('链接', input('url', e.url, 'https://…'))}
        ${field('备注', area('note', e.note, 3), '记录截图、访谈或版本信息')}
        <p class="fld-h">链接以文本形式保留，避免在画布拖动时误触打开；需要打开时从面板复制。</p>
        <button class="btn wide violet" data-act="edit-window">打开来源编辑器…</button>
      </div>`;
    }
    if ({ timeline: 1, cycle: 1, hierarchy: 1, matrix: 1, compare: 1, columns: 1, video: 1, semantic: 1, group: 1 }[e.type]) {
      return `<button class="btn wide violet adv-open-btn" data-act="edit-window">打开完整编辑窗口…</button>` + advPanel(e);
    }
    if (e.type === 'image') {
      const ms = Marks.norm(e) || [];
      const kinds = ms.reduce((m, k) => ((m[k.kind] = (m[k.kind] || 0) + 1), m), {});
      const KL = { arrow: '箭头', pen: '画笔', text: '文字', rect: '矩形', ellipse: '椭圆', mosaic: '马赛克', highlight: '高亮' };
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('说明', input('caption', e.caption))}
        <div class="row2">
          <button class="btn wide" data-act="pick-image">${e.src ? '替换图片' : '上传图片'}</button>
          <button class="btn wide ghost" data-act="reset-crop">复位裁切</button>
        </div>
        <button class="btn wide violet img-edit-btn" data-act="edit-image">
          <svg viewBox="0 0 14 14" fill="none"><path d="M9.2 1.8l3 3-7.4 7.4-3.6.6.6-3.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          编辑图片 · 标注
        </button>
        <p class="fld-h">打开可视化编辑器：箭头 / 画笔 / 文字 / 框选 / 马赛克 / 高亮，拖蓝色手柄可改尺寸。</p>
        ${field('缩放（裁切）', `<input type="range" class="rng" data-path="zoom" min="1" max="3" step="0.02" value="${e.zoom || 1}">`)}
        <div class="row2">
          ${field('水平偏移', `<input type="range" class="rng" data-path="ox" min="-50" max="50" step="1" value="${e.ox || 0}">`)}
          ${field('垂直偏移', `<input type="range" class="rng" data-path="oy" min="-50" max="50" step="1" value="${e.oy || 0}">`)}
        </div>
        <div class="row2">
          ${field('图片填充', select('fit', e.fit, [['contain', '完整显示'], ['cover', '填满裁切']]))}
          ${field('圆角', `<input type="range" class="rng" data-path="radius" min="0" max="30" step="1" value="${e.radius == null ? 14 : e.radius}">`)}
        </div>
        ${field('投影', select('shadow', e.shadow === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
      </div>
      <div class="sect">
        <div class="sect-t">标注 <span class="dim">${ms.length} 条</span>
          <button class="mini-btn" data-act="edit-image" title="打开编辑器">＋</button>
        </div>
        ${
          ms.length
            ? `<div class="mark-sum">${Object.keys(kinds)
                .map((k) => `<span class="mark-pill">${KL[k] || k} ${kinds[k]}</span>`)
                .join('')}</div>
               <button class="btn wide ghost" data-act="clear-marks">清除全部标注</button>`
            : `<p class="fld-h">还没有标注。点上面的「编辑图片」可以直接在图上画箭头、加文字。</p>`
        }
      </div>`;
    }
    if (e.type === 'table') {
      const s = Tables.size(e);
      const act = Tables.activeCell();
      const cur = act && act.id === e.id ? act : { r: e.header === false ? 0 : Math.min(1, s.rows - 1), c: 0 };
      const rr = Math.min(Math.max(0, cur.r), s.rows - 1);
      const cc = Math.min(Math.max(0, cur.c), s.cols - 1);
      const val = (e.rows[rr] && e.rows[rr][cc]) || '';
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('说明（表下小字）', input('caption', e.caption, '可留空'))}
        <button class="btn wide violet" data-act="edit-window">打开表格编辑窗口…</button>
        <div class="row2">
          ${field('首行表头', select('header', e.header === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
          ${field('斑马纹', select('zebra', e.zebra === false ? 'off' : 'on', [['on', '有'], ['off', '无']]))}
        </div>
        <div class="row2">
          ${field('行高', select('density', e.density || 'normal', [['compact', '紧凑'], ['normal', '标准'], ['loose', '宽松']]))}
          ${field('对齐', select('align', e.align || 'left', [['left', '居左'], ['center', '居中'], ['right', '居右']]))}
        </div>
        <div class="row2">
          ${field('列宽', select('__widths', Tables.widthMode(e), [['auto', '自动'], ['even', '等宽'], ['first', '首列加宽']]))}
          ${field('首列强调', select('firstCol', e.firstCol ? 'on' : 'off', [['on', '加粗'], ['off', '不强调']]))}
        </div>
      </div>
      <div class="sect">
        <div class="sect-t">单元格 <span class="dim">R${rr + 1} · C${cc + 1} / 共 ${s.rows}×${s.cols}</span></div>
        ${field('内容', area(`rows.${rr}.${cc}`, val, 3), '画布内双击格子也能直接改；Tab 下一格 · Enter 下一行')}
        <div class="tbl-ops">
          <button class="btn sm ghost" data-act="row-above">上方插入行</button>
          <button class="btn sm ghost" data-act="row-below">下方插入行</button>
          <button class="btn sm ghost" data-act="col-left">左侧插入列</button>
          <button class="btn sm ghost" data-act="col-right">右侧插入列</button>
          <button class="btn sm danger" data-act="row-del">删除本行</button>
          <button class="btn sm danger" data-act="col-del">删除本列</button>
        </div>
        <p class="fld-h">点画布里的任一格子可切换当前单元格，行列操作都作用在它上面。</p>
      </div>`;
    }
    if (e.type === 'state') {
      const selId = Canvas.getSelNode() || (e.nodes[0] && e.nodes[0].id);
      const node = e.nodes.find((n) => n.id === selId);
      const outs = (e.edges || []).filter((x) => x.from === selId).length;
      const ins = (e.edges || []).filter((x) => x.to === selId).length;
      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        ${field('说明', input('caption', e.caption, '可选'))}
        <div class="sect-t">状态 <span class="dim">${e.nodes.length}</span>
          <button class="mini-btn" data-act="add-state" title="新增状态">＋</button>
        </div>
        <div class="node-list">
          ${e.nodes
            .map(
              (n, i) => `<div class="node-item ${n.id === selId ? 'on' : ''}" data-nid="${n.id}">
                <span class="nd-dot ${n.kind === 'state' ? 'process' : n.kind === 'initial' ? 'start' : 'end'}"></span>
                <span class="nd-t">${E(n.name || (n.kind === 'initial' ? '初始' : n.kind === 'final' ? '结束' : '未命名'))}</span>
                <span class="nd-i">${i + 1}</span>
              </div>`
            )
            .join('')}
        </div>
        ${
          node
            ? `<div class="node-edit">
                ${field('状态名称', input('__node.name', node.name, '如：待机'))}
                ${field('备注', input('__node.note', node.note, 'entry / exit'))}
                ${field('类型', select('__node.kind', node.kind || 'state', [['state', '状态'], ['initial', '初始'], ['final', '结束']]))}
                <div class="fe-row"><span>出入</span><b>入 ${ins} · 出 ${outs}</b></div>
              </div>`
            : ''
        }
        <button class="btn wide violet" data-act="edit-window">打开编辑窗口…</button>
        <p class="fld-h">状态与转移在可视化编辑器里拖拽编辑；这里可快速改标题与状态名。</p>
      </div>`;
    }
    if (e.type === 'flowchart') {
      const sel = Canvas.getSelNode() || (e.nodes[0] && e.nodes[0].id);
      const node = e.nodes.find((n) => n.id === sel);
      const depth = {};
      const kids = {};
      e.nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
      const walk = (n, d) => { depth[n.id] = d; (kids[n.id] || []).forEach((c) => walk(c, d + 1)); };
      e.nodes.filter((n) => !n.parentId).forEach((n) => walk(n, 0));

      return `<div class="sect">
        ${field('标题', input('title', e.title))}
        <div class="sect-t">节点 <span class="dim">${e.nodes.length}</span>
          <button class="mini-btn" data-act="add-root" title="新增根节点">＋</button>
        </div>
        <div class="node-list">
          ${e.nodes
            .map(
              (n, i) => `<div class="node-item ${n.id === sel ? 'on' : ''}" data-nid="${n.id}" style="--d:${depth[n.id] || 0}">
                <span class="nd-dot ${n.kind}"></span>
                <span class="nd-t">${E(n.text || '未命名')}</span>
                ${n.label ? `<span class="nd-lb">${E(n.label)}</span>` : ''}
                <span class="nd-i">${i + 1}</span>
              </div>`
            )
            .join('')}
        </div>
        ${
          node
            ? `<div class="node-edit">
                ${field('节点文字', `<textarea class="ipt ta" rows="2" data-path="__node.text">${E(node.text)}</textarea>`)}
                ${field('节点类型', `<select class="ipt sel" data-path="__node.kind">
                  ${[['start', '开始 / 结束胶囊'], ['process', '处理步骤'], ['decision', '判断（菱形）'], ['end', '结束']]
                    .map((o) => `<option value="${o[0]}" ${o[0] === node.kind ? 'selected' : ''}>${o[1]}</option>`)
                    .join('')}
                </select>`)}
                ${node.parentId ? field('分支标签', input('__node.label', node.label, '是 / 否')) : ''}
                <div class="row3">
                  <button class="btn sm" data-act="child">＋ 子节点</button>
                  <button class="btn sm ghost" data-act="sibling">＋ 同级</button>
                  <button class="btn sm danger" data-act="del-node">删除</button>
                </div>
              </div>`
            : ''
        }
        <p class="fld-h">点击节点可在画布中被选中；布局自动计算，无需手动连线。</p>
      </div>`;
    }
    return '';
  }

  function actions(e) {
    return `<div class="sect act-sect">
      <div class="row2">
        <button class="btn sm ghost" data-act="front">置顶</button>
        <button class="btn sm ghost" data-act="back">置底</button>
      </div>
      <div class="row2">
        <button class="btn sm ghost" data-act="dup">复制副本</button>
        <button class="btn sm danger" data-act="del">删除组件</button>
      </div>
      <div class="row2">
        <label class="fld-inline"><span>X</span><input type="number" class="ipt num" data-path="x" value="${Math.round(e.x)}"></label>
        <label class="fld-inline"><span>Y</span><input type="number" class="ipt num" data-path="y" value="${Math.round(e.y)}"></label>
      </div>
    </div>`;
  }

  /* ---------------- 交互 ---------------- */
  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    if (o) o[parts[parts.length - 1]] = val;
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => Store.end('prop'), 550);
  }

  function setDeep(root, path, value) {
    const parts = path.split('.');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      if (i === parts.length - 1) {
        cur[key] = value;
        return;
      }
      if (cur[key] == null) cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[key];
    }
  }

  function advNodeDefault(e, coll) {
    if (coll === 'points') return { label: '新点位', x: 50, y: 50, tone: 'violet' };
    if (e.type === 'timeline') return { date: '新阶段', title: '新节点', note: '补充说明' };
    return { label: '新节点', note: '补充说明' };
  }

  function afterAdvance(e, focusIdx) {
    Canvas.rebuild(e.id);
    if (window.Groups) Groups.syncAll();
    refreshOutline();
    refreshInspector(true);
    if (focusIdx != null) setTimeout(() => {
      const row = inspector.querySelector(`[data-adv-row="${focusIdx}"] input`);
      if (row) { row.focus(); row.select(); }
    }, 20);
  }

  function advAction(e, act, btn) {
    const coll = btn.dataset.coll;
    const idx = Number(btn.dataset.idx);
    if (!Array.isArray(e[coll])) e[coll] = [];
    const arr = e[coll];
    if (act === 'adv-add') {
      const max = ({ cycle: 6, timeline: 6, hierarchy: 5, matrix: 10 }[e.type]) || 10;
      if (arr.length >= max) { U.toast('最多 ' + max + ' 个节点，先删掉一个再加'); return; }
      Store.begin();
      e[coll].push(advNodeDefault(e, coll));
      Store.end('advance');
      afterAdvance(e, e[coll].length - 1);
      return;
    }
    if (!Number.isInteger(idx) || !arr[idx]) return;
    if (act === 'adv-del') {
      const min = ({ cycle: 3, timeline: 3, hierarchy: 3 }[e.type]) || 1;
      if (arr.length <= min) { U.toast('至少保留 ' + min + ' 个节点'); return; }
      Store.begin();
      arr.splice(idx, 1);
      Store.end('advance');
      afterAdvance(e, Math.max(0, idx - 1));
      return;
    }
    if (act === 'adv-up' || act === 'adv-down') {
      const j = idx + (act === 'adv-up' ? -1 : 1);
      if (j < 0 || j >= arr.length) return;
      Store.begin();
      const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
      Store.end('advance');
      afterAdvance(e, j);
    }
  }

  function pickVideo(e) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'video/*,image/gif';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        U.toast('本地媒体超过 2MB，建议改用视频 URL，避免工程文件过大');
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        Store.begin();
        e.src = r.result;
        e.isGif = /gif/i.test(file.type) || /\.gif$/i.test(file.name);
        if (!e.title || e.title === '动效参考') e.title = file.name.replace(/\.[^.]+$/, '');
        Store.end('media');
        Canvas.rebuild(e.id);
        refreshInspector(true);
        U.toast('已载入本地' + (e.isGif ? ' GIF' : '视频'));
      };
      r.readAsDataURL(file);
    };
    inp.click();
  }

  function onInput(ev) {
    const t = ev.target;
    const path = t.dataset.path;
    if (!path) return;
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;
    if (!e) return;

    let val = t.type === 'number' || t.type === 'range' ? Number(t.value) : t.value;
    if (path === 'html' || /\.html$/.test(path)) val = U.textToHtml(val);
    if (path === 'shadow' || path === 'header' || path === 'zebra' || path === 'firstCol' || path === '__ordered') val = val === 'on';
    if (path === 'loop') val = val === 'on';

    if (path === '__cols_count') {
      Store.begin();
      const n = Math.min(3, Math.max(2, Number(val) || 2));
      if (!Array.isArray(e.cols)) e.cols = [];
      while (e.cols.length < n) e.cols.push({ title: '第 ' + (e.cols.length + 1) + ' 栏', html: '<p></p>' });
      if (e.cols.length > n) e.cols = e.cols.slice(0, n);
      Store.end('columns');
      Canvas.rebuild(id);
      refreshInspector(true);
      return;
    }

    if (path === '__widths') {
      Store.begin();
      Tables.widthPreset(e, val);
      Store.end('table');
      Canvas.rebuild(id);
      refreshInspector(true);
      return;
    }
    Store.begin();

    if (path === '__list_text') {
      e.items = String(val || '').split('\n').map((s) => s.trim()).filter(Boolean);
    } else if (path === '__ordered') {
      e.ordered = val;
    } else if (path.indexOf('__node.') === 0) {
      const nodeId = Canvas.getSelNode();
      const node = e.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      node[path.slice(7)] = val;
    } else {
      setDeep(e, path, val);
    }
    Canvas.rebuild(id);
    if (window.Groups) Groups.syncAll();
    refreshOutline();
    scheduleCommit();
  }

  function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;

    const msRow = ev.target.closest('.ms-row');
    if (msRow) {
      Canvas.focus(msRow.dataset.id);
      refreshInspector(true);
      return;
    }
    if (btn && btn.dataset.act === 'ms-cancel') { Canvas.select(null); return; }
    if (btn && btn.dataset.act === 'ms-del') { Canvas.removeSelection(); return; }
    if (btn && btn.dataset.act === 'group-selected') {
      const ids = (Canvas.getSelIds && Canvas.getSelIds()) || [];
      if (ids.length < 2) return;
      const groups = ids.map((x) => Store.el(x)).filter((x) => x && x.type === 'group');
      if (groups.length === 1) {
        const g = groups[0];
        const rest = ids.filter((x) => x !== g.id && (Store.el(x) || {}).type !== 'group');
        Store.begin();
        Groups.addMembers(g, rest);
        Store.end('group');
        Canvas.rebuild(g.id);
        Canvas.select(g.id);
        refreshInspector(true);
        U.toast('已加入分组：' + (g.title || '分组'));
      } else {
        const g = Groups.createFrom(ids);
        if (!g) return;
        Canvas.renderAll();
        Canvas.select(g.id);
        refreshInspector(true);
        U.toast('已组合为分组框');
      }
      return;
    }

    if (ev.target.closest('.node-item')) {
      const nid = ev.target.closest('.node-item').dataset.nid;
      Canvas.select(id, nid);
      refreshInspector(true);
      return;
    }
    if (!btn || !e) return;
    const act = btn.dataset.act;

    if (/^adv-(add|up|down|del)$/.test(act)) {
      advAction(e, act, btn);
      return;
    }
    if (act === 'pick-video') { pickVideo(e); return; }
    if (act === 'clear-video') {
      Store.begin();
      e.src = '';
      e.poster = '';
      e.isGif = false;
      Store.end('media');
      Canvas.rebuild(e.id);
      refreshInspector(true);
      return;
    }
    if (act === 'group-remove') {
      const memberId = btn.dataset.id;
      Store.begin();
      Groups.removeMember(e, memberId);
      Store.end('group');
      Canvas.rebuild(e.id);
      refreshInspector(true);
      return;
    }
    if (act === 'group-sync') {
      Canvas.renderAll();
      Canvas.select(e.id);
      refreshInspector(true);
      U.toast('已按子组件重新适配分组边界');
      return;
    }

    if (act === 'pick-image') {
      const inp = document.getElementById('file-image');
      inp.dataset.mode = 'replace';
      inp.click();
      return;
    }
    if (act === 'reset-crop') {
      Store.commit(() => { e.zoom = 1; e.ox = 0; e.oy = 0; }, 'crop');
      Canvas.rebuild(id); refreshInspector(true);
      return;
    }
    if (act === 'edit-image') {
      if (window.ImgEditor) ImgEditor.open(id);
      return;
    }
    if (act === 'add-state') {
      if (!window.SD) return;
      Store.begin();
      if (!Array.isArray(e.nodes)) e.nodes = [];
      if (!Array.isArray(e.edges)) e.edges = [];
      const geo = SD.layout(e);
      let x = Math.round(geo.bbox.x + 20);
      let y = Math.round(geo.bbox.y + geo.bbox.h + 46);
      let guard = 0;
      while (guard++ < 200) {
        const hit = geo.nodes.some((g) => Math.abs(g.x - x) < 60 && Math.abs(g.y - y) < 50);
        if (!hit) break;
        y += 56;
      }
      e.nodes.push({ id: U.uid('s'), name: '新状态', note: '', kind: 'state', x: Math.round(x), y: Math.round(y) });
      Store.end('state-add');
      Canvas.rebuild(id);
      refreshOutline();
      refreshInspector(true);
      return;
    }
    if (act === 'edit-window') {
      Canvas.openEditor(id);
      return;
    }
    if (act === 'clear-marks') {
      Store.begin();
      e.marks = [];
      delete e.annotations;
      Store.end('marks');
      Canvas.rebuild(id);
      refreshInspector(true);
      U.toast('已清除标注');
      return;
    }
    if (act === 'front') { Store.front(id); Canvas.renderAll(); refreshInspector(true); return; }
    if (act === 'back') { Store.back(id); Canvas.renderAll(); refreshInspector(true); return; }
    if (act === 'dup') {
      const c = Store.duplicate(id);
      Canvas.renderAll();
      if (c) Canvas.select(c.id);
      refreshInspector(true);
      return;
    }
    if (act === 'del') {
      Store.remove(id);
      Canvas.renderAll();
      Canvas.select(null);
      return;
    }
    if (act === 'add-root') {
      addNode(e, null, 'process');
      return;
    }
    if (act === 'child') { addNode(e, Canvas.getSelNode(), 'process'); return; }
    if (act === 'sibling') {
      const n = e.nodes.find((x) => x.id === Canvas.getSelNode());
      addNode(e, n ? n.parentId : null, n ? n.kind : 'process');
      return;
    }
    if (act === 'del-node') { deleteNode(); return; }
    if (/^(row|col)-(above|below|left|right|del)$/.test(act)) {
      tableOp(e, act);
      return;
    }
  }

  /* ---------------- 表格行列操作 ---------------- */
  function tableOp(e, act) {
    const id = e.id;
    const s0 = Tables.size(e);
    const act0 = Tables.activeCell();
    const r = act0 && act0.id === id ? act0.r : Math.max(0, s0.rows - 1);
    const c = act0 && act0.id === id ? act0.c : Math.max(0, s0.cols - 1);

    Store.begin();
    let curR = r, curC = c;
    if (act === 'row-above') curR = Tables.insertRow(e, r);
    else if (act === 'row-below') curR = Tables.insertRow(e, r + 1);
    else if (act === 'col-left') curC = Tables.insertCol(e, c);
    else if (act === 'col-right') curC = Tables.insertCol(e, c + 1);
    else if (act === 'row-del') {
      const res = Tables.deleteRow(e, r);
      if (res === false) { Store.end('table'); U.toast('至少保留一行'); return; }
      curR = Math.min(res, Tables.size(e).rows - 1);
    } else if (act === 'col-del') {
      const res = Tables.deleteCol(e, c);
      if (res === false) { Store.end('table'); U.toast('至少保留一列'); return; }
      curC = Math.min(res, Tables.size(e).cols - 1);
    }
    Store.end('table');

    const s1 = Tables.size(e);
    Tables.setActive(id, Math.min(curR, s1.rows - 1), Math.min(curC, s1.cols - 1), true);
    Canvas.rebuild(id);
    refreshInspector(true);
    refreshOutline();
  }

  /* ---------------- 流程图节点操作 ---------------- */
  function nodeIndexAfterSubtree(nodes, id) {
    const kids = {};
    nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    let last = nodes.findIndex((n) => n.id === id);
    const walk = (nid) => {
      (kids[nid] || []).forEach((c) => {
        const i = nodes.findIndex((n) => n.id === c.id);
        if (i > last) last = i;
        walk(c.id);
      });
    };
    walk(id);
    return last + 1;
  }

  function addNode(e, parentId, kind) {
    Store.begin();
    const n = { id: U.uid('n'), parentId: parentId || null, kind: kind || 'process', text: '新节点' };
    let idx = e.nodes.length;
    if (parentId) idx = nodeIndexAfterSubtree(e.nodes, parentId);
    e.nodes.splice(idx, 0, n);
    Store.end('node');
    Canvas.renderAll();
    Canvas.select(e.id, n.id);
    refreshInspector(true);
    const ta = inspector.querySelector('textarea[data-path="__node.text"]');
    if (ta) { ta.focus(); ta.select(); }
  }

  function deleteNode() {
    const id = Canvas.getSel();
    const e = id ? Store.el(id) : null;
    const nid = Canvas.getSelNode();
    if (!e || !nid) return;
    Store.begin();
    const kids = {};
    e.nodes.forEach((n) => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    const del = new Set();
    (function walk(x) { del.add(x); (kids[x] || []).forEach((c) => walk(c.id)); })(nid);
    if (del.size >= e.nodes.length) {
      Store.end('node');
      U.toast('至少保留一个节点');
      return;
    }
    e.nodes = e.nodes.filter((n) => !del.has(n.id));
    Store.end('node');
    Canvas.renderAll();
    const next = e.nodes[0];
    Canvas.select(e.id, next ? next.id : null);
    refreshInspector(true);
  }

  function focusProps(id) {
    if (id) Canvas.select(id);
    if (!inspector) return;
    inspector.scrollTop = 0;
    refreshInspector(true);
    setTimeout(() => {
      const q = inspector.querySelector('.sect input, .sect textarea, .sect select');
      if (q) q.focus();
    }, 30);
    U.toast('在右侧属性面板编辑');
  }

  return { init, refreshOutline, refreshInspector, deleteNode, focusProps, refresh: () => { refreshOutline(); refreshInspector(); } };
})();
