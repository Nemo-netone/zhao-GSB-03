/* cycles.js — 有向图全部简单回路枚举（Johnson 1975）
 * - 自环(v->v)、二元互指环天然支持，且各只出现一次；
 * - 再用「字典序最小起点旋转归一」做一层去重保险：
 *   a->b->c->a 与 b->c->a->b 视为同一条；
 * 注意：a->b->a 与反向同一条（二节点环没有方向之分）；
 * 三节点环 a->b->c->a 与 a->c->b->a 是两条不同的环（边不同），都保留。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepCycles = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function canonical(nodes) {
    let best = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i] < nodes[best]) best = i;
    }
    if (best === 0) return nodes.slice();
    return nodes.slice(best).concat(nodes.slice(0, best));
  }

  function findCycles(nodes, edges) {
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
    for (const list of adj) list.sort((x, y) => x - y);

    function tarjanSub(lo) {
      const idx = new Int32Array(N).fill(-1);
      const low = new Int32Array(N);
      const on = new Uint8Array(N);
      const st = [];
      let timer = 0;
      const groups = [];
      for (let root = lo; root < N; root++) {
        if (idx[root] !== -1) continue;
        const calls = [[root, 0]];
        idx[root] = low[root] = timer++;
        st.push(root); on[root] = 1;
        while (calls.length) {
          const f = calls[calls.length - 1];
          const v = f[0];
          if (f[1] < adj[v].length) {
            const w = adj[v][f[1]++];
            if (w < lo) continue;
            if (idx[w] === -1) {
              idx[w] = low[w] = timer++;
              st.push(w); on[w] = 1;
              calls.push([w, 0]);
            } else if (on[w] && idx[w] < low[v]) {
              low[v] = idx[w];
            }
          } else {
            if (low[v] === idx[v]) {
              const g = [];
              for (;;) {
                const w = st.pop(); on[w] = 0; g.push(w);
                if (w === v) break;
              }
              groups.push(g);
            }
            calls.pop();
            if (calls.length) {
              const p = calls[calls.length - 1][0];
              if (low[v] < low[p]) low[p] = low[v];
            }
          }
        }
      }
      return groups;
    }

    const seen = new Set();
    const result = [];

    function emit(indexPath) {
      const named = indexPath.map((i) => nodeList[i]);
      const can = canonical(named);
      const key = can.join('\u0001');
      if (seen.has(key)) return;
      seen.add(key);
      result.push(can);
    }

    let lo = 0;
    while (lo < N) {
      const groups = tarjanSub(lo);
      let chosen = null;
      let chosenMin = N;
      for (const g of groups) {
        let cyclic = g.length > 1;
        if (!cyclic) {
          const v = g[0];
          for (const w of adj[v]) if (w === v) { cyclic = true; break; }
        }
        if (!cyclic) continue;
        let mn = N;
        for (const v of g) if (v < mn) mn = v;
        if (mn < chosenMin) { chosenMin = mn; chosen = g; }
      }
      if (!chosen) break;

      const inComp = new Set(chosen);
      const start = chosenMin;
      const blocked = new Set();
      const blockedOn = new Map();
      const pathStack = [];

      function unblock(u) {
        blocked.delete(u);
        const list = blockedOn.get(u);
        if (list) {
          blockedOn.delete(u);
          for (const w of list) if (blocked.has(w)) unblock(w);
        }
      }

      function circuit(v) {
        let found = false;
        pathStack.push(v);
        blocked.add(v);
        for (const w of adj[v]) {
          if (!inComp.has(w)) continue;
          if (w === start) {
            emit(pathStack.slice());
            found = true;
          } else if (!blocked.has(w)) {
            if (circuit(w)) found = true;
          }
        }
        if (found) unblock(v);
        else for (const w of adj[v]) {
          if (!inComp.has(w)) continue;
          if (!blockedOn.has(w)) blockedOn.set(w, []);
          blockedOn.get(w).push(v);
        }
        pathStack.pop();
        return found;
      }

      circuit(start);
      lo = start + 1;
    }

    const cycles = result
      .map((ns) => ({
        nodes: ns,
        length: ns.length,
        path: ns.concat(ns[0]).join(' -> '),
      }))
      .sort((a, b) => (a.length - b.length) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return { cycles, count: cycles.length };
  }

  return { findCycles, canonical };
});
