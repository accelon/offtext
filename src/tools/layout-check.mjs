// 檢查窄螢幕是否有水平溢出：node src/tools/layout-check.mjs（先跑 build）
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
const DOMAINS = loadDomains(ROOT);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-layout-'));
const DEFAULT_PAGE =
  pathToFileURL(path.join(BUILD, 'index.html')).href + '?theme=light&expand=0#/aijargon/人工神經元';
const PAGE = process.argv[2] || DEFAULT_PAGE;

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=420,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    PAGE,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 60 && !page; i++) {
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.OFFTEXT_DOMAINS=' + JSON.stringify(DOMAINS) + ';',
});
await send('Page.reload', { ignoreCache: true });
await sleep(500);
for (let i = 0; i < 30; i++) {
  const res = await send('Runtime.evaluate', {
    expression: 'document.readyState',
    returnByValue: true,
  });
  if (res.result?.result?.value === 'complete') break;
  await sleep(100);
}

const res = await send('Runtime.evaluate', {
  expression: `(() => {
    const vw = innerWidth;
    const offenders = [...document.querySelectorAll('*')]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(
        ({ el }) =>
          !el.closest('.backlinks-list') &&
          !el.closest('.index-tabs') &&
          !el.closest('.graph-canvas')
      )
      .filter(({ rect }) => rect.right > vw + 0.5 || rect.width > vw + 0.5)
      .slice(0, 15)
      .map(({ el, rect }) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') + ' right=' + Math.round(rect.right) + ' width=' + Math.round(rect.width));
    return {
      innerWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      offenders,
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(res.result.result.value, null, 2));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
