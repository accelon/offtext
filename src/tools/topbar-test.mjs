// 頂欄排版檢查：編輯態、桌面寬度，設定圖示是否被折到下一行。
// 用法：node src/tools/topbar-test.mjs [--width=1280]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9344;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-topbar-'));
const WIDTH = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1]) || 1280;
const PAGE =
  'http://127.0.0.1:8123/build/index.html?data=aijargon&test=1&edit=1#/aijargon/' +
  encodeURIComponent('權重');

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},900`,
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    PAGE,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8123'));
  } catch (e) {
    /* 等它起來 */
  }
  await sleep(250);
}
if (!page) throw new Error('no page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
for (let i = 0; i < 80; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break;
  await sleep(100);
}
await sleep(700);

const result = await evaluate(`(async () => {
  document.querySelector('#editBtn').click();
  await new Promise((r) => setTimeout(r, 500));
  const view = document.querySelector('.cm-offtext-root')?.__cmView;
  if (view) view.dispatch({ changes: { from: 0, insert: '測' } });
  await new Promise((r) => setTimeout(r, 350));
  const bar = document.querySelector('.topbar').getBoundingClientRect();
  const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
  const search = document.querySelector('.search-wrap').getBoundingClientRect();
  const rows = new Set([...document.querySelectorAll('.topbar > *')].map((el) => Math.round(el.getBoundingClientRect().top)));
  return {
    width: innerWidth,
    topbarHeight: Math.round(bar.height),
    rows: [...rows].sort((a, b) => a - b),
    settingsTop: Math.round(settings.top),
    settingsWrapped: settings.top > bar.top + 40,
    searchWidth: Math.round(search.width),
    exportVisible: !document.querySelector('#exportBtn').hidden,
    saveVisible: !document.querySelector('#saveBtn').hidden,
    editVisible: !document.querySelector('#editBtn').hidden,
    children: [...document.querySelectorAll('.topbar > *')].map((el) => ({
      id: el.id || el.className,
      top: Math.round(el.getBoundingClientRect().top),
      width: Math.round(el.getBoundingClientRect().width),
      text: (el.textContent || '').trim().slice(0, 12),
    })),
  };
})()`);
console.log(JSON.stringify(result, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, `topbar-${WIDTH}.png`), Buffer.from(shot.result.data, 'base64'));
console.log('exceptions', exceptions.length, exceptions.map((e) => e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
