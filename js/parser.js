/* 解析模块：把脏文本归一成 { nodes, edges, isolated }
 * 支持：->  <-  =>  <=  :  ：  逗号/中文逗号/顿号/分号多目标、链式 a -> b -> c、
 *       # 与 // 注释（引号内除外）、引号模块名、单行孤立模块。
 */
window.DepTool = window.DepTool || {};
(function (ns) {
  'use strict';

  var QUOTES = { '"': true, "'": true, '\u0060': true };
  var TWO_CHAR_SEPS = ['->', '<-', '=>', '<='];
  var ONE_CHAR_SEPS = { ':': true, '\uff1a': true };
  var LIST_SEPS = { ',': true, '\uff0c': true, '\u3001': true, ';': true, '\uff1b': true };

  function stripComment(line) {
    var inQ = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) { if (ch === inQ) inQ = null; continue; }
      if (QUOTES[ch]) { inQ = ch; continue; }
      if (ch === '#') return line.slice(0, i);
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }

  function cleanName(raw) {
    var s = raw.trim();
    var changed = true;
    while (changed && s.length >= 2) {
      changed = false;
      var f = s[0], l = s[s.length - 1];
      if (QUOTES[f] && f === l) { s = s.slice(1, -1).trim(); changed = true; }
    }
    return s;
  }

  function splitList(s) {
    var parts = [], cur = '', inQ = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQ) { cur += ch; if (ch === inQ) inQ = null; continue; }
      if (QUOTES[ch]) { inQ = ch; cur += ch; continue; }
      if (LIST_SEPS[ch]) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    var out = [];
    for (var j = 0; j < parts.length; j++) {
      var name = cleanName(parts[j]);
      if (name) out.push(name);
    }
    return out;
  }

  // 把一行切成 [part, sep, part, sep, ...]，分隔符识别需在引号外
  function tokenize(line) {
    var tokens = [], cur = '', inQ = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) { cur += ch; if (ch === inQ) inQ = null; continue; }
      if (QUOTES[ch]) { inQ = ch; cur += ch; continue; }
      var two = line.substr(i, 2);
      if (TWO_CHAR_SEPS.indexOf(two) >= 0) {
        tokens.push(cur, two); cur = ''; i++; continue;
      }
      if (ONE_CHAR_SEPS[ch]) { tokens.push(cur, ch); cur = ''; continue; }
      cur += ch;
    }
    tokens.push(cur);
    return tokens;
  }

  function isSep(tok) {
    return TWO_CHAR_SEPS.indexOf(tok) >= 0 || ONE_CHAR_SEPS[tok] === true;
  }
  function isReverse(sep) { return sep === '<-' || sep === '<='; }

  ns.parse = function (text) {
    var edgeSet = new Set();
    var edges = [];
    var nodeSet = new Set();
    var lines = String(text || '').split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
      var line = stripComment(lines[li]).trim();
      if (!line) continue;
      var tokens = tokenize(line);
      var sepCount = 0;
      for (var t = 0; t < tokens.length; t++) if (isSep(tokens[t])) sepCount++;
      if (sepCount === 0) {
        var single = splitList(tokens[0]);
        for (var s1 = 0; s1 < single.length; s1++) nodeSet.add(single[s1]);
        continue;
      }
      // tokens: part, sep, part, sep, part ... 链式逐段生成边
      for (var k = 0; k + 2 < tokens.length; k += 2) {
        var left = splitList(tokens[k]);
        var sep = tokens[k + 1];
        var right = splitList(tokens[k + 2]);
        var sources = isReverse(sep) ? right : left;
        var targets = isReverse(sep) ? left : right;
        for (var a = 0; a < sources.length; a++) nodeSet.add(sources[a]);
        for (var b = 0; b < targets.length; b++) nodeSet.add(targets[b]);
        for (var x = 0; x < sources.length; x++) {
          for (var y = 0; y < targets.length; y++) {
            var key = sources[x] + '\u0001' + targets[y];
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edges.push([sources[x], targets[y]]);
            }
          }
        }
      }
    }
    var inEdge = new Set();
    for (var e = 0; e < edges.length; e++) { inEdge.add(edges[e][0]); inEdge.add(edges[e][1]); }
    var nodes = Array.from(nodeSet).sort();
    var isolated = nodes.filter(function (n) { return !inEdge.has(n); });
    return { nodes: nodes, edges: edges, isolated: isolated };
  };
})(window.DepTool);
