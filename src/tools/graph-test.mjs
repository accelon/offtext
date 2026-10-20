// 圖譜 UI 實測：半透明可收合設定浮窗、Ctrl 點節點後新中心置中。
// 用法：node src/tools/graph-test.mjs（先跑 build）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const BUILD = path.join(ROOT, 'build');
const SHOTS = path.join(BUILD, 'shots');
const DOMAINS = loadDomains(ROOT);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-graph-'));
const PAGE = pathToFileURL(path.join(BUILD, 'index.html')).href + '?theme=light#/graph/aijargon/神經網絡';

fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過圖譜測試');
  process.exit(0);
}

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,1100',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    PAGE,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) {
      /* 還沒起來 */
    }
    await sleep(250);
  }
  throw new Error('Edge 沒有在時限內提供 DevTools 端點');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
const exceptions = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    const detail = msg.params.exceptionDetails;
    exceptions.push(
      (detail.exception && (detail.exception.description || detail.exception.value)) ||
        detail.text ||
        'exception'
    );
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result && res.result.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  }
  return res.result && res.result.result ? res.result.result.value : undefined;
}

async function waitFor(expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch (e) {
      /* 頁面還在換 */
    }
    await sleep(100);
  }
  throw new Error('等待逾時：' + label);
}

async function shot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.result.data, 'base64'));
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.OFFTEXT_DOMAINS=' + JSON.stringify(DOMAINS) + ';',
});
await send('Page.reload', { ignoreCache: true });
await waitFor('document.readyState === "complete"', 'document ready');
await waitFor('!!document.querySelector(".graph-panel")', 'graph panel');
await waitFor('document.querySelectorAll(".graph-node").length > 1', 'graph nodes');

const panelOpen = await evaluate(`(() => {
  const panel = document.querySelector('.graph-panel');
  const body = document.querySelector('.graph-panel-body');
  const toggle = document.querySelector('.graph-panel-toggle');
  const style = getComputedStyle(panel);
  return {
    collapsed: panel.classList.contains('is-collapsed'),
    bodyDisplay: getComputedStyle(body).display,
    background: style.backgroundColor,
    backdrop: style.backdropFilter,
    expanded: toggle.getAttribute('aria-expanded'),
    position: style.position,
    canvasTop: Math.round(document.querySelector('.graph-canvas').getBoundingClientRect().top),
  };
})()`);
const nodeShape = await evaluate(`(() => {
  const circles = [...document.querySelectorAll('.graph-node-circle')];
  const radii = circles.map((circle) => Number(circle.getAttribute('r')));
  const multiLine = [...document.querySelectorAll('.graph-node-label')].filter(
    (label) => label.querySelectorAll('tspan').length > 1
  ).length;
  const overflow = [];
  document.querySelectorAll('.graph-node').forEach((group) => {
    const circle = group.querySelector('.graph-node-circle');
    const label = group.querySelector('.graph-node-label');
    if (!circle || !label) return;
    const r = Number(circle.getAttribute('r'));
    const box = label.getBBox();
    if (box.width / 2 > r + 1 || box.height / 2 > r + 1) {
      overflow.push({
        key: group.dataset.key,
        r,
        w: Math.round(box.width),
        h: Math.round(box.height),
      });
    }
  });
  return {
    count: radii.length,
    minRadius: Math.min(...radii),
    maxRadius: Math.max(...radii),
    multiLineLabels: multiLine,
    overflow,
  };
})()`);

const edgeStyle = await evaluate(`(() => {
  const forward = document.querySelector('.graph-edge.is-forward');
  const back = document.querySelector('.graph-edge.is-back');
  return {
    forward: forward ? getComputedStyle(forward).strokeDasharray : '',
    back: back ? getComputedStyle(back).strokeDasharray : '',
    forwardWidth: forward ? getComputedStyle(forward).strokeWidth : '',
  };
})()`);

const rectShape = await evaluate(`(async () => {
  const circleSvg = document.querySelector('.graph-svg');
  const circleHeight = Math.round(circleSvg.viewBox.baseVal.height);
  const select = document.querySelector('#graphNodeShape');
  select.value = 'rect';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));

  const rectSvg = document.querySelector('.graph-svg');
  const groups = [...document.querySelectorAll('.graph-node')];
  const rects = [...document.querySelectorAll('.graph-node-rect')];
  const overflow = [];
  const overlaps = [];
  const boxes = groups.map((group) => {
    const shape = group.querySelector('.graph-node-shape');
    const label = group.querySelector('.graph-node-label');
    const w = Number(shape?.getAttribute('width'));
    const h = Number(shape?.getAttribute('height'));
    const box = label?.getBBox();
    if (box && (box.width > w - 2 || box.height > h - 2)) {
      overflow.push({ key: group.dataset.key, w, h, textW: Math.round(box.width), textH: Math.round(box.height) });
    }
    return { key: group.dataset.key, rect: group.getBoundingClientRect() };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].rect;
      const b = boxes[j].rect;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) overlaps.push([boxes[i].key, boxes[j].key, Math.round(ox), Math.round(oy)]);
    }
  }
  return {
    circles: document.querySelectorAll('.graph-node-circle').length,
    rects: rects.length,
    nodes: groups.length,
    circleHeight,
    rectHeight: Math.round(rectSvg.viewBox.baseVal.height),
    heightDelta: circleHeight - Math.round(rectSvg.viewBox.baseVal.height),
    overflow,
    overlaps: overlaps.slice(0, 8),
    overlapCount: overlaps.length,
  };
})()`);
await shot('shot-graph-rect.png');

const rectDepth3 = await evaluate(`(async () => {
  const depth = document.querySelector('#graphDepth');
  depth.value = '3';
  depth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  const groups = [...document.querySelectorAll('.graph-node')];
  const boxes = groups.map((group) => ({ key: group.dataset.key, rect: group.getBoundingClientRect() }));
  let overlapCount = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].rect;
      const b = boxes[j].rect;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlapCount++;
    }
  }
  const overflow = [];
  groups.forEach((group) => {
    const shape = group.querySelector('.graph-node-shape');
    const label = group.querySelector('.graph-node-label');
    const w = Number(shape?.getAttribute('width'));
    const h = Number(shape?.getAttribute('height'));
    const box = label?.getBBox();
    if (box && (box.width > w - 2 || box.height > h - 2)) overflow.push(group.dataset.key);
  });
  return { nodes: groups.length, overlapCount, overflowCount: overflow.length };
})()`);

await evaluate(`(async () => {
  const depth = document.querySelector('#graphDepth');
  depth.value = '2';
  depth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const select = document.querySelector('#graphNodeShape');
  select.value = 'circle';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
})()`);
await shot('shot-graph-panel.png');

const arrows = await evaluate(`(() => {
  const edges = [...document.querySelectorAll('.graph-edge')];
  const marker = document.querySelector('#graph-arrow');
  return {
    markers: document.querySelectorAll('marker#graph-arrow').length,
    edges: edges.length,
    withMarker: edges.filter((edge) => edge.getAttribute('marker-end')).length,
    markerEnd: edges[0]?.getAttribute('marker-end') || '',
    arrowFill: marker ? getComputedStyle(marker.querySelector('path')).fill : '',
  };
})()`);

// 線粗：細／中／粗，實際 stroke-width 要跟著變。
const edgeThick = await evaluate(`(async () => {
  const select = document.querySelector('#graphEdgeWidth');
  select.value = 'thick';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  const line = document.querySelector('.graph-edge');
  return {
    value: document.querySelector('#graphEdgeWidth')?.value,
    strokeWidth: line && getComputedStyle(line).strokeWidth,
  };
})()`);
await shot('shot-graph-thick.png');
const edgeBack = await evaluate(`(async () => {
  const select = document.querySelector('#graphEdgeWidth');
  select.value = 'medium';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  return {
    value: document.querySelector('#graphEdgeWidth')?.value,
    strokeWidth: document.querySelector('.graph-edge') &&
      getComputedStyle(document.querySelector('.graph-edge')).strokeWidth,
  };
})()`);

await evaluate("document.querySelector('.graph-panel-toggle').click()");
await sleep(150);
const panelCollapsed = await evaluate(`(() => {
  const panel = document.querySelector('.graph-panel');
  const body = document.querySelector('.graph-panel-body');
  return {
    collapsed: panel.classList.contains('is-collapsed'),
    bodyDisplay: getComputedStyle(body).display,
    stored: localStorage.getItem('offtext.graphPanel.v1'),
    expanded: document.querySelector('.graph-panel-toggle').getAttribute('aria-expanded'),
  };
})()`);
await shot('shot-graph-panel-collapsed.png');

// 收合狀態下 Ctrl 點另一個節點：重繪後 panel 仍收合。
const targetId = await evaluate(`(() => {
  const node = [...document.querySelectorAll('.graph-node')].find(
    (n) => !n.classList.contains('is-root')
  );
  if (!node) return '';
  const id = node.dataset.id;
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  return id;
})()`);
await waitFor(
  `document.querySelector('.graph-node.is-root')?.dataset.id === ${JSON.stringify(targetId)}`,
  'new root'
);
await sleep(400);

const recentered = await evaluate(`(() => {
  const root = document.querySelector('.graph-node.is-root');
  const svg = document.querySelector('.graph-svg');
  const canvas = document.querySelector('.graph-canvas').getBoundingClientRect();
  const match = /translate\\(([-\\d.]+)[ ,]([-\\d.]+)\\)/.exec(root.getAttribute('transform') || '');
  const x = match ? Number(match[1]) : NaN;
  const y = match ? Number(match[2]) : NaN;
  const vb = svg.viewBox.baseVal;
  return {
    rootId: root.dataset.id,
    rootX: x,
    rootY: y,
    centerX: vb.x + vb.width / 2,
    centerY: vb.y + vb.height / 2,
    dx: Math.abs(x - (vb.x + vb.width / 2)),
    dy: Math.abs(y - (vb.y + vb.height / 2)),
    scrollCenterDelta: Math.round(
      canvas.top + canvas.height / 2 - window.innerHeight / 2
    ),
    panelStillCollapsed: document.querySelector('.graph-panel').classList.contains('is-collapsed'),
    hash: location.hash,
  };
})()`);
await shot('shot-graph-recentered.png');

const focusBar = await evaluate(`(async () => {
  const node = [...document.querySelectorAll('.graph-node')].find(
    (n) => !n.classList.contains('is-root')
  );
  if (!node) return { error: 'no non-root node' };
  const id = node.dataset.id;
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 260));
  const bar = document.querySelector('.graph-focus-bar');
  const button = document.querySelector('.graph-focus-center');
  const before = {
    id,
    visible: !!bar,
    label: document.querySelector('.graph-focus-label')?.textContent || '',
    button: button?.textContent || '',
  };
  if (button) button.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    ...before,
    rootAfter: document.querySelector('.graph-node.is-root')?.dataset.id || '',
    hashAfter: location.hash,
    barAfter: !!document.querySelector('.graph-focus-bar'),
    stillGraph: location.hash.startsWith('#/graph/'),
  };
})()`);

// 手機寬度：收合與展開都不能水平溢出。
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(320);
const mobileCollapsed = await evaluate(`(() => {
  const panel = document.querySelector('.graph-panel').getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panelLeft: Math.round(panel.left),
    panelRight: Math.round(panel.right),
    panelWidth: Math.round(panel.width),
    collapsed: document.querySelector('.graph-panel').classList.contains('is-collapsed'),
  };
})()`);
await shot('shot-graph-panel-mobile.png');

await evaluate("document.querySelector('.graph-panel-toggle').click()");
await sleep(180);
const mobileOpen = await evaluate(`(() => {
  const panel = document.querySelector('.graph-panel').getBoundingClientRect();
  const shape = document.querySelector('#graphNodeShape');
  const shapeRect = shape?.getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panelLeft: Math.round(panel.left),
    panelRight: Math.round(panel.right),
    panelWidth: Math.round(panel.width),
    collapsed: document.querySelector('.graph-panel').classList.contains('is-collapsed'),
    shapeWidth: shapeRect ? Math.round(shapeRect.width) : 0,
    shapeLeft: shapeRect ? Math.round(shapeRect.left) : 0,
    shapeRight: shapeRect ? Math.round(shapeRect.right) : 0,
    controls: [...document.querySelectorAll('.graph-control')].map((control) => {
      const rect = control.getBoundingClientRect();
      return { text: control.textContent.trim(), width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right) };
    }),
  };
})()`);
await shot('shot-graph-panel-mobile-open.png');

const mobileFocusBar = await evaluate(`(async () => {
  const node = [...document.querySelectorAll('.graph-node')].find(
    (n) => !n.classList.contains('is-root')
  );
  if (!node) return { error: 'no node' };
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 260));
  const bar = document.querySelector('.graph-focus-bar');
  const rect = bar?.getBoundingClientRect();
  const button = document.querySelector('.graph-focus-center');
  const visible = !!bar && rect.width > 0;
  if (button) button.click();
  await new Promise((r) => setTimeout(r, 450));
  return {
    visible,
    width: rect ? Math.round(rect.width) : 0,
    right: rect ? Math.round(rect.right) : 0,
    innerWidth,
    button: button?.textContent || '',
    stillGraph: location.hash.startsWith('#/graph/'),
    barAfter: !!document.querySelector('.graph-focus-bar'),
  };
})()`);

console.log(
  JSON.stringify(
    { panelOpen, nodeShape, edgeStyle, rectShape, rectDepth3, arrows, edgeThick, edgeBack, panelCollapsed, recentered, focusBar, mobileCollapsed, mobileOpen, mobileFocusBar, exceptions },
    null,
    2
  )
);

ws.close();
child.kill();
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* Windows 檔案鎖 */
}
