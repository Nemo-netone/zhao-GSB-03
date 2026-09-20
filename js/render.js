/* 渲染模块：把布局结果画成 SVG（字符串拼装，5000 边级别也足够快），
 * 并负责交互：节点点击高亮、循环组点击、滚轮缩放、拖拽平移。
 */
window.DepTool = window.DepTool || {};
(function (ns) {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  ns.esc = esc;

  function edgeKey(a, b) { return a + '\u0001' + b; }
  ns.edgeKey = edgeKey;

  function edgePath(pa, pb) {
    var x1 = pa.x + pa.w / 2, y1 = pa.y;
    var x2 = pb.x + pb.w / 2, y2 = pb.y + pb.h;
    var my = (y1 + y2) / 2;
    return 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ', ' + x2 + ' ' + my + ', ' + x2 + ' ' + y2;
  }
  function innerEdgePath(pa, pb) {
    var x1 = pa.x + pa.w / 2, y1 = pa.y + pa.h;
    var x2 = pb.x + pb.w / 2, y2 = pb.y + pb.h;
    var my = Math.max(y1, y2) + 26;
    return 'M ' + x1 + ' ' + y1 + ' Q ' + (x1 + x2) / 2 + ' ' + my + ', ' + x2 + ' ' + y2;
  }
  function selfLoopPath(p) {
    var cx = p.x + p.w / 2, y = p.y;
    return 'M ' + cx + ' ' + y + ' C ' + (cx - 26) + ' ' + (y - 30) + ', ' + (cx + 26) + ' ' + (y - 30) + ', ' + (cx + 1) + ' ' + (y - 2);
  }

  ns.buildSVG = function (model, layout) {
    var nodePos = layout.nodePos;
    var nodeToComp = model.nodeToComp;
    var parts = [];
    parts.push('<defs>'
      + '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#7a869a"/></marker>'
      + '<marker id="arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#f0883e"/></marker>'
      + '<marker id="arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#3fb950"/></marker>'
      + '<marker id="arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#d2a8ff"/></marker>'
      + '</defs>');
    parts.push('<g id="viewport">');

    // 边
    parts.push('<g class="edges">');
    var edges = model.parsed.edges;
    for (var i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      var pa = nodePos.get(a), pb = nodePos.get(b);
      if (!pa || !pb) continue;
      var d;
      if (a === b) d = selfLoopPath(pa);
      else if (nodeToComp.get(a) === nodeToComp.get(b)) d = innerEdgePath(pa, pb);
      else d = edgePath(pa, pb);
      parts.push('<path class="edge" data-edge="' + esc(edgeKey(a, b)) + '" d="' + d + '" marker-end="url(#arrow)"/>');
    }
    parts.push('</g>');

    // 循环组框
    parts.push('<g class="comps">');
    layout.compBox.forEach(function (box, id) {
      var c = model.components[id];
      if (!c.cyclic) return;
      parts.push('<rect class="comp-box" data-comp="' + id + '" x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" rx="10"/>');
      parts.push('<text class="comp-label" data-comp="' + id + '" x="' + (box.x + 12) + '" y="' + (box.y + 15) + '">\u5faa\u73af\u7ec4 ' + esc(c.members.join(', ')) + '</text>');
    });
    parts.push('</g>');

    // 孤立模块区
    if (layout.isoBox) {
      var ib = layout.isoBox;
      parts.push('<rect class="iso-box" x="' + ib.x + '" y="' + ib.y + '" width="' + ib.w + '" height="' + ib.h + '" rx="8"/>');
      parts.push('<text class="iso-label" x="' + (ib.x + 12) + '" y="' + (ib.y + 17) + '">\u5b64\u7acb\u6a21\u5757\uff08\u65e0\u4f9d\u8d56\u5173\u7cfb\uff09</text>');
    }

    // 节点
    parts.push('<g class="nodes">');
    nodePos.forEach(function (p, name) {
      parts.push('<g class="node" data-name="' + esc(name) + '" transform="translate(' + p.x + ',' + p.y + ')">'
        + '<rect width="' + p.w + '" height="' + p.h + '" rx="6"/>'
        + '<text x="' + (p.w / 2) + '" y="' + (p.h / 2 + 4) + '" text-anchor="middle">' + esc(name) + '</text>'
        + '</g>');
    });
    parts.push('</g></g>');
    return parts.join('');
  };

  // 交互：返回当前状态，回调由 app 提供
  ns.attachInteraction = function (svg, model, handlers) {
    var viewport = svg.querySelector('#viewport');
    var view = { x: 0, y: 0, k: 1 };
    function apply() {
      viewport.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    }
    apply();

    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var rect = svg.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      var nk = Math.min(8, Math.max(0.05, view.k * factor));
      view.x = mx - (mx - view.x) * (nk / view.k);
      view.y = my - (my - view.y) * (nk / view.k);
      view.k = nk;
      apply();
    }, { passive: false });

    var dragging = false, sx = 0, sy = 0, moved = false, downTarget = null;
    svg.addEventListener('pointerdown', function (ev) {
      dragging = true; moved = false;
      downTarget = ev.target;
      sx = ev.clientX; sy = ev.clientY;
      svg.classList.add('panning');
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x += dx; view.y += dy;
      sx = ev.clientX; sy = ev.clientY;
      apply();
    });
    svg.addEventListener('pointerup', function () {
      dragging = false;
      svg.classList.remove('panning');
      if (moved) return;
      var t = downTarget;
      downTarget = null;
      var nodeG = t && t.closest ? t.closest('.node') : null;
      var compEl = t && t.closest ? t.closest('[data-comp]') : null;
      if (nodeG) handlers.onNode(nodeG.getAttribute('data-name'));
      else if (compEl) handlers.onComp(parseInt(compEl.getAttribute('data-comp'), 10));
      else handlers.onBackground();
    });

    return {
      resetView: function () { view = { x: 0, y: 0, k: 1 }; apply(); }
    };
  };

  function allNodes(svg) { return svg.querySelectorAll('.node'); }
  function allEdges(svg) { return svg.querySelectorAll('.edge'); }

  ns.clearHighlight = function (svg) {
    allNodes(svg).forEach(function (n) {
      n.classList.remove('dim', 'hl-self', 'hl-up', 'hl-down', 'hl-cycle');
    });
    allEdges(svg).forEach(function (e) {
      e.classList.remove('dim', 'e-up', 'e-down', 'e-cycle');
    });
  };

  // 高亮一组节点：selfSet / upSet / downSet 均为模块名 Set
  ns.highlightSets = function (svg, selfSet, upSet, downSet) {
    ns.clearHighlight(svg);
    allNodes(svg).forEach(function (g) {
      var name = g.getAttribute('data-name');
      if (selfSet.has(name)) g.classList.add('hl-self');
      else if (upSet.has(name) && downSet.has(name)) g.classList.add('hl-self');
      else if (upSet.has(name)) g.classList.add('hl-up');
      else if (downSet.has(name)) g.classList.add('hl-down');
      else g.classList.add('dim');
    });
    allEdges(svg).forEach(function (e) {
      var key = e.getAttribute('data-edge').split('\u0001');
      var a = key[0], b = key[1];
      var aUp = upSet.has(a) || selfSet.has(a), bUp = upSet.has(b) || selfSet.has(b);
      var aDown = downSet.has(a) || selfSet.has(a), bDown = downSet.has(b) || selfSet.has(b);
      if (aUp && bUp && upSet.has(a) && upSet.has(b)) e.classList.add('e-up');
      else if (aDown && bDown && downSet.has(a) && downSet.has(b)) e.classList.add('e-down');
      else if ((aUp && bUp) || (aDown && bDown)) e.classList.add('e-cycle');
      else e.classList.add('dim');
    });
  };

  // 高亮一条环路径
  ns.highlightCycle = function (svg, cycle) {
    ns.clearHighlight(svg);
    var inCycle = new Set(cycle);
    allNodes(svg).forEach(function (g) {
      g.classList.add(inCycle.has(g.getAttribute('data-name')) ? 'hl-cycle' : 'dim');
    });
    var wanted = new Set();
    for (var i = 0; i < cycle.length; i++) {
      wanted.add(edgeKey(cycle[i], cycle[(i + 1) % cycle.length]));
    }
    allEdges(svg).forEach(function (e) {
      e.classList.add(wanted.has(e.getAttribute('data-edge')) ? 'e-cycle' : 'dim');
    });
  };
})(window.DepTool);
