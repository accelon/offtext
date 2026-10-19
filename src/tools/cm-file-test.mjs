// file:// 實測：不靠 HTTP、不靠 fetch，注入一個小 domain 後直接渲染／編輯。
// 用法：node src/tools/cm-file-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CM_FILE_CDP_PORT || 9343);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-cm-file-'));
const PAGE = 'file:///D:/2026/offtext/build/index.html';
const SHOT = 'cm-file.png';

fs.mkdirSync(SHOTS, { recursive: true });

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    PAGE,
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
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.OFFTEXT_DOMAINS = [{
    id: 'modern-chinese-history',
    name: '中國近代史',
    entries: {
      '_': '這是一份用 file:// 直接開啟的巢狀文字。',
      '甲': '甲條目用來說明^[乙]。',
      '乙': '乙條目是巢狀展開的目標。'
    }
  }];`,
});
await send('Page.reload', { ignoreCache: true });
await waitFor('document.readyState === "complete"', 'file ready');
await waitFor('!!document.querySelector(".cm-offtext-root")', 'CM6 root file');

const initial = await evaluate(`(() => ({
  protocol: location.protocol,
  hasCM: !!window.OfftextCM,
  manifest: Array.isArray(window.OFFTEXT_TSV_MANIFEST) ? window.OFFTEXT_TSV_MANIFEST.length : -1,
  title: document.querySelector('.entry-title')?.textContent,
  text: document.querySelector('.cm-content')?.innerText,
  refs: document.querySelectorAll('.cm-ref').length,
  bootHidden: document.querySelector('#boot').hidden,
}))()`);
console.log('initial', JSON.stringify(initial, null, 2));

await evaluate(`document.querySelector('#editBtn').click()`);
await sleep(200);
await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
})()`);
await send('Input.insertText', { text: '（離線編輯）' });
await sleep(300);
const editing = await evaluate(`(() => ({
  editing: document.querySelector('.cm-offtext-root')?.classList.contains('cm-editing'),
  save: document.querySelector('#saveBtn')?.textContent,
  saveHidden: document.querySelector('#saveBtn')?.hidden,
  footer: document.querySelector('#stats')?.textContent,
  tail: document.querySelector('.cm-offtext-root')?.__cmView?.state.doc.toString().slice(-12),
}))()`);
console.log('editing', JSON.stringify(editing, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  fs.writeFileSync(path.join(SHOTS, SHOT), Buffer.from(shot.result.data, 'base64'));
  console.log('shot', path.join(SHOTS, SHOT));
}

// 沒有檔案 handle、也不是 HTTP：存檔只套用＋重建，dirty 留給離開流程。
await evaluate("document.querySelector('#saveBtn').click()");
await sleep(500);
const saved = await evaluate(`(() => ({
  saveHidden: document.querySelector('#saveBtn').hidden,
  dirtyHidden: document.querySelector('#dirtyBtn').hidden,
  dirty: document.querySelector('#dirtyBtn').textContent,
  toast: document.querySelector('.edit-toast')?.textContent,
  footer: document.querySelector('#stats').textContent,
}))()`);
console.log('saved', JSON.stringify(saved, null, 2));

await evaluate("document.querySelector('.edit-toast')?.classList.remove('is-visible')");
const dirtyShot = await send('Page.captureScreenshot', { format: 'png' });
if (dirtyShot.result && dirtyShot.result.data) {
  fs.writeFileSync(
    path.join(SHOTS, 'cm-dirty.png'),
    Buffer.from(dirtyShot.result.data, 'base64')
  );
  console.log('shot', path.join(SHOTS, 'cm-dirty.png'));
}

await evaluate('window.confirm = () => true');
await evaluate("document.querySelector('#leaveBtn').click()");
await sleep(300);
const leave = await evaluate(`(() => ({
  panel: !!document.querySelector('.leave-panel'),
  buttons: [...document.querySelectorAll('.leave-panel .edit-actions button')].map((b) => b.textContent),
}))()`);
console.log('leave', JSON.stringify(leave, null, 2));
const leaveShot = await send('Page.captureScreenshot', { format: 'png' });
if (leaveShot.result && leaveShot.result.data) {
  fs.writeFileSync(
    path.join(SHOTS, 'cm-leave.png'),
    Buffer.from(leaveShot.result.data, 'base64')
  );
  console.log('shot', path.join(SHOTS, 'cm-leave.png'));
}
if (leave.panel) {
  await evaluate(`[...document.querySelectorAll('.leave-panel .edit-actions button')]
    .find((b) => b.textContent === '不儲存離開')?.click()`);
  await sleep(300);
}
const left = await evaluate(`(() => ({
  bootVisible: !document.querySelector('#boot').hidden,
  hash: location.hash,
}))()`);
console.log('left', JSON.stringify(left, null, 2));

console.log('exceptions', exceptions);
ws.close();
child.kill();
await sleep(300);
process.exit(exceptions.length ? 2 : 0);
