// 印出某個 URL 的展開狀態，除錯用：node src/tools/dump.mjs "<url>"
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
const PORT = 9335;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-dump-'));
const DEFAULT_URL =
  pathToFileURL(path.join(BUILD, 'index.html')).href + '?theme=light&expand=1,1.0#/aijargon/_';
const PAGE = process.argv[2] || DEFAULT_URL;

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,1000',
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
    /* 等 */
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
  expression: `(() => ({
    href: location.href,
    root: document.querySelector('.entry-title')?.textContent,
    expanded: [...document.querySelectorAll('.nt-ref[aria-expanded="true"]')].map((b) => ({
      path: b.dataset.path,
      label: b.textContent,
      parentExp: b.closest('.nt-exp')?.querySelector('.nt-exp-head .nt-exp-key')?.textContent || null,
    })),
    exps: [...document.querySelectorAll('.nt-exp')].map((e) => ({
      id: e.id,
      path: e.dataset.path,
      depth: e.dataset.depth,
      cls: e.className,
      text: e.textContent.replace(/\\s+/g, ' ').slice(0, 50),
    })),
    focusing: document.querySelector('#reader').classList.contains('is-focusing'),
    focusTarget: document.querySelector('.nt-focus-current')?.getAttribute('data-path') || null,
    texts: [...document.querySelectorAll('.nt-text')].slice(0, 12).map((e) => ({
      t: e.textContent.slice(0, 14),
      cls: e.className,
      op: getComputedStyle(e).opacity,
      parent: e.parentElement.className,
    })),
    dimmed: [...document.querySelectorAll('.nt-dim')].map((e) => ({
      cls: typeof e.className === 'string' ? e.className : '',
      path: e.dataset?.path || null,
      text: (e.textContent || '').replace(/\\s+/g, ' ').slice(0, 18),
    })),
  }))()`,
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
