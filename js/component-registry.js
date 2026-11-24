/* ------------------------------------------------------------------
 *  component-registry.js — 组件目录的单一数据源
 *  组件库、新建默认值、属性面板标签都从这里取；新增类型时先登记再实现渲染。
 * ------------------------------------------------------------------ */
window.ComponentRegistry = (function () {
  const CATEGORIES = [
    {
      id: 'basic',
      name: '基础排版',
      desc: '标题、正文与要点',
      tone: 'violet',
      icon: '<path d="M3 4h10M3 7.4h10M3 10.8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    },
    {
      id: 'structure',
      name: '结构图解',
      desc: '流程、状态与关系',
      tone: 'blue',
      icon: '<rect x="5" y="2" width="6" height="3.2" rx="1.4" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="10.8" width="5.2" height="3.2" rx="1.4" stroke="currentColor" stroke-width="1.2"/><rect x="8.8" y="10.8" width="5.2" height="3.2" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M8 5.2v2.4M4.6 10.8v-2.2h6.8v2.2" stroke="currentColor" stroke-width="1.1" fill="none"/>',
    },
    {
      id: 'data',
      name: '数据呈现',
      desc: '表格、指标与评价',
      tone: 'mint',
      icon: '<rect x="2.5" y="8.2" width="2.4" height="5" rx=".8" stroke="currentColor" stroke-width="1.2"/><rect x="6.8" y="5.4" width="2.4" height="7.8" rx=".8" stroke="currentColor" stroke-width="1.2"/><rect x="11.1" y="2.5" width="2.4" height="10.7" rx=".8" stroke="currentColor" stroke-width="1.2"/>',
    },
    {
      id: 'media',
      name: '素材引用',
      desc: '截图、图片与出处',
      tone: 'pink',
      icon: '<rect x="2.3" y="3.2" width="11.4" height="9.6" rx="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M2.8 10.6l3.2-3 2.7 2.5 1.9-1.7 2.8 2.6" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="5.3" cy="6" r="1" fill="currentColor"/>',
    },
    {
      id: 'analysis',
      name: '拆解方法',
      desc: '观点、证据与结论',
      tone: 'amber',
      icon: '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2.8" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" stroke="currentColor" stroke-width="1.1"/>',
    },
    {
      id: 'layout',
      name: '布局容器',
      desc: '分组与分栏',
      tone: 'slate',
      icon: '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M8.2 2.2v11.6M2.2 8h11.6" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 2"/>',
    },
  ];

  const TYPES = [
    /* ---------------- 现有 7 个 ---------------- */
    {
      type: 'heading', label: '标题', category: 'basic', w: 720,
      desc: '章节标题与层级', keywords: ['标题', '章节', 'heading', 'h1', 'h2'],
      icon: '<path d="M4 3v10M12 3v10M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    },
    {
      type: 'text', label: '文字', category: 'basic', w: 560,
      desc: '正文段落与富文本', keywords: ['文字', '正文', '段落', 'text'],
      icon: '<path d="M3 4h10M3 7.5h10M3 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    },
    {
      type: 'note', label: '标注', category: 'basic', w: 420,
      desc: '带颜色的批注卡', keywords: ['标注', '批注', '便签', 'note'],
      icon: '<path d="M3 3.5h10v7.2L9.7 13H3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 10.5H9.6V13" stroke="currentColor" stroke-width="1.4"/>',
    },
    {
      type: 'image', label: '图片', category: 'media', w: 560,
      desc: '截图、参考图与标注', keywords: ['图片', '截图', '照片', 'image', 'img'],
      icon: '<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M3 10.4l3-2.8 2.6 2.4 1.8-1.6 2.6 2.4" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="5.6" cy="6.2" r="1" fill="currentColor"/>',
    },
    {
      type: 'flowchart', label: '流程图', category: 'structure', w: 520,
      desc: '流程、分支与节点关系', keywords: ['流程图', '流程', '分支', 'flowchart', '节点'],
      icon: '<rect x="5" y="1.8" width="6" height="3.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><rect x="5" y="10.8" width="6" height="3.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.2v2.2M8 7.4L3.4 7.4v1.6M8 7.4l4.6 0v1.6" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    },
    {
      type: 'table', label: '表格', category: 'data', w: 620,
      desc: '结构化行列数据', keywords: ['表格', '数据表', '行列', 'table'],
      icon: '<rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M2.4 6.4h11.2M2.4 9.6h11.2M6.2 6.4v6.4" stroke="currentColor" stroke-width="1.3"/>',
    },
    {
      type: 'state', label: '状态图', category: 'structure', w: 620,
      desc: '状态与转移关系', keywords: ['状态图', '状态', '状态机', 'state'],
      icon: '<circle cx="3.4" cy="8" r="1.8" fill="currentColor"/><rect x="6.6" y="3.2" width="6.6" height="3.6" rx="1.6" stroke="currentColor" stroke-width="1.3"/><rect x="6.6" y="9.2" width="6.6" height="3.6" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 8h1.2M9.9 6.9v2.2" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    },

    /* ---------------- P1 新增 6 个 ---------------- */
    {
      type: 'list', label: '列表', category: 'basic', w: 440,
      desc: '多条并列要点的清单', keywords: ['列表', '清单', '要点', 'list', 'bullet'],
      icon: '<circle cx="2.8" cy="4" r=".9" fill="currentColor"/><circle cx="2.8" cy="8" r=".9" fill="currentColor"/><circle cx="2.8" cy="12" r=".9" fill="currentColor"/><path d="M5.6 4h8M5.6 8h8M5.6 12h8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>',
    },
    {
      type: 'quote', label: '引用', category: 'basic', w: 500,
      desc: '突出核心结论或原话', keywords: ['引用', '金句', '结论', 'quote'],
      icon: '<path d="M2.6 5.8h3.3v3.1H4.2c0 1.4.4 2.2 1.7 2.8M8.1 5.8h3.3v3.1h-1.7c0 1.4.4 2.2 1.7 2.8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M2.6 5.8c0-1.5 1-2.6 2.5-2.8M8.1 5.8c0-1.5 1-2.6 2.5-2.8" stroke="currentColor" stroke-width="1.1" fill="none"/>',
    },
    {
      type: 'divider', label: '分隔线', category: 'basic', w: 680,
      desc: '章节之间的分隔与节奏', keywords: ['分隔线', '分割线', '章节', 'divider'],
      icon: '<path d="M2 8h4.2M9.8 8h4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 5.4l2.2 2.6-2.2 2.6-2.2-2.6z" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    },
    {
      type: 'metric', label: '指标卡', category: 'data', w: 240,
      desc: '关键数值与趋势', keywords: ['指标', '数值', 'kpi', '数据卡', 'metric'],
      icon: '<path d="M3 12.6V8.8M8 12.6V4.2M13 12.6V6.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2 13.4h12" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
    },
    {
      type: 'rating', label: '评分条', category: 'data', w: 320,
      desc: '评分与完成度', keywords: ['评分', '打分', '完成度', 'rating', 'score'],
      icon: '<path d="M8 2.3l1.5 3.1 3.4.5-2.5 2.4.6 3.4L8 10.1l-3 1.6.6-3.4L3.1 5.9l3.4-.5z" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    },
    {
      type: 'source', label: '来源卡', category: 'media', w: 400,
      desc: '链接、出处与参考说明', keywords: ['来源', '链接', '出处', '参考', 'source', 'link'],
      icon: '<path d="M6.6 9.4l2.8-2.8M5.2 7.4l-1.5 1.5a2.6 2.6 0 003.7 3.7l1.5-1.5M10.8 8.6l1.5-1.5a2.6 2.6 0 00-3.7-3.7L7.1 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
    },

    /* ---------------- P2 图解 5 个 ---------------- */
    {
      type: 'timeline', label: '时间轴', category: 'structure', w: 760, h: 300,
      desc: '玩家旅程、版本演进与任务节奏', keywords: ['时间轴', '时间线', '旅程', '版本', 'timeline', '节奏'],
      icon: '<path d="M3 2.6v10.8" stroke="currentColor" stroke-width="1.2"/><circle cx="3" cy="4.2" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><path d="M5.2 4.2h7.4M5.2 8h5.6M5.2 12h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    },
    {
      type: 'cycle', label: '循环图', category: 'structure', w: 520, h: 470,
      desc: '核心循环、养成回路与资源闭环', keywords: ['循环图', '循环', '回路', '闭环', 'cycle', '核心循环'],
      icon: '<path d="M3.2 6.6a4.8 4.8 0 014.8-3.1h2.6" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M9.5 1.9l2.2 1.9-2.2 1.8" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M12.8 9.4a4.8 4.8 0 01-4.8 3.1H5.4" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M6.5 14.1L4.3 12.2l2.2-1.8" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    },
    {
      type: 'hierarchy', label: '层级图', category: 'structure', w: 640, h: 400,
      desc: '五层框架、优先级与概念分层', keywords: ['层级图', '层级', '金字塔', '分层', '框架', 'hierarchy'],
      icon: '<path d="M6.4 2.2h3.2l1.2 3H5.2zM4.6 6h6.8l1.2 3H3.4zM2.8 10h10.4l1 3H1.8z" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linejoin="round"/>',
    },
    {
      type: 'matrix', label: '矩阵', category: 'structure', w: 620, h: 500,
      desc: '优先级、风险与机会判断', keywords: ['矩阵', '四象限', '象限', '优先级', '风险', 'matrix'],
      icon: '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.3" stroke="currentColor" stroke-width="1.1"/><path d="M8 2.2v11.6M2.2 8h11.6" stroke="currentColor" stroke-width=".9" stroke-dasharray="2 2"/><circle cx="10.8" cy="5" r="1.4" fill="currentColor"/><circle cx="5.2" cy="10.8" r="1.2" fill="currentColor"/>',
    },
    {
      type: 'compare', label: '对比卡', category: 'structure', w: 760, h: 330,
      desc: '方案、竞品与改前改后对照', keywords: ['对比', '对照', '方案', '竞品', '前后', 'compare', 'vs'],
      icon: '<rect x="1.8" y="3.2" width="5.2" height="9.6" rx="1.2" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="3.2" width="5.2" height="9.6" rx="1.2" stroke="currentColor" stroke-width="1.2"/><path d="M7.2 8h1.6M7.9 6.9l1.1 1.1-1.1 1.1" stroke="currentColor" stroke-width="1.1" fill="none"/>',
    },

    /* ---------------- P3 容器与高级素材 4 个 ---------------- */
    {
      type: 'group', label: '分组框', category: 'layout', w: 900, h: 520,
      desc: '把一组组件框在一起整体移动', keywords: ['分组', '分组框', '组合', '容器', 'group', '框架'],
      icon: '<rect x="1.8" y="2.2" width="12.4" height="11.6" rx="1.5" stroke="currentColor" stroke-width="1.1" stroke-dasharray="3 2"/><rect x="4.2" y="5.2" width="3.2" height="3.2" rx=".8" stroke="currentColor" stroke-width="1"/><rect x="8.6" y="5.2" width="3.2" height="3.2" rx=".8" stroke="currentColor" stroke-width="1"/><rect x="4.2" y="9.2" width="7.6" height="2.2" rx=".8" stroke="currentColor" stroke-width="1"/>',
    },
    {
      type: 'columns', label: '分栏', category: 'layout', w: 760, h: 360,
      desc: '双栏 / 三栏并排组织内容', keywords: ['分栏', '双栏', '三栏', '多栏', '布局', 'columns'],
      icon: '<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.3" stroke="currentColor" stroke-width="1.1"/><path d="M8 2.6v10.8" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 2"/>',
    },
    {
      type: 'video', label: '视频 / GIF', category: 'media', w: 600, h: 400,
      desc: '动效、镜头与交互反馈', keywords: ['视频', 'gif', '动效', '镜头', '录屏', 'video'],
      icon: '<rect x="2" y="3.2" width="12" height="9.6" rx="1.6" stroke="currentColor" stroke-width="1.2"/><path d="M6.4 6.1l4.2 1.9-4.2 1.9z" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M2.6 10.8l3-2.6 2.6 2.2 1.8-1.5 2.8 2.4" stroke="currentColor" stroke-width="1" fill="none"/>',
    },
    {
      type: 'semantic', label: '语义卡', category: 'analysis', w: 430, h: 210,
      desc: '观点、证据、结论、问题四类分析卡', keywords: ['语义卡', '观点', '证据', '结论', '问题', '分析卡', 'semantic'],
      icon: '<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M4.6 5.2h3.4M4.6 7.7h6.8M4.6 10.2h5.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="11.4" cy="5.2" r="1.2" fill="currentColor"/>',
    },
  ];

  const TYPE_MAP = {};
  TYPES.forEach((t) => { TYPE_MAP[t.type] = t; });

  function get(type) { return TYPE_MAP[type] || null; }
  function has(type) { return !!TYPE_MAP[type]; }
  function all() { return TYPES.slice(); }
  function categories() {
    return CATEGORIES.map((c) => ({
      ...c,
      types: TYPES.filter((t) => t.category === c.id),
    })).filter((c) => c.types.length);
  }
  function categoryOf(type) {
    const t = get(type);
    return t ? CATEGORIES.find((c) => c.id === t.category) || null : null;
  }

  function create(type, x, y) {
    const id = U.uid(type);
    switch (type) {
      case 'heading':
        return { id, type, x, y, w: 720, level: 2, kicker: 'NEW / 小节', text: '新的小节标题' };
      case 'text':
        return { id, type, x, y, w: 560, html: '<p>在这里写下你的拆解……</p>', variant: 'body' };
      case 'note':
        return { id, type, x, y, w: 420, tone: 'idea', title: '标注标题', html: '<p>要点说明。</p>' };
      case 'image':
        return {
          id, type, x, y, w: 560, h: 340, src: '', fit: 'contain', zoom: 1, ox: 0, oy: 0,
          radius: 14, shadow: true, title: '截图', caption: '补充说明', marks: [],
        };
      case 'flowchart':
        return { id, type, x, y, w: 520, title: '新流程图', nodes: FC.blank().nodes };
      case 'state': {
        const base = window.SD ? SD.blank() : { title: '新状态图', nodes: [], edges: [] };
        return Object.assign({ id, type, x, y, w: 620 }, base);
      }
      case 'table': {
        const base = window.Tables ? Tables.blank() : { rows: [['维度', '表现', '判断'], ['', '', ''], ['', '', '']] };
        return Object.assign({ id, type, x, y, w: 620, title: '新表格', caption: '' }, base);
      }
      case 'list':
        return {
          id, type, x, y, w: 440, title: '要点清单', ordered: false,
          items: ['第一，把玩家看见的障碍说清楚', '第二，说明服装能力如何成为钥匙', '第三，补上验证方式和风险'],
        };
      case 'quote':
        return {
          id, type, x, y, w: 500, tone: 'violet',
          text: '真正值得记住的，不是玩法列表，而是玩家为什么愿意再来一次。',
          by: '— 拆解结论',
        };
      case 'divider':
        return { id, type, x, y, w: 680, tone: 'violet', label: 'SECTION 01' };
      case 'metric':
        return {
          id, type, x, y, w: 240, tone: 'violet',
          label: '关键指标', value: '42', unit: '%', note: '相对上一版本 +12%',
        };
      case 'rating':
        return {
          id, type, x, y, w: 320, tone: 'violet',
          label: '完成度', value: 4, max: 5, note: '当前评估 · 待实机验证',
        };
      case 'source':
        return {
          id, type, x, y, w: 400,
          title: '参考来源', url: 'https://example.com', note: '补充说明：截图 / 访谈 / 版本记录',
        };
      case 'timeline':
        return {
          id, type, x, y, w: 760, title: '玩家旅程时间轴', orientation: 'h', tone: 'blue',
          nodes: [
            { date: '01 初见', title: '进入世界', note: '第一眼看到什么' },
            { date: '02 探索', title: '发现路径', note: '玩家主动走向哪里' },
            { date: '03 成长', title: '能力变化', note: '服装能力成为钥匙' },
            { date: '04 回流', title: '再次回来', note: '新的目标与牵挂' },
          ],
        };
      case 'cycle':
        return {
          id, type, x, y, w: 520, title: '核心循环', tone: 'violet', center: '留存',
          nodes: [
            { label: '探索', note: '发现内容' },
            { label: '获取', note: '拿到服装' },
            { label: '搭配', note: '形成方案' },
            { label: '验证', note: '进入关卡' },
            { label: '回流', note: '新的目标' },
          ],
        };
      case 'hierarchy':
        return {
          id, type, x, y, w: 640, title: '五层拆解框架', tone: 'blue', style: 'pyramid',
          nodes: [
            { label: '世界', note: '开放地图与视觉奇观' },
            { label: '系统', note: '服装、关卡与收集' },
            { label: '循环', note: '探索—获取—验证' },
            { label: '体验', note: '情绪与记忆点' },
            { label: '结论', note: '一句话判断' },
          ],
        };
      case 'matrix':
        return {
          id, type, x, y, w: 620, title: '机会判断矩阵', tone: 'blue',
          xLabel: '玩家价值 →', yLabel: '实现成本 ↑',
          quadrants: { tr: '重点投入', tl: '谨慎评估', br: '快速试点', bl: '暂缓' },
          points: [
            { label: '换装拍照', x: 72, y: 38, tone: 'violet' },
            { label: '联机社交', x: 58, y: 76, tone: 'amber' },
            { label: '轻量收集', x: 38, y: 28, tone: 'mint' },
          ],
        };
      case 'compare':
        return {
          id, type, x, y, w: 760, title: '两版方案对比', tone: 'blue',
          left: { title: '原方案', html: '<p>先做玩法列表，再补验证。</p>' },
          right: { title: '改版方案', html: '<p>先明确玩家障碍，再倒推系统。</p>' },
          verdict: '改版把“为什么回来”放在最前面，验证路径更清楚。',
        };
      case 'group':
        return {
          id, type, x, y, w: 420, h: 240, z: 0,
          title: '系统分组', tone: 'slate', members: [],
        };
      case 'columns':
        return {
          id, type, x, y, w: 760, title: '并排说明', tone: 'slate',
          cols: [
            { title: '核心循环', html: '<p>探索、获取、搭配、验证，形成可持续的回合。</p>' },
            { title: '体验抓手', html: '<p>视觉奇观、服装能力与关卡解法互相咬合。</p>' },
          ],
        };
      case 'video':
        return {
          id, type, x, y, w: 600, title: '动效参考', src: '', poster: '', caption: '记录镜头、动效与交互反馈',
          isGif: false, fit: 'cover', loop: false,
        };
      case 'semantic':
        return {
          id, type, x, y, w: 430, title: '核心判断', variant: 'insight',
          body: '这套系统的价值不在于内容数量，而在于让玩家愿意多试一次。',
          source: '— 体验观察',
        };
      default:
        return { id, type: 'text', x, y, w: 480, html: '<p>新组件</p>' };
    }
  }

  return { categories, all, get, has, categoryOf, create };
})();
