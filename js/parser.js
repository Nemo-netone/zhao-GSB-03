/* parser.js — 脏文本依赖清单解析
 * 职责：注释剥离、等价箭头归一、多目标拆分、引号/空白清洗、重复边合并。
 * 输出纯数据：{ nodes: string[], edges: [from,to][], stats: {...} }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DepParser = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 等价箭头：--> -> => → ⟶ depends on : ：（长的写在前面）
  const ARROW_RE = /-->|->|=>|→|⟶|depends\s+on|[:：]/g;
  // 多目标分隔符：半角/全角逗号、分号
  const TARGET_SPLIT_RE = /[,，;；]/;
  const NODE_SPLIT_RE = /[,，;；]/;
  const SEP = '\u0000';

  // 剥离注释：# 与 // 行注释、-- 注释；引号（单/双）内的内容原样保留。
  // 例外：--> 是合法箭头，不能当注释。
  function stripComment(line) {
    let out = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        out += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        out += ch;
        continue;
      }
      if (ch === '#') break;
      if (ch === '/' && line[i + 1] === '/') break;
      if (ch === '-' && line[i + 1] === '-' && line[i + 2] !== '>') break;
      out += ch;
    }
    return out;
  }

  // 清洗模块名：整体被成对引号包裹 → 去引号、保留内部空格；否则移除全部空白。
  function cleanName(raw) {
    let s = raw.trim();
    if (s.length >= 2) {
      const first = s[0];
      const last = s[s.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return s.slice(1, -1).trim();
      }
    }
    return s.replace(/\s+/g, '');
  }

  function splitBy(sepRe, text) {
    return text.split(sepRe).map(cleanName).filter(Boolean);
  }

  // 按所有箭头切成链段，例如 a -> b -> c,d  =>  ['a','b','c,d']
  function splitArrows(text) {
    ARROW_RE.lastIndex = 0;
    const segments = [];
    let last = 0;
    let m;
    while ((m = ARROW_RE.exec(text)) !== null) {
      segments.push(text.slice(last, m.index));
      last = m.index + m[0].length;
    }
    segments.push(text.slice(last));
    return segments;
  }

  function parse(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const nodeSet = new Set();
    const edgeSet = new Set();
    const edges = [];
    let rawEdges = 0;
    let duplicateEdges = 0;
    let ignoredLines = 0;
    let contentLines = 0;

    function addNode(n) { nodeSet.add(n); }
    function addEdge(a, b) {
      addNode(a); addNode(b);
      rawEdges++;
      const key = a + SEP + b;
      if (edgeSet.has(key)) { duplicateEdges++; return; }
      edgeSet.add(key);
      edges.push([a, b]);
    }

    for (const rawLine of lines) {
      const line = stripComment(rawLine).trim();
      if (!line) { ignoredLines++; continue; }
      contentLines++;

      const segments = splitArrows(line);
      if (segments.length < 2) {
        // 没有箭头：当作节点声明（可能是孤立模块），逗号/分号可列多个
        const names = splitBy(NODE_SPLIT_RE, segments[0]);
        if (!names.length) ignoredLines++;
        names.forEach(addNode);
        continue;
      }

      // 链式：a -> b -> c,d  产生 a->b、b->c、b->d
      const chain = segments.slice(0, -1).map(cleanName);
      const targets = splitBy(TARGET_SPLIT_RE, segments[segments.length - 1]);
      if (!chain.length || !chain[0] || !targets.length) {
        ignoredLines++;
        continue;
      }
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i] && chain[i + 1]) addEdge(chain[i], chain[i + 1]);
      }
      const tail = chain[chain.length - 1];
      for (const t of targets) addEdge(tail, t);
    }

    const nodes = Array.from(nodeSet).sort();
    return {
      nodes,
      edges,
      stats: {
        totalLines: lines.length,
        contentLines,
        ignoredLines,
        rawEdges,
        uniqueEdges: edges.length,
        duplicateEdges,
        nodeCount: nodes.length,
      },
    };
  }

  return { parse, stripComment, cleanName };
});
