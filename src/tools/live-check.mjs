// 線上位址實測：啟動頁列出 data/ TSV → 勾選載入 → 首頁渲染，沒有 JS 例外。
// 用法：node src/tools/live-check.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-live-'));
const PAGE = process.argv[2] || 'https://shutonggui.cn/offtext/';

fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過線上一頁式測試');
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
  for (let i = 0; i < 80; i++) {
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

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch (e) {
      /* 頁面還在載入 */
    }
    await sleep(120);
  }
  throw new Error('等待逾時：' + label);
}

await send('Runtime.enable');
await send('Page.enable');
await waitFor('document.readyState === "complete"', 'document ready');
await waitFor('document.querySelector("#boot").hidden', 'boot hidden');
await waitFor('document.querySelectorAll("#subject option").length > 1', 'subjects');

const boot = await evaluate(`(() => ({
  url: location.href,
  protocol: location.protocol,
  bootHidden: document.querySelector('#boot').hidden,
  catalogWasVisible: !document.querySelector('#bootCatalog').hidden,
  catalogRows: document.querySelectorAll('.boot-tsv').length,
}))()`);

const loaded = await evaluate(`(() => ({
  subjects: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
  stats: document.querySelector('#stats').textContent,
  title: document.querySelector('.entry-title')?.textContent,
  hash: location.hash,
  bootVisible: !document.querySelector('#boot').hidden,
  bodyTextLength: document.querySelector('#reader')?.textContent.length || 0,
  readonly: document.body.classList.contains('is-readonly-online'),
  editHidden: document.querySelector('#editBtn')?.hidden,
  saveHidden: document.querySelector('#saveBtn')?.hidden,
  exportHidden: document.querySelector('#exportBtn')?.hidden,
  editing: !!document.querySelector('.cm-offtext-root.cm-editing'),
}))()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'shot-live.png'), Buffer.from(shot.result.data, 'base64'));

console.log(JSON.stringify({ boot, loaded, exceptions }, null, 2));

ws.close();
child.kill();
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* Windows 檔案鎖 */
}
