// 啟動頁實測：單一 scroll、分組全選、科目命名、開啟選定科目。
// 用法：node src/tools/boot-test.mjs（先跑 build，且 serve.mjs 在 8123）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9338;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-boot-'));
const PAGE = 'http://127.0.0.1:8123/build/index.html?theme=light';

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
for (let i = 0; i < 40; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break;
  await sleep(100);
}
await sleep(500);

const layout = await evaluate(`(() => {
  const card = document.querySelector('.boot-card');
  const list = document.querySelector('.boot-catalog-list');
  const groups = [...document.querySelectorAll('.boot-group')].map((section) => ({
    group: section.dataset.group,
    items: section.querySelectorAll('.boot-tsv').length,
    actions: [...section.querySelectorAll('.boot-group-actions button')].map((b) => b.textContent),
  }));
  const open = document.querySelector('#bootOpenSelected');
  const listTop = list.getBoundingClientRect().top;
  const openBottom = open.getBoundingClientRect().bottom;
  return {
    h1: !!document.querySelector('.boot-card h1'),
    intro: !!document.querySelector('.boot-card > p:not(#bootStatus)'),
    catalogHead: !!document.querySelector('.boot-catalog-head'),
    hint: !!document.querySelector('#bootCatalogHint'),
    openText: open.textContent,
    openAboveList: openBottom <= listTop + 1,
    groups,
    checked: document.querySelectorAll('.boot-tsv input:checked').length,
    cardOverflow: getComputedStyle(card).overflow,
    cardScrolls: card.scrollHeight > card.clientHeight + 1,
    listScrolls: list.scrollHeight > list.clientHeight + 1,
    bootOpenHidden: document.querySelector('#bootOpen').hidden,
  };
})()`);
console.log('layout', JSON.stringify(layout, null, 2));

const groupToggle = await evaluate(`(() => {
  const section = document.querySelector('.boot-group');
  const buttons = section.querySelectorAll('.boot-group-actions button');
  buttons[1].click();
  const afterNone = section.querySelectorAll('input:checked').length;
  buttons[0].click();
  const afterAll = section.querySelectorAll('input:checked').length;
  return { afterNone, afterAll, total: section.querySelectorAll('input').length };
})()`);
console.log('groupToggle', JSON.stringify(groupToggle, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'boot-refactor.png'), Buffer.from(shot.result.data, 'base64'));

const opened = await evaluate(`(async () => {
  document.querySelector('#bootOpenSelected').click();
  await new Promise((r) => setTimeout(r, 900));
  return {
    bootHidden: document.querySelector('#boot').hidden,
    booting: document.body.classList.contains('is-booting'),
    subjects: document.querySelectorAll('#subject option').length,
    title: document.querySelector('.entry-title')?.textContent,
    hash: location.hash,
    modernName: [...document.querySelectorAll('#subject option')].some((o) => o.textContent.includes('中國近代史')),
    ancientId: [...document.querySelectorAll('#subject option')].some((o) => o.value === 'ancient-china'),
    worldId: [...document.querySelectorAll('#subject option')].some((o) => o.value === 'world-history'),
    readonly: document.body.classList.contains('is-readonly-online'),
    editHidden: document.querySelector('#editBtn').hidden,
    saveHidden: document.querySelector('#saveBtn').hidden,
    orphanHidden: document.querySelector('#orphanBtn').hidden,
    exportHidden: document.querySelector('#exportBtn').hidden,
    editing: !!document.querySelector('.cm-offtext-root.cm-editing'),
  };
})()`);
console.log('opened', JSON.stringify(opened, null, 2));

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
console.log('exceptions', exceptions.length, exceptions.map((e) => e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
