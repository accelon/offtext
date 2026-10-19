/* 圖譜
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 圖譜 ---------- */

  const GRAPH_MAX_NODES = 48;
  const GRAPH_EDGE_WIDTHS = { thin: 1.2, medium: 2.4, thick: 4 };
  const GRAPH_PANEL_KEY = 'offtext.graphPanel.v1';
  let graphPanelCollapsed = false;
  try {
    graphPanelCollapsed = localStorage.getItem(GRAPH_PANEL_KEY) === '1';
  } catch (e) {
    /* 私密模式 */
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value != null) node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  const GRAPH_BREAK_SUFFIXES = [
    'contamination',
    'reinforcement',
    'engineering',
    'propagation',
    'supervised',
    'computing',
    'attention',
    'database',
    'function',
    'diffusion',
    'learning',
    'network',
    'fitting',
    'ability',
    'decoding',
    'privacy',
    'driving',
    'calling',
    'window',
    'tensors',
    'weights',
    'prompt',
    'collapse',
    'algebra',
    'ization',
    'former',
    'source',
    'format',
    'descent',
    'model',
    'meter',
    'typed',
    'tensor',
    'modal',
    'code',
    'type',
    'data',
    'face',
    'izer',
    'gen',
    'use',
  ].sort((a, b) => b.length - a.length);

  function graphLabel(key, domain) {
    const text = disp(key === '_' ? domainName(domain) : String(key));
    const hasHan = /[\u3400-\u9fff]/.test(text);

    if (hasHan) {
      // 中文：4 字以內一行；5 字起換行，最多 3 行，讓圓圈可以縮小。
      if (text.length <= 4) return [text];
      const lineCount = Math.min(3, Math.ceil(text.length / 4));
      const perLine = Math.ceil(text.length / lineCount);
      const lines = [];
      for (let i = 0; i < lineCount; i++) {
        lines.push(text.slice(i * perLine, (i + 1) * perLine));
      }
      return lines.filter(Boolean);
    }

    // 英文／數字：短詞不拆。
    if (text.length <= 10) return [text];

    // 先找常見的英文複合詞尾，避免把 diffusionmodel 切成 diffusi/onmodel。
    for (const suffix of GRAPH_BREAK_SUFFIXES) {
      if (!text.endsWith(suffix)) continue;
      const head = text.slice(0, -suffix.length);
      if (head.length >= 3 && head.length <= 12 && suffix.length <= 12) {
        return [head, suffix];
      }
    }

    // 有空白／連字號時以詞為單位裝行；沒有就整詞一行，不把英文單字切一半。
    const words = text.split(/[\s_-]+/).filter(Boolean);
    if (words.length > 1) {
      const lineCount = Math.min(3, words.length);
      const target = Math.ceil(text.length / lineCount);
      const lines = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word;
        if (line && candidate.length > target && lines.length < lineCount - 1) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines;
    }
    return [text];
  }

  function graphTextWidth(line, fontSize) {
    const size = fontSize || state.graph.fontSize || 12;
    let width = 0;
    for (const ch of line) width += /[\u3400-\u9fff]/.test(ch) ? size : size * 0.6;
    return width;
  }

  function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return h / 997;
  }

  function graphRadius(node) {
    const size = state.graph.fontSize;
    const value = graphDegree(node.id);
    const base = 12 + Math.min(22, Math.sqrt(value) * 4.5);
    const lines = graphLabel(node.key, node.domain);
    const pad = 6;
    const fit = Math.max(
      ...lines.map((line) => graphTextWidth(line, size) / 2 + pad),
      (lines.length * size * 1.12) / 2 + pad
    );
    const min = node.depth === 0 ? size * 1.9 : size * 1.15;
    return Math.max(min, base, fit);
  }

  function graphShortDomain(id) {
    if (id === 'aijargon') return 'AI';
    return disp(domainName(id)).slice(0, 1);
  }

  const graphTip = el('div', 'graph-tip');
  graphTip.hidden = true;
  document.body.append(graphTip);

  function hideGraphTip() {
    graphTip.hidden = true;
  }

  function moveGraphTip(x, y) {
    const pad = 12;
    const box = graphTip.getBoundingClientRect();
    let left = x + 16;
    let top = y + 16;
    if (left + box.width > window.innerWidth - pad) left = x - box.width - 16;
    if (top + box.height > window.innerHeight - pad) top = y - box.height - 16;
    graphTip.style.left = Math.max(pad, left) + 'px';
    graphTip.style.top = Math.max(pad, top) + 'px';
  }

  function showGraphTip(node, x, y) {
    const domain = state.index.byId.get(node.domain);
    const value = domain ? domain.entries.get(node.key) : '';
    const text = NT.plainText(value || '').replace(/\s+/g, ' ').trim();
    const counts = graphCounts(node.id);

    graphTip.textContent = '';
    const head = el('div', 'graph-tip-head');
    head.append(el('strong', 'graph-tip-key', disp(displayKey(node.domain, node.key))));
    head.append(el('span', 'graph-tip-domain', disp(domainName(node.domain))));
    graphTip.append(head);
    graphTip.append(
      el(
        'div',
        'graph-tip-meta',
        '順 ' + counts.forward + ' · 逆 ' + counts.back + ' · 深度 ' + node.depth
      )
    );
    graphTip.append(
      el(
        'p',
        'graph-tip-body',
        disp(text.length > 260 ? text.slice(0, 260) + '…' : text || '（尚無釋文）')
      )
    );
    graphTip.hidden = false;
    moveGraphTip(x, y);
  }

  function buildGraph(rootId, opts) {
    const nodes = new Map();
    const root = nodeInfo(rootId);
    const tree = new Set();
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    nodes.set(rootId, { ...root, depth: 0 });
    let frontier = [rootId];
    let truncated = false;

    for (let level = 0; level < opts.depth; level++) {
      const candidates = new Map();
      for (const id of frontier) {
        const next = new Set();
        if (opts.forward) {
          for (const target of state.index.links.forward.get(id) || []) next.add(target);
        }
        if (opts.backward) {
          for (const source of state.index.links.backward.get(id) || []) next.add(source);
        }
        for (const other of next) {
          if (nodes.has(other) || other === rootId) continue;
          const found = candidates.get(other);
          if (found) found.count++;
          else candidates.set(other, { count: 1, parent: id });
        }
      }

      const ordered = [...candidates.keys()].sort((a, b) => {
        const crossA = candidates.get(a).count;
        const crossB = candidates.get(b).count;
        if (crossA !== crossB) return crossB - crossA;
        const degree = graphDegree(b) - graphDegree(a);
        if (degree) return degree;
        return a.localeCompare(b);
      });

      const nextFrontier = [];
      for (const id of ordered) {
        if (nodes.size >= GRAPH_MAX_NODES) {
          truncated = true;
          break;
        }
        const parent = candidates.get(id).parent;
        nodes.set(id, { ...nodeInfo(id), depth: level + 1, parent });
        tree.add(pairKey(parent, id));
        nextFrontier.push(id);
      }

      frontier = nextFrontier;
      if (!frontier.length || nodes.size >= GRAPH_MAX_NODES) break;
    }

    const edges = [];
    const seen = new Set();
    const addEdge = (from, to, kind) => {
      const key = from + '|' + to + '|' + kind;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ from, to, kind, tree: tree.has(pairKey(from, to)) });
    };

    for (const id of nodes.keys()) {
      if (opts.forward) {
        for (const target of state.index.links.forward.get(id) || []) {
          if (nodes.has(target)) addEdge(id, target, 'forward');
        }
      }
      if (opts.backward) {
        for (const source of state.index.links.backward.get(id) || []) {
          if (nodes.has(source)) addEdge(source, id, 'back');
        }
      }
    }

    return { rootId, nodes, edges, truncated };
  }

  function layoutGraph(graph, width, height) {
    const nodes = [...graph.nodes.values()];
    nodes.forEach((node) => {
      node.r = graphRadius(node);
    });

    const cx = width / 2;
    const cy = height / 2;
    const edgeFactor =
      state.graph.edgeLength === 'short' ? 0.78 : state.graph.edgeLength === 'long' ? 1.28 : 1;
    const byDepth = new Map();
    nodes.forEach((node) => {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
      byDepth.get(node.depth).push(node);
    });

    const angleOf = (node) => Math.atan2(node.y - cy, node.x - cx);
    [...byDepth.keys()]
      .sort((a, b) => a - b)
      .forEach((depth) => {
        const group = byDepth.get(depth);
        // 同一層依父節點角度排序，讓相鄰子樹排在一起，先減少交錯。
        group.sort((a, b) => {
          const pa = a.parent ? graph.nodes.get(a.parent) : null;
          const pb = b.parent ? graph.nodes.get(b.parent) : null;
          if (pa && pb) {
            const diff = angleOf(pa) - angleOf(pb);
            if (Math.abs(diff) > 0.001) return diff;
          }
          const metric = graphDegree(b.id) - graphDegree(a.id);
          if (metric) return metric;
          return a.id.localeCompare(b.id);
        });

        const rx = Math.min(width * 0.42, (82 + depth * 74) * edgeFactor);
        const ry = Math.min(height * 0.42, (82 + depth * 92) * edgeFactor);
        group.forEach((node, i) => {
          if (depth === 0) {
            node.x = cx;
            node.y = cy;
            return;
          }
          const angle = (i / group.length) * Math.PI * 2 + hashId(node.id) * 0.18;
          node.x = cx + Math.cos(angle) * rx;
          node.y = cy + Math.sin(angle) * ry;
        });
      });

    const baseRest = Math.max(76, Math.min(152, width / 4.6)) * edgeFactor;
    for (let iter = 0; iter < 240; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const min = a.r + b.r + 8;
          let force = 5000 / (dist * dist);
          if (dist < min) force += (min - dist) * 0.4;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (a.depth !== 0) {
            a.x -= fx;
            a.y -= fy;
          }
          if (b.depth !== 0) {
            b.x += fx;
            b.y += fy;
          }
        }
      }

      for (const edge of graph.edges) {
        const a = graph.nodes.get(edge.from);
        const b = graph.nodes.get(edge.to);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const rest = baseRest + (a.depth === 0 || b.depth === 0 ? 35 : 0);
        // 只讓 BFS 樹邊有較強彈簧；多出來的交叉邊只輕輕拉住，減少圖面被拉成一團。
        const force = (dist - rest) * (edge.tree ? 0.018 : 0.003);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (a.depth !== 0) {
          a.x += fx;
          a.y += fy;
        }
        if (b.depth !== 0) {
          b.x -= fx;
          b.y -= fy;
        }
      }

      for (const node of nodes) {
        if (node.depth === 0) continue;
        node.x += (cx - node.x) * 0.0004;
        node.y += (cy - node.y) * 0.0004;
        node.x = Math.max(node.r + 8, Math.min(width - node.r - 8, node.x));
        node.y = Math.max(node.r + 8, Math.min(height - node.r - 8, node.y));
      }
    }

    // 最後再單純推開重疊的圓，讓節點多時仍然讀得到詞目。
    for (let pass = 0; pass < 160; pass++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          const min = a.r + b.r + 8;
          if (dist >= min) continue;
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const push = (min - dist) * 0.55 + 0.5;
          const ux = dx / dist;
          const uy = dy / dist;
          if (a.depth !== 0) {
            a.x -= ux * push;
            a.y -= uy * push;
          }
          if (b.depth !== 0) {
            b.x += ux * push;
            b.y += uy * push;
          }
          moved = true;
        }
      }
      for (const node of nodes) {
        node.x = Math.max(node.r + 8, Math.min(width - node.r - 8, node.x));
        node.y = Math.max(node.r + 8, Math.min(height - node.r - 8, node.y));
      }
      if (!moved) break;
    }

    // 節點少時把位置放大，讓圖不要縮在中央；只放大座標，圓與字不變。
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      minY = Math.min(minY, node.y - node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(1.8, (width - 80) / spanX, (height - 80) / spanY);
    if (scale > 1.02) {
      const root = graph.nodes.get(graph.rootId);
      for (const node of nodes) {
        node.x = cx + (node.x - root.x) * scale;
        node.y = cy + (node.y - root.y) * scale;
      }
    }

    // 根節點固定畫布正中央；若放大後有節點超出畫布，再以根節點為中心縮小。
    // 這樣 Ctrl 點新節點重繪時，新中心一定落在 viewBox 的正中央。
    const root = graph.nodes.get(graph.rootId);
    root.x = cx;
    root.y = cy;
    const halfW = Math.max(60, width / 2 - 24);
    const halfH = Math.max(60, height / 2 - 24);
    let maxDx = 0;
    let maxDy = 0;
    for (const node of nodes) {
      if (node === root) continue;
      maxDx = Math.max(maxDx, Math.abs(node.x - root.x) + node.r);
      maxDy = Math.max(maxDy, Math.abs(node.y - root.y) + node.r);
    }
    const fit = Math.min(1, halfW / Math.max(1, maxDx), halfH / Math.max(1, maxDy));
    if (fit < 1) {
      for (const node of nodes) {
        node.x = root.x + (node.x - root.x) * fit;
        node.y = root.y + (node.y - root.y) * fit;
      }
    }
  }

  function cycleGraphFocus(id) {
    const focus = state.graph.focus;
    if (!focus || focus.id !== id) state.graph.focus = { id, mode: 1 };
    else if (focus.mode === 1) state.graph.focus = { id, mode: 2 };
    else state.graph.focus = null;
    render();
  }

  function renderGraphControls(graph) {
    const box = el('div', 'graph-controls');

    const depthLabel = el('label', 'graph-control');
    depthLabel.append(document.createTextNode('層數'));
    const depth = document.createElement('select');
    [1, 2, 3].forEach((n) => {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = String(n);
      depth.append(option);
    });
    depth.id = 'graphDepth';
    depth.value = String(state.graph.depth);
    depth.addEventListener('change', () => {
      state.graph.depth = Number(depth.value);
      state.graph.focus = null;
      render();
    });
    depthLabel.append(depth);

    const fontLabel = el('label', 'graph-control graph-font-control');
    fontLabel.append(document.createTextNode('字級'));
    const font = document.createElement('input');
    font.type = 'range';
    font.id = 'graphFontSize';
    font.min = '12';
    font.max = '24';
    font.step = '0.1';
    font.value = String(state.graph.fontSize);
    const formatSize = (value) => {
      const n = Number(value);
      return (Math.round(n * 10) / 10).toString() + 'px';
    };
    const fontValue = el('span', 'graph-font-value', formatSize(state.graph.fontSize));
    font.addEventListener('input', () => {
      fontValue.textContent = formatSize(font.value);
    });
    font.addEventListener('change', () => {
      state.graph.fontSize = Number(font.value);
      state.graph.focus = null;
      render();
    });
    fontLabel.append(font, fontValue);

    const edgeLabel = el('label', 'graph-control');
    edgeLabel.append(document.createTextNode('連線'));
    const edge = document.createElement('select');
    edge.id = 'graphEdgeLength';
    [
      ['short', '短'],
      ['medium', '中'],
      ['long', '長'],
    ].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      edge.append(option);
    });
    edge.value = state.graph.edgeLength;
    edge.addEventListener('change', () => {
      state.graph.edgeLength = edge.value;
      state.graph.focus = null;
      render();
    });
    edgeLabel.append(edge);

    const widthLabel = el('label', 'graph-control');
    widthLabel.append(document.createTextNode('線粗'));
    const lineWidth = document.createElement('select');
    lineWidth.id = 'graphEdgeWidth';
    [
      ['thin', '細'],
      ['medium', '中'],
      ['thick', '粗'],
    ].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      lineWidth.append(option);
    });
    lineWidth.value = state.graph.edgeWidth;
    lineWidth.addEventListener('change', () => {
      state.graph.edgeWidth = lineWidth.value;
      state.graph.focus = null;
      render();
    });
    widthLabel.append(lineWidth);

    const check = (key, text) => {
      const label = el('label', 'graph-check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = key === 'forward' ? 'graphForward' : 'graphBackward';
      input.checked = state.graph[key];
      input.addEventListener('change', () => {
        state.graph[key] = input.checked;
        state.graph.focus = null;
        render();
      });
      label.append(input);
      label.append(document.createTextNode(text));
      return label;
    };

    const count = el(
      'span',
      'graph-count',
      graph.nodes.size + ' 個節點 · ' + graph.edges.length + ' 條連線'
    );

    const reset = el('button', 'graph-reset', '重設');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      state.graph.depth = 2;
      state.graph.forward = true;
      state.graph.backward = true;
      state.graph.fontSize = 12;
      state.graph.edgeLength = 'medium';
      state.graph.edgeWidth = 'medium';
      state.graph.focus = null;
      render();
    });

    box.append(
      depthLabel,
      fontLabel,
      edgeLabel,
      widthLabel,
      check('forward', '順鏈結'),
      check('backward', '逆鏈結'),
      count,
      reset
    );
    return box;
  }

  function renderGraphLegend() {
    const legend = el('div', 'graph-legend');
    legend.append(el('span', 'graph-legend-label', '深度'));

    for (let d = 0; d <= state.graph.depth; d++) {
      const chip = el('span', 'graph-swatch');
      chip.style.setProperty('--h', String(NT.hue(d)));
      legend.append(chip);
    }
    legend.append(el('span', 'graph-legend-label', '0 → ' + state.graph.depth));

    const addLine = (cls, text) => {
      const item = el('span', 'graph-legend-item');
      item.append(el('span', 'graph-legend-line ' + cls));
      item.append(document.createTextNode(text));
      legend.append(item);
    };
    addLine('is-forward', '順鏈結');
    addLine('is-back', '逆鏈結');
    legend.append(el('span', 'graph-legend-item', '大小＝連結數'));

    const badge = el('span', 'graph-legend-item');
    badge.append(el('span', 'graph-legend-badge', '生'));
    badge.append(document.createTextNode('其他科目'));
    legend.append(badge);
    return legend;
  }

  /**
   * 圖譜設定：半透明浮在畫布上，可收合成一行，讓圖譜拿到更多畫面。
   * 收合狀態存在 localStorage（offtext.graphPanel.v1）。
   */
  function renderGraphPanel(graph) {
    const panel = el('div', 'graph-panel' + (graphPanelCollapsed ? ' is-collapsed' : ''));
    const head = el('div', 'graph-panel-head');
    const toggle = el('button', 'graph-panel-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!graphPanelCollapsed));
    toggle.setAttribute('aria-controls', 'graphPanelBody');
    toggle.title = graphPanelCollapsed ? '展開圖譜設定' : '收合圖譜設定';

    const chevron = el('span', 'graph-panel-chevron', '▾');
    toggle.append(
      el('span', 'graph-panel-icon', '⚙'),
      el('span', 'graph-panel-label', '圖譜設定'),
      chevron
    );

    const body = el('div', 'graph-panel-body');
    body.id = 'graphPanelBody';
    body.append(renderGraphControls(graph), renderGraphLegend());
    panel.append(head, body);
    head.append(toggle);

    toggle.addEventListener('click', () => {
      graphPanelCollapsed = !graphPanelCollapsed;
      panel.classList.toggle('is-collapsed', graphPanelCollapsed);
      toggle.setAttribute('aria-expanded', String(!graphPanelCollapsed));
      toggle.title = graphPanelCollapsed ? '展開圖譜設定' : '收合圖譜設定';
      try {
        localStorage.setItem(GRAPH_PANEL_KEY, graphPanelCollapsed ? '1' : '0');
      } catch (e) {
        /* 私密模式 */
      }
    });

    return panel;
  }

  function renderGraphFocusBar(graph) {
    const focus = state.graph.focus;
    if (!focus) return null;
    const node = graph.nodes.get(focus.id);
    if (!node || node.id === graph.rootId) return null;
    const bar = el('div', 'graph-focus-bar');
    bar.append(
      el(
        'span',
        'graph-focus-label',
        '已選：' +
          disp(node.key) +
          ' · ' +
          (focus.mode === 2 ? '逆鏈' : '順鏈')
      )
    );
    const center = el('button', 'graph-focus-center', '設成中心');
    center.type = 'button';
    center.title = '以「' + disp(node.key) + '」為圖譜中心，不離開圖譜';
    center.addEventListener('click', () =>
      navigateGraph(node.domain, node.key, { recenter: true })
    );
    bar.append(center);
    return bar;
  }

  function renderGraphSvg(graph, rootDomain, width, height) {
    const focus = state.graph.focus;
    const litEdges = new Set();
    const litNodes = new Set();

    if (focus) {
      litNodes.add(focus.id);
      for (const edge of graph.edges) {
        if (focus.mode === 1 && edge.kind === 'forward' && edge.from === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.to);
        } else if (focus.mode === 2 && edge.kind === 'back' && edge.to === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.from);
        }
      }
    }

    const svg = svgEl('svg', {
      class: 'graph-svg',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': '條目鏈結圖譜',
    });
    svg.style.setProperty('--graph-font-size', state.graph.fontSize + 'px');
    svg.style.setProperty(
      '--graph-edge-width',
      (GRAPH_EDGE_WIDTHS[state.graph.edgeWidth] || 2.4) + 'px'
    );
    const defs = svgEl('defs');
    const arrow = svgEl('marker', {
      id: 'graph-arrow',
      viewBox: '0 0 10 10',
      refX: '9.5',
      refY: '5',
      markerWidth: '5.5',
      markerHeight: '5.5',
      orient: 'auto',
      markerUnits: 'strokeWidth',
    });
    arrow.append(
      svgEl('path', {
        class: 'graph-arrow-head',
        d: 'M 0 0 L 10 5 L 0 10 z',
        fill: 'context-stroke',
      })
    );
    defs.append(arrow);
    svg.append(defs);
    const bg = svgEl('rect', {
      class: 'graph-bg',
      width,
      height,
    });
    svg.append(bg);

    const edgeLayer = svgEl('g', { class: 'graph-edge-layer' });
    const reverse = new Set(graph.edges.map((edge) => edge.to + '|' + edge.from));
    graph.edges.forEach((edge) => {
      const a = graph.nodes.get(edge.from);
      const b = graph.nodes.get(edge.to);
      if (!a || !b) return;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ux = dx / dist;
      const uy = dy / dist;
      const both = reverse.has(edge.from + '|' + edge.to);
      const off = both ? 2.2 : 0;
      const sign = edge.from < edge.to ? 1 : -1;
      const ox = -uy * off * sign;
      const oy = ux * off * sign;
      const x1 = a.x + ux * (a.r + 2) + ox;
      const y1 = a.y + uy * (a.r + 2) + oy;
      const x2 = b.x - ux * (b.r + 3) + ox;
      const y2 = b.y - uy * (b.r + 3) + oy;

      let cls = 'graph-edge is-' + edge.kind + (edge.tree ? ' is-tree' : ' is-extra');
      if (focus) cls += litEdges.has(edge) ? ' is-lit' : ' is-dim';

      const line = svgEl('line', {
        class: cls,
        x1,
        y1,
        x2,
        y2,
        'marker-end': 'url(#graph-arrow)',
        'data-from': edge.from,
        'data-to': edge.to,
        'data-kind': edge.kind,
      });
      line.style.setProperty('--hue', String(NT.hue(Math.max(a.depth, b.depth))));
      edgeLayer.append(line);
    });
    svg.append(edgeLayer);

    const nodeLayer = svgEl('g', { class: 'graph-node-layer' });
    const ordered = [...graph.nodes.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    ordered.forEach((node) => {
      const cross = node.domain !== rootDomain;
      let cls = 'graph-node';
      if (node.id === graph.rootId) cls += ' is-root';
      if (cross) cls += ' is-cross';
      if (focus) {
        if (node.id === focus.id) cls += ' is-selected';
        else if (litNodes.has(node.id)) cls += ' is-lit';
        else cls += ' is-dim';
      }

      const group = svgEl('g', {
        class: cls,
        transform: 'translate(' + node.x + ' ' + node.y + ')',
        tabindex: 0,
        role: 'button',
        'data-id': node.id,
        'data-key': node.key,
        'data-depth': node.depth,
        'aria-label':
          disp(domainName(node.domain)) +
          ' ' +
          disp(node.key) +
          '；點擊切換順鏈／逆鏈高亮；Ctrl 點擊以此為起點',
      });
      group.style.setProperty('--hue', String(NT.hue(node.depth)));

      const counts = graphCounts(node.id);
      const title = svgEl('title');
      title.textContent =
        disp(domainName(node.domain)) +
        '：' +
        disp(node.key) +
        '（順 ' +
        counts.forward +
        '／逆 ' +
        counts.back +
        '／深度 ' +
        node.depth +
        '）';
      group.append(title);

      if (cross) {
        group.append(svgEl('circle', { class: 'graph-node-halo', r: node.r + 3 }));
      }
      group.append(svgEl('circle', { class: 'graph-node-circle', r: node.r }));

      const lines = graphLabel(node.key, node.domain);
      const text = svgEl('text', {
        class: 'graph-node-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      lines.forEach((line, i) => {
        const tspan = svgEl('tspan', {
          x: 0,
          y: (i - (lines.length - 1) / 2) * state.graph.fontSize * 1.1,
        });
        tspan.textContent = line;
        text.append(tspan);
      });
      group.append(text);

      if (cross) {
        const badge = svgEl('g', { class: 'graph-badge' });
        badge.append(svgEl('circle', { cx: node.r * 0.72, cy: -node.r * 0.72, r: 8 }));
        const badgeText = svgEl('text', {
          x: node.r * 0.72,
          y: -node.r * 0.72 + 2.5,
          'text-anchor': 'middle',
        });
        badgeText.textContent = graphShortDomain(node.domain);
        badge.append(badgeText);
        group.append(badge);
      }

      group.addEventListener('mouseenter', (e) => showGraphTip(node, e.clientX, e.clientY));
      group.addEventListener('mousemove', (e) => {
        if (!graphTip.hidden) moveGraphTip(e.clientX, e.clientY);
      });
      group.addEventListener('mouseleave', hideGraphTip);
      group.addEventListener('focus', () => {
        const rect = group.getBoundingClientRect();
        showGraphTip(node, rect.left + rect.width / 2, rect.top);
      });
      group.addEventListener('blur', hideGraphTip);

      group.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== 'mobile') {
          e.preventDefault();
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });
      group.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== 'mobile') {
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });

      nodeLayer.append(group);
    });
    svg.append(nodeLayer);

    bg.addEventListener('click', () => {
      if (!state.graph.focus) return;
      state.graph.focus = null;
      render();
    });

    return svg;
  }

  function graphContentWidth() {
    const style = getComputedStyle(reader);
    const pad = parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0);
    return Math.max(320, Math.round(reader.clientWidth - pad));
  }

  function graphCanvasHeight(count, width) {
    const fontFactor = 1 + ((state.graph.fontSize - 12) / 12) * 0.65;
    const edgeFactor =
      state.graph.edgeLength === 'short' ? 0.9 : state.graph.edgeLength === 'long' ? 1.15 : 1;
    const base = width * 0.55 + Math.max(0, count - 6) * 24;
    return Math.max(460, Math.min(2800, Math.round(base * fontFactor * edgeFactor)));
  }

  function renderGraph() {
    hideGraphTip();
    const res = NT.resolve(state.index, state.root.key, state.root.domain);
    if (res.status !== 'ok') {
      reader.append(emptyState(res));
      return;
    }

    const rootId = res.domain + ':' + res.key;
    const graph = buildGraph(rootId, state.graph);
    if (state.graph.focus && !graph.nodes.has(state.graph.focus.id)) state.graph.focus = null;
    const width = graphContentWidth();
    const height = graphCanvasHeight(graph.nodes.size, width);
    layoutGraph(graph, width, height);


    const article = el('article', 'graph');
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', '圖譜 · ' + disp(domainName(res.domain))));

    const titleRow = el('div', 'entry-title-row');
    titleRow.append(
      el('h1', 'entry-title', disp(displayKey(res.domain, res.key)))
    );
    const back = el('button', 'graph-back', '回到條目');
    back.type = 'button';
    back.addEventListener('click', () => navigate(res.domain, res.key));
    titleRow.append(back);
    head.append(titleRow);
    head.append(
      el(
        'p',
        'index-hint',
        '以「' +
          disp(displayKey(res.domain, res.key)) +
          '」為起點。滑過節點看釋文；點節點切換順鏈／逆鏈高亮；Ctrl/⌘+點擊以它為起點重繪。'
      )
    );
    article.append(head);

    const stage = el('div', 'graph-stage');
    stage.append(renderGraphPanel(graph));
    const canvas = el('div', 'graph-canvas');
    canvas.append(renderGraphSvg(graph, res.domain, width, height));
    stage.append(canvas);
    const focusBar = renderGraphFocusBar(graph);
    if (focusBar) stage.append(focusBar);
    article.append(stage);

    if (!graph.edges.length) {
      article.append(
        el(
          'p',
          'graph-note',
          state.graph.forward || state.graph.backward
            ? '目前設定下沒有可畫的連線。試試增加層數。'
            : '順鏈結與逆鏈結都關閉了；開啟至少一種才會畫線。'
        )
      );
    }
    if (graph.truncated) {
      article.append(
        el(
          'p',
          'graph-note',
          '節點超過 ' +
            GRAPH_MAX_NODES +
            ' 個，只顯示 ' +
            graph.nodes.size +
            ' 個；降低層數或關閉其中一種鏈結可看得更清楚。'
        )
      );
    }

    reader.append(article);
  }

  /* ---------- 索引：用 graph 連線數探索節點 ---------- */

  const INDEX_VIEWS = [
    ['all', '全部'],
    ['zero', '零連結'],
    ['cross', '跨領域'],
    ['both', '兩邊都有'],
  ];
  const INDEX_SORTS = [
    ['product', '乘積（順×逆）'],
    ['forward', '順鏈次數'],
    ['back', '逆鏈次數'],
    ['cross', '跨領域連線'],
    ['name', '名稱'],
  ];
  const INDEX_PAGE_SIZE = 120;

  let indexRowCache = null;
  let indexRowCacheFor = null;
  let indexRowCacheMode = -1;

  function indexCount(domain) {
    let n = 0;
    for (const [key, value] of domain.entries) {
      if (key === '_' || isReservedKey(key) || isRedirect(value)) continue;
      n++;
    }
    return n;
  }

  function indexRows() {
    const mode = SETTINGS ? SETTINGS.simModeOf() : 0;
    if (indexRowCache && indexRowCacheFor === state.index && indexRowCacheMode === mode) {
      return indexRowCache;
    }

    const rows = [];
    for (const entry of entries) {
      const id = entry.domain + ':' + entry.key;
      const forwardSet = state.index.links.forward.get(id);
      const backwardSet = state.index.links.backward.get(id);
      let forward = 0;
      let back = 0;
      let crossOut = 0;
      let crossIn = 0;
      const crossCounts = new Map();
      const addCross = (domain) => {
        crossCounts.set(domain, (crossCounts.get(domain) || 0) + 1);
      };

      if (forwardSet) {
        forward = forwardSet.size;
        for (const target of forwardSet) {
          const domain = target.slice(0, target.indexOf(':'));
          if (domain !== entry.domain) {
            crossOut++;
            addCross(domain);
          }
        }
      }
      if (backwardSet) {
        back = backwardSet.size;
        for (const source of backwardSet) {
          const domain = source.slice(0, source.indexOf(':'));
          if (domain !== entry.domain) {
            crossIn++;
            addCross(domain);
          }
        }
      }

      const crossDomains = [...crossCounts.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort(
          (a, b) =>
            b.count - a.count ||
            domainName(a.domain).localeCompare(domainName(b.domain), 'zh-Hant')
        );

      rows.push({
        ...entry,
        id,
        forward,
        back,
        product: forward * back,
        crossOut,
        crossIn,
        cross: crossOut + crossIn,
        crossDomains,
      });
    }

    indexRowCache = rows;
    indexRowCacheFor = state.index;
    indexRowCacheMode = mode;
    return rows;
  }

  function indexZeroKind(row) {
    if (!row.forward && !row.back) return 'none';
    if (!row.forward) return 'no-forward';
    return 'no-back';
  }

  function indexZeroLabel(row) {
    return { none: '全無', 'no-forward': '無順鏈', 'no-back': '無逆鏈' }[indexZeroKind(row)];
  }

  function indexBaseRows() {
    let rows = indexRows();
    if (state.indexDomain) rows = rows.filter((row) => row.domain === state.indexDomain);

    const query = state.indexQuery.trim().toLowerCase();
    if (query) {
      const forms = SETTINGS ? SETTINGS.searchForms(query) : [query];
      const needles = forms.map((form) => form.toLowerCase());
      rows = rows.filter((row) => needles.some((needle) => row.hay.includes(needle)));
    }
    return rows;
  }

  function indexSortName() {
    const hit = INDEX_SORTS.find(([key]) => key === state.indexSort);
    return hit ? hit[1] : INDEX_SORTS[0][1];
  }

  function sortIndexRows(rows) {
    const byName = (a, b) =>
      a.key.localeCompare(b.key, 'zh-Hant') ||
      a.domainName.localeCompare(b.domainName, 'zh-Hant') ||
      a.domain.localeCompare(b.domain);
    const byTotal = (a, b) => b.forward + b.back - (a.forward + a.back);
    // 零連結時乘積全是 0；預設再依「全無 → 無順鏈 → 無逆鏈」分組，方便逐類補鏈。
    const zeroRank = { none: 0, 'no-forward': 1, 'no-back': 2 };
    const sorters = {
      product: (a, b) => {
        if (state.indexView === 'zero') {
          const rank = zeroRank[indexZeroKind(a)] - zeroRank[indexZeroKind(b)];
          if (rank) return rank;
          return byName(a, b);
        }
        return b.product - a.product || b.cross - a.cross || byTotal(a, b) || byName(a, b);
      },
      forward: (a, b) => b.forward - a.forward || b.product - a.product || byName(a, b),
      back: (a, b) => b.back - a.back || b.product - a.product || byName(a, b),
      cross: (a, b) => b.cross - a.cross || b.product - a.product || byName(a, b),
      name: byName,
    };
    return rows.sort(sorters[state.indexSort] || sorters.product);
  }

  function indexViewCounts(base) {
    return {
      all: base.length,
      zero: base.filter((row) => row.product === 0).length,
      cross: base.filter((row) => row.cross > 0).length,
      both: base.filter((row) => row.product > 0).length,
    };
  }

  function indexViewRows(base) {
    if (state.indexView === 'zero') return base.filter((row) => row.product === 0);
    if (state.indexView === 'cross') return base.filter((row) => row.cross > 0);
    if (state.indexView === 'both') return base.filter((row) => row.product > 0);
    return base.slice();
  }

  function renderIndexTabs(selected) {
    const nav = el('nav', 'index-tabs');
    nav.setAttribute('aria-label', '索引科目');

    const add = (id, label, count) => {
      const active = id === selected;
      const btn = el('button', 'index-tab' + (active ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.domain = id;
      btn.setAttribute('aria-pressed', String(active));
      btn.append(el('span', 'index-tab-name', label));
      btn.append(el('span', 'index-tab-count', String(count)));
      btn.addEventListener('click', () => navigateIndex(id === 'all' ? null : id));
      nav.append(btn);
    };

    add('all', '全部科目', entries.length);
    domains.forEach((domain) => add(domain.id, disp(domain.name || domain.id), indexCount(domain)));
    return nav;
  }

  function renderIndex() {
    const allRows = indexRows();
    const article = el('article', 'index');
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', '資料表'));
    head.append(el('h1', 'entry-title', '索引'));
    head.append(
      el(
        'p',
        'index-hint',
        '共 ' +
          allRows.length +
          ' 條、' +
          domains.length +
          ' 個科目。先用文字搜尋，再依科目、連線狀態與排序縮小範圍。順／逆是順鏈／逆鏈次數，×是兩者乘積；點條目閱讀，按「圖」以該節點開圖譜。'
      )
    );

    const searchRow = el('div', 'index-search-row');
    const searchLabel = el('label', 'index-search-label');
    searchLabel.append(document.createTextNode('搜尋'));
    const search = document.createElement('input');
    search.id = 'indexSearch';
    search.className = 'index-search';
    search.type = 'search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.placeholder = '條目名稱或內容…';
    search.setAttribute('aria-label', '搜尋索引條目');
    search.value = state.indexQuery;
    searchLabel.append(search);
    searchRow.append(searchLabel);

    const clear = el('button', 'index-search-clear', '清除');
    clear.type = 'button';
    clear.title = '清除搜尋字';
    clear.hidden = !state.indexQuery;
    searchRow.append(clear);
    head.append(searchRow);

    head.append(renderIndexTabs(state.indexDomain || 'all'));

    const controls = el('div', 'index-controls');
    const views = el('nav', 'index-views');
    views.setAttribute('aria-label', '節點連線檢視');
    const viewButtons = {};
    INDEX_VIEWS.forEach(([key, label]) => {
      const active = key === state.indexView;
      const btn = el('button', 'index-view' + (active ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.view = key;
      btn.setAttribute('aria-pressed', String(active));
      btn.append(el('span', 'index-view-name', label));
      const count = el('span', 'index-view-count', '0');
      btn.append(count);
      btn.addEventListener('click', () => {
        if (state.indexView === key) return;
        state.indexView = key;
        state.indexLimit = INDEX_PAGE_SIZE;
        refresh();
      });
      viewButtons[key] = { button: btn, count };
      views.append(btn);
    });
    controls.append(views);

    const sortLabel = el('label', 'index-sort');
    sortLabel.append(document.createTextNode('排序'));
    const sort = document.createElement('select');
    sort.id = 'indexSort';
    sort.className = 'index-sort-select';
    sort.setAttribute('aria-label', '索引排序');
    INDEX_SORTS.forEach(([key, label]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label;
      option.selected = key === state.indexSort;
      sort.append(option);
    });
    sort.addEventListener('change', () => {
      state.indexSort = sort.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    sortLabel.append(sort);
    controls.append(sortLabel);
    head.append(controls);

    const summary = el('p', 'index-summary');
    head.append(summary);
    article.append(head);

    const results = el('div', 'index-results');
    article.append(results);

    function refresh() {
      const base = indexBaseRows();
      const counts = indexViewCounts(base);

      Object.entries(viewButtons).forEach(([key, item]) => {
        item.count.textContent = String(counts[key]);
        const active = state.indexView === key;
        item.button.classList.toggle('is-active', active);
        item.button.setAttribute('aria-pressed', String(active));
      });
      clear.hidden = !state.indexQuery;

      const rows = sortIndexRows(indexViewRows(base));
      const query = state.indexQuery.trim();
      const scope = state.indexDomain ? disp(domainName(state.indexDomain)) : '全部科目';
      let text =
        scope +
        ' · 符合 ' +
        rows.length +
        ' 個節點' +
        (query ? '（搜尋「' + query + '」）' : '') +
        ' · 依' +
        indexSortName() +
        '排序';
      if (state.indexView === 'zero') {
        let none = 0;
        let noForward = 0;
        let noBack = 0;
        rows.forEach((row) => {
          if (!row.forward && !row.back) none++;
          else if (!row.forward) noForward++;
          else noBack++;
        });
        text += ' · 全無 ' + none + '、無順鏈 ' + noForward + '、無逆鏈 ' + noBack;
      } else if (state.indexView === 'cross') {
        const outCount = rows.filter((row) => row.crossOut > 0).length;
        const inCount = rows.filter((row) => row.crossIn > 0).length;
        text += ' · 對外 ' + outCount + '、對內 ' + inCount;
      }
      summary.textContent = text;

      results.textContent = '';
      if (!rows.length) {
        const empty = el('div', 'index-empty');
        empty.append(el('strong', null, '沒有符合的節點'));
        empty.append(el('p', null, '換個搜尋字，或把科目／檢視條件放寬。'));
        const reset = el('button', 'ghost', '清除搜尋與篩選');
        reset.type = 'button';
        reset.addEventListener('click', () => {
          state.indexQuery = '';
          state.indexView = 'all';
          state.indexLimit = INDEX_PAGE_SIZE;
          if (state.indexDomain) navigateIndex();
          else render();
        });
        empty.append(reset);
        results.append(empty);
        return;
      }

      const shown = rows.slice(0, state.indexLimit);
      const meta = el(
        'p',
        'index-result-count',
        '顯示 ' +
          shown.length +
          ' / ' +
          rows.length +
          ' 個' +
          (rows.length > shown.length ? ' · 還有 ' + (rows.length - shown.length) + ' 個' : '')
      );
      results.append(meta);

      const list = el('div', 'index-list');
      shown.forEach((row) => list.append(indexItem(row)));
      results.append(list);

      if (rows.length > shown.length) {
        const more = el('button', 'index-more', '顯示更多');
        more.type = 'button';
        more.addEventListener('click', () => {
          state.indexLimit += INDEX_PAGE_SIZE;
          refresh();
        });
        results.append(more);
      }
    }

    search.addEventListener('input', () => {
      state.indexQuery = search.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      state.indexQuery = '';
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = '';
      refresh();
      search.blur();
    });
    clear.addEventListener('click', () => {
      state.indexQuery = '';
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = '';
      refresh();
      search.focus();
    });

    reader.append(article);
    refresh();
  }

  function indexItem(row) {
    const item = el('div', 'index-item');
    const main = el('button', 'index-main');
    main.type = 'button';
    main.title = '閱讀「' + disp(row.key) + '」';
    main.setAttribute('aria-label', '閱讀「' + disp(row.key) + '」');

    const top = el('span', 'index-top');
    top.append(el('span', 'index-key', disp(row.key)));
    if (!state.indexDomain) {
      top.append(el('span', 'index-domain-tag', disp(row.domainName)));
    }
    if (!row.product) {
      top.append(el('span', 'index-zero-tag', indexZeroLabel(row)));
    }
    main.append(top);

    const meta = el('span', 'index-meta');
    const addStat = (text, title, extra) => {
      const stat = el('span', 'index-stat' + (extra ? ' ' + extra : ''), text);
      stat.title = title;
      meta.append(stat);
    };
    addStat('順 ' + row.forward, '順鏈：本條目引用 ' + row.forward + ' 個條目');
    addStat('逆 ' + row.back, '逆鏈：本條目被 ' + row.back + ' 個條目引用');
    addStat('×' + row.product, '順鏈次數 × 逆鏈次數', 'is-product');
    if (row.cross) {
      row.crossDomains.forEach(({ domain, count }) => {
        const name = disp(domainName(domain));
        addStat(name + ' ' + count, '與「' + name + '」的連線 ' + count + ' 條', 'is-cross');
      });
    }
    main.append(meta);

    main.append(el('span', 'index-preview', row.preview));
    main.addEventListener('click', () => navigate(row.domain, row.key));
    item.append(main);

    const graph = el('button', 'index-graph');
    graph.type = 'button';
    graph.title = '以「' + disp(row.key) + '」為中心開圖譜';
    graph.setAttribute('aria-label', '以「' + disp(row.key) + '」為中心開圖譜');
    graph.append(indexGraphGlyph());
    graph.addEventListener('click', () => navigateGraph(row.domain, row.key));
    item.append(graph);
    return item;
  }

  /** 和 toolbar 的「文／圖譜」toggle 相同的三小圈圖示。 */
  function indexGraphGlyph() {
    const svg = svgEl('svg', {
      class: 'index-graph-icon',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.append(svgEl('path', { d: 'M7.8 7.8 11 13.2M16.2 7.8 13 13.2' }));
    svg.append(svgEl('circle', { cx: 7, cy: 6, r: 2.1 }));
    svg.append(svgEl('circle', { cx: 17, cy: 6, r: 2.1 }));
    svg.append(svgEl('circle', { cx: 12, cy: 16.5, r: 3.2 }));
    return svg;
  }

  function emptyState(res) {
    const box = el('div', 'empty');
    box.append(el('h2', null, '找不到這個條目'));
    box.append(el('p', null, disp(res.name || '')));
    const back = el('button', 'ghost', '回到索引');
    back.type = 'button';
    back.addEventListener('click', () => navigateIndex());
    box.append(back);
    return box;
  }
