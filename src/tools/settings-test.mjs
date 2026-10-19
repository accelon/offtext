// 設置頁實測：扳手位置、主題三態、繁簡三態、搜尋與重載後的記憶。
// 用法：node src/tools/settings-test.mjs（先跑 build）
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
const PORT = 9334;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-settings-'));
const PAGE = pathToFileURL(path.join(BUILD, 'index.html')).href + '#/modern-chinese-history/義和團';

fs.mkdirSync(SHOTS, { recursive: true });

if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過設置頁測試');
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

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    const ready = await evaluate('document.readyState');
    if (ready === 'complete') break;
    await sleep(100);
  }
  for (let i = 0; i < 50; i++) {
    const title = await evaluate("document.querySelector('.entry-title')?.textContent || ''");
    if (title) return title;
    await sleep(100);
  }
  throw new Error('條目沒有在時限內渲染');
}

async function shot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.result.data, 'base64'));
}

await send('Runtime.enable');
await send('Page.enable');

// 啟動頁沒有 data.js；測試時注入同一份 TSV 資料，避免真的開檔案選擇器。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.OFFTEXT_DOMAINS=' + JSON.stringify(DOMAINS) + ';',
});
await send('Page.reload', { ignoreCache: true });
await waitReady();

const layout = await evaluate(`(() => {
  const bar = document.querySelector('.topbar');
  const kids = [...bar.children];
  const last = kids[kids.length - 1];
  const btn = document.querySelector('#settingsBtn');
  const index = document.querySelector('#indexBtn');
  const barRect = bar.getBoundingClientRect();
  const rect = btn.getBoundingClientRect();
  const indexRect = index.getBoundingClientRect();
  return {
    lastId: last && last.id,
    hasWrench: !!btn.querySelector('svg'),
    visible: rect.width > 0 && rect.height > 0,
    rightGap: Math.round(barRect.right - rect.right),
    afterIndex: rect.left >= indexRect.right,
    title: btn.title,
  };
})()`);

await evaluate("document.querySelector('#settingsBtn').click()");
await sleep(120);

const opened = await evaluate(`(() => {
  const box = document.querySelector('#settingsBox');
  const back = document.querySelector('#settingsBackdrop');
  return {
    boxHidden: box.hidden,
    backdropHidden: back.hidden,
    focused: document.activeElement && document.activeElement.id,
    themeButtons: [...document.querySelectorAll('#themeSeg button')].map((b) => b.textContent),
    simButtons: [...document.querySelectorAll('#simSeg button')].map((b) => b.textContent),
    demoRows: document.querySelectorAll('#simDemo .sim-row').length,
  };
})()`);

await evaluate("document.querySelector('#themeSeg button[data-theme=\"light\"]').click()");
await sleep(120);
const light = await evaluate(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  stored: localStorage.getItem('offtext.theme.v1'),
  bg: getComputedStyle(document.body).backgroundColor,
  active: document.querySelector('#themeSeg button.is-active')?.dataset.theme,
}))()`);
await shot('shot-settings-light.png');

await evaluate("document.querySelector('#themeSeg button[data-theme=\"dark\"]').click()");
await sleep(120);
const dark = await evaluate(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  stored: localStorage.getItem('offtext.theme.v1'),
  bg: getComputedStyle(document.body).backgroundColor,
  fg: getComputedStyle(document.body).color,
  active: document.querySelector('#themeSeg button.is-active')?.dataset.theme,
}))()`);
await shot('shot-settings-dark.png');

await evaluate("document.querySelector('#themeSeg button[data-theme=\"eye\"]').click()");
await sleep(120);
const eye = await evaluate(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  stored: localStorage.getItem('offtext.theme.v1'),
  bg: getComputedStyle(document.body).backgroundColor,
  fg: getComputedStyle(document.body).color,
  active: document.querySelector('#themeSeg button.is-active')?.dataset.theme,
}))()`);
await shot('shot-settings-eye.png');

// 無損簡體：義和團 → 义和团（一對一），原文不動。
await evaluate("document.querySelector('#simSeg button[data-mode=\"1\"]').click()");
await sleep(100);
const simDemo = await evaluate(`(() => ({
  text: [...document.querySelectorAll('#simDemo .sim-row')].map((row) => row.textContent),
  active: document.querySelector('#simSeg button.is-active')?.dataset.mode,
  stats: document.querySelector('#setStats').textContent,
}))()`);

await evaluate("document.querySelector('#settingsDone').click()");
await sleep(100);
const lossless = await evaluate(`(() => {
  const title = document.querySelector('.entry-title')?.textContent;
  const body = [...document.querySelectorAll('.nt-line')].map((el) => el.textContent).join(' ');
  const source = window.OFFTEXT_DOMAINS
    .find((d) => d.id === 'modern-chinese-history').entries['義和團'];
  return {
    title,
    bodyHasSimplified: body.includes('镇压') && body.includes('民间'),
    bodyHasOriginal: body.includes('鎮壓'),
    titleHasSimplified: title === '义和團',
    sourceExists: typeof source === 'string',
    sourceStillOriginal: typeof source === 'string' && source.includes('鎮壓') && source.includes('19世紀末'),
    hash: location.hash,
  };
})()`);
await shot('shot-simplified-lossless.png');

// 簡體顯示時，單純點內文不應跳出「不能新增詞目」的 toast（只有真的選取才提示）。
const selectionGuard = await evaluate(`(async () => {
  document.querySelector('.nt-line').click();
  await new Promise((r) => setTimeout(r, 320));
  const toast = document.querySelector('.edit-toast');
  return {
    toastVisible: !!toast && toast.classList.contains('is-visible'),
    addTermHidden: document.querySelector('.add-term-btn')?.hidden,
  };
})()`);

// 搜尋：簡體顯示時打簡體也找得到原文條目。
const search = await evaluate(`(async () => {
  const input = document.querySelector('#search');
  input.focus();
  input.value = '义和团';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const first = document.querySelector('.search-item');
  return {
    count: document.querySelectorAll('.search-item').length,
    key: first?.querySelector('.search-key')?.textContent,
    preview: first?.querySelector('.search-preview')?.textContent,
    firstIsTarget: first?.querySelector('.search-key')?.textContent === '义和團',
  };
})()`);
await evaluate(`(() => {
  const input = document.querySelector('#search');
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
})()`);

// 強制簡體：後訓練 → 后训练（合併字也轉）。
await evaluate("document.querySelector('#settingsBtn').click()");
await sleep(80);
await evaluate("document.querySelector('#simSeg button[data-mode=\"2\"]').click()");
await sleep(80);
await evaluate("document.querySelector('#settingsDone').click()");
await evaluate("location.hash = '#/aijargon/後訓練'");
await sleep(300);
const forced = await evaluate(`(() => {
  const body = [...document.querySelectorAll('.nt-line')].map((el) => el.textContent).join(' ');
  return {
    title: document.querySelector('.entry-title')?.textContent,
    bodyHead: body.slice(0, 20),
    bodyHasForced: body.includes('后训练'),
    mode: document.querySelector('#simSeg button.is-active')?.dataset.mode,
  };
})()`);
await shot('shot-simplified-forced.png');

// 重載：主題與文字顯示都要記住。
await send('Page.reload', { ignoreCache: true });
await waitReady();
const reloaded = await evaluate(`(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  storedTheme: localStorage.getItem('offtext.theme.v1'),
  storedSim: localStorage.getItem('offtext.simmode.v1'),
  activeTheme: document.querySelector('#settingsBtn')?.classList.contains('is-custom'),
  title: document.querySelector('.entry-title')?.textContent,
  body: [...document.querySelectorAll('.nt-line')].map((el) => el.textContent).join(' ').slice(0, 20),
}))()`);

// 索引與圖譜也要跟著文字顯示轉換。
await evaluate("location.hash = '#/index/modern-chinese-history'");
await sleep(300);
const indexSim = await evaluate(`(() => {
  const keys = [...document.querySelectorAll('.index-key')].map((el) => el.textContent);
  return {
    count: keys.length,
    hasSimplified: keys.some((key) => key.includes('八国联军') || key.includes('义和团')),
    sample: keys.slice(0, 5),
    tabs: [...document.querySelectorAll('.index-tab-name')].map((el) => el.textContent).slice(0, 3),
  };
})()`);

await evaluate("location.hash = '#/graph/modern-chinese-history/義和團'");
await sleep(500);
const graphSim = await evaluate(`(() => ({
  labels: [...document.querySelectorAll('.graph-node-label')].map((el) => el.textContent).slice(0, 8),
  title: document.querySelector('.entry-title')?.textContent,
  hint: document.querySelector('.index-hint')?.textContent,
}))()`);

// 亮底／護眼／暗底圖譜：節點都要有看得見的底色，不能只剩描邊。
const graphFills = async () =>
  evaluate(`(() => {
    const circle = document.querySelector('.graph-node-circle');
    const label = document.querySelector('.graph-node-label');
    const style = circle ? getComputedStyle(circle) : null;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      nodes: document.querySelectorAll('.graph-node').length,
      fill: style && style.fill,
      stroke: style && style.stroke,
      labelFill: label && getComputedStyle(label).fill,
    };
  })()`);

await evaluate("window.OfftextSettings.setTheme('light'); location.hash = '#/graph/aijargon/人工神經元'");
await sleep(500);
const lightGraph = await graphFills();
await shot('shot-graph-light.png');

await evaluate("window.OfftextSettings.setTheme('eye')");
await sleep(250);
const eyeGraph = await graphFills();
await shot('shot-graph-eye.png');

await evaluate("window.OfftextSettings.setTheme('dark')");
await sleep(250);
const darkGraph = await graphFills();
await shot('shot-graph-dark.png');
await evaluate("window.OfftextSettings.setTheme('eye')");
await sleep(120);

// 手機寬度：底部彈出、不得水平溢出。
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(220);
await evaluate("document.querySelector('#settingsBtn').click()");
await sleep(120);
const mobile = await evaluate(`(() => {
  const box = document.querySelector('#settingsBox').getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    boxLeft: Math.round(box.left),
    boxRight: Math.round(box.right),
    boxTop: Math.round(box.top),
    boxBottom: Math.round(box.bottom),
  };
})()`);
await shot('shot-settings-mobile.png');

console.log(
  JSON.stringify(
    {
      layout,
      opened,
      light,
      dark,
      eye,
      simDemo,
      lossless,
      selectionGuard,
      search,
      forced,
      reloaded,
      indexSim,
      graphSim,
      lightGraph,
      eyeGraph,
      darkGraph,
      mobile,
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
