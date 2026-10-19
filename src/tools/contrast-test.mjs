// 文字對比度檢查：亮底／暗底／護眼，展開到第二層。
// 用法：node src/tools/contrast-test.mjs（先跑 build）
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
const PORT = 9343;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-contrast-'));
const PAGE =
  pathToFileURL(path.join(BUILD, 'index.html')).href +
  '?theme=light&expand=0#/aijargon/' +
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

const result = await evaluate(`(async () => {
  function parse(c) {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => parseFloat(x));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function lum(c) {
    const channel = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }
  function bgOf(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.1) return c;
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  }
  function ratio(el) {
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) return null;
    const bg = bgOf(el);
    const a = fg.a * (parseFloat(style.opacity) || 1);
    const mix = {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
    };
    const l1 = lum(mix);
    const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  const out = {};
  for (const theme of ['light', 'dark', 'eye']) {
    document.documentElement.setAttribute('data-theme', theme);
    await new Promise((r) => setTimeout(r, 90));
    const items = {};
    for (const selector of ['.nt-exp-key', '.nt-exp-domain', '.nt-ref', '.nt-note', '.cm-content']) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const value = ratio(el);
      items[selector] = value == null ? null : Math.round(value * 100) / 100;
    }
    out[theme] = items;
  }
  return out;
})()`);
console.log(JSON.stringify(result, null, 2));
const failures = [];
for (const [theme, items] of Object.entries(result)) {
  for (const [selector, value] of Object.entries(items)) {
    if (value != null && value < 4.5) failures.push({ theme, selector, value });
  }
}
console.log('failures', JSON.stringify(failures));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
