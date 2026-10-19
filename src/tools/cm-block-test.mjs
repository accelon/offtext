// 區塊展開與巢狀巢狀（block widget 內再展開）實測。
// 用法：node src/tools/cm-block-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CM_BLOCK_CDP_PORT || 9345);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-cm-block-'));
const URL =
  'http://127.0.0.1:8123/build/index.html?data=aijargon&mode=block&expand=0&test=1';

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,1100',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    URL,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) {
      /* 還沒起來 */
    }
    await sleep(200);
  }
  throw new Error('Edge 沒有在時限內提供 DevTools 端點');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
const exceptions = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    const detail = msg.params.exceptionDetails;
    exceptions.push(
      (detail.exception && (detail.exception.description || detail.exception.value)) ||
        detail.text ||
        'exception'
    );
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result && res.result.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  }
  return res.result && res.result.result ? res.result.result.value : undefined;
}

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch (e) {
      /* 頁面還在載入 */
    }
    await sleep(100);
  }
  throw new Error('等待逾時：' + label);
}

await send('Runtime.enable');
await send('Page.enable');
await waitFor('document.readyState === "complete"', 'ready');
await waitFor('!!document.querySelector(".cm-offtext-root")', 'CM6 root');
await waitFor('!!document.querySelector(".cm-exp-block")', 'block widget');

const block = await evaluate(`(() => {
  const box = document.querySelector('.cm-exp-block');
  const nested = box.querySelector('.cm-nested');
  return {
    block: !!box,
    header: box.querySelector('.cm-exp-head')?.innerText,
    nestedEditors: box.querySelectorAll('.cm-editor').length,
    nestedText: box.querySelector('.cm-content')?.innerText?.slice(0, 80),
    display: getComputedStyle(nested).display,
    borderLeft: getComputedStyle(box).borderLeftWidth,
    refLabels: box.querySelectorAll('.cm-ref').length,
  };
})()`);
console.log('block', JSON.stringify(block, null, 2));

// 在 block 內再展開一個引用。
await evaluate(`document.querySelector('.cm-exp-block .cm-ref')?.click()`);
await sleep(500);
const nested2 = await evaluate(`(() => ({
  blocks: document.querySelectorAll('.cm-exp-block').length,
  nestedEditors: document.querySelectorAll('.cm-nested .cm-editor').length,
  deep: document.querySelectorAll('.cm-nested .cm-nested .cm-editor').length,
  paths: [...document.querySelectorAll('[data-path]')].map((el) => el.dataset.path).slice(0, 12),
}))()`);
console.log('nested2', JSON.stringify(nested2, null, 2));

await evaluate("document.querySelector('.edit-toast')?.classList.remove('is-visible')");
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  fs.writeFileSync(path.join(SHOTS, 'cm-block.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('shot', path.join(SHOTS, 'cm-block.png'));
}

// 收合外層 block
await evaluate(`document.querySelector('.cm-exp-head .nt-exp-close')?.click()`);
await sleep(350);
const collapsed = await evaluate(`(() => ({
  blocks: document.querySelectorAll('.cm-exp-block').length,
  expanded: [...document.querySelectorAll('.cm-ref[aria-expanded="true"]')].length,
}))()`);
console.log('collapsed', JSON.stringify(collapsed, null, 2));

console.log('exceptions', exceptions);
ws.close();
child.kill();
await sleep(300);
process.exit(exceptions.length ? 2 : 0);
