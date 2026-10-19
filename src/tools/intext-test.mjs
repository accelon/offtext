// 文內搜尋：A 的反鏈區 → 找 B → 跳到 B 插入 ^[A] → 取消按鈕。
// 用法：node src/tools/intext-test.mjs（先跑 build）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const BUILD = path.join(ROOT, 'build');
const DOMAINS = loadDomains(ROOT);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9342;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-intext-'));
const PAGE =
  pathToFileURL(path.join(BUILD, 'index.html')).href +
  '?test=1#/aijargon/' +
  encodeURIComponent('權重');

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
    page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
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
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.OFFTEXT_DOMAINS=' + JSON.stringify(DOMAINS) + ';',
});
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 40; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break;
  await sleep(100);
}
await sleep(600);

const panel = await evaluate(`(async () => {
  document.querySelector('#editBtn').click();
  await new Promise((r) => setTimeout(r, 300));
  const search = document.querySelector('.backlink-search');
  if (!search) return { error: 'no search button' };
  search.click();
  await new Promise((r) => setTimeout(r, 250));
  return {
    open: !!document.querySelector('.reco-panel'),
    items: document.querySelectorAll('.reco-item').length,
    first: document.querySelector('.reco-source')?.textContent,
    context: document.querySelector('.reco-context')?.textContent.slice(0, 50),
    go: !!document.querySelector('.reco-go'),
  };
})()`);
console.log('panel', JSON.stringify(panel, null, 2));

const inserted = await evaluate(`(async () => {
  document.querySelector('.reco-go').click();
  await new Promise((r) => setTimeout(r, 900));
  const root = document.querySelector('.cm-offtext-root');
  return {
    hash: decodeURIComponent(location.hash),
    title: document.querySelector('.entry-title')?.textContent,
    editing: root?.classList.contains('cm-editing'),
    cancel: document.querySelectorAll('.cm-cancel-insert').length,
    pending: [...document.querySelectorAll('.backlink.is-pending')].map((b) => b.textContent),
    save: document.querySelector('#saveBtn')?.textContent,
    docHas: root?.__cmView?.state.doc.toString().includes('^[權重]'),
  };
})()`);
console.log('inserted', JSON.stringify(inserted, null, 2));

const cancelled = await evaluate(`(async () => {
  const btn = document.querySelector('.cm-cancel-insert');
  if (!btn) return { error: 'no cancel' };
  btn.click();
  await new Promise((r) => setTimeout(r, 300));
  const root = document.querySelector('.cm-offtext-root');
  return {
    cancel: document.querySelectorAll('.cm-cancel-insert').length,
    docHas: root?.__cmView?.state.doc.toString().includes('^[權重]'),
    docHasWord: root?.__cmView?.state.doc.toString().includes('權重'),
    pending: document.querySelectorAll('.backlink.is-pending').length,
  };
})()`);
console.log('cancelled', JSON.stringify(cancelled, null, 2));

console.log('exceptions', exceptions.length, exceptions.map((e) => e.exception?.description || e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
