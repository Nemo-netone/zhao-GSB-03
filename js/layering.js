/* layering.js — SCC 缩点 DAG、最长路径分层、拓扑顺序、传递闭包
 * 规则（写死，保证同输入同输出）：
 *  - 被依赖方在上：没有出边（最基础）的分量 level=0（图最上层）；
 *    level(c) = max(level(d)) + 1，d 是 c 直接依赖的分量。
 *  - 同层分量按分量 key（内部最小节点名）字典序排列；分量内部节点字典序。
 *  - 拓扑/构建顺序：依赖在前（level 大的先读），同级按 key 字典序。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepLayering = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function build(model) {
    const { nodes, edges } = model;
    const scc = typeof globalThis !== 'undefined' && globalThis.DepSCC ? globalThis.DepSCC : require('./scc.js');
    const cyc = typeof globalThis !== 'undefined' && globalThis.DepCycles ? globalThis.DepCycles : require('./cycles.js');

    const { components, nodeComp } = scc.compute(nodes, edges);
    const { cycles, count: cycleCount } = cyc.findCycles(nodes, edges);

    const C = components.length;
    const compAdj = Array.from({ length: C }, () => new Set());
    const compRev = Array.from({ length: C }, () => new Set());
    const compEdgeSet = new Set();
    const indegNode = new Map();
    const outdegNode = new Map();
    nodes.forEach((n) => { indegNode.set(n, 0); outdegNode.set(n, 0); });

    const crossEdges = [];
    for (const [a, b] of edges) {
      outdegNode.set(a, outdegNode.get(a) + 1);
      indegNode.set(b, indegNode.get(b) + 1);
      const ca = nodeComp.get(a);
      const cb = nodeComp.get(b);
      if (ca === cb) continue;
      compAdj[ca].add(cb);
      compRev[cb].add(ca);
      const k = ca + '\u0000' + cb;
      if (!compEdgeSet.has(k)) {
        compEdgeSet.add(k);
        crossEdges.push([ca, cb, a, b]);
      }
    }

    // level：0 = 最基础（图顶部）
    const level = new Int32Array(C);
    const order = components.map((c) => c.id).sort((x, y) => {
      const kx = components[x].min; const ky = components[y].min;
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
    // 按 key 升序反复松弛直到稳定（SCC 缩点后无环，有限步收敛）
    let changed = true;
    let guard = 0;
    while (changed && guard++ <= C + 2) {
      changed = false;
      for (const cid of order) {
        let m = -1;
        for (const d of compAdj[cid]) if (level[d] > m) m = level[d];
        const want = m + 1;
        if (want !== level[cid]) { level[cid] = want; changed = true; }
      }
    }
    let maxLevel = 0;
    for (let i = 0; i < C; i++) if (level[i] > maxLevel) maxLevel = level[i];

    const comps = components.map((c) => ({
      id: c.id,
      key: c.min,
      nodes: c.nodes,
      cyclic: c.cyclic,
      isSingle: c.nodes.length === 1,
      level: level[c.id],          // 0=最基础
      displayLevel: maxLevel - level[c.id], // 0=图顶部被依赖层？见下（顶部=level 0）
    }));
    // 图上：被依赖方在上 => level 0 画在最上（displayLevel 直接用 level，顶向下递增）
    for (const cp of comps) cp.displayLevel = cp.level;

    // 分层（显示从上到下）
    const layers = Array.from({ length: maxLevel + 1 }, () => []);
    for (const cp of comps) layers[cp.level].push(cp);
    layers.forEach((l) => l.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));

    // 构建/阅读顺序：依赖在前（level 大 → 小）
    let seq = 0;
    const topo = [];
    for (let lv = maxLevel; lv >= 0; lv--) {
      for (const cp of layers[lv]) {
        topo.push({
          order: seq++,
          level: cp.level,
          componentId: cp.id,
          key: cp.key,
          nodes: cp.nodes,
          cyclic: cp.cyclic,
        });
      }
    }

    // 环按所属分量分组
    const cyclesByComp = new Map();
    for (const cy of cycles) {
      const cid = nodeComp.get(cy.nodes[0]);
      if (!cyclesByComp.has(cid)) cyclesByComp.set(cid, []);
      cyclesByComp.get(cid).push(cy);
    }

    // 孤立模块：完全没有出现在任何边的端点上
    const isolates = nodes.filter((n) => indegNode.get(n) === 0 && outdegNode.get(n) === 0);

    crossEdges.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0));

    // 传递闭包（分量级，天然正确处理环）
    function collect(start, adjMap) {
      const compsOut = new Set();
      const q = [start];
      while (q.length) {
        const c = q.pop();
        for (const d of adjMap[c]) {
          if (!compsOut.has(d)) { compsOut.add(d); q.push(d); }
        }
      }
      const nodesOut = new Set();
      compsOut.forEach((cid) => components[cid].nodes.forEach((n) => nodesOut.add(n)));
      return { components: compsOut, nodes: nodesOut };
    }

    function closureForNode(name) {
      if (!nodeComp.has(name)) return null;
      const cid = nodeComp.get(name);
      const up = collect(cid, compAdj);   // 它依赖的全部：谁会牵连它
      const down = collect(cid, compRev); // 依赖它的全部：它会牵连谁
      const groupNodes = new Set(components[cid].nodes);
      // 隔着环也要算对：同组其他成员既是上游也是下游
      components[cid].nodes.forEach((n) => {
        if (n !== name) { up.nodes.add(n); down.nodes.add(n); }
      });
      return {
        node: name,
        componentId: cid,
        groupNodes,
        upstreamNodes: up.nodes,     // 传递上游（含循环组同伴）
        downstreamNodes: down.nodes, // 传递下游（含循环组同伴）
        upstreamComponents: up.components,
        downstreamComponents: down.components,
      };
    }

    return {
      nodes,
      edges,
      components: comps,
      nodeComp,
      compAdj,
      compRev,
      crossEdges,
      layers,
      maxLevel,
      topo,
      cycles,
      cycleCount,
      cyclesByComp,
      isolates,
      closureForNode,
    };
  }

  return { build };
});


