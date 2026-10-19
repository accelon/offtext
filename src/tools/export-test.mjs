// Export 實測：產生單一 HTML、不含 CM6、可離線巢狀展開與 hover。
// 用法：node src/tools/export-test.mjs（先跑 build）
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
const PORT = 9341;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-export-'));
const PAGE =
  pathToFileURL(path.join(BUILD, 'index.html')).href +
  '?theme=light&test=1&edit=1#/aijargon/' +
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
await sleep(600);

const html = await evaluate(`window.__offtextTest.buildExportHtml()`);
if (!html || !html.includes('<!doctype html>')) throw new Error('export HTML missing');
const button = await evaluate(`(async () => {
  document.querySelector('#editBtn').click();
  await new Promise((r) => setTimeout(r, 250));
  const btn = document.querySelector('#exportBtn');
  return { hidden: btn.hidden, text: btn.textContent, editing: !!document.querySelector('.cm-editing') };
})()`);
console.log('button', button);
console.log('size', Buffer.byteLength(html), 'hasCM', html.includes('CodeMirror') || html.includes('offtext-cm.js'));
const match = /window\.OFFTEXT_EXPORT=([\s\S]*?);<\/script>/.exec(html);
if (!match) throw new Error('payload missing');
const payload = JSON.parse(match[1]);
console.log('payload', {
  start: payload.start,
  domains: Object.keys(payload.domains).length,
  entries: Object.keys(payload.entries).length,
  aliases: Object.keys(payload.aliases).length,
  badHome: Object.keys(payload.entries).filter((id) => id.endsWith(':_')).length,
  badAlias: Object.values(payload.entries).filter((value) => String(value).trim().startsWith('@')).length,
});

const out = path.join(BUILD, 'export-test.html');
fs.writeFileSync(out, html);
const fileUrl = pathToFileURL(out).href;
await send('Page.navigate', { url: fileUrl });
for (let i = 0; i < 60; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break;
  await sleep(100);
}
await sleep(350);

const initial = await evaluate(`(() => ({
  title: document.querySelector('.entry-title')?.textContent,
  refs: document.querySelectorAll('.nt-ref').length,
  cm: document.querySelectorAll('.cm-editor').length,
  external: [...document.querySelectorAll('script[src], link[href]')].length,
}))()`);
console.log('initial', initial);

const expand = await evaluate(`(async () => {
  const ref = document.querySelector('.nt-ref');
  ref.click();
  await new Promise((r) => setTimeout(r, 200));
  return {
    expanded: document.querySelectorAll('.nt-exp-inline').length,
    text: document.querySelector('.nt-exp-inline')?.textContent.slice(0, 40),
  };
})()`);
console.log('expand', expand);

const hover = await evaluate(`(async () => {
  const ref = document.querySelector('.nt-ref');
  ref.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  await new Promise((r) => setTimeout(r, 250));
  return {
    cards: document.querySelectorAll('.export-hover').length,
    title: document.querySelector('.export-hover-title')?.textContent,
    nested: document.querySelectorAll('.export-hover .nt-ref').length,
  };
})()`);
console.log('hover', hover);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(BUILD, 'shots', 'export-runtime.png'), Buffer.from(shot.result.data, 'base64'));

console.log('exceptions', exceptions.length, exceptions.map((e) => e.exception?.description || e.text));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
