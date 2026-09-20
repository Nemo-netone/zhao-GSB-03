/* 布局模块：按分层结果计算每个节点/循环组框的坐标（确定性）。
 * 层 = 最长路径层（0 在最上），同层分量按最小成员名字典序，成员按字典序。
 */
window.DepTool = window.DepTool || {};
(function (ns) {
  'use strict';

  var NODE_H = 34;
  var COMP_LABEL_H = 20;
  var PAD = 14;
  var GAP = 12;
  var COMP_GAP = 36;
  var LAYER_GAP = 92;
  var TOP_MARGIN = 28;
  var ISO_TITLE_H = 26;

  function charW(ch) { return ch.charCodeAt(0) > 255 ? 13 : 7.6; }
  function nodeW(name) {
    var w = 0;
    for (var i = 0; i < name.length; i++) w += charW(name[i]);
    return Math.max(70, Math.ceil(w) + 28);
  }
  ns.nodeWidth = nodeW;

  ns.computeLayout = function (model) {
    var components = model.components, layers = model.layers, isoCompIds = model.isoCompIds;
    var cmp = ns.cmp;

    // 分量尺寸
    var sizes = components.map(function (c) {
      if (!c.cyclic) return { w: nodeW(c.members[0]), h: NODE_H, cols: 1, cw: 0 };
      var n = c.members.length;
      var cols = Math.ceil(Math.sqrt(n));
      var rows = Math.ceil(n / cols);
      var cw = 0;
      c.members.forEach(function (m) { cw = Math.max(cw, nodeW(m)); });
      return {
        w: cols * cw + (cols - 1) * GAP + 2 * PAD,
        h: COMP_LABEL_H + rows * NODE_H + (rows - 1) * GAP + 2 * PAD - 4,
        cols: cols, cw: cw
      };
    });

    // 分层分组
    var maxLayer = -1;
    components.forEach(function (c, i) {
      if (!isoCompIds.has(i)) maxLayer = Math.max(maxLayer, layers[i]);
    });
    var byLayer = [];
    for (var l = 0; l <= maxLayer; l++) byLayer.push([]);
    components.forEach(function (c, i) {
      if (isoCompIds.has(i)) return;
      byLayer[layers[i]].push(i);
    });
    byLayer.forEach(function (arr) {
      arr.sort(function (a, b) { return cmp(components[a].members[0], components[b].members[0]); });
    });

    var layerH = byLayer.map(function (arr) {
      return arr.length ? Math.max.apply(null, arr.map(function (i) { return sizes[i].h; })) : 0;
    });
    var layerW = byLayer.map(function (arr) {
      var w = arr.reduce(function (s, i) { return s + sizes[i].w; }, 0);
      return w + Math.max(0, arr.length - 1) * COMP_GAP;
    });

    // 孤立模块区
    var iso = model.parsed.isolated;
    var isoW = 0;
    iso.forEach(function (m) { isoW = Math.max(isoW, nodeW(m)); });
    var width = Math.max(240, Math.max.apply(null, layerW.concat([0])) + 40);
    var isoCols = iso.length ? Math.max(1, Math.floor((width - 2 * PAD + GAP) / (isoW + GAP))) : 0;
    var isoRows = iso.length ? Math.ceil(iso.length / isoCols) : 0;
    var isoH = iso.length ? ISO_TITLE_H + isoRows * NODE_H + Math.max(0, isoRows - 1) * GAP + 2 * PAD : 0;

    // 纵向定位
    var nodePos = new Map();
    var compBox = new Map();
    var y = TOP_MARGIN;
    var layerY = [];
    for (var l2 = 0; l2 <= maxLayer; l2++) { layerY.push(y); y += layerH[l2] + LAYER_GAP; }
    for (var l3 = 0; l3 <= maxLayer; l3++) {
      var arr = byLayer[l3];
      if (!arr.length) continue;
      var x = (width - layerW[l3]) / 2;
      for (var k = 0; k < arr.length; k++) {
        var i = arr[k], s = sizes[i], c = components[i];
        var bx = x, by = layerY[l3];
        compBox.set(i, { x: bx, y: by, w: s.w, h: s.h });
        if (!c.cyclic) {
          nodePos.set(c.members[0], { x: bx, y: by, w: s.w, h: NODE_H, comp: i });
        } else {
          for (var m = 0; m < c.members.length; m++) {
            var col = m % s.cols, row = Math.floor(m / s.cols);
            nodePos.set(c.members[m], {
              x: bx + PAD + col * (s.cw + GAP),
              y: by + COMP_LABEL_H + PAD - 6 + row * (NODE_H + GAP),
              w: s.cw, h: NODE_H, comp: i
            });
          }
        }
        x += s.w + COMP_GAP;
      }
    }

    // 孤立模块区定位
    var isoBox = null;
    if (iso.length) {
      var iy = y - LAYER_GAP + 20;
      isoBox = { x: 10, y: iy, w: width - 20, h: isoH };
      for (var q = 0; q < iso.length; q++) {
        var icol = q % isoCols, irow = Math.floor(q / isoCols);
        nodePos.set(iso[q], {
          x: 10 + PAD + icol * (isoW + GAP),
          y: iy + ISO_TITLE_H + irow * (NODE_H + GAP),
          w: isoW, h: NODE_H, comp: -1
        });
      }
      y = iy + isoH + 20;
    }

    return { nodePos: nodePos, compBox: compBox, isoBox: isoBox, width: width, height: y + 10 };
  };
})(window.DepTool);
