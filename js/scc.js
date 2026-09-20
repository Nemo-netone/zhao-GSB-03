/* scc.js — 强连通分量（Tarjan，迭代实现，避免大图递归爆栈）
 * 输入 {nodes, edges}；输出：
 *   components: [{ id, nodes: string[](字典序), cyclic, min }]
 *   nodeComp:   Map<nodeName, componentId>
 * 分量顺序按分量内最小节点名字典序，保证确定性。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepSCC = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function compute(nodes, edges) {
    const nodeList = Array.from(nodes).sort();
    const indexOf = new Map();
    nodeList.forEach((n, i) => indexOf.set(n, i));
    const N = nodeList.length;
    const adj = Array.from({ length: N }, () => []);
    for (const [a, b] of edges) {
      const ia = indexOf.get(a);
      const ib = indexOf.get(b);
      if (ia !== undefined && ib !== undefined) adj[ia].push(ib);
    }
    for (const list of adj) list.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

    const idx = new Int32Array(N).fill(-1);
    const low = new Int32Array(N);
    const onStack = new Uint8Array(N);
    const stack = [];
    let timer = 0;
    const groups = [];

    // 迭代版 Tarjan
    for (let root = 0; root < N; root++) {
      if (idx[root] !== -1) continue;
      const callStack = [[root, 0]];
      idx[root] = low[root] = timer++;
      stack.push(root);
      onStack[root] = 1;

      while (callStack.length) {
        const frame = callStack[callStack.length - 1];
        const v = frame[0];
        let child = frame[1];
        if (child < adj[v].length) {
          const w = adj[v][child];
          frame[1]++;
          if (idx[w] === -1) {
            idx[w] = low[w] = timer++;
            stack.push(w);
            onStack[w] = 1;
            callStack.push([w, 0]);
          } else if (onStack[w]) {
            if (idx[w] < low[v]) low[v] = idx[w];
          }
        } else {
          if (low[v] === idx[v]) {
            const comp = [];
            while (true) {
              const w = stack.pop();
              onStack[w] = 0;
              comp.push(nodeList[w]);
              if (w === v) break;
            }
            groups.push(comp);
          }
          callStack.pop();
          if (callStack.length) {
            const parentFrame = callStack[callStack.length - 1];
            const p = parentFrame[0];
            if (low[v] < low[p]) low[p] = low[v];
          }
        }
      }
    }

    const selfLoop = new Set();
    for (const [a, b] of edges) if (a === b) selfLoop.add(a);

    const components = groups
      .map((g) => {
        g.sort();
        return {
          nodes: g,
          cyclic: g.length > 1 || selfLoop.has(g[0]),
          min: g[0],
        };
      })
      .sort((x, y) => (x.min < y.min ? -1 : x.min > y.min ? 1 : 0))
      .map((c, i) => ({ id: i, nodes: c.nodes, cyclic: c.cyclic, min: c.min }));

    const nodeComp = new Map();
    components.forEach((c) => c.nodes.forEach((n) => nodeComp.set(n, c.id)));
    return { components, nodeComp };
  }

  return { compute };
});
