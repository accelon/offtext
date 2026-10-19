// 啟動行為實測：HTTP(S) 讀 data-index.txt 直接進主畫面；file:// 才顯示選檔頁。
// 用法：node src/tools/boot-test.mjs（先跑 build，且 serve.mjs 在 8123）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9338;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-boot-'));
const PAGE = 'http://127.0.0.1:8123/build/index.html?theme=light';
const FILE_PAGE = pathToFileURL(path.join(ROOT, 'build', 'index.html')).href + '?edit=1';

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1100,900',
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

async function waitFor(expression, label) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error('timeout: ' + label);
}

await waitFor('document.readyState === "complete"', 'document ready');
await waitFor('document.querySelector("#boot").hidden', 'http auto boot hidden');
await waitFor('document.querySelectorAll("#subject option").length > 1', 'http subjects');
await sleep(400);

const auto = await evaluate(`(() => ({
  bootHidden: document.querySelector('#boot').hidden,
  booting: document.body.classList.contains('is-booting'),
  catalogBuilt: document.querySelectorAll('.boot-tsv').length,
  subjects: document.querySelectorAll('#subject option').length,
  title: document.querySelector('.entry-title')?.textContent,
  hash: location.hash,
  stats: document.querySelector('#stats').textContent,
  readonly: document.body.classList.contains('is-readonly-online'),
  editHidden: document.querySelector('#editBtn').hidden,
}))()`);
console.log('auto', JSON.stringify(auto, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'boot-auto.png'), Buffer.from(shot.result.data, 'base64'));

const legacy = await evaluate(`(async () => {
  location.hash = '#/ancientchina/_';
  await new Promise((r) => setTimeout(r, 350));
  return {
    hash: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
    subject: document.querySelector('#subject')?.value,
  };
})()`);
console.log('legacy', JSON.stringify(legacy, null, 2));

const reserved = await evaluate(`(async () => {
  location.hash = '#/aijargon/' + encodeURIComponent('@x');
  await new Promise((r) => setTimeout(r, 350));
  return {
    hash: decodeURIComponent(location.hash),
    title: document.querySelector('.entry-title')?.textContent,
  };
})()`);
console.log('reserved', JSON.stringify(reserved, null, 2));

// file:// 不讀 data-index.txt，仍顯示本機選檔頁。
await send('Page.navigate', { url: FILE_PAGE });
await waitFor('document.readyState === "complete"', 'file ready');
await waitFor('document.querySelector("#boot") && !document.querySelector("#boot").hidden', 'file boot');
await sleep(400);
const fileMode = await evaluate(`(() => {
  const shown = (id) => {
    const el = document.querySelector(id);
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  };
  return {
    bootHidden: document.querySelector('#boot').hidden,
    filePicker: shown('#bootOpen'),
    openSelected: shown('#bootOpenSelected'),
    catalog: shown('#bootCatalog'),
    status: document.querySelector('#bootStatus')?.textContent,
    subjects: document.querySelectorAll('#subject option').length,
  };
})()`);
console.log('fileMode', JSON.stringify(fileMode, null, 2));

console.log('exceptions', exceptions.length, exceptions.map((e) => e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
