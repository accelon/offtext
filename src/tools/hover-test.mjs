// Hover popup 實測：桌面閱讀 hover、巢狀 hover、Ctrl+click、Esc。
// 用法：node src/tools/hover-test.mjs（先跑 build）
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
const PORT = 9339;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-hover-'));
const PAGE =
  pathToFileURL(path.join(BUILD, 'index.html')).href +
  '?theme=light#/aijargon/' +
  encodeURIComponent('人工神經元');

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
await sleep(500);

const first = await evaluate(`(async () => {
  const anchor = document.querySelector('.cm-ref');
  if (!anchor) return { error: 'no cm-ref' };
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  const card = document.querySelector('.hover-card');
  return {
    anchor: anchor.textContent,
    cards: document.querySelectorAll('.hover-card').length,
    title: card?.querySelector('.hover-card-title')?.textContent,
    body: card?.querySelector('.hover-card-body')?.textContent.slice(0, 60),
    cmEditors: card?.querySelectorAll('.cm-editor').length || 0,
    refs: card?.querySelectorAll('.hover-ref').length || 0,
    visible: !document.querySelector('.hover-layer').hidden,
  };
})()`);
console.log('first', JSON.stringify(first, null, 2));

const second = await evaluate(`(async () => {
  const inner = document.querySelector('.hover-card .hover-ref');
  if (!inner) return { error: 'no inner ref' };
  inner.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  await new Promise((r) => setTimeout(r, 450));
  return {
    cards: document.querySelectorAll('.hover-card').length,
    titles: [...document.querySelectorAll('.hover-card-title')].map((el) => el.textContent),
    bodies: [...document.querySelectorAll('.hover-card-body')].map((el) => el.textContent.slice(0, 30)),
  };
})()`);
console.log('second', JSON.stringify(second, null, 2));

const ctrlClick = await evaluate(`(async () => {
  const inner = [...document.querySelectorAll('.hover-card .hover-ref')].find(
    (el) => el.dataset.ref && !['神經元', '人工神經元'].includes(el.dataset.ref)
  );
  if (!inner) return { error: 'no inner ref' };
  const before = location.hash;
  const label = inner.dataset.ref;
  inner.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await new Promise((r) => setTimeout(r, 500));
  return {
    label,
    before,
    after: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
    cards: document.querySelectorAll('.hover-card').length,
  };
})()`);
console.log('ctrlClick', JSON.stringify(ctrlClick, null, 2));

const escape = await evaluate(`(async () => {
  const anchor = document.querySelector('.cm-ref');
  anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  const open = document.querySelectorAll('.hover-card').length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  return { open, after: document.querySelectorAll('.hover-card').length };
})()`);
console.log('escape', JSON.stringify(escape, null, 2));

const expandHover = await evaluate(`(async () => {
  location.hash = '#/aijargon/' + encodeURIComponent('人工神經元');
  await new Promise((r) => setTimeout(r, 700));
  const first = () => document.querySelector('.cm-ref');
  if (!first()) return { error: 'no cm-ref after navigation' };

  first().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  const openBefore = document.querySelectorAll('.hover-card').length;

  first().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  const expandedAnchor = first();
  const afterExpand = {
    expanded: expandedAnchor.getAttribute('aria-expanded'),
    open: !!document.querySelector('.cm-refwrap.is-open'),
    cards: document.querySelectorAll('.hover-card').length,
  };

  expandedAnchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  afterExpand.cardsAfterHover = document.querySelectorAll('.hover-card').length;

  expandedAnchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350));
  const collapsedAnchor = first();
  collapsedAnchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  return {
    openBefore,
    ...afterExpand,
    collapsed: collapsedAnchor.getAttribute('aria-expanded'),
    cardsAfterCollapseHover: document.querySelectorAll('.hover-card').length,
  };
})()`);
console.log('expandHover', JSON.stringify(expandHover, null, 2));
console.log('exceptions', exceptions.length, exceptions.map((e) => e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
