/* ------------------------------------------------------------------
 *  groups.js — 分组框的边界、成员与整体移动
 *  · 分组框本身是一个低层级容器组件，成员仍是独立组件
 *  · 拖动分组标题时由 Canvas 调 expand() 把成员一起移动
 *  · 删除分组只删除容器，不删除成员
 * ------------------------------------------------------------------ */
window.Groups = (function () {
  const PAD = { l: 24, t: 54, r: 24, b: 26 };
  const EMPTY_W = 420, EMPTY_H = 240;

  function memberIds(g) {
    return (Array.isArray(g && g.members) ? g.members : []).filter((id) => Store.el(id));
  }

  function nodeOf(id) {
    return document.querySelector(`.el[data-id="${id}"]`);
  }

  function boxOf(e) {
    const n = nodeOf(e.id);
    return {
      x: Number(e.x) || 0,
      y: Number(e.y) || 0,
      w: (n && n.offsetWidth) || Number(e.w) || 220,
      h: (n && n.offsetHeight) || Number(e.h) || 120,
    };
  }

  function boundsOf(ids) {
    const boxes = ids.map((id) => Store.el(id)).filter(Boolean).map(boxOf);
    if (!boxes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    boxes.forEach((b) => {
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    });
    return {
      x: Math.round(x1 - PAD.l),
      y: Math.round(y1 - PAD.t),
      w: Math.round(x2 - x1 + PAD.l + PAD.r),
      h: Math.round(y2 - y1 + PAD.t + PAD.b),
    };
  }

  function sync(g) {
    if (!g || g.type !== 'group') return;
    const ids = memberIds(g);
    if (!ids.length) {
      if (!g.w) g.w = EMPTY_W;
      if (!g.h) g.h = EMPTY_H;
      return;
    }
    const b = boundsOf(ids);
    if (!b) return;
    g.x = b.x; g.y = b.y; g.w = b.w; g.h = b.h;
    const n = nodeOf(g.id);
    if (n) {
      n.style.left = g.x + 'px';
      n.style.top = g.y + 'px';
      n.style.width = g.w + 'px';
      n.style.height = g.h + 'px';
    }
  }

  function syncAll() {
    const doc = Store.get();
    if (!doc) return;
    (doc.elements || []).forEach((e) => { if (e.type === 'group') sync(e); });
  }

  function flatten(ids) {
    const out = [];
    const add = (id) => {
      const e = Store.el(id);
      if (!e || out.indexOf(id) >= 0) return;
      if (e.type === 'group') {
        memberIds(e).forEach(add);
      } else {
        out.push(id);
      }
    };
    (ids || []).forEach(add);
    return out;
  }

  /** 选中分组时把成员一起纳入拖动；返回真正要移动的元素 id */
  function expand(ids) {
    const out = [];
    (ids || []).forEach((id) => {
      const e = Store.el(id);
      if (!e) return;
      if (out.indexOf(id) < 0) out.push(id);
      if (e.type === 'group') {
        memberIds(e).forEach((mid) => { if (out.indexOf(mid) < 0) out.push(mid); });
      }
    });
    return out;
  }

  function createFrom(ids, title) {
    const members = flatten(ids);
    if (!members.length) return null;
    const b = boundsOf(members) || { x: 0, y: 0, w: EMPTY_W, h: EMPTY_H };
    const g = {
      id: U.uid('grp'), type: 'group',
      x: b.x, y: b.y, w: b.w, h: b.h, z: 0,
      title: title || '系统分组', tone: 'slate', members,
    };
    Store.add(g, { reason: 'group' });
    Store.update(g.id, { z: 0 }, true);
    return g;
  }

  function addMembers(g, ids) {
    if (!g || g.type !== 'group') return [];
    const members = memberIds(g);
    flatten(ids).forEach((id) => {
      if (id !== g.id && members.indexOf(id) < 0) members.push(id);
    });
    g.members = members;
    sync(g);
    return members;
  }

  function removeMember(g, id) {
    if (!g || g.type !== 'group') return;
    g.members = memberIds(g).filter((x) => x !== id);
    sync(g);
  }

  function labelOfMember(id) {
    const e = Store.el(id);
    if (!e) return '已删除组件';
    if (e.title) return e.title;
    if (e.text) return U.plainText(e.text).slice(0, 20);
    if (e.label) return e.label;
    if (e.html) return U.plainText(e.html).slice(0, 20);
    return (window.ComponentRegistry && ComponentRegistry.get(e.type) || {}).label || e.type;
  }

  return {
    sync, syncAll, expand, createFrom, addMembers, removeMember,
    memberIds, flatten, labelOfMember, boundsOf,
  };
})();
