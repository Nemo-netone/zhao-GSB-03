/* 图算法模块：强连通分量（Tarjan）、全部基本环（Johnson，旋转去重）、
 * 凝聚图、传递闭包、最长路径分层、拓扑顺序。全部确定性输出。
 */
window.DepTool = window.DepTool || {};
(function (ns) {
  'use strict';

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  ns.cmp = cmp;

  // 通用 Tarjan，返回 SCC 列表（每个内部升序，列表按首元素升序）
  function tarjanSCC(nodeList, adj) {
    var index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    var sccs = [];
    var counter = 0;
    function strongconnect(v) {
      index.set(v, counter); low.set(v, counter); counter++;
      stack.push(v); onStack.add(v);
      var outs = adj.get(v);
      for (var i = 0; i < outs.length; i++) {
        var w = outs[i];
        if (!index.has(w)) {
          strongconnect(w);
          low.set(v, Math.min(low.get(v), low.get(w)));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
      }
      if (low.get(v) === index.get(v)) {
        var scc = [], w;
        do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
        scc.sort(cmp);
        sccs.push(scc);
      }
    }
    for (var i = 0; i < nodeList.length; i++) {
      if (!index.has(nodeList[i])) strongconnect(nodeList[i]);
    }
    sccs.sort(function (a, b) { return cmp(a[0], b[0]); });
    return sccs;
  }

  ns.findSCCs = function (nodes, edges) {
    var adj = new Map();
    for (var i = 0; i < nodes.length; i++) adj.set(nodes[i], []);
    for (var e = 0; e < edges.length; e++) adj.get(edges[e][0]).push(edges[e][1]);
    var sorted = nodes.slice().sort(cmp);
    for (var n = 0; n < sorted.length; n++) adj.get(sorted[n]).sort(cmp);
    return tarjanSCC(sorted, adj);
  };

  // 环的规范形：旋转到字典序最小节点开头（旋转重复因此归并）
  function canonicalCycle(cyc) {
    var best = 0;
    for (var i = 1; i < cyc.length; i++) if (cyc[i] < cyc[best]) best = i;
    return cyc.slice(best).concat(cyc.slice(0, best));
  }
  ns.canonicalCycle = canonicalCycle;

  // Johnson 算法找全部基本环；自环单独算；结果确定性排序
  ns.findCycles = function (nodes, edges, sccs) {
    var selfLoop = new Set();
    var adj = new Map();
    var i, e;
    for (i = 0; i < nodes.length; i++) adj.set(nodes[i], new Set());
    for (e = 0; e < edges.length; e++) {
      var a = edges[e][0], b = edges[e][1];
      if (a === b) selfLoop.add(a);
      else adj.get(a).add(b);
    }
    var cycles = [];
    var seen = new Set();
    function addCycle(cyc) {
      var c = canonicalCycle(cyc);
      var key = c.join('\u0001');
      if (!seen.has(key)) { seen.add(key); cycles.push(c); }
    }
    Array.from(selfLoop).sort(cmp).forEach(function (s) { addCycle([s]); });

    var nonTrivial = (sccs || ns.findSCCs(nodes, edges)).filter(function (s) { return s.length > 1; });
    for (var si = 0; si < nonTrivial.length; si++) {
      var members = nonTrivial[si].slice().sort(cmp);
      var inScc = new Set(members);
      var fullAdj = new Map();
      for (i = 0; i < members.length; i++) {
        var m = members[i];
        fullAdj.set(m, Array.from(adj.get(m)).filter(function (x) { return inScc.has(x); }).sort(cmp));
      }
      for (var startIdx = 0; startIdx < members.length; startIdx++) {
        var start = members[startIdx];
        var subNodes = members.slice(startIdx);
        var subSet = new Set(subNodes);
        var subAdj = new Map();
        for (i = 0; i < subNodes.length; i++) {
          var sn = subNodes[i];
          subAdj.set(sn, fullAdj.get(sn).filter(function (x) { return subSet.has(x); }));
        }
        var subSccs = tarjanSCC(subNodes, subAdj);
        var startScc = null;
        for (i = 0; i < subSccs.length; i++) {
          if (subSccs[i].length > 1 && subSccs[i].indexOf(start) >= 0) { startScc = subSccs[i]; break; }
        }
        if (!startScc) continue;
        var inC = new Set(startScc);
        var cadj = new Map();
        for (i = 0; i < startScc.length; i++) {
          var cn = startScc[i];
          cadj.set(cn, subAdj.get(cn).filter(function (x) { return inC.has(x); }));
        }
        var blocked = new Set();
        var B = new Map();
        for (i = 0; i < startScc.length; i++) B.set(startScc[i], new Set());
        var stack = [];
        var unblock = function (u) {
          blocked.delete(u);
          B.get(u).forEach(function (w) { if (blocked.has(w)) unblock(w); });
          B.get(u).clear();
        };
        var circuit = function (v) {
          var found = false;
          stack.push(v);
          blocked.add(v);
          var outs = cadj.get(v);
          for (var j = 0; j < outs.length; j++) {
            var w = outs[j];
            if (w === start) { addCycle(stack.slice()); found = true; }
            else if (!blocked.has(w)) { if (circuit(w)) found = true; }
          }
          if (found) unblock(v);
          else { for (var j2 = 0; j2 < outs.length; j2++) B.get(outs[j2]).add(v); }
          stack.pop();
          return found;
        };
        circuit(start);
      }
    }
    cycles.sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return cmp(a.join('\u0001'), b.join('\u0001'));
    });
    return cycles;
  };

  // 凝聚图：每个 SCC 一个分量；含自环的单节点也算循环分量
  ns.buildComponents = function (nodes, edges, sccs) {
    var selfLoop = new Set();
    for (var e = 0; e < edges.length; e++) if (edges[e][0] === edges[e][1]) selfLoop.add(edges[e][0]);
    var nodeToComp = new Map();
    var components = sccs.map(function (members, id) {
      for (var i = 0; i < members.length; i++) nodeToComp.set(members[i], id);
      return { id: id, members: members, cyclic: members.length > 1 || selfLoop.has(members[0]) };
    });
    var compAdj = components.map(function () { return new Set(); });
    var compPred = components.map(function () { return new Set(); });
    for (var k = 0; k < edges.length; k++) {
      var ca = nodeToComp.get(edges[k][0]), cb = nodeToComp.get(edges[k][1]);
      if (ca !== cb) { compAdj[ca].add(cb); compPred[cb].add(ca); }
    }
    return { components: components, nodeToComp: nodeToComp, compAdj: compAdj, compPred: compPred };
  };

  // 传递闭包（在凝聚 DAG 上记忆化 DFS）：up = 它依赖的（上游），down = 依赖它的（下游）
  ns.computeClosures = function (components, compAdj, compPred) {
    var n = components.length;
    function reach(adjList) {
      var memo = new Array(n).fill(null);
      function dfs(u) {
        if (memo[u]) return memo[u];
        var s = new Set([u]);
        adjList[u].forEach(function (v) {
          dfs(v).forEach(function (x) { s.add(x); });
        });
        memo[u] = s;
        return s;
      }
      for (var i = 0; i < n; i++) dfs(i);
      return memo;
    }
    return { up: reach(compAdj), down: reach(compPred) };
  };

  ns.expandComps = function (compSet, components) {
    var out = new Set();
    compSet.forEach(function (c) {
      components[c].members.forEach(function (m) { out.add(m); });
    });
    return out;
  };

  // 最长路径分层：不依赖任何模块的分量在第 0 层（最上层）
  ns.computeLayers = function (components, compAdj) {
    var n = components.length;
    var layer = new Array(n).fill(-1);
    function dfs(u) {
      if (layer[u] >= 0) return layer[u];
      var best = 0;
      compAdj[u].forEach(function (v) { best = Math.max(best, dfs(v) + 1); });
      layer[u] = best;
      return best;
    }
    for (var i = 0; i < n; i++) dfs(i);
    return layer;
  };

  // 拓扑顺序（构建/阅读顺序：被依赖的在前），确定性按分量键字典序
  ns.topoOrder = function (components, compAdj, compPred, skip) {
    var n = components.length;
    var remaining = compAdj.map(function (s) { return s.size; });
    var key = components.map(function (c) { return c.members[0]; });
    var ready = [];
    for (var i = 0; i < n; i++) {
      if (skip && skip.has(i)) continue;
      if (remaining[i] === 0) ready.push(i);
    }
    var order = [];
    while (ready.length) {
      ready.sort(function (a, b) { return cmp(key[a], key[b]); });
      var u = ready.shift();
      order.push(u);
      compPred[u].forEach(function (p) {
        if (skip && skip.has(p)) return;
        remaining[p]--;
        if (remaining[p] === 0) ready.push(p);
      });
    }
    return order;
  };

  // 纯计算分析管线（不碰 DOM），供 app 与自测共用
  ns.analyzeText = function (text) {
    var parsed = ns.parse(text);
    var sccs = ns.findSCCs(parsed.nodes, parsed.edges);
    var cycles = ns.findCycles(parsed.nodes, parsed.edges, sccs);
    var built = ns.buildComponents(parsed.nodes, parsed.edges, sccs);
    var layers = ns.computeLayers(built.components, built.compAdj);
    var isolatedSet = new Set(parsed.isolated);
    var isoCompIds = new Set();
    built.components.forEach(function (c) {
      if (!c.cyclic && c.members.length === 1 && isolatedSet.has(c.members[0])) isoCompIds.add(c.id);
    });
    var topo = ns.topoOrder(built.components, built.compAdj, built.compPred, isoCompIds);
    var closures = ns.computeClosures(built.components, built.compAdj, built.compPred);
    // 每个循环分量包含哪些环（环上所有节点必在同一个 SCC 内）
    var cycleComp = cycles.map(function (cyc) { return built.nodeToComp.get(cyc[0]); });
    return {
      parsed: parsed, sccs: sccs, cycles: cycles,
      components: built.components, nodeToComp: built.nodeToComp,
      compAdj: built.compAdj, compPred: built.compPred,
      layers: layers, isoCompIds: isoCompIds, topo: topo,
      closures: closures, cycleComp: cycleComp
    };
  };
})(window.DepTool);
