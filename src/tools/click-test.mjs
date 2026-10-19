// 用 Edge 的 DevTools 協定實際點擊一次，確認展開 / 收合與截圖。
// 用法：node src/tools/click-test.mjs（先跑 build）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const ROOT = path.resolve(SRC, '..');
const BUILD = path.join(ROOT, 'build');
const SHOTS = path.join(BUILD, 'shots');
const DOMAINS = loadDomains(ROOT);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-click-'));
const PAGE = pathToFileURL(path.join(BUILD, 'index.html')).href + '?theme=light#/aijargon/人工神經元';

fs.mkdirSync(SHOTS, { recursive: true });

if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過點擊測試');
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
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
    exceptions.push(msg.params.exceptionDetails.text);
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

await send('Runtime.enable');
await send('Page.enable');

// 啟動頁沒有 data.js；測試時注入同一份 TSV 資料，避免真的開檔案選擇器。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.OFFTEXT_DOMAINS=' + JSON.stringify(DOMAINS) + ';',
});
await send('Page.reload', { ignoreCache: true });
await sleep(500);

for (let i = 0; i < 40; i++) {
  const ready = await evaluate('document.readyState');
  if (ready === 'complete') break;
  await sleep(100);
}

const opened = await evaluate(`(async () => {
  const before = document.querySelectorAll('.nt-exp').length;
  const first = document.querySelector('.nt-ref');
  if (!first) return { error: 'no ref' };
  const label = first.textContent;
  first.click();
  await new Promise((r) => setTimeout(r, 250));
  const expanded = document.querySelector('.nt-ref[aria-expanded="true"]');
  const exp = document.querySelector('.nt-exp');
  return {
    before,
    after: document.querySelectorAll('.nt-exp').length,
    label,
    ariaExpanded: expanded ? expanded.getAttribute('aria-expanded') : null,
    inline: exp ? exp.classList.contains('nt-exp-inline') : null,
    focusing: document.querySelector('#reader').classList.contains('is-focusing'),
    dimmed: document.querySelectorAll('.nt-dim').length,
    firstExpansion: exp ? exp.textContent.replace(/\\s+/g, ' ').slice(0, 70) : null,
  };
})()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'shot-clicked.png'), Buffer.from(shot.result.data, 'base64'));

// 展開後再點內層的神經元：應該出現「循環」提示而不是無限遞迴。
const cycle = await evaluate(`(async () => {
  const inner = document.querySelector('.nt-exp .nt-ref');
  if (!inner) return { error: 'no inner ref' };
  inner.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    notes: [...document.querySelectorAll('.nt-note-cycle')].map((n) => n.textContent),
    expansions: document.querySelectorAll('.nt-exp').length,
  };
})()`);

const closed = await evaluate(`(async () => {
  const btn = document.querySelector('.nt-ref[aria-expanded="true"]');
  if (!btn) return { error: 'nothing open' };
  btn.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    after: document.querySelectorAll('.nt-exp').length,
    expandedCount: document.querySelectorAll('.nt-ref[aria-expanded="true"]').length,
    focusing: document.querySelector('#reader').classList.contains('is-focusing'),
    dimmed: document.querySelectorAll('.nt-dim').length,
  };
})()`);

// 反鏈接：人工神經元 的標題右側應列出直接引用它的條目；點一筆後標出來源引用。
const backlinks = await evaluate(`(async () => {
  const items = [...document.querySelectorAll('.backlink')];
  if (!items.length) return { error: 'no backlinks' };
  const labels = items.map((b) => b.textContent.trim());
  const direct = items.filter((b) => !b.closest('.backlinks-menu')).length;
  const menu = items.filter((b) => b.closest('.backlinks-menu')).length;
  const more = document.querySelector('.backlinks-more');
  more?.querySelector('summary')?.click();
  const menuOpen = !!more?.open;
  more?.querySelector('summary')?.click();
  const first = items[0];
  const source = first.textContent.trim();
  first.click();
  await new Promise((r) => setTimeout(r, 300));
  const marks = [...document.querySelectorAll('.nt-ref.is-backlink-source')];
  return {
    count: items.length,
    direct,
    menu,
    menuOpen,
    labels: labels.slice(0, 10),
    source,
    title: document.querySelector('.entry-title')?.textContent,
    hash: location.hash,
    highlighted: marks.length,
    highlightedLabel: marks[0]?.textContent || null,
    scrollY: Math.round(window.scrollY),
    focused: document.activeElement?.className || null,
  };
})()`);

const backlinkShot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'shot-backlink.png'), Buffer.from(backlinkShot.result.data, 'base64'));

// 再點被標記的來源引用，應回到原條目。
const backlinkReturn = await evaluate(`(async () => {
  const mark = document.querySelector('.nt-ref.is-backlink-source');
  if (!mark) return { error: 'no marked ref' };
  mark.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    title: document.querySelector('.entry-title')?.textContent,
    hash: location.hash,
    marks: document.querySelectorAll('.nt-ref.is-backlink-source').length,
  };
})()`);

// 跨科目反鏈接：化學「氧氣」應列出生物科的引用，點過去也要標出來源。
const crossBacklink = await evaluate(`(async () => {
  location.hash = '#/chemistry/' + encodeURIComponent('氧氣');
  await new Promise((r) => setTimeout(r, 250));
  const items = [...document.querySelectorAll('.backlink')];
  const bio = items.find((b) => b.textContent.includes('生物'));
  if (!bio) return { error: 'no cross-domain backlink', labels: items.map((b) => b.textContent) };
  const label = bio.textContent.trim();
  bio.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    label,
    title: document.querySelector('.entry-title')?.textContent,
    hash: location.hash,
    highlighted: [...document.querySelectorAll('.nt-ref.is-backlink-source')].map((b) => b.textContent),
  };
})()`);

// 索引頁：預設全部科目，可用搜尋與連線檢視縮小範圍。
const index = await evaluate(`(async () => {
  document.querySelector('#indexBtn').click();
  await new Promise((r) => setTimeout(r, 350));
  const first = {
    hash: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
    items: document.querySelectorAll('.index-item').length,
    tabs: document.querySelectorAll('.index-tab').length,
    active: document.querySelector('.index-tab.is-active')?.dataset.domain,
    views: [...document.querySelectorAll('.index-view')].map((b) => b.dataset.view),
    searchLabel: document.querySelector('.index-search-label')?.firstChild?.textContent,
  };

  const search = document.querySelector('#indexSearch');
  search.value = '牛頓';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const filtered = {
    items: document.querySelectorAll('.index-item').length,
    keys: [...document.querySelectorAll('.index-key')].map((n) => n.textContent),
    counts: [...document.querySelectorAll('.index-view-count')].map((n) => n.textContent),
  };
  document.querySelector('.index-search-clear').click();

  document.querySelector('.index-view[data-view="zero"]').click();
  const zeroRows = [...document.querySelectorAll('.index-item')];
  const zero = {
    active: document.querySelector('.index-view.is-active')?.dataset.view,
    items: zeroRows.length,
    allZero: zeroRows.every((row) => row.querySelector('.index-stat.is-product')?.textContent === '×0'),
    tags: [...document.querySelectorAll('.index-zero-tag')].slice(0, 3).map((n) => n.textContent),
  };

  document.querySelector('.index-view[data-view="cross"]').click();
  const crossRows = [...document.querySelectorAll('.index-item')];
  const cross = {
    active: document.querySelector('.index-view.is-active')?.dataset.view,
    items: crossRows.length,
    allCross: crossRows.every((row) => !!row.querySelector('.index-stat.is-cross')),
  };
  document.querySelector('.index-view[data-view="all"]').click();

  document.querySelector('.index-tab[data-domain="aijargon"]').click();
  await new Promise((r) => setTimeout(r, 350));
  const ai = {
    hash: location.hash,
    items: document.querySelectorAll('.index-item').length,
    active: document.querySelector('.index-tab.is-active')?.dataset.domain,
    rankSelects: ['#rankImportant', '#rankCore', '#rankHub'].filter((s) => document.querySelector(s)).length,
  };

  return { first, filtered, zero, cross, ai };
})()`);

// 從索引點進條目，再測科目切換（切換科目會離開索引）。
const subject = await evaluate(`(async () => {
  document.querySelector('.index-main').click();
  await new Promise((r) => setTimeout(r, 250));
  const select = document.querySelector('#subject');
  select.value = 'biology';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return {
    hash: location.hash,
    value: select.value,
    kicker: document.querySelector('.entry-kicker')?.textContent,
    title: document.querySelector('.entry-title')?.textContent,
  };
})()`);

// 搜尋 + 切換條目
const search = await evaluate(`(async () => {
  const input = document.querySelector('#search');
  input.value = 'gpu';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const hits = [...document.querySelectorAll('.search-item')];
  if (!hits.length) return { count: 0 };
  hits[0].click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    count: hits.length,
    first: hits[0].querySelector('.search-key').textContent,
    title: document.querySelector('.entry-title').textContent,
    hash: location.hash,
  };
})()`);

// Ctrl/⌘+點擊引用：直接替換閱讀頁，不展開。
const ctrlClick = await evaluate(`(async () => {
  const first = document.querySelector('.nt-ref');
  if (!first) return { error: 'no ref' };
  const label = first.textContent;
  first.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await new Promise((r) => setTimeout(r, 250));
  return {
    label,
    title: document.querySelector('.entry-title')?.textContent,
    hash: location.hash,
    expansions: document.querySelectorAll('.nt-exp').length,
  };
})()`);

// 從閱讀頁按「圖譜」進入。
const graphButton = await evaluate(`(async () => {
  document.querySelector('#viewToggle').click();
  await new Promise((r) => setTimeout(r, 300));
  return {
    hash: location.hash,
    root: document.querySelector('.graph-node.is-root')?.dataset.id,
    title: document.querySelector('.entry-title')?.textContent,
  };
})()`);

// 圖譜：高亮循環、層數、方向開關、Ctrl 重設起點。
const graph = await evaluate(`(async () => {
  location.hash = '#/graph/aijargon/人工神經元';
  await new Promise((r) => setTimeout(r, 350));

  const wait = () => new Promise((r) => setTimeout(r, 250));
  const read = () => ({
    nodes: document.querySelectorAll('.graph-node').length,
    edges: document.querySelectorAll('.graph-edge').length,
    lit: document.querySelectorAll('.graph-edge.is-lit').length,
    dimmed: document.querySelectorAll('.graph-edge.is-dim').length,
    selected: document.querySelectorAll('.graph-node.is-selected').length,
    root: document.querySelector('.graph-node.is-root')?.dataset.id,
    cross: document.querySelectorAll('.graph-node.is-cross').length,
  });
  const clickNode = async (id, ctrl = false) => {
    const node = document.querySelector('.graph-node[data-id="' + id + '"]');
    if (!node) return false;
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl }));
    await wait();
    return true;
  };
  const setDepth = async (value) => {
    const select = document.querySelector('#graphDepth');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
  };
  const setCheck = async (id, checked) => {
    const input = document.querySelector(id);
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
  };
  const initial = read();
  const hoverNode = document.querySelector('.graph-node[data-key="丟棄"]');
  hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: 520, clientY: 520 }));
  await wait();
  const hover = {
    hidden: document.querySelector('.graph-tip').hidden,
    text: document.querySelector('.graph-tip').textContent.replace(/\\s+/g, ' ').slice(0, 80),
  };
  hoverNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

  await clickNode('aijargon:人工神經元');
  const forward = read();
  await clickNode('aijargon:人工神經元');
  const back = read();
  await clickNode('aijargon:人工神經元');
  const off = read();

  await setDepth('3');
  const depth3 = read();
  await setDepth('2');

  const fontInput = document.querySelector('#graphFontSize');
  fontInput.value = '18';
  fontInput.dispatchEvent(new Event('change', { bubbles: true }));
  await wait();
  const font = {
    value: document.querySelector('#graphFontSize')?.value,
    rendered: getComputedStyle(document.querySelector('.graph-node-label')).fontSize,
  };

  const edgeInput = document.querySelector('#graphEdgeLength');
  edgeInput.value = 'long';
  edgeInput.dispatchEvent(new Event('change', { bubbles: true }));
  await wait();
  const edge = {
    value: document.querySelector('#graphEdgeLength')?.value,
    nodes: document.querySelectorAll('.graph-node').length,
  };

  await setDepth('1');
  await setCheck('#graphBackward', false);
  const forwardOnly = read();
  await setCheck('#graphBackward', true);

  await clickNode('aijargon:權重', true);
  const recentered = {
    hash: location.hash,
    root: document.querySelector('.graph-node.is-root')?.dataset.id,
    nodes: document.querySelectorAll('.graph-node').length,
  };

  return {
    initial,
    hover,
    forward,
    back,
    off,
    depth3,
    font,
    edge,
    forwardOnly,
    recentered,
  };
})()`);

const graphBack = await evaluate(`(async () => {
  document.querySelector('.graph-back').click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    hash: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
  };
})()`);

// 文字／圖譜快速切換：按鈕與 g 鍵都要能來回。
const viewToggle = await evaluate(`(async () => {
  const wait = () => new Promise((r) => setTimeout(r, 280));
  const read = () => ({
    hash: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
    graph: document.querySelector('#viewToggle').classList.contains('is-graph'),
    pressed: document.querySelector('#viewToggle').getAttribute('aria-pressed'),
  });

  document.querySelector('#viewToggle').click();
  await wait();
  const afterGlyph = read();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
  await wait();
  const afterGText = read();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
  await wait();
  const afterGGraph = read();

  document.querySelector('#viewToggle').click();
  await wait();
  const afterText = read();

  return { afterGlyph, afterGText, afterGGraph, afterText };
})()`);

const history = await evaluate(`(async () => {
  const entries = window.OFFTEXT_DOMAINS
    .find((domain) => domain.id === 'modern-chinese-history')
    .entries;
  const keys = Object.keys(entries).filter((key) => key !== '_').slice(0, 17);
  for (const key of keys) {
    location.hash = '#/modern-chinese-history/' + encodeURIComponent(key);
    await new Promise((r) => setTimeout(r, 90));
  }
  const select = document.querySelector('#readHistory');
  const options = [...select.options].slice(1);
  const values = options.map((option) => option.value);
  const chosen = options[1].value;
  select.value = chosen;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return {
    count: options.length,
    unique: new Set(values).size,
    first: options[0]?.textContent,
    firstValue: values[0],
    expectedFirst: 'modern-chinese-history:' + keys[keys.length - 1],
    last: values[values.length - 1],
    chosen,
    chosenHash: location.hash,
    newFirst: [...select.options].slice(1)[0]?.value,
    reset: select.value,
  };
})()`);

console.log(
  JSON.stringify(
    {
      opened,
      cycle,
      closed,
      backlinks,
      backlinkReturn,
      crossBacklink,
      index,
      subject,
      search,
      ctrlClick,
      graphButton,
      graph,
      graphBack,
      viewToggle,
      history,
      exceptions,
    },
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
  /* Windows 檔案鎖，留著也無妨 */
}

