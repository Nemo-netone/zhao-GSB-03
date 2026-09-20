/* 主控模块：串联 解析 → 图算法 → 布局 → 渲染，并处理列表与自测 UI。 */
(function () {
  'use strict';
  var ns = window.DepTool;

  var input = document.getElementById('input');
  var stats = document.getElementById('stats');
  var svg = document.getElementById('graph');
  var cycleCount = document.getElementById('cycle-count');
  var cycleList = document.getElementById('cycle-list');
  var cycleFilter = document.getElementById('cycle-filter');
  var topoList = document.getElementById('topo-list');
  var isolatedList = document.getElementById('isolated-list');

  var MAX_CYCLES_SHOWN = 50;
  var model = null;
  var selectedNode = null;
  var activeCycle = -1;
  var filterComp = null;

  var SAMPLE = [
    '# 主链路',
    'app -> router',
    'app -> store',
    'router -> api',
    'store -> api',
    'api -> http',
    'http -> logger',
    '',
    '// 等价写法与脏数据',
    '"web ui" : app',
    "'legacy mod' => http",
    'cache <- api            # 反向写法，等价于 api -> cache',
    'report -> pdf, excel，csv',
    'auth -> user -> "perm mod"   # 链式写法',
    'api -> http             # 重复边，会被合并',
    '',
    '# 环',
    'a1 -> b1',
    'b1 -> c1',
    'c1 -> a1',
    'x -> y',
    'y -> x',
    'self -> self',
    '',
    '# 孤立模块（单行模块名）',
    'lonely-util',
    '"another lonely"'
  ].join('\n');

  function esc(s) { return ns.esc(s); }

  function cycleLabel(cyc) {
    return cyc.concat([cyc[0]]).join(' → ');
  }

  function renderStats(elapsed) {
    var cyclicGroups = model.components.filter(function (c) { return c.cyclic; }).length;
    var maxLayer = model.topo.length ? Math.max.apply(null, model.layers) + 1 : 0;
    stats.innerHTML = '模块 <b>' + model.parsed.nodes.length + '</b>'
      + ' · 依赖边 <b>' + model.parsed.edges.length + '</b>'
      + ' · 环 <b>' + model.cycles.length + '</b>'
      + ' · 循环组 <b>' + cyclicGroups + '</b>'
      + ' · 层数 <b>' + maxLayer + '</b>'
      + ' · 孤立模块 <b>' + model.parsed.isolated.length + '</b>'
      + ' · 用时 <b>' + elapsed.toFixed(1) + ' ms</b>';
  }

  function renderCycleList() {
    var cycles = model.cycles;
    cycleCount.textContent = '共 ' + cycles.length + ' 条';
    var idxs = [];
    for (var i = 0; i < cycles.length; i++) {
      if (filterComp !== null && model.cycleComp[i] !== filterComp) continue;
      idxs.push(i);
    }
    var shown = idxs.slice(0, MAX_CYCLES_SHOWN);
    var html = '';
    for (var k = 0; k < shown.length; k++) {
      var ci = shown[k];
      html += '<li data-idx="' + ci + '"' + (ci === activeCycle ? ' class="active"' : '') + '>'
        + esc(cycleLabel(cycles[ci])) + '</li>';
    }
    cycleList.innerHTML = html || '<span class="empty-note">无环</span>';
    if (idxs.length > MAX_CYCLES_SHOWN) {
      cycleList.innerHTML += '<div class="more-note">…仅展开前 ' + MAX_CYCLES_SHOWN + ' 条，其余 '
        + (idxs.length - MAX_CYCLES_SHOWN) + ' 条已计入总数</div>';
    }
    if (filterComp !== null) {
      var members = model.components[filterComp].members.join(', ');
      cycleFilter.textContent = '仅显示循环组 {' + members + '} 的环（点击取消过滤）';
      cycleFilter.classList.remove('hidden');
    } else {
      cycleFilter.classList.add('hidden');
    }
  }

  function renderTopo() {
    var html = '';
    for (var i = 0; i < model.topo.length; i++) {
      var c = model.components[model.topo[i]];
      if (c.cyclic) {
        var cycCount = 0;
        for (var j = 0; j < model.cycleComp.length; j++) if (model.cycleComp[j] === c.id) cycCount++;
        html += '<li class="topo-cycle">循环组 {' + esc(c.members.join(', ')) + '}（含 ' + cycCount + ' 条环，整组同一构建批次）</li>';
      } else {
        html += '<li>' + esc(c.members[0]) + '</li>';
      }
    }
    topoList.innerHTML = html || '<span class="empty-note">无</span>';
  }

  function renderIsolated() {
    var iso = model.parsed.isolated;
    isolatedList.innerHTML = iso.length
      ? iso.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('')
      : '<span class="empty-note">无</span>';
  }

  function clearInteractionState() {
    selectedNode = null;
    activeCycle = -1;
  }

  function doAnalyze() {
    var text = input.value;
    if (!text.trim()) {
      stats.textContent = '请输入依赖文本（或点「填入示例」）。';
      svg.innerHTML = '';
      cycleList.innerHTML = ''; topoList.innerHTML = ''; isolatedList.innerHTML = '';
      cycleCount.textContent = '';
      return;
    }
    var t0 = performance.now();
    model = ns.analyzeText(text);
    var layout = ns.computeLayout(model);
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + Math.max(layout.height, 120));
    svg.innerHTML = ns.buildSVG(model, layout);
    var elapsed = performance.now() - t0;

    clearInteractionState();
    filterComp = null;
    renderStats(elapsed);
    renderCycleList();
    renderTopo();
    renderIsolated();

    ns.attachInteraction(svg, model, {
      onNode: function (name) {
        if (selectedNode === name) {
          selectedNode = null;
          ns.clearHighlight(svg);
          return;
        }
        selectedNode = name;
        activeCycle = -1;
        renderCycleList();
        var cid = model.nodeToComp.get(name);
        var selfSet = new Set(model.components[cid].members);
        var upSet = ns.expandComps(model.closures.up[cid], model.components);
        var downSet = ns.expandComps(model.closures.down[cid], model.components);
        selfSet.forEach(function (m) { upSet.delete(m); downSet.delete(m); });
        ns.highlightSets(svg, selfSet, upSet, downSet);
      },
      onComp: function (compId) {
        filterComp = (filterComp === compId) ? null : compId;
        activeCycle = -1;
        renderCycleList();
      },
      onBackground: function () {
        clearInteractionState();
        ns.clearHighlight(svg);
        renderCycleList();
      }
    });
  }

  cycleList.addEventListener('click', function (ev) {
    var li = ev.target.closest('li');
    if (!li || !model) return;
    var idx = parseInt(li.getAttribute('data-idx'), 10);
    if (activeCycle === idx) {
      activeCycle = -1;
      ns.clearHighlight(svg);
    } else {
      activeCycle = idx;
      selectedNode = null;
      ns.highlightCycle(svg, model.cycles[idx]);
    }
    renderCycleList();
  });

  cycleFilter.addEventListener('click', function () {
    filterComp = null;
    renderCycleList();
  });

  document.getElementById('btn-analyze').addEventListener('click', doAnalyze);
  document.getElementById('btn-sample').addEventListener('click', function () {
    input.value = SAMPLE;
    doAnalyze();
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    input.value = '';
    stats.textContent = '等待分析…';
    svg.innerHTML = '';
    cycleList.innerHTML = ''; topoList.innerHTML = ''; isolatedList.innerHTML = '';
    cycleCount.textContent = '';
    model = null;
  });

  // 拖拽 .txt 进文本框
  input.addEventListener('dragover', function (ev) {
    ev.preventDefault();
    input.classList.add('dragover');
  });
  input.addEventListener('dragleave', function () { input.classList.remove('dragover'); });
  input.addEventListener('drop', function (ev) {
    ev.preventDefault();
    input.classList.remove('dragover');
    var file = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      input.value = String(reader.result || '');
      doAnalyze();
    };
    reader.readAsText(file);
  });

  // 自测
  document.getElementById('btn-selftest').addEventListener('click', function () {
    var panel = document.getElementById('selftest-panel');
    var list = document.getElementById('selftest-list');
    var summary = document.getElementById('selftest-summary');
    var out = ns.runSelfTests();
    var pass = out.results.filter(function (r) { return r.pass; }).length;
    summary.innerHTML = '通过 <b>' + pass + ' / ' + out.results.length + '</b>'
      + (out.perfMs !== null ? ' · 性能用例耗时 <b>' + out.perfMs + ' ms</b>' : '');
    list.innerHTML = out.results.map(function (r) {
      if (r.pass) return '<li class="pass">✅ ' + esc(r.name) + '</li>';
      return '<li class="fail">❌ ' + esc(r.name)
        + '<div class="detail">期望: ' + esc(r.expected) + '\n实际: ' + esc(r.actual) + '</div></li>';
    }).join('');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
})();
