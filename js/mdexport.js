/* ------------------------------------------------------------------
 *  mdexport.js — 把拆解书画布导出为「给 AI 阅读和学习」的 Markdown
 *
 *  设计原则：
 *  1. 不导出画布坐标 / 层级 / 编辑器 UI，只保留内容与语义结构；
 *  2. 按「页 → 画布阅读顺序 → 组件」组织，分组框成员嵌套在分组下；
 *  3. 流程图、状态图用 Mermaid 代码块表达关系；
 *  4. 表格、时间轴、矩阵等用原生 Markdown 表格 / 列表；
 *  5. 内嵌 data/blob 媒体只保留标题与说明，远程媒体保留链接。
 * ------------------------------------------------------------------ */
window.MDExport = (function () {
  const TYPE_LABEL = {
    heading: '标题',
    text: '文字',
    note: '标注',
    image: '图片',
    flowchart: '流程图',
    table: '表格',
    state: '状态图',
    list: '列表',
    quote: '引用',
    divider: '分隔线',
    metric: '指标卡',
    rating: '评分条',
    source: '来源卡',
    timeline: '时间轴',
    cycle: '循环图',
    hierarchy: '层级图',
    matrix: '矩阵',
    compare: '对比卡',
    group: '分组框',
    columns: '分栏',
    video: '视频 / GIF',
    semantic: '语义卡',
  };

  const NOTE_TONE = { idea: '观点', risk: '风险', todo: '待办', data: '数据' };
  const SEMANTIC = {
    insight: ['观点', '我的判断是什么？'],
    evidence: ['证据', '什么支撑这个判断？'],
    conclusion: ['结论', '所以意味着什么？'],
    question: ['问题', '还需要验证什么？'],
  };
  const QUADRANT = {
    tr: '右上（高 X / 高 Y）',
    tl: '左上（低 X / 高 Y）',
    br: '右下（高 X / 低 Y）',
    bl: '左下（低 X / 低 Y）',
  };

  const clean = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const multiline = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
  const excerpt = (v, n) => {
    const s = clean(v);
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
  };

  function plain(html) {
    if (!html) return '';
    return String(U.htmlToText(html) || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function yaml(v) {
    // JSON 字符串同时是合法的 YAML 双引号字符串，能安全处理中文、引号与换行
    return JSON.stringify(String(v == null ? '' : v));
  }

  function escapeUrl(url) {
    return String(url || '').trim()
      .replace(/ /g, '%20')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E');
  }

  function isRemoteMedia(src) {
    return /^(https?:)?\/\//i.test(String(src || '').trim());
  }

  function isInlineMedia(src) {
    return /^(data:|blob:|file:)/i.test(String(src || '').trim());
  }

  /* ---------------- HTML → Markdown ---------------- */

  function inlineMd(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return node.nodeValue.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    const kids = Array.from(node.childNodes || []).map(inlineMd).join('');

    switch (tag) {
      case 'br':
        return '\n';
      case 'strong':
      case 'b': {
        const t = kids.trim();
        return t ? `**${t}**` : '';
      }
      case 'em':
      case 'i': {
        const t = kids.trim();
        return t ? `*${t}*` : '';
      }
      case 'code': {
        const t = kids.trim();
        return t ? `\`${t}\`` : '';
      }
      case 'a': {
        const href = node.getAttribute('href');
        const t = kids.trim() || href || '';
        return href ? `[${t}](${escapeUrl(href)})` : t;
      }
      case 'img':
        return clean(node.getAttribute('alt') || '');
      case 's':
      case 'del':
      case 'strike': {
        const t = kids.trim();
        return t ? `~~${t}~~` : '';
      }
      case 'u':
        return kids;
      default:
        return kids;
    }
  }

  function listMd(el) {
    const ordered = el.tagName.toLowerCase() === 'ol';
    const lines = [];
    let index = 1;

    Array.from(el.children || []).forEach((li) => {
      if (!li || li.tagName.toLowerCase() !== 'li') return;
      const clone = li.cloneNode(true);
      clone.querySelectorAll('ul, ol').forEach((n) => n.remove());
      const text = inlineMd(clone).trim();
      const prefix = ordered ? `${index++}. ` : '- ';
      if (text) lines.push(prefix + text.replace(/\n/g, '\n  '));

      Array.from(li.children || []).forEach((child) => {
        if (!child || !/^(ul|ol)$/i.test(child.tagName)) return;
        const sub = listMd(child).trim();
        if (sub) sub.split('\n').filter(Boolean).forEach((line) => lines.push('  ' + line));
      });
    });

    return lines.length ? '\n' + lines.join('\n') + '\n' : '';
  }

  function tableMdFromHtml(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children || [])
        .filter((c) => /^(td|th)$/i.test(c.tagName))
        .map((c) => inlineMd(c).trim())
    ).filter((r) => r.length);
    return rows.length ? '\n\n' + mdTable(rows) + '\n\n' : '';
  }

  function blockMd(node) {
    if (!node) return '';
    if (node.nodeType === 3) return inlineMd(node);
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (/^h[1-6]$/.test(tag)) {
      const t = inlineMd(node).trim();
      return t ? `\n\n**${t}**\n\n` : '';
    }
    if (tag === 'p') {
      const t = inlineMd(node).trim();
      return t ? `\n\n${t}\n\n` : '';
    }
    if (tag === 'ul' || tag === 'ol') return listMd(node);
    if (tag === 'blockquote') {
      const t = blockChildren(node).trim();
      return t ? '\n\n' + t.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n' : '';
    }
    if (tag === 'table') return tableMdFromHtml(node);
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'figure') {
      const t = blockChildren(node).trim();
      return t ? `\n\n${t}\n\n` : '';
    }
    return inlineMd(node);
  }

  function blockChildren(node) {
    return Array.from(node.childNodes || []).map(blockMd).join('');
  }

  function htmlToMd(html) {
    if (!html) return '';
    const host = document.createElement('div');
    host.innerHTML = String(html);
    const out = blockChildren(host);
    return out
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------------- Markdown 基础块 ---------------- */

  function mdCell(v) {
    const s = multiline(v).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    return s || '—';
  }

  function mdTable(rows) {
    const list = (rows || []).map((r) => (Array.isArray(r) ? r : []));
    if (!list.length) return '';
    const width = Math.max(1, ...list.map((r) => r.length));
    const norm = (r) => {
      const out = [];
      for (let i = 0; i < width; i++) out.push(mdCell(r[i]));
      return out;
    };
    const header = norm(list[0]);
    const body = list.slice(1).map(norm);
    const line = (cells) => '| ' + cells.join(' | ') + ' |';
    return [
      line(header),
      line(header.map(() => '---')),
      ...body.map(line),
    ].join('\n');
  }

  function quoteBlock(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    return t.split('\n').map((line) => {
      if (!line.trim()) return '>';
      const s = line.trim();
      return /^>/.test(s) ? s : `> ${s}`;
    }).join('\n');
  }

  function mermaidText(v) {
    return clean(v)
      .replace(/"/g, '&quot;')
      .replace(/:/g, '：')
      .replace(/\n/g, '<br/>') || '节点';
  }

  function stateText(v) {
    return clean(v).replace(/:/g, '：') || '';
  }

  function stateName(n, index) {
    if (n && n.kind === 'initial') return '开始';
    if (n && n.kind === 'final') return '结束';
    return clean(n && n.name) || `状态${index + 1}`;
  }

  /* ---------------- 组件标题与通用字段 ---------------- */

  function elementTitle(e) {
    switch (e.type) {
      case 'heading': return clean(e.text) || '标题';
      case 'text': return excerpt(plain(e.html), 32) || '文字段落';
      case 'note': return clean(e.title) || '标注';
      case 'image': return clean(e.title) || '图片';
      case 'flowchart': return clean(e.title) || '流程图';
      case 'table': return clean(e.title) || '表格';
      case 'state': return clean(e.title) || '状态图';
      case 'list': return clean(e.title) || '要点清单';
      case 'quote': return excerpt(e.text, 32) || '引用';
      case 'divider': return clean(e.label) || '分隔线';
      case 'metric': return clean(e.label) || '关键指标';
      case 'rating': return clean(e.label) || '评分';
      case 'source': return clean(e.title) || '参考来源';
      case 'timeline': return clean(e.title) || '时间轴';
      case 'cycle': return clean(e.title) || '循环图';
      case 'hierarchy': return clean(e.title) || '层级图';
      case 'matrix': return clean(e.title) || '矩阵';
      case 'compare': return clean(e.title) || '对比卡';
      case 'group': return clean(e.title) || '分组';
      case 'columns': return clean(e.title) || '分栏';
      case 'video': return clean(e.title) || (e.isGif ? 'GIF' : '视频');
      case 'semantic': return clean(e.title) || '核心判断';
      default: return clean(e.title) || '组件';
    }
  }

  function sectionHeading(e, depth) {
    const type = TYPE_LABEL[e.type] || '组件';
    const title = elementTitle(e);
    const hashes = '#'.repeat(Math.min(6, 3 + depth));
    if (!title || title === type) return `${hashes} ${type}`;
    return `${hashes} ${type}：${title}`;
  }

  function annotationText(e) {
    const marks = Array.isArray(e.marks) ? e.marks : [];
    const annotations = Array.isArray(e.annotations) ? e.annotations : [];
    const raw = marks.length ? marks : annotations;
    const out = [];
    raw.forEach((m) => {
      if (!m) return;
      const t = clean(m.text || m.label || '');
      if (t && !out.includes(t)) out.push(t);
    });
    return out;
  }

  function mediaLink(src, label) {
    const s = String(src || '').trim();
    if (!s) return '';
    if (isInlineMedia(s)) {
      return `**媒体说明**：内嵌本地媒体（${s.startsWith('data:') ? 'data URL' : s.startsWith('blob:') ? 'blob URL' : '本地路径'}），未随 Markdown 导出；请在原始拆解书中查看。`;
    }
    const alt = String(label || '媒体').replace(/[\[\]]/g, '');
    return `![${alt}](${escapeUrl(s)})`;
  }

  function renderHeading(e) {
    const out = [];
    const level = Number(e.level) || 2;
    out.push(`**标题层级**：H${Math.max(1, Math.min(6, level))}`);
    if (clean(e.kicker)) out.push(`**眉标**：${clean(e.kicker)}`);
    if (!clean(e.text)) out.push('**内容**：（空标题）');
    return out.join('\n\n');
  }

  function renderText(e) {
    const md = htmlToMd(e.html);
    if (e.variant === 'quote') {
      return `**版式**：引言\n\n${md ? quoteBlock(md) : '（暂无正文）'}`;
    }
    return `**版式**：正文\n\n${md || '（暂无正文）'}`;
  }

  function renderNote(e) {
    const tone = NOTE_TONE[e.tone] || '观点';
    const body = htmlToMd(e.html);
    const title = clean(e.title);
    const quote = [];
    if (title) quote.push(`**${title}**`);
    if (body) {
      if (quote.length) quote.push('');
      quote.push(body);
    }
    return `**标注类型**：${tone}\n\n${quote.length ? quoteBlock(quote.join('\n')) : '（暂无内容）'}`;
  }

  function renderImage(e) {
    const out = [];
    if (clean(e.caption)) out.push(`**说明**：${clean(e.caption)}`, '');
    const src = String(e.src || '').trim();
    if (!src) {
      out.push('**图片**：（暂无图片）');
    } else if (isInlineMedia(src)) {
      out.push(mediaLink(src, e.title || '图片'));
    } else {
      const alt = clean(e.title || '图片').replace(/[\[\]]/g, '');
      out.push(`![${alt}](${escapeUrl(src)})`);
    }
    const notes = annotationText(e);
    if (notes.length) {
      out.push('', '**标注文字**：');
      notes.forEach((n) => out.push(`- ${n}`));
    }
    return out.join('\n');
  }

  function renderFlowchart(e) {
    const nodes = Array.isArray(e.nodes) ? e.nodes.filter(Boolean) : [];
    const out = [`**节点数**：${nodes.length}`];
    if (!nodes.length) {
      out.push('（暂无流程节点）');
      return out.join('\n');
    }
    const byId = new Map();
    nodes.forEach((n, i) => {
      if (n.id) byId.set(n.id, { n, i });
    });
    out.push('', '```mermaid', 'flowchart TD');
    nodes.forEach((n, i) => {
      const text = mermaidText(n.text || `节点${i + 1}`);
      const kind = n.kind || 'process';
      if (kind === 'decision') out.push(`  n${i}{"${text}"}`);
      else if (kind === 'start' || kind === 'end') out.push(`  n${i}(["${text}"])`);
      else out.push(`  n${i}["${text}"]`);
    });
    nodes.forEach((n, i) => {
      if (!n.parentId) return;
      const parent = byId.get(n.parentId);
      if (!parent) return;
      const branch = clean(n.label);
      out.push(`  n${parent.i} -->${branch ? `|"${mermaidText(branch)}"|` : ''} n${i}`);
    });
    out.push('```');
    return out.join('\n');
  }

  function renderTable(e) {
    const rows = Array.isArray(e.rows) ? e.rows.filter(Array.isArray) : [];
    const out = [];
    if (!rows.length) return '（暂无表格数据）';
    if (e.header === false) {
      const width = Math.max(1, ...rows.map((r) => r.length));
      const head = [];
      for (let i = 0; i < width; i++) head.push(`列 ${i + 1}`);
      out.push(mdTable([head, ...rows]));
    } else {
      out.push(mdTable(rows));
    }
    if (clean(e.caption)) out.push('', `**说明**：${clean(e.caption)}`);
    return out.join('\n');
  }

  function renderState(e) {
    const nodes = Array.isArray(e.nodes) ? e.nodes.filter(Boolean) : [];
    const edges = Array.isArray(e.edges) ? e.edges.filter(Boolean) : [];
    const out = [`**状态数**：${nodes.length} · **转移数**：${edges.length}`];
    if (!nodes.length) {
      out.push('（暂无状态节点）');
      return out.join('\n');
    }

    const byId = new Map();
    nodes.forEach((n, i) => { if (n.id) byId.set(n.id, { n, i }); });

    out.push('', '```mermaid', 'stateDiagram-v2');
    nodes.forEach((n, i) => {
      const kind = n.kind || 'state';
      if (kind === 'initial' || kind === 'final') return;
      out.push(`  state "${mermaidText(n.name || `状态${i + 1}`)}" as s${i}`);
    });

    edges.forEach((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return;
      const fromRef = (from.n.kind === 'initial') ? '[*]' : `s${from.i}`;
      const toRef = (to.n.kind === 'final') ? '[*]' : `s${to.i}`;
      if (fromRef === toRef && fromRef === '[*]') return;
      const label = stateText(edge.label);
      out.push(`  ${fromRef} --> ${toRef}${label ? ` : ${label}` : ''}`);
    });
    out.push('```');

    const notes = [];
    nodes.forEach((n, i) => {
      const note = clean(n.note);
      if (note) notes.push(`- **${stateName(n, i)}**：${note}`);
    });
    if (notes.length) out.push('', '**状态备注**', notes.join('\n'));

    if (edges.length) {
      out.push('', '**转移关系**');
      edges.forEach((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return;
        const a = stateName(from.n, from.i);
        const b = stateName(to.n, to.i);
        out.push(`- ${a} → ${b}${clean(edge.label) ? `（${clean(edge.label)}）` : ''}`);
      });
    }
    return out.join('\n');
  }

  function renderList(e) {
    const items = Array.isArray(e.items) ? e.items.map(clean).filter(Boolean) : [];
    if (!items.length) return '（暂无条目）';
    const ordered = e.ordered === true;
    return items.map((item, i) => (ordered ? `${i + 1}. ${item}` : `- ${item}`)).join('\n');
  }

  function renderQuote(e) {
    const text = multiline(e.text).trim();
    const out = [];
    if (text) out.push(quoteBlock(text));
    else out.push('（暂无引文）');
    const by = clean(e.by);
    if (by) out.push(/^[—–-]/.test(by) ? by : `—— ${by}`);
    return out.join('\n\n');
  }

  function renderDivider(e) {
    return `---${clean(e.label) ? `\n\n**标签**：${clean(e.label)}` : ''}`;
  }

  function renderMetric(e) {
    const value = e.value !== '' && e.value != null ? clean(e.value) : '—';
    const out = [`**数值**：${value}${clean(e.unit) ? ` ${clean(e.unit)}` : ''}`];
    if (clean(e.note)) out.push(`**说明**：${clean(e.note)}`);
    return out.join('\n');
  }

  function renderRating(e) {
    const max = Math.max(1, Number(e.max) || 5);
    const value = Math.max(0, Math.min(max, Number(e.value) || 0));
    const pct = Math.round((value / max) * 100);
    const out = [`**评分**：${value} / ${max}（${pct}%）`];
    if (clean(e.note)) out.push(`**说明**：${clean(e.note)}`);
    return out.join('\n');
  }

  function renderSource(e) {
    const out = [];
    const url = clean(e.url);
    if (url) {
      if (/^(https?:)?\/\//i.test(url)) out.push(`**链接**：[${url}](${escapeUrl(url)})`);
      else out.push(`**链接**：${url}`);
    }
    if (clean(e.note)) out.push(`**说明**：${clean(e.note)}`);
    return out.length ? out.join('\n') : '（暂无来源信息）';
  }

  function renderTimeline(e) {
    const nodes = Array.isArray(e.nodes) ? e.nodes.filter(Boolean) : [];
    const out = [
      `**方向**：${e.orientation === 'v' ? '纵向' : '横向'}`,
      '',
    ];
    const rows = [['#', '日期 / 阶段', '节点', '说明']];
    nodes.forEach((n, i) => {
      rows.push([String(i + 1), clean(n.date) || '—', clean(n.title) || '—', clean(n.note) || '—']);
    });
    out.push(nodes.length ? mdTable(rows) : '（暂无时间轴节点）');
    return out.join('\n');
  }

  function renderCycle(e) {
    const nodes = Array.isArray(e.nodes) ? e.nodes.filter(Boolean) : [];
    const out = [`**中心**：${clean(e.center) || '—'}`];
    if (!nodes.length) return out.concat('（暂无循环节点）').join('\n');
    out.push('', '**环上节点（按顺序）**');
    nodes.forEach((n, i) => {
      out.push(`${i + 1}. **${clean(n.label) || `节点${i + 1}`}**${clean(n.note) ? ` — ${clean(n.note)}` : ''}`);
    });
    return out.join('\n');
  }

  function renderHierarchy(e) {
    const nodes = Array.isArray(e.nodes) ? e.nodes.filter(Boolean) : [];
    const out = [`**形态**：${e.style === 'layers' ? '等宽分层' : '金字塔'}`];
    const rows = [['层级', '标题', '说明']];
    nodes.forEach((n, i) => rows.push([String(i + 1), clean(n.label) || '—', clean(n.note) || '—']));
    out.push('', nodes.length ? mdTable(rows) : '（暂无层级节点）');
    return out.join('\n');
  }

  function quadrantOf(p) {
    const x = Number(p.x) || 0;
    const y = Number(p.y) || 0;
    if (x >= 50 && y >= 50) return 'tr';
    if (x < 50 && y >= 50) return 'tl';
    if (x >= 50 && y < 50) return 'br';
    return 'bl';
  }

  function renderMatrix(e) {
    const q = e.quadrants || {};
    const out = [
      `**X 轴**：${clean(e.xLabel) || 'X 轴'}`,
      `**Y 轴**：${clean(e.yLabel) || 'Y 轴'}`,
      '',
      '**象限**',
      '',
    ];
    const qRows = [['位置', '标签']];
    ['tr', 'tl', 'br', 'bl'].forEach((k) => qRows.push([QUADRANT[k], clean(q[k]) || '—']));
    out.push(mdTable(qRows));

    const points = Array.isArray(e.points) ? e.points.filter((p) => p && clean(p.label)) : [];
    out.push('', '**点位**', '');
    if (!points.length) {
      out.push('（暂无点位）');
    } else {
      const pRows = [['点位', 'X（0–100）', 'Y（0–100）', '象限']];
      points.forEach((p) => {
        const key = quadrantOf(p);
        pRows.push([
          clean(p.label),
          String(Math.round((Number(p.x) || 0) * 10) / 10),
          String(Math.round((Number(p.y) || 0) * 10) / 10),
          clean(q[key]) || QUADRANT[key],
        ]);
      });
      out.push(mdTable(pRows));
    }
    return out.join('\n');
  }

  function renderCompare(e, depth) {
    const out = [];
    const left = e.left || {};
    const right = e.right || {};
    const h = '#'.repeat(Math.min(6, 4 + (depth || 0)));
    out.push(`${h} A 栏：${clean(left.title) || '未命名'}`);
    out.push(htmlToMd(left.html) || '（暂无内容）');
    out.push(`${h} B 栏：${clean(right.title) || '未命名'}`);
    out.push(htmlToMd(right.html) || '（暂无内容）');
    if (clean(e.verdict)) out.push(`**结论**：${htmlToMd(e.verdict) || clean(e.verdict)}`);
    return out.join('\n\n');
  }

  function renderColumns(e, depth) {
    const cols = Array.isArray(e.cols) ? e.cols : [];
    const out = [`**栏数**：${cols.length}`];
    const h = '#'.repeat(Math.min(6, 4 + (depth || 0)));
    cols.forEach((col, i) => {
      out.push(`${h} 第 ${i + 1} 栏：${clean(col && col.title) || '未命名'}`);
      out.push(htmlToMd(col && col.html) || '（暂无内容）');
    });
    return out.join('\n\n');
  }

  function renderVideo(e) {
    const out = [`**媒体类型**：${e.isGif ? 'GIF' : '视频'}`];
    if (clean(e.caption)) out.push(`**说明**：${clean(e.caption)}`);
    const src = String(e.src || '').trim();
    if (!src) {
      out.push('**媒体**：（暂无视频 / GIF）');
    } else if (isInlineMedia(src)) {
      out.push(mediaLink(src, e.title || '视频'));
    } else if (isRemoteMedia(src)) {
      out.push(`**链接**：<${escapeUrl(src)}>`);
    } else {
      out.push(`**媒体路径**：${src}`);
    }
    return out.join('\n');
  }

  function renderSemantic(e) {
    const variant = SEMANTIC[e.variant] ? e.variant : 'insight';
    const label = SEMANTIC[variant][0];
    const prompt = SEMANTIC[variant][1];
    const out = [`**类型**：${label}`, `**引导问题**：${prompt}`];
    const body = htmlToMd(e.body) || clean(e.body) || '（暂无正文）';
    out.push('', body);
    if (clean(e.source)) out.push('', `**出处**：${clean(e.source)}`);
    return out.join('\n');
  }

  function renderGroup(e, depth, ctx) {
    const members = Array.isArray(e.members) ? e.members : [];
    const out = [`**成员数**：${members.length}`];
    if (!members.length) {
      out.push('（暂无成员）');
      return out.join('\n');
    }
    const children = members
      .map((id) => ctx.byId.get(id))
      .filter((m) => m && m.id && m.id !== e.id && ctx.parentOf.get(m.id) === e.id)
      .sort(ctx.sort);
    if (!children.length) {
      out.push('（成员未找到或已移动）');
      return out.join('\n');
    }
    const childOut = [];
    children.forEach((m) => {
      if (ctx.visited.has(m.id)) return;
      childOut.push(renderElement(m, depth + 1, ctx));
    });
    out.push('', childOut.join('\n\n'));
    return out.join('\n');
  }

  function renderFallback(e) {
    const skip = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'z', 'selected']);
    const out = ['**原始字段**'];
    Object.keys(e).forEach((k) => {
      if (skip.has(k)) return;
      const v = e[k];
      if (v == null || v === '') return;
      const text = typeof v === 'object' ? JSON.stringify(v) : clean(v);
      if (text) out.push(`- **${k}**：${text}`);
    });
    return out.length > 1 ? out.join('\n') : '（暂无内容）';
  }

  function renderElement(e, depth, ctx) {
    if (!e) return '';
    if (e.id && ctx.visited.has(e.id)) return '';
    if (e.id) ctx.visited.add(e.id);

    const head = sectionHeading(e, depth || 0);
    let body = '';
    switch (e.type) {
      case 'heading': body = renderHeading(e); break;
      case 'text': body = renderText(e); break;
      case 'note': body = renderNote(e); break;
      case 'image': body = renderImage(e); break;
      case 'flowchart': body = renderFlowchart(e); break;
      case 'table': body = renderTable(e); break;
      case 'state': body = renderState(e); break;
      case 'list': body = renderList(e); break;
      case 'quote': body = renderQuote(e); break;
      case 'divider': body = renderDivider(e); break;
      case 'metric': body = renderMetric(e); break;
      case 'rating': body = renderRating(e); break;
      case 'source': body = renderSource(e); break;
      case 'timeline': body = renderTimeline(e); break;
      case 'cycle': body = renderCycle(e); break;
      case 'hierarchy': body = renderHierarchy(e); break;
      case 'matrix': body = renderMatrix(e); break;
      case 'compare': body = renderCompare(e, depth || 0); break;
      case 'group': body = renderGroup(e, depth || 0, ctx); break;
      case 'columns': body = renderColumns(e, depth || 0); break;
      case 'video': body = renderVideo(e); break;
      case 'semantic': body = renderSemantic(e); break;
      default: body = renderFallback(e);
    }
    return body ? `${head}\n\n${body}` : head;
  }

  /* ---------------- 排序与文档结构 ---------------- */

  function readingSort(a, b) {
    const ay = Number(a.y) || 0;
    const by = Number(b.y) || 0;
    if (Math.abs(ay - by) > 0.5) return ay - by;
    const ax = Number(a.x) || 0;
    const bx = Number(b.x) || 0;
    return ax - bx;
  }

  function stats(doc) {
    const boards = (doc && Array.isArray(doc.boards)) ? doc.boards : [];
    const all = boards.flatMap((b) => (b && Array.isArray(b.elements) ? b.elements : [])).filter(Boolean);
    const types = [];
    all.forEach((e) => {
      if (e.type && !types.includes(e.type)) types.push(e.type);
    });
    return { boards: boards.length, components: all.length, types };
  }

  function frontmatter(doc, boards, all, types) {
    const title = clean(doc && doc.title) || '未命名拆解书';
    const lines = ['---'];
    lines.push(`title: ${yaml(title)}`);
    lines.push('format: "markdown-for-ai"');
    lines.push('format_version: 1');
    lines.push(`generator: ${yaml('析境 · 可视化拆解工作台')}`);
    lines.push(`exported_at: ${yaml(new Date().toISOString())}`);
    lines.push(`exported_at_local: ${yaml(localStamp())}`);
    lines.push('timezone: "Asia/Shanghai"');
    lines.push(`board_count: ${boards.length}`);
    lines.push(`component_count: ${all.length}`);
    lines.push(`component_types: [${types.join(', ')}]`);
    lines.push(`media_policy: ${yaml('远程媒体保留链接；内嵌本地媒体仅保留标题与说明，不展开 data/blob。')}`);
    lines.push('boards:');
    boards.forEach((b, i) => {
      const name = clean(b && b.name) || `第 ${i + 1} 页`;
      const count = (b && Array.isArray(b.elements)) ? b.elements.length : 0;
      lines.push(`  - index: ${i + 1}`);
      lines.push(`    name: ${yaml(name)}`);
      lines.push(`    components: ${count}`);
    });
    lines.push('---');
    return lines.join('\n');
  }

  function renderBoard(board, index, ctx) {
    const name = clean(board && board.name) || `第 ${index + 1} 页`;
    const elements = (board && Array.isArray(board.elements)) ? board.elements : [];
    const roots = elements
      .filter((e) => e && e.id)
      .filter((e) => !ctx.parentOf.has(e.id))
      .sort(readingSort);

    const out = [`## 第 ${index + 1} 页 · ${name}`, `**本页组件数**：${elements.length}`];
    if (!elements.length) {
      out.push('（本页暂无组件）');
      return out.join('\n\n');
    }
    const sections = roots.map((e) => renderElement(e, 0, ctx)).filter(Boolean);
    // 理论上不应该出现未挂到 root 的元素；这里兜底，确保内容不丢失
    elements.forEach((e) => {
      if (!e || !e.id || ctx.visited.has(e.id)) return;
      sections.push(renderElement(e, 0, ctx));
    });
    out.push(sections.join('\n\n'));
    return out.join('\n\n');
  }

  function build(doc) {
    const boards = (doc && Array.isArray(doc.boards)) ? doc.boards : [];
    const all = boards.flatMap((b) => (b && Array.isArray(b.elements) ? b.elements : [])).filter(Boolean);
    const types = [];
    all.forEach((e) => { if (e.type && !types.includes(e.type)) types.push(e.type); });

    const byId = new Map();
    all.forEach((e) => { if (e && e.id) byId.set(e.id, e); });
    const parentOf = new Map();
    all.forEach((e) => {
      if (!e || e.type !== 'group' || !Array.isArray(e.members)) return;
      e.members.forEach((id) => {
        if (!id || id === e.id || !byId.has(id) || parentOf.has(id)) return;
        parentOf.set(id, e.id);
      });
    });

    const ctx = {
      byId,
      parentOf,
      visited: new Set(),
      sort: readingSort,
    };

    const title = clean(doc && doc.title) || '未命名拆解书';
    const out = [];
    out.push(frontmatter(doc || {}, boards, all, types));
    out.push(`# ${title}`);
    out.push(`**文档规模**：${boards.length} 页 / ${all.length} 个组件 / ${types.length} 种组件类型`);
    out.push(
      '## AI 阅读说明\n\n' +
      '- **组织方式**：按「页 → 画布从上到下、从左到右 → 组件」阅读；组件标题前的词是组件类型。\n' +
      '- **分组框**：分组框成员嵌套在分组标题下，不再作为独立顶层组件重复出现。\n' +
      '- **流程图 / 状态图**：关系用 Mermaid 代码块表达；节点文字就是图上的标签。\n' +
      '- **矩阵**：X / Y 是 0–100 的归一化坐标；象限标签与点位分别列出。\n' +
      '- **表格 / 时间轴 / 层级图**：使用原生 Markdown 表格；单元格内换行转为 `<br>`。\n' +
      '- **媒体**：远程图片 / 视频保留链接；内嵌 data/blob 媒体只保留标题和说明，避免 Markdown 体积膨胀。\n' +
      '- **坐标说明**：除矩阵点位外，画布坐标、组件宽高、缩放、阴影等视觉参数均已省略。'
    );

    const toc = ['## 目录', ''];
    if (!boards.length) {
      toc.push('- （暂无画布）');
    } else {
      boards.forEach((b, i) => {
        const name = clean(b && b.name) || `第 ${i + 1} 页`;
        const count = (b && Array.isArray(b.elements)) ? b.elements.length : 0;
        toc.push(`- 第 ${i + 1} 页 · ${name}（${count} 个组件）`);
      });
    }
    out.push(toc.join('\n'));

    boards.forEach((b, i) => {
      out.push(renderBoard(b || {}, i, ctx));
    });

    out.push('## 导出信息\n\n' +
      `- **导出时间**：${localStamp()}\n` +
      '- **用途**：可直接交给 AI 解析、总结、检索或作为学习资料。\n' +
      '- **保真原则**：优先保留文字、层级、顺序与关系；省略纯视觉参数。');

    return out.filter(Boolean).join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  return { build, stats, TYPE_LABEL };
})();
