/* selftest.js — 内置自测（浏览器 / Node 均可运行）
 * 覆盖：单环、多环、自环、二元环、旋转去重、大环套小环、反向三环、
 * 逗号多目标、引号名、等价箭头归一、重复边、孤立、注释、
 * 传递闭包（含跨环整体）、分层规则、环不影响分层、右仅现不丢、
 * 稳定性（两次分析逐项一致）、大图环数准确与 1 秒性能。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepSelfTest = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const deps = typeof window !== 'undefined'
    ? { P: globalThis.DepParser, S: globalThis.DepSCC, C: globalThis.DepCycles, L: globalThis.DepLayering }
    : {
        P: require('./parser.js'),
        S: require('./scc.js'),
        C: require('./cycles.js'),
        L: require('./layering.js'),
      };

  function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function run() {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { P, C, L } = deps;
    const cases = [];
    function test(name, fn) {
      try { fn(); cases.push({ name, pass: true }); }
      catch (e) { cases.push({ name, pass: false, detail: e.message }); }
    }
    function check(cond, expected, actual) {
      if (!cond) throw new Error('期望: ' + JSON.stringify(expected) + '\n实际: ' + JSON.stringify(actual));
    }
    const analyze = (t) => L.build(P.parse(t));

    test('1. 基本解析与分层：a->b->c，被依赖方在上(level 0)', () => {
      const m = analyze('a -> b\nb -> c');
      const lv = (n) => m.components[m.nodeComp.get(n)].level;
      check(m.nodes.join() === 'a,b,c', 'a,b,c', m.nodes);
      check(m.edges.length === 2, 2, m.edges.length);
      check(lv('c') === 0 && lv('b') === 1 && lv('a') === 2, 'c=0,b=1,a=2', [lv('c'), lv('b'), lv('a')]);
    });

    test('2. 自环是环：x -> x', () => {
      const m = analyze('x -> x');
      check(m.cycleCount === 1, 1, m.cycleCount);
      check(m.cycles[0].path === 'x -> x', 'x -> x', m.cycles[0].path);
      check(m.components[m.nodeComp.get('x')].cyclic === true, true, false);
    });

    test('3. 二元互指只算一个环', () => {
      const m = analyze('a -> b\nb -> a');
      check(m.cycleCount === 1, 1, m.cycleCount);
      check(m.cycles[0].nodes.join() === 'a,b', 'a,b', m.cycles[0].nodes);
    });

    test('4. 单三环：a->b->c->a', () => {
      const m = analyze('a -> b\nb -> c\nc -> a');
      check(m.cycleCount === 1, 1, m.cycleCount);
      check(m.cycles[0].path === 'a -> b -> c -> a', 'a -> b -> c -> a', m.cycles[0].path);
    });

    test('5. 多个不相交的环各算各的（3 个二元环）', () => {
      const m = analyze('a->b\nb->a\nc->d\nd->c\nx->y\ny->x');
      check(m.cycleCount === 3, 3, m.cycleCount);
    });

    test('6. 旋转去重：同一环换起点/换边顺序只计一次', () => {
      // 边故意打乱、且环里每个节点都能作为“起点”被读到：a->b->c->a
      const m = analyze('c -> a\nb -> c\na -> b');
      check(m.cycleCount === 1, 1, m.cycleCount);
      check(m.cycles[0].path === 'a -> b -> c -> a', 'a -> b -> c -> a', m.cycles[0].path);
      // canonical 对所有旋转给出同一个键
      const can = C.canonical(['b', 'c', 'a']).join('|');
      check(can === 'a|b|c', 'a|b|c', can);
      const can2 = C.canonical(['c', 'a', 'b']).join('|');
      check(can2 === 'a|b|c', 'a|b|c', can2);
    });

    test('7. 大环套小环：三元环 + a-b 互指 = 2 条环', () => {
      const m = analyze('a->b\nb->c\nc->a\nb->a');
      const paths = m.cycles.map((cc) => cc.path).sort();
      check(m.cycleCount === 2, 2, m.cycleCount);
      check(paths.includes('a -> b -> a') && paths.includes('a -> b -> c -> a'),
        'a->b->a 与 a->b->c->a', paths);
    });

    test('8. 逗号/中文逗号/分号多目标', () => {
      const r = P.parse('a -> b，c; d\ne => f, g');
      const keys = r.edges.map((e) => e.join('>')).sort();
      check(deepEq(keys, ['a>b', 'a>c', 'a>d', 'e>f', 'e>g']),
        ['a>b', 'a>c', 'a>d', 'e>f', 'e>g'], keys);
    });

    test('9. 引号模块名：去引号、保留内部空格', () => {
      const r = P.parse("\"my module\" -> 'b mod'");
      check(deepEq(r.edges, [['my module', 'b mod']]),
        [['my module', 'b mod']], r.edges);
    });

    test('10. 等价箭头归一 + 重复边合并', () => {
      const r = P.parse('a -> b\na => b\na --> b\na depends on b\na:b\na→b');
      check(r.stats.uniqueEdges === 1, 1, r.stats.uniqueEdges);
      check(r.stats.duplicateEdges === 5, 5, r.stats.duplicateEdges);
    });

    test('11. 注释行：# // -- 均忽略，而 --> 不是注释', () => {
      const r = P.parse('# head\n// slash\na -> b -- tail\nc --> d\n  ; 纯注释\n-- only');
      const keys = r.edges.map((e) => e.join('>')).sort();
      check(deepEq(keys, ['a>b', 'c>d']), ['a>b', 'c>d'], keys);
    });

    test('12. 孤立模块与无箭头声明行都保留', () => {
      const m = analyze('a -> b\nlone\nx, y');
      check(m.isolates.join() === 'lone,x,y', 'lone,x,y', m.isolates);
    });

    test('13. 只在箭头右边出现的模块不丢失', () => {
      const m = analyze('app -> router\napp -> logger');
      check(m.nodes.includes('router') && m.nodes.includes('logger'), true, m.nodes);
      check(m.components[m.nodeComp.get('logger')].level === 0, 0, 'logger 应 level0');
    });

    test('14. 传递上游/下游闭包正确（跨环作为整体，环内成员互算）', () => {
      // u->x；x,y 互指；y->v；v->w
      const m = analyze('u -> x\nx -> y\ny -> x\ny -> v\nv -> w');
      const cl = m.closureForNode('x');
      const up = Array.from(cl.upstreamNodes).sort();
      const down = Array.from(cl.downstreamNodes).sort();
      const group = Array.from(cl.groupNodes).sort();
      // 上游（谁会牵连 x）：环内同伴 y，以及 x 沿箭头可达的 v,w
      check(deepEq(up, ['v', 'w', 'y']), ['v', 'w', 'y'], up);
      // 下游（x 会牵连谁）：u 与环内同伴 y
      check(deepEq(down, ['u', 'y']), ['u', 'y'], down);
      check(deepEq(group, ['x', 'y']), ['x', 'y'], group);
      const cl2 = m.closureForNode('y');
      check(deepEq(Array.from(cl2.upstreamNodes).sort(), ['v', 'w', 'x']), ['v', 'w', 'x'], Array.from(cl2.upstreamNodes));
      check(deepEq(Array.from(cl2.downstreamNodes).sort(), ['u', 'x']), ['u', 'x'], Array.from(cl2.downstreamNodes));
    });

    test('15. 有环不影响分层：三环 SCC 与外部依赖照样分层', () => {
      const m = analyze('a->b\nb->c\nc->a\na->base\ntop->b');
      const lv = (n) => m.components[m.nodeComp.get(n)].level;
      check(lv('base') === 0, 0, lv('base'));
      check(lv('a') === 1 && lv('b') === 1 && lv('c') === 1, '环组 level=1', lv('a'));
      check(lv('top') === 2, 2, lv('top'));
      const comp = m.components[m.nodeComp.get('a')];
      check(comp.nodes.join() === 'a,b,c', 'a,b,c', comp.nodes);
    });

    test('16. 同层分量按 key 字典序、层内拓扑列表有序', () => {
      const m = analyze('zeta->core\nalpha->core\nbeta->core');
      const layer1 = m.layers[1].map((cc) => cc.key);
      check(deepEq(layer1, ['alpha', 'beta', 'zeta']), ['alpha', 'beta', 'zeta'], layer1);
    });

    test('17. 环总数准确：全连接三节点 SCC(5环) + 二元环(1) = 6', () => {
      const m = analyze('a->b\nb->a\nb->c\nc->b\na->c\nc->a\nd->e\ne->d');
      check(m.cycleCount === 6, 6, m.cycleCount);
      const lens = {};
      m.cycles.forEach((cc) => { lens[cc.length] = (lens[cc.length] || 0) + 1; });
      check(lens[2] === 4 && lens[3] === 2, '4 个二元环 + 2 个三环', lens);
    });

    test('18. 稳定性：同一段文本分析两次，所有结果逐项一致', () => {
      const text = ['r->q', 'a->b,b->c,c->a', 'm->n,n->m', 'z->z', 'solo',
        'a->c', 'q->x', 'n->o', 'o->p', '# c', 'a -> b'].join('\n');
      const snap = (mm) => JSON.stringify({
        nodes: mm.nodes, edges: mm.edges,
        comps: mm.components.map((cc) => [cc.key, cc.level, cc.cyclic, cc.nodes]),
        topo: mm.topo.map((t) => [t.key, t.level]),
        cycles: mm.cycles.map((cc) => cc.path),
        isolates: mm.isolates, count: mm.cycleCount,
      });
      check(snap(analyze(text)) === snap(analyze(text)), '两次结果完全一致', '两次结果不一致');
    });

    test('19. 脏数据综合：箭头/引号/空格/链式写法', () => {
      const r = P.parse('  "A mod"  -->  b ,  c \na -> b -> d');
      const keys = r.edges.map((e) => e.join('>')).sort();
      check(deepEq(keys, ['A mod>b', 'A mod>c', 'a>b', 'b>d']),
        ['A mod>b', 'A mod>c', 'a>b', 'b>d'], keys);
    });

    test('20. 性能与环数：1000 模块 / 5000 边 / 20 个环，1 秒内出全部结果', () => {
      const N = 1000;
      const edgeSet = new Set();
      const name = (i) => 'm' + String(i).padStart(4, '0');
      // 骨架链 i -> i-1，保证 1000 个模块全部出现（999 条，且无环）
      for (let i = 1; i < N; i++) edgeSet.add(name(i) + '->' + name(i - 1));
      // 20 个互不相邻的二元环（偶数点对 2..40），与骨架/随机边组合不出更大环
      for (let k = 2; k < 42; k += 2) {
        edgeSet.add(name(k) + '->' + name(k + 1));
        edgeSet.add(name(k + 1) + '->' + name(k));
      }
      // 再补指向更小编号节点的随机边直到 5000（回边不参与，环数保持 20）
      let rnd = 20240918;
      const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 0x80000000) / 0x80000000);
      while (edgeSet.size < 5000) {
        const i = 1 + Math.floor(rand() * (N - 1));
        const j = Math.floor(rand() * i);
        edgeSet.add(name(i) + '->' + name(j));
      }
      const lines = Array.from(edgeSet);
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const parsed = P.parse(lines.join('\n'));
      const m = L.build(parsed);
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const ms = t1 - t0;
      check(m.nodes.length === N, N, m.nodes.length);
      check(parsed.stats.uniqueEdges === 5000, 5000, parsed.stats.uniqueEdges);
      check(m.cycleCount === 20, 20, m.cycleCount);
      check(ms < 1000, '<1000ms', ms.toFixed(1) + 'ms');
    });

    test('21. 空输入/纯注释不报错且结果为空集', () => {
      const m = analyze('# nothing\n\n   \n// xxx');
      check(m.nodes.length === 0 && m.cycleCount === 0 && m.isolates.length === 0,
        '全空', [m.nodes.length, m.cycleCount, m.isolates.length]);
    });

    const failCount = cases.filter((cc) => !cc.pass).length;
    return {
      total: cases.length,
      passCount: cases.length - failCount,
      failCount,
      cases,
      elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
    };
  }

  return { run };
});



