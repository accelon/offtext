// 手機模式實測：自動載入全部科目、不載入 CM6、簡化 toolbar、DOM 巢狀、閱讀按鈕。
// 用法：node src/tools/mobile-test.mjs（先跑 build，且 serve.mjs 在 8123）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9340;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-mobile-'));
const PAGE = 'http://127.0.0.1:8123/build/index.html?theme=light';

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
  width: 420,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
});
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 80; i++) {
  if ((await evaluate('document.readyState')) === 'complete') break;
  await sleep(100);
}
await sleep(1200);

const initial = await evaluate(`(() => {
  const shown = (id) => {
    const el = document.querySelector(id);
    return (
      !!el &&
      !el.hidden &&
      getComputedStyle(el).display !== 'none' &&
      el.offsetParent !== null
    );
  };
  return {
    ua: navigator.userAgent,
    touch: navigator.maxTouchPoints,
    coarse: matchMedia('(pointer: coarse)').matches,
    bootStatus: document.querySelector('#bootStatus')?.textContent,
    bootHidden: document.querySelector('#boot').hidden,
    bodyMobile: document.body.classList.contains('is-mobile-ui'),
    title: document.querySelector('.entry-title')?.textContent,
    subjects: document.querySelectorAll('#subject option').length,
    noCM: !document.querySelector('.cm-editor'),
    cmGlobal: !!window.OfftextCM,
    topbar: ['#subject', '#search', '#viewToggle', '#indexBtn', '#settingsBtn'].map((id) => [id, shown(id)]),
    hidden: ['#homeBtn', '#rankImportant', '#readHistory', '#editBtn', '#saveBtn', '#orphanBtn', '#leaveBtn'].map((id) => [id, shown(id)]),
    footer: getComputedStyle(document.querySelector('.site-foot')).display,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  };
})()`);
console.log('initial', JSON.stringify(initial, null, 2));

const expand = await evaluate(`(async () => {
  const ref = document.querySelector('.nt-ref');
  if (!ref) return { error: 'no nt-ref' };
  const label = ref.textContent;
  ref.click();
  await new Promise((r) => setTimeout(r, 350));
  return {
    label,
    expanded: document.querySelectorAll('.nt-exp').length,
    readButton: document.querySelector('.nt-mobile-read')?.textContent,
    focusing: document.querySelector('#reader').classList.contains('is-focusing'),
    ancestor: document.querySelectorAll('.is-focus-ancestor').length,
    dim: document.querySelectorAll('.nt-dim').length,
  };
})()`);
console.log('expand', JSON.stringify(expand, null, 2));

const deep = await evaluate(`(async () => {
  const inner = document.querySelector('.nt-exp .nt-ref');
  if (!inner) return { error: 'no nested ref' };
  inner.click();
  await new Promise((r) => setTimeout(r, 350));
  return {
    ancestorLabels: document.querySelectorAll('.nt-ref.is-focus-ancestor').length,
    explained: document.querySelectorAll('.nt-exp').length,
    dim: document.querySelectorAll('.nt-dim').length,
  };
})()`);
console.log('deep', JSON.stringify(deep, null, 2));

const read = await evaluate(`(async () => {
  const btn = document.querySelector('.nt-mobile-read');
  if (!btn) return { error: 'no read button' };
  btn.click();
  await new Promise((r) => setTimeout(r, 450));
  return {
    hash: location.hash,
    title: document.querySelector('.entry-title')?.textContent,
    expanded: document.querySelectorAll('.nt-exp').length,
  };
})()`);
console.log('read', JSON.stringify(read, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(SHOTS, 'mobile-refactor.png'), Buffer.from(shot.result.data, 'base64'));

const settings = await evaluate(`(async () => {
  document.querySelector('#settingsBtn').click();
  await new Promise((r) => setTimeout(r, 120));
  const buttons = [...document.querySelectorAll('#uiSeg button')];
  return {
    open: !document.querySelector('#settingsBox').hidden,
    modes: buttons.map((b) => ({ mode: b.dataset.ui, active: b.classList.contains('is-active'), disabled: b.disabled })),
    hint: document.querySelector('#uiHint')?.textContent,
  };
})()`);
console.log('settings', JSON.stringify(settings, null, 2));

console.log('exceptions', exceptions.length, JSON.stringify(exceptions.map((e) => e.exception?.description || e.text)));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
