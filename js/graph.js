/* graph.js — SVG 分层依赖图渲染（纯 DOM/SVG，无第三方依赖）
 * 布局规则（确定性）：
 *  - 层从上到下：level 0（最基础、被依赖方）在顶部；
 *  - 同层分量按 key 字典序排列，层整体居中；
 *  - 循环分量（SCC）用虚线框圈住，标题「循环组(n)」可点开看环路径。
 * 高亮：上游=绿（它依赖的，谁牵连它）；下游=橙（依赖它的，它牵连谁）；组内=金。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepGraph = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const NODE_H = 30;
  const NODE_PAD_X = 12;
  const NODE_GAP_X = 14;
  const NODE_GAP_Y = 10;
  const GROUP_PAD = 10;
  const GROUP_HEAD = 24;
  const LAYER_GAP = 92;
  const SIDE_MARGIN = 28;
  const TOP_MARGIN = 26;
  const ISO_GAP = 54;
  const CHAR_W = 7.6;

  const C = {
    nodeFill: '#1b2433',
    nodeStroke: '#3a4860',
    text: '#dbe3f0',
    dim: '#3b4557',
    edge: '#46536c',
    up: '#4cc38a',
    down: '#ff9d5c',
    inCycle: '#ffd166',
    groupFill: 'rgba(255,209,102,0.05)',
    groupStroke: '#8a772f',
    isoFill: '#1a2030',
    isoStroke: '#39435a',
    select: '#5eb1ff',
  };

  function el(name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function nodeWidth(name) {
    return Math.max(58, Math.ceil(name.length * CHAR_W) + NODE_PAD_X * 2);
  }
  // 计算每个分量的盒子尺寸与每个节点的位置
  function computeLayout(model) {
    const compBoxes = new Map();
    for (const comp of model.components) {
      const nodeRects = new Map();
      let maxW = 0;
      let totalH = 0;
      comp.nodes.forEach((name, i) => {
        const w = nodeWidth(name);
        if (w > maxW) maxW = w;
        nodeRects.set(name, { w, h: NODE_H });
        totalH += NODE_H;
        if (i > 0) totalH += NODE_GAP_Y;
      });
      const titleW = comp.cyclic ? Math.ceil(('循环组(' + comp.nodes.length + ')').length * CHAR_W) + 24 : 0;
      const innerW = Math.max(maxW, titleW);
      const boxW = innerW + GROUP_PAD * 2;
      const innerH = comp.cyclic ? totalH + GROUP_HEAD : totalH;
      const boxH = innerH + GROUP_PAD * 2;
      compBoxes.set(comp.id, { w: boxW, h: boxH, innerW, nodeRects });
    }

    const layerRows = model.layers.map((comps) => {
      let x = 0;
      const placed = [];
      comps.forEach((comp, i) => {
        const b = compBoxes.get(comp.id);
        if (i > 0) x += NODE_GAP_X;
        placed.push({ comp, box: b, x, y: 0 });
        x += b.w;
      });
      return { items: placed, width: x, height: Math.max(0, ...placed.map((p) => p.box.h)) };
    });

    const maxRowW = Math.max(10, ...layerRows.map((r) => r.width));
    let y = TOP_MARGIN;
    const nodePos = new Map();
    const compPos = new Map();
    layerRows.forEach((row, li) => {
      const startX = SIDE_MARGIN + Math.max(0, (maxRowW - row.width) / 2);
      const cy = y;
      row.items.forEach((it) => {
        const bx = startX + it.x;
        compPos.set(it.comp.id, { x: bx, y: cy, w: it.box.w, h: it.box.h });
        let ny = cy + GROUP_PAD + (it.comp.cyclic ? GROUP_HEAD : 0);
        const innerX = bx + GROUP_PAD + (it.box.innerW - it.box.nodeRects.get(it.comp.nodes[0]).w) / 2;
        for (const name of it.comp.nodes) {
          const r = it.box.nodeRects.get(name);
          const nx = bx + GROUP_PAD + (it.box.innerW - r.w) / 2;
          nodePos.set(name, { x: nx, y: ny, w: r.w, h: r.h, cx: nx + r.w / 2, cy: ny + r.h / 2, comp: it.comp.id });
          ny += NODE_H + NODE_GAP_Y;
        }
        void innerX;
      });
      y += row.height + LAYER_GAP;
    });

    // 孤立区
    const isoBox = { x: 0, y: 0, w: 0, h: 0 };
    const isoPositions = new Map();
    const isoTitleH = 26;
    const isoRowH = NODE_H + NODE_GAP_Y;
    const availW = Math.max(maxRowW + SIDE_MARGIN * 2, 320);
    if (model.isolates.length) {
      y += ISO_GAP - LAYER_GAP;
      let cx = SIDE_MARGIN;
      let rowY = y + isoTitleH;
      let rowMaxBottom = rowY;
      for (const name of model.isolates) {
        const w = nodeWidth(name);
        if (cx + w > SIDE_MARGIN + availW - 20 && cx > SIDE_MARGIN) {
          cx = SIDE_MARGIN;
          rowY += isoRowH;
        }
        isoPositions.set(name, { x: cx, y: rowY, w, h: NODE_H, cx: cx + w / 2, cy: rowY + NODE_H / 2 });
        rowMaxBottom = rowY + NODE_H;
        cx += w + NODE_GAP_X;
      }
      const rows = new Set();
      isoPositions.forEach((p) => rows.add(p.y));
      isoBox.x = SIDE_MARGIN - 10;
      isoBox.y = y - 6;
      isoBox.w = availW - SIDE_MARGIN;
      isoBox.h = isoTitleH + rows.size * isoRowH - NODE_GAP_Y + 16;
      y = isoBox.y + isoBox.h + TOP_MARGIN;
    }

    return {
      width: Math.max(availW, maxRowW + SIDE_MARGIN * 2),
      height: Math.max(y, 260),
      nodePos,
      compPos,
      isoPositions,
      isoBox,
      layerRows,
    };
  }
  function render(container, model, handlers) {
    container.textContent = '';
    const layout = computeLayout(model);
    const svg = el('svg', { width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height });
    container.appendChild(svg);

    const defs = el('defs');
    function marker(id, color) {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      m.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
      return m;
    }
    defs.appendChild(marker('arr-normal', C.edge));
    defs.appendChild(marker('arr-up', C.up));
    defs.appendChild(marker('arr-down', C.down));
    defs.appendChild(marker('arr-in', C.inCycle));
    svg.appendChild(defs);

    const internalByComp = new Map();
    for (const [a, b] of model.edges) {
      const ca = model.nodeComp.get(a);
      const cb = model.nodeComp.get(b);
      if (ca === cb) {
        if (!internalByComp.has(ca)) internalByComp.set(ca, []);
        internalByComp.get(ca).push([a, b]);
      }
    }

    // ---- 分量框（循环组，最底层）----
    const groupLayer = el('g', { 'data-layer': 'groups' });
    svg.appendChild(groupLayer);
    for (const comp of model.components) {
      const pos = layout.compPos.get(comp.id);
      if (!comp.cyclic) continue;
      const g = el('g', { 'data-comp': String(comp.id), class: 'comp-group' });
      const rect = el('rect', {
        x: pos.x, y: pos.y, width: pos.w, height: pos.h, rx: 10,
        fill: C.groupFill, stroke: C.groupStroke, 'stroke-width': 1.4, 'stroke-dasharray': '6 4',
      });
      g.appendChild(rect);
      const label = el('text', {
        x: pos.x + GROUP_PAD, y: pos.y + 16,
        fill: C.inCycle, 'font-size': 12, 'font-weight': 600, class: 'group-label',
      });
      label.textContent = '循环组(' + comp.nodes.length + ') · ' + (model.cyclesByComp.get(comp.id) || []).length + ' 环 · 点击查看';
      label.style.cursor = 'pointer';
      label.addEventListener('click', (e) => { e.stopPropagation(); handlers.onGroupClick && handlers.onGroupClick(comp.id); });
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', (e) => { e.stopPropagation(); handlers.onGroupClick && handlers.onGroupClick(comp.id); });
      g.appendChild(label);
      groupLayer.appendChild(g);
    }


    // ---- 节点层 ----
    const nodeLayer = el('g', { 'data-layer': 'nodes' });
    svg.appendChild(nodeLayer);
    const nodeElems = new Map();
    for (const comp of model.components) {
      for (const name of comp.nodes) {
        const p = layout.nodePos.get(name);
        const g = el('g', { 'data-node': name, class: 'dep-node' });
        const rect = el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 7, fill: C.nodeFill, stroke: C.nodeStroke, 'stroke-width': 1.3 });
        const t = el('text', { x: p.cx, y: p.cy + 4.5, 'text-anchor': 'middle', fill: C.text, 'font-size': 12.5, 'font-family': 'Consolas, monospace' });
        t.textContent = name;
        g.appendChild(rect); g.appendChild(t);
        g.style.cursor = 'pointer';
        g.addEventListener('click', (e) => { e.stopPropagation(); handlers.onNodeClick && handlers.onNodeClick(name); });
        g.addEventListener('mouseenter', () => { if (!g.dataset.hl) rect.setAttribute('stroke', C.select); });
        g.addEventListener('mouseleave', () => { if (!g.dataset.hl) rect.setAttribute('stroke', C.nodeStroke); });
        nodeLayer.appendChild(g);
        nodeElems.set(name, { g, rect, text: t });
      }
    }

    // ---- 孤立模块区 ----
    let isoGroup = null;
    if (model.isolates.length) {
      isoGroup = el('g', { 'data-layer': 'isolates' });
      const b = layout.isoBox;
      isoGroup.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, fill: C.isoFill, stroke: C.isoStroke, 'stroke-dasharray': '3 4' }));
      const title = el('text', { x: b.x + 6, y: b.y + 18, fill: '#7d8aa3', 'font-size': 12, 'font-weight': 600 });
      title.textContent = '孤立模块（' + model.isolates.length + '，与任何模块都没有依赖关系）';
      isoGroup.appendChild(title);
      for (const name of model.isolates) {
        const p = layout.isoPositions.get(name);
        const g = el('g', { 'data-node': name, class: 'dep-node iso-node' });
        const rect = el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 7, fill: C.nodeFill, stroke: C.nodeStroke });
        const t = el('text', { x: p.cx, y: p.cy + 4.5, 'text-anchor': 'middle', fill: C.text, 'font-size': 12.5, 'font-family': 'Consolas, monospace' });
        t.textContent = name;
        g.appendChild(rect); g.appendChild(t);
        g.style.cursor = 'pointer';
        g.addEventListener('click', (e) => { e.stopPropagation(); handlers.onNodeClick && handlers.onNodeClick(name); });
        nodeLayer.appendChild(g);
        nodeElems.set(name, { g, rect, text: t });
      }
      svg.appendChild(isoGroup);
    }
    svg.addEventListener('click', () => { handlers.onBackgroundClick && handlers.onBackgroundClick(); });

    // ---- 边层（最后绘制，盖在节点上；不拦截点击）----
    const edgeLayer = el('g', { 'data-layer': 'edges' });
    edgeLayer.setAttribute('pointer-events', 'none');
    svg.appendChild(edgeLayer);
    const crossPaths = [];
    for (const [ca, cb, a, b] of model.crossEdges) {
      const path = drawEdge(edgeLayer, model, layout, a, b);
      if (path) crossPaths.push({ path, ca, cb, a, b });
    }
    const internalLayer = el('g', { 'data-layer': 'internal' });
    internalLayer.setAttribute('pointer-events', 'none');
    svg.appendChild(internalLayer);
    const internalPaths = [];
    model.components.forEach((comp) => {
      const list = internalByComp.get(comp.id) || [];
      if (!comp.cyclic || !list.length) return;
      let k = 0;
      for (const [a, b] of list) {
        const pa = layout.nodePos.get(a);
        const pb = layout.nodePos.get(b);
        const path = el('path', {
          fill: 'none', stroke: C.groupStroke, 'stroke-width': 1.2,
          'marker-end': 'url(#arr-in)', 'data-comp': String(comp.id),
        });
        if (a === b) {
          const rx = pa.x + pa.w;
          const ry = pa.y + 4;
          path.setAttribute('d', 'M' + rx + ',' + ry + ' C' + (rx + 22) + ',' + (ry - 14) + ' ' + (rx + 22) + ',' + (ry + 20) + ' ' + rx + ',' + (ry + 22));
        } else {
          const off = 24 + (k % 5) * 7;
          const ax = pa.x + pa.w, ay = pa.cy;
          const bx = pb.x + pb.w, by = pb.cy;
          const ex = Math.max(ax, bx) + off;
          path.setAttribute('d', 'M' + ax + ',' + ay + ' C' + ex + ',' + ay + ' ' + ex + ',' + by + ' ' + bx + ',' + by);
        }
        internalLayer.appendChild(path);
        internalPaths.push({ path, a, b, comp: comp.id });
        k++;
      }
    });

    function applySelection(closure, activeCycleNodes) {
      const upNodes = closure ? closure.upstreamNodes : null;
      const downNodes = closure ? closure.downstreamNodes : null;
      const groupNodes = closure ? closure.groupNodes : null;
      const cycleSet = activeCycleNodes ? new Set(activeCycleNodes) : null;
      const cycleEdges = new Set();
      if (activeCycleNodes) {
        for (let i = 0; i < activeCycleNodes.length; i++) {
          cycleEdges.add(activeCycleNodes[i] + '\u0000' + activeCycleNodes[(i + 1) % activeCycleNodes.length]);
        }
      }

      // 节点
      nodeElems.forEach(function (rec, name) {
        rec.g.dataset.hl = '';
        rec.g.setAttribute('opacity', '1');
        rec.rect.setAttribute('stroke', C.nodeStroke);
        rec.rect.setAttribute('stroke-width', '1.3');
        rec.rect.setAttribute('fill', C.nodeFill);
        if (cycleSet && cycleSet.has(name)) {
          rec.rect.setAttribute('stroke', C.inCycle);
          rec.rect.setAttribute('stroke-width', '2.4');
        }
        if (groupNodes && groupNodes.has(name)) {
          rec.g.dataset.hl = 'group';
          rec.rect.setAttribute('stroke', closure.node === name ? C.select : C.inCycle);
          rec.rect.setAttribute('stroke-width', closure.node === name ? '2.6' : '2');
          rec.rect.setAttribute('fill', closure.node === name ? '#24304a' : '#2a2a1d');
        } else if (upNodes && upNodes.has(name)) {
          rec.g.dataset.hl = 'up';
          rec.rect.setAttribute('stroke', C.up);
          rec.rect.setAttribute('stroke-width', '2');
        } else if (downNodes && downNodes.has(name)) {
          rec.g.dataset.hl = 'down';
          rec.rect.setAttribute('stroke', C.down);
          rec.rect.setAttribute('stroke-width', '2');
        } else if (closure) {
          rec.g.setAttribute('opacity', '0.22');
        }
      });

      // 跨分量边
      for (const item of crossPaths) {
        let stroke = C.edge; let width = 1.2; let marker = 'arr-normal'; let op = 0.85;
        if (closure) {
          if (item.ca === closure.componentId) { stroke = C.up; width = 2; marker = 'arr-up'; }
          else if (item.cb === closure.componentId) { stroke = C.down; width = 2; marker = 'arr-down'; }
          else if (closure.upstreamComponents.has(item.ca) && closure.upstreamComponents.has(item.cb)) { stroke = C.up; width = 1.6; marker = 'arr-up'; op = 0.7; }
          else if (closure.downstreamComponents.has(item.ca) && closure.downstreamComponents.has(item.cb)) { stroke = C.down; width = 1.6; marker = 'arr-down'; op = 0.7; }
          else op = 0.08;
        }
        item.path.setAttribute('stroke', stroke);
        item.path.setAttribute('stroke-width', String(width));
        item.path.setAttribute('marker-end', 'url(#' + marker + ')');
        item.path.setAttribute('opacity', String(op));
      }

      // 组内边
      for (const item of internalPaths) {
        const key = item.a + '\u0000' + item.b;
        if (cycleEdges.has(key)) {
          item.path.setAttribute('stroke', C.inCycle);
          item.path.setAttribute('stroke-width', '2.6');
          item.path.setAttribute('opacity', '1');
          continue;
        }
        if (closure && item.comp === closure.componentId) {
          item.path.setAttribute('stroke', C.inCycle);
          item.path.setAttribute('stroke-width', '1.8');
          item.path.setAttribute('opacity', '0.95');
        } else if (closure) {
          item.path.setAttribute('opacity', '0.07');
        } else {
          item.path.setAttribute('stroke', C.groupStroke);
          item.path.setAttribute('stroke-width', '1.2');
          item.path.setAttribute('opacity', '0.7');
        }
      }
    }

    return { svg, layout, applySelection, nodeCount: nodeElems.size };
  }

  function drawEdge(layer, model, layout, a, b) {
    const pa = layout.nodePos.get(a);
    const pb = layout.nodePos.get(b);
    if (!pa || !pb) return null;
    const x1 = pa.cx, y1 = pa.y;
    const x2 = pb.cx, y2 = pb.y + pb.h;
    const midY = (y1 + y2) / 2;
    const d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2;
    const path = el('path', {
      d, fill: 'none', stroke: C.edge, 'stroke-width': 1.2,
      'marker-end': 'url(#arr-normal)', opacity: 0.85,
    });
    path.addEventListener('click', function () {});
    layer.appendChild(path);
    return path;
  }

  return { render };
});

