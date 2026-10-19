// HTTP 模式實測：啟動頁 TSV 清單 → 載入 → 記憶體編輯 → 未存檔提示 → 離開流程。
// 需要先跑 node src/tools/serve.mjs --port 8123，並 node src/tools/build.mjs。
// 用法：node src/tools/http-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const BUILD = path.join(ROOT, 'build');
const SHOTS = path.join(BUILD, 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-http-'));
const HTTP_PAGE = 'http://127.0.0.1:8123/build/index.html#/modern-chinese-history/義和團';
const FILE_PAGE = pathToFileURL(path.join(BUILD, 'index.html')).href;

if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過 HTTP 測試');
  process.exit(0);
}

try {
  const probe = await fetch('http://127.0.0.1:8123/api/tsvs');
  if (!probe.ok) throw new Error('status ' + probe.status);
} catch (e) {
  console.error('HTTP 伺服器沒開：請先跑 node src/tools/serve.mjs --port 8123');
  process.exit(1);
}

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,1100',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    HTTP_PAGE,
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) {
      /* 還沒起來 */
    }
    await sleep(250);
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

async function waitFor(expression, label, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch (e) {
      /* 頁面還在換 */
    }
    await sleep(100);
  }
  throw new Error('等待逾時：' + label);
}

async function shot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.result.data, 'base64'));
}

await send('Runtime.enable');
await send('Page.enable');
await waitFor('document.readyState === "complete"', 'document ready');
await waitFor('!document.querySelector("#bootCatalog").hidden', 'boot catalog');

const catalog = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.boot-tsv')];
  return {
    count: rows.length,
    checked: rows.filter((row) => row.querySelector('input').checked).length,
    allChecked: rows.every((row) => row.querySelector('input').checked),
    names: rows.map((row) => row.querySelector('.boot-tsv-name').textContent),
    openLabel: document.querySelector('#bootOpenSelected').textContent,
    hint: document.querySelector('#bootCatalogHint').textContent,
  };
})()`);
await shot('shot-boot-http.png');

await evaluate("document.querySelector('#bootOpenSelected').click()");
await waitFor('document.querySelector("#boot").hidden', 'boot hidden');
await waitFor('document.querySelectorAll("#subject option").length > 1', 'subjects');

const loaded = await evaluate(`(() => ({
  subjects: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
  hash: location.hash,
  title: document.querySelector('.entry-title')?.textContent,
  stats: document.querySelector('#stats').textContent,
  dirtyHidden: document.querySelector('#dirtyBtn').hidden,
}))()`);

// 選取正文的一段文字，走「新增詞目 → 編輯器」的真實流程。
const selection = await evaluate(`(() => {
  const text = document.querySelector('.nt-text');
  const node = text && text.firstChild;
  if (!node || node.nodeType !== 3) return { ok: false };
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(3, node.textContent.length));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('#reader').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return { ok: true, text: sel.toString() };
})()`);
await waitFor('!document.querySelector(".add-term-btn").hidden', 'add term button');
await evaluate("document.querySelector('.add-term-btn').click()");
await waitFor('!!document.querySelector(".edit-panel")', 'editor');

const editor = await evaluate(`(() => ({
  kicker: document.querySelector('.edit-kicker')?.textContent,
  file: document.querySelector('.edit-file')?.textContent || '',
  note: document.querySelector('.edit-note')?.textContent,
}))()`);

await evaluate(`(() => {
  const area = document.querySelector('.edit-textarea');
  area.value = '這是記憶體測試值';
  document.querySelector('.edit-primary').click();
})()`);
await waitFor('!document.querySelector("#dirtyBtn").hidden', 'dirty badge');

const dirty = await evaluate(`(() => ({
  badge: document.querySelector('#dirtyBtn').textContent,
  badgeTitle: document.querySelector('#dirtyBtn').title,
  subjectOptions: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
  stats: document.querySelector('#stats').textContent,
  title: document.querySelector('.entry-title')?.textContent,
  body: [...document.querySelectorAll('.nt-line')].map((el) => el.textContent).join(' '),
}))()`);
await shot('shot-dirty-badge.png');

await evaluate("document.querySelector('#dirtyBtn').click()");
await waitFor('!!document.querySelector(".leave-panel")', 'save dialog');
const saveDialog = await evaluate(`(() => {
  const panel = document.querySelector('.leave-panel');
  return {
    title: panel.querySelector('.edit-title')?.textContent,
    items: [...panel.querySelectorAll('.dirty-item')].map((item) => item.textContent.trim()),
    buttons: [...panel.querySelectorAll('.edit-actions button')].map((b) => b.textContent),
    note: panel.querySelector('.dirty-note')?.textContent,
  };
})()`);
await shot('shot-save-dialog.png');
await evaluate(`[...document.querySelectorAll('.leave-panel .edit-actions button')]
  .find((b) => b.textContent === '取消').click()`);

await evaluate("document.querySelector('#leaveBtn').click()");
await waitFor('!!document.querySelector(".leave-panel")', 'leave dialog');
const leaveDialog = await evaluate(`(() => ({
  title: document.querySelector('.leave-panel .edit-title')?.textContent,
  buttons: [...document.querySelectorAll('.leave-panel .edit-actions button')].map((b) => b.textContent),
}))()`);
await shot('shot-leave-dialog.png');
await evaluate(`[...document.querySelectorAll('.leave-panel .edit-actions button')]
  .find((b) => b.textContent === '取消').click()`);

// 「不儲存離開」：確認後回到啟動頁，資料檔不動。
await evaluate('window.confirm = () => true');
await evaluate("document.querySelector('#leaveBtn').click()");
await waitFor('!!document.querySelector(".leave-panel")', 'leave dialog 2');
await evaluate(`[...document.querySelectorAll('.leave-panel .edit-actions button')]
  .find((b) => b.textContent === '不儲存離開').click()`);
await waitFor('!document.querySelector("#boot").hidden', 'back to boot');
const left = await evaluate(`(() => ({
  bootVisible: !document.querySelector('#boot').hidden,
  dirtyHidden: document.querySelector('#dirtyBtn').hidden,
  catalogCount: document.querySelectorAll('.boot-tsv').length,
  hash: location.hash,
  stats: document.querySelector('#stats').textContent,
}))()`);

// 伺服器寫回 API：用原內容 POST，確認能寫回 data/。
const serverSave = await evaluate(`(async () => {
  const get = await fetch('/data/biology.tsv', { cache: 'no-store' });
  const text = await get.text();
  const res = await fetch('/api/tsv/biology.tsv', {
    method: 'POST',
    headers: { 'content-type': 'text/tab-separated-values; charset=utf-8' },
    body: text,
  });
  return { status: res.status, body: await res.json() };
})()`);

// 完整「儲存並離開」：載入 → 記憶體編輯 → 離開時寫回 dev server。
// 測試前先記下原檔，寫入後立刻還原。
const originalModern = await (
  await fetch('http://127.0.0.1:8123/data/modern-chinese-history.tsv', { cache: 'no-store' })
).text();

await evaluate("document.querySelector('#bootOpenSelected').click()");
await waitFor('document.querySelector("#boot").hidden', 'boot hidden 2');
await waitFor('document.querySelectorAll("#subject option").length > 1', 'subjects 2');
const selection2 = await evaluate(`(() => {
  const text = document.querySelector('.nt-text');
  const node = text && text.firstChild;
  if (!node || node.nodeType !== 3) return '';
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(3, node.textContent.length));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.querySelector('#reader').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return sel.toString();
})()`);
await waitFor('!document.querySelector(".add-term-btn").hidden', 'add term 2');
await evaluate("document.querySelector('.add-term-btn').click()");
await waitFor('!!document.querySelector(".edit-panel")', 'editor 2');
await evaluate(`(() => {
  const area = document.querySelector('.edit-textarea');
  area.value = '這是儲存測試值';
  document.querySelector('.edit-primary').click();
})()`);
await waitFor('!document.querySelector("#dirtyBtn").hidden', 'dirty 2');
await evaluate("document.querySelector('#leaveBtn').click()");
await waitFor('!!document.querySelector(".leave-panel")', 'leave dialog 3');
await evaluate(`[...document.querySelectorAll('.leave-panel .edit-actions button')]
  .find((b) => b.textContent === '儲存並離開').click()`);
await waitFor('!document.querySelector("#boot").hidden', 'boot after save', 12000);

const savedText = await (
  await fetch('http://127.0.0.1:8123/data/modern-chinese-history.tsv', { cache: 'no-store' })
).text();
const saveAndLeave = {
  selection: selection2,
  wroteValue: savedText.includes(selection2 + '\t這是儲存測試值'),
  dirtyHidden: await evaluate('document.querySelector("#dirtyBtn").hidden'),
  bootVisible: await evaluate('!document.querySelector("#boot").hidden'),
};

// 還原原檔（不管寫入成功與否都做）。
const restore = await fetch('http://127.0.0.1:8123/api/tsv/modern-chinese-history.tsv', {
  method: 'POST',
  headers: { 'content-type': 'text/tab-separated-values; charset=utf-8' },
  body: originalModern,
});
const restored = { status: restore.status, ok: (await restore.json()).ok };

// file:// 模式：清單仍要出現，但按鈕改成選檔。
await send('Page.navigate', { url: FILE_PAGE });
await waitFor('document.readyState === "complete"', 'file ready');
await waitFor('!document.querySelector("#bootCatalog").hidden', 'file catalog');
const fileMode = await evaluate(`(() => ({
  protocol: location.protocol,
  count: document.querySelectorAll('.boot-tsv').length,
  openLabel: document.querySelector('#bootOpenSelected').textContent,
  hint: document.querySelector('#bootCatalogHint').textContent,
  bootVisible: !document.querySelector('#boot').hidden,
}))()`);
await shot('shot-boot-file.png');

// ?data= 仍可直接載入（且不再標成唯讀）。
await send('Page.navigate', {
  url: 'http://127.0.0.1:8123/build/index.html?data=biology,chemistry',
});
await waitFor('document.readyState === "complete"', 'data ready');
await waitFor('document.querySelector("#boot").hidden', 'data boot hidden');
const fromUrl = await evaluate(`(() => ({
  subjects: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
  stats: document.querySelector('#stats').textContent,
  title: document.querySelector('.entry-title')?.textContent,
  bootVisible: !document.querySelector('#boot').hidden,
}))()`);

console.log(
  JSON.stringify(
    {
      catalog,
      loaded,
      selection,
      editor,
      dirty,
      saveDialog,
      leaveDialog,
      left,
      serverSave,
      saveAndLeave,
      restored,
      fileMode,
      fromUrl,
      exceptions,
    },
    null,
    2
  )
);

ws.close();
child.kill();
await sleep(400);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* Windows 檔案鎖 */
}
