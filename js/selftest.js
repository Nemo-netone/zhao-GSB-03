/* 自测模块：21 条断言覆盖解析、环、分层、闭包、稳定性与性能。 */
window.DepTool = window.DepTool || {};
(function (ns) {
  'use strict';

  var lastPerfMs = null;

  function fmt(v) {
    if (v instanceof Set) return 'Set{' + Array.from(v).sort().join(',') + '}';
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function deepEq(a, b) {
    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      var ok = true;
      a.forEach(function (x) { if (!b.has(x)) ok = false; });
      return ok;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
      return true;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var k = 0; k < ka.length; k++) {
        if (!deepEq(a[ka[k]], b[ka[k]])) return false;
      }
      return true;
    }
    return a === b;
  }

  function closureFor(model, name) {
    var cid = model.nodeToComp.get(name);
    return {
      up: ns.expandComps(model.closures.up[cid], model.components),
      down: ns.expandComps(model.closures.down[cid], model.components)
    };
  }

  function layerOf(model, name) {
    return model.layers[model.nodeToComp.get(name)];
  }

  // 确定性伪随机（LCG）
  function lcg(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 1000 模块 / 5000 边 / 恰好 20 个环（20 个互不相交的三环 + 其余为 DAG 边）
  function genPerfText() {
    var lines = [];
    var k, i;
    for (k = 0; k < 20; k++) {
      var a = 'r' + (3 * k), b = 'r' + (3 * k + 1), c = 'r' + (3 * k + 2);
      lines.push(c + ' -> ' + b);
      lines.push(b + ' -> ' + a);
      lines.push(a + ' -> ' + c);
    }
    var seen = new Set();
    for (i = 61; i < 1000; i++) {
      lines.push('m' + i + ' -> m' + (i - 1));
      seen.add(i + '|' + (i - 1));
    }
    var rand = lcg(20260920);
    var need = 5000 - 60 - 939;
    var got = 0;
    while (got < need) {
      var hi = 61 + Math.floor(rand() * 939);
      var lo = 60 + Math.floor(rand() * (hi - 60));
      var key = hi + '|' + lo;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push('m' + hi + ' -> m' + lo);
      got++;
    }
    return lines.join('\n');
  }

  ns.runSelfTests = function () {
    var results = [];
    function assertEq(actual, expected, msg) {
      if (!deepEq(actual, expected)) {
        var e = new Error(msg || '不相等');
        e.expected = fmt(expected);
        e.actual = fmt(actual);
        throw e;
      }
    }
    function assertTrue(x, msg, detail) {
      if (!x) {
        var e = new Error(msg || '期望为真');
        e.expected = msg || 'truthy';
        e.actual = fmt(detail !== undefined ? detail : x);
        throw e;
      }
    }
    function test(name, fn) {
      try { fn(); results.push({ name: name, pass: true }); }
      catch (e) { results.push({ name: name, pass: false, expected: e.expected || '', actual: e.actual || e.message }); }
    }

    test('01 基础解析：单条边', function () {
      var p = ns.parse('app -> router');
      assertEq(p.edges, [['app', 'router']]);
      assertEq(p.nodes, ['app', 'router']);
    });

    test('02 注释行与行尾注释被忽略', function () {
      var p = ns.parse('# 整行注释\n// 另一种注释\napp -> api # 行尾注释\n  // x -> y\n');
      assertEq(p.edges, [['app', 'api']]);
      assertEq(p.nodes, ['api', 'app']);
    });

    test('03 等价写法归一（-> : => <- <= ：）', function () {
      var p = ns.parse('a -> b\na: b\na => b\nb <- a\nb <= a\na\uff1ab');
      assertEq(p.edges, [['a', 'b']]);
    });

    test('04 引号与两侧空白剥除', function () {
      var p = ns.parse('   "app mod"  ->  \'store\'  \n\u0060x\u0060 -> "  y  "');
      assertEq(p.edges, [['app mod', 'store'], ['x', 'y']]);
    });

    test('05 逗号多目标（中英文逗号、顿号）', function () {
      var p = ns.parse('a -> b, c\uff0cd\u3001e');
      assertEq(p.edges, [['a', 'b'], ['a', 'c'], ['a', 'd'], ['a', 'e']]);
    });

    test('06 重复边合并', function () {
      var p = ns.parse('a -> b\na -> b\n  a   ->   b  \na: b');
      assertEq(p.edges, [['a', 'b']]);
    });

    test('07 孤立模块单列且不参与边', function () {
      var p = ns.parse('lonely\na -> b');
      assertEq(p.isolated, ['lonely']);
      assertEq(p.nodes, ['a', 'b', 'lonely']);
    });

    test('08 只在箭头右侧出现的模块不丢', function () {
      var m = ns.analyzeText('a -> b\nb -> c');
      assertTrue(m.parsed.nodes.indexOf('c') >= 0, 'c 应在节点中', m.parsed.nodes);
      assertEq(layerOf(m, 'c'), 0);
      assertTrue(m.topo.some(function (id) { return m.components[id].members[0] === 'c'; }), 'c 应在拓扑序中');
    });

    test('09 单环计数为 1', function () {
      var m = ns.analyzeText('a -> b\nb -> c\nc -> a');
      assertEq(m.cycles.length, 1);
      assertEq(m.cycles[0], ['a', 'b', 'c']);
    });

    test('10 自环是环且分量为循环组', function () {
      var m = ns.analyzeText('a -> a\nb -> a');
      assertEq(m.cycles, [['a']]);
      var cid = m.nodeToComp.get('a');
      assertTrue(m.components[cid].cyclic, 'a 的分量应为循环组');
    });

    test('11 二元环（互指）计 1 条', function () {
      var m = ns.analyzeText('a -> b\nb -> a');
      assertEq(m.cycles, [['a', 'b']]);
    });

    test('12 旋转去重：同一环换起点只计一次', function () {
      var m = ns.analyzeText('b -> c\nc -> a\na -> b');
      assertEq(m.cycles.length, 1);
      assertEq(m.cycles[0], ['a', 'b', 'c']);
    });

    test('13 大环套小环各算各的', function () {
      var m = ns.analyzeText('a -> b\nb -> c\nc -> d\nd -> a\nb -> d');
      assertEq(m.cycles, [['a', 'b', 'd'], ['a', 'b', 'c', 'd']]);
    });

    test('14 多个互不相交的环', function () {
      var m = ns.analyzeText('a -> b\nb -> a\nx -> y\ny -> z\nz -> x');
      assertEq(m.cycles.length, 2);
      var cyclic = m.components.filter(function (c) { return c.cyclic; });
      assertEq(cyclic.length, 2);
    });

    test('15 三节点以上缠成的环识别为一个循环组', function () {
      var m = ns.analyzeText('a -> b\nb -> c\nc -> d\nd -> a\nd -> b');
      var cyclic = m.components.filter(function (c) { return c.cyclic; });
      assertEq(cyclic.length, 1);
      assertEq(cyclic[0].members, ['a', 'b', 'c', 'd']);
      assertEq(m.cycles.length, 2);
    });

    test('16 分层：被依赖者在上，按最长路径', function () {
      var m = ns.analyzeText('app -> router\nrouter -> api\napi -> http\napp -> x\nx -> y\ny -> z\napp -> z');
      assertEq(layerOf(m, 'http'), 0);
      assertEq(layerOf(m, 'api'), 1);
      assertEq(layerOf(m, 'router'), 2);
      assertEq(layerOf(m, 'app'), 3);
      assertEq(layerOf(m, 'z'), 0);
      assertEq(layerOf(m, 'y'), 1);
      assertEq(layerOf(m, 'x'), 2);
    });

    test('17 有环不影响分层：整组占一层', function () {
      var m = ns.analyzeText('app -> a\na -> b\nb -> a\nb -> base');
      var cid = m.nodeToComp.get('a');
      assertTrue(m.components[cid].cyclic, 'ab 应为循环组');
      assertEq(m.layers[cid], 1);
      assertEq(layerOf(m, 'app'), 2);
      assertEq(layerOf(m, 'base'), 0);
    });

    test('18 闭包高亮：隔着环也算对，循环组整体对待', function () {
      var m = ns.analyzeText('app -> a\na -> b\nb -> a\nb -> base\nui -> app');
      var cApp = closureFor(m, 'app');
      assertEq(cApp.up, new Set(['app', 'a', 'b', 'base']));
      assertEq(cApp.down, new Set(['app', 'ui']));
      var cB = closureFor(m, 'b');
      assertEq(cB.up, new Set(['a', 'b', 'base']));
      assertEq(cB.down, new Set(['a', 'b', 'app', 'ui']));
    });

    test('19 稳定性：同一段脏文本分析两次逐项一致', function () {
      var text = '# c\napp -> a, b\na: b\nb -> a\nx <- y\n"s 1" => t\nlonely\nq -> q\napp -> a\n';
      var m1 = ns.analyzeText(text);
      var m2 = ns.analyzeText(text);
      function snap(m) {
        return {
          nodes: m.parsed.nodes, edges: m.parsed.edges, isolated: m.parsed.isolated,
          cycles: m.cycles, layers: m.layers, topo: m.topo,
          comps: m.components.map(function (c) { return { members: c.members, cyclic: c.cyclic }; })
        };
      }
      assertEq(snap(m2), snap(m1));
    });

    test('20 性能：1000 模块 / 5000 边 / 20 环 < 1 秒', function () {
      var text = genPerfText();
      var t0 = performance.now();
      var m = ns.analyzeText(text);
      var layout = ns.computeLayout(m);
      var svgStr = ns.buildSVG(m, layout);
      var elapsed = performance.now() - t0;
      lastPerfMs = Math.round(elapsed);
      assertEq(m.parsed.nodes.length, 1000);
      assertEq(m.parsed.edges.length, 5000);
      assertEq(m.cycles.length, 20);
      assertTrue(svgStr.length > 0, 'SVG 应已生成');
      assertTrue(elapsed < 1000, '全流程应 < 1000ms', lastPerfMs + 'ms');
    });

    test('21 空输入不报错', function () {
      var m = ns.analyzeText('  \n\n# 只有注释\n');
      assertEq(m.parsed.nodes, []);
      assertEq(m.cycles, []);
      assertEq(m.topo, []);
    });

    return { results: results, perfMs: lastPerfMs };
  };
})(window.DepTool);
