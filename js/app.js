/* app.js — 组装：输入/拖放、分析、统计、图交互、各面板渲染、自测入口 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const input = $('input');
  const graphCanvas = $('graph-canvas');
  const graphEmpty = $('graph-empty');
  let model = null;
  let graphView = null;
  let selectedNode = null;
  let activeCycleNodes = null;

  const sample = [
    '# 前端模块依赖（脏写法示例）',
    'app -> router, store',
    'app => config',
    'router depends on api',
    'store --> api',
    'api -> http',
    'http -> logger',
    'logger -> telemetry',
    'telemetry -> logger   # 环1：logger <-> telemetry',
    'router -> cache',
    'cache -> store        # 环2：app->router->cache->store->... 经 api 回来？见下',
    'store -> cache',
    '"feature/x" -> router',
    'feature/x; orphan-ui; dead-lib  // 后两个声明但无边',
    'httpv2 -> logger',
    'api -> httpv2',
    'lonely-node',
  ].join('\n');

  function analyze(text) {
    const t0 = performance.now();
    const parsed = DepParser.parse(text);
    const m = DepLayering.build(parsed);
    const t1 = performance.now();
    m.parseStats = parsed.stats;
    m.elapsedMs = t1 - t0;
    return m;
  }

  function renderAll(m) {
    model = m;
    selectedNode = null;
    activeCycleNodes = null;
    graphEmpty.style.display = m.nodes.length ? 'none' : 'block';
    renderStats(m);
    renderGraph();
    renderTopo(m);
    renderCycles(m);
    renderIsolates(m);
    hideCyclePop();
  }

  function renderStats(m) {
    const s = m.parseStats;
    const cyclicComps = m.components.filter((c) => c.cyclic).length;
    const nodesInCycles = m.components.filter((c) => c.cyclic).reduce((n, c) => n + c.nodes.length, 0);
    const cls = m.cycleCount > 0 ? 'bad' : 'ok';
    $('stats').innerHTML =
      chip('模块', s.nodeCount) +
      chip('唯一边', s.uniqueEdges) +
      (s.duplicateEdges ? chip('合并重复边', s.duplicateEdges, 'warn') : '') +
      chip('循环组', cyclicComps, cls) +
      chip('卷入环节点', nodesInCycles, cls) +
      chip('环总数', m.cycleCount, cls) +
      chip('孤立', m.isolates.length) +
      '<span class="chip timing">耗时 ' + m.elapsedMs.toFixed(1) + ' ms</span>';
  }
  function chip(label, value, kind) {
    return '<span class="chip ' + (kind || '') + '">' + label + ' <b>' + value + '</b></span>';
  }
  function renderGraph() {
    if (!model || !model.nodes.length) { graphCanvas.textContent = ''; return; }
    graphView = DepGraph.render(graphCanvas, model, {
      onNodeClick: onNodeClick,
      onGroupClick: showCyclePop,
      onBackgroundClick: clearSelection,
    });
    updateSelectionInfo(null);
  }

  function onNodeClick(name) {
    selectedNode = name;
    activeCycleNodes = null;
    const closure = model.closureForNode(name);
    graphView.applySelection(closure, null);
    updateSelectionInfo(closure);
    hideCyclePop();
    // 同步更新环面板高亮
    document.querySelectorAll('.cycle-line').forEach((e) => e.classList.remove('dim'));
  }

  function clearSelection() {
    selectedNode = null;
    activeCycleNodes = null;
    graphView.applySelection(null, null);
    updateSelectionInfo(null);
    document.querySelectorAll('.cycle-line').forEach((e) => e.classList.remove('dim'));
  }

  function updateSelectionInfo(closure) {
    const box = $('selection-info');
    if (!closure) {
      box.innerHTML = '<span class="hint">点击任意模块：高亮它的全部传递上游（谁牵连它）与传递下游（它牵连谁）；点击虚线组标题查看组内环路径。</span>';
      return;
    }
    const up = Array.from(closure.upstreamNodes).sort();
    const down = Array.from(closure.downstreamNodes).sort();
    const group = Array.from(closure.groupNodes).sort();
    box.innerHTML =
      '<span class="sel-title">' + esc(closure.node) + '</span>' +
      (closure.groupNodes.size > 1 ? ' <span style="color:var(--cycle)">∈ 循环组：' + group.map(esc).join(', ') + '</span>' : '') +
      '<div><span class="up">▲ 传递上游（谁会牵连它，' + up.length + '）</span>：' + (up.length ? up.map(esc).join(' → ') : '无') + '</div>' +
      '<div><span class="down">▼ 传递下游（它会牵连谁，' + down.length + '）</span>：' + (down.length ? down.map(esc).join(' ← ') : '无') + '</div>';
  }

  function showCyclePop(compId) {
    const list = model.cyclesByComp.get(compId) || [];
    const comp = model.components[compId];
    $('cycle-pop-title').textContent = '循环组：' + comp.key + '（' + comp.nodes.length + ' 节点 / ' + list.length + ' 环）';
    const body = $('cycle-pop-body');
    body.innerHTML = list.length
      ? list.map(function (c, i) {
          return '<div class="cycle-line" data-cycle="' + i + '" data-comp="' + compId + '"><span class="idx">#' + (i + 1) + '</span>' + esc(c.path) + '</div>';
        }).join('')
      : '<div class="hint">该分量没有可显示的简单回路。</div>';
    $('cycle-pop').classList.remove('hidden');
    body.querySelectorAll('.cycle-line').forEach(function (e) {
      e.addEventListener('click', function () {
        const cid = Number(e.dataset.comp);
        const cy = (model.cyclesByComp.get(cid) || [])[Number(e.dataset.cycle)];
        activeCycleNodes = cy.nodes;
        graphView.applySelection(selectedNode ? model.closureForNode(selectedNode) : null, cy.nodes);
      });
    });
  }
  function hideCyclePop() { $('cycle-pop').classList.add('hidden'); }
  function renderTopo(m) {
    if (!m.nodes.length) { $('topo-list').innerHTML = empty('暂无结果'); return; }
    const byLevel = new Map();
    for (const item of m.topo) {
      if (!byLevel.has(item.level)) byLevel.set(item.level, []);
      byLevel.get(item.level).push(item);
    }
    const levels = Array.from(byLevel.keys()).sort((a, b) => b - a);
    let html = '<div class="hint" style="margin-bottom:10px">构建/阅读顺序：被依赖的先构建（下→上读）。同一层内按字典序，结果确定可复现。</div>';
    let ord = 1;
    for (const lv of levels) {
      const items = byLevel.get(lv);
      html += '<div class="topo-group"><h3>第 ' + (m.maxLevel - lv) + ' 批（level ' + lv + '，' + items.length + ' 个分量）</h3><div class="topo-items">';
      for (const it of items) {
        const cls = it.cyclic ? 'topo-item cyclic" title="循环组：' + esc(it.nodes.join(', ')) : 'topo-item';
        html += '<span class="' + cls + '"><span class="ord">' + (ord++) + '</span>' +
          it.nodes.map(esc).join(it.cyclic ? ' ⇄ ' : '') + '</span>';
      }
      html += '</div></div>';
    }
    if (m.isolates.length) {
      html += '<div class="topo-group"><h3>孤立模块（无任何边）</h3><div class="topo-items">' +
        m.isolates.map((n) => '<span class="topo-item">' + esc(n) + '</span>').join('') + '</div></div>';
    }
    $('topo-list').innerHTML = html;
  }

  const CYCLE_DRAW_LIMIT = 50;
  let cyclesExpanded = false;
  function renderCycles(m) {
    cyclesExpanded = false;
    const box = $('cycle-list');
    if (!m.cycleCount) { box.innerHTML = '<div class="empty-hint">没有检测到环。</div>'; return; }
    const groups = m.components.filter((c) => c.cyclic);
    let html = '<div class="hint" style="margin-bottom:10px">共 <b style="color:var(--cycle)">' + m.cycleCount +
      '</b> 条不同的简单回路（同环旋转只计一次）。图上最多展开 ' + CYCLE_DRAW_LIMIT +
      ' 条；点击任意路径可在图上高亮该环。</div>';
    let shown = 0;
    for (const comp of groups) {
      const list = m.cyclesByComp.get(comp.id) || [];
      const visible = cyclesExpanded ? list : list.slice(0, Math.max(0, CYCLE_DRAW_LIMIT - shown));
      if (!visible.length) continue;
      html += '<div class="cycle-block' + (comp.nodes.length <= 6 ? ' open' : '') + '">' +
        '<div class="cb-head"><span>循环组 ' + esc(comp.key) + '（' + comp.nodes.length + ' 节点）</span>' +
        '<span class="hint">' + list.length + ' 环</span></div><div class="cb-body">';
      const offset = m.cycles.indexOf(list[0]);
      html += visible.map((c, i) =>
        '<div class="cycle-line" data-comp="' + comp.id + '" data-idx="' + (offset + i) + '"><span class="idx">#' + (offset + i + 1) + '</span>' + esc(c.path) + '</div>'
      ).join('');
      if (list.length > visible.length) {
        html += '<div class="cycle-more" data-more="1">本组还有 ' + (list.length - visible.length) + ' 条，点击展开全部 ' + m.cycleCount + ' 条</div>';
      }
      html += '</div></div>';
      shown += visible.length;
    }
    if (shown < m.cycleCount) {
      html = html.replace('<div class="cycle-more" data-more="1">', '<div class="cycle-more" id="expand-all" data-more="1">');
    }
    box.innerHTML = html;
    box.querySelectorAll('.cb-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
    box.querySelectorAll('.cycle-line').forEach((line) => {
      line.addEventListener('click', () => {
        const comp = Number(line.dataset.comp);
        const idx = Number(line.dataset.idx);
        const cy = m.cycles[idx];
        switchTab('tab-graph');
        activeCycleNodes = cy.nodes;
        selectedNode = null;
        graphView.applySelection(null, cy.nodes);
        updateSelectionInfo(null);
      });
    });
    const more = box.querySelector('#expand-all');
    if (more) more.addEventListener('click', () => { cyclesExpanded = true; renderCycles(m); });
  }

  function renderIsolates(m) {
    const box = $('isolate-list');
    if (!m.isolates.length) { box.innerHTML = '<div class="empty-hint">没有孤立模块。</div>'; return; }
    box.innerHTML = '<div class="isolate-group"><h3>完全没出现在任何边里的模块（' + m.isolates.length + '，字典序）</h3><div class="isolate-items">' +
      m.isolates.map((n) => '<span class="topo-item">' + esc(n) + '</span>').join('') + '</div></div>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function empty(msg) { return '<div class="empty-hint" style="position:static">' + msg + '</div>'; }

  function switchTab(id) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === id));
  }
  function doAnalyze() {
    renderAll(analyze(input.value));
  }

  $('btn-analyze').addEventListener('click', doAnalyze);
  $('btn-load-sample').addEventListener('click', () => { input.value = sample; doAnalyze(); });
  $('btn-clear').addEventListener('click', () => { input.value = ''; renderAll(analyze('')); });
  $('cycle-pop-close').addEventListener('click', hideCyclePop);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doAnalyze(); });

  // 拖放 txt
  const overlay = $('drop-overlay');
  let dragDepth = 0;
  ['dragenter', 'dragover'].forEach((ev) =>
    document.querySelector('.pane-left').addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragenter') dragDepth++;
      overlay.classList.remove('hidden');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    document.querySelector('.pane-left').addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave') { dragDepth--; if (dragDepth > 0) return; }
      else dragDepth = 0;
      overlay.classList.add('hidden');
      if (ev === 'drop') {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) file.text().then((txt) => { input.value = txt; doAnalyze(); });
      }
    })
  );

  // 自测
  function runSelfTest() {
    switchTab('tab-test');
    const out = $('test-output');
    out.innerHTML = '<div class="hint">运行中…</div>';
    setTimeout(() => {
      const report = DepSelfTest.run();
      const allPass = report.failCount === 0;
      $('test-summary').textContent = report.passCount + ' 通过 / ' + report.failCount + ' 失败 / 共 ' + report.total + ' 条';
      let html = '<div class="test-summary-line ' + (allPass ? 'all-pass' : 'has-fail') + '">' +
        (allPass ? '✔ 全部通过' : '✘ 有 ' + report.failCount + ' 条失败') + '（总耗时 ' + report.elapsedMs.toFixed(1) + ' ms）</div>';
      for (const c of report.cases) {
        html += '<div class="test-case ' + (c.pass ? 'pass' : 'fail') + '"><span class="tc-status">' +
          (c.pass ? 'PASS' : 'FAIL') + '</span>' + esc(c.name) +
          (c.detail ? '<span class="detail">' + esc(c.detail) + '</span>' : '') + '</div>';
      }
      out.innerHTML = html;
    }, 20);
  }
  $('btn-selftest').addEventListener('click', runSelfTest);
  $('btn-rerun-test').addEventListener('click', runSelfTest);
})();



