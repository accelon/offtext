// HTTP 模式實測：啟動頁 TSV 清單 → 載入 → 內嵌編輯 → 存檔／重建 → 離開 → 寫回 API。
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
const HTTP_PAGE = 'http://127.0.0.1:8123/build/index.html?test=1&edit=1';
const FILE_PAGE = pathToFileURL(path.join(BUILD, 'index.html')).href + '?edit=1';
const API = 'http://127.0.0.1:8123';

if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge，跳過 HTTP 測試');
  process.exit(0);
}

try {
  const probe = await fetch(API + '/api/tsvs');
  if (!probe.ok) throw new Error('status ' + probe.status);
} catch (e) {
  console.error('HTTP 伺服器沒開：請先跑 node src/tools/serve.mjs --port 8123');
  process.exit(1);
}

const originalTarget = await (await fetch(API + '/data/chinese.tsv', { cache: 'no-store' })).text();

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
  for (let i = 0; i < 80; i++) {
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
const logs = [];

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
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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

async function waitFor(expression, label, timeout = 12000) {
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

async function chooseNewSelection(length) {
  return evaluate(`(() => {
    const root = document.querySelector('.cm-offtext-root');
    if (!root) return null;
    const view = root.__cmView;
    const text = view.state.doc.toString();
    const test = window.__offtextTest;
    const domain = test?.state?.root?.domain;
    const entries = test?.state?.index?.byId?.get(domain)?.entries;
    for (let offset = 0; offset < Math.min(30, text.length); offset += 2) {
      const to = Math.min(offset + ${length}, text.length);
      const candidate = text.slice(offset, to).trim();
      if (!candidate || /[\\[\\]\\n\\t]/.test(candidate)) continue;
      if (entries && entries.has(candidate)) continue;
      view.focus();
      view.dispatch({ selection: { anchor: offset, head: to } });
      document.querySelector('#reader').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { text: candidate, offset, length: candidate.length };
    }
    return null;
  })()`);
}

async function typeDraft(value) {
  await evaluate(`(() => {
    const root = document.querySelector('.cm-offtext-root');
    const view = root.__cmView;
    view.focus();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(value)} },
      selection: { anchor: ${JSON.stringify(value)}.length },
    });
  })()`);
  await sleep(350);
}

function restoreTarget() {
  return fetch(API + '/api/tsv/chinese.tsv', {
    method: 'POST',
    headers: { 'content-type': 'text/tab-separated-values; charset=utf-8' },
    body: originalTarget,
  }).then((res) => res.json());
}

let report = {};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor('document.readyState === "complete"', 'document ready');
  await waitFor('!document.querySelector("#bootCatalog").hidden', 'boot catalog');

  const catalog = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.boot-tsv')];
    return {
      count: rows.length,
      allChecked: rows.every((row) => row.querySelector('input').checked),
      names: rows.slice(0, 3).map((row) => row.querySelector('.boot-tsv-name').textContent),
      openLabel: document.querySelector('#bootOpenSelected').textContent,
    };
  })()`);
  await shot('shot-boot-http.png');

  await evaluate("document.querySelector('#bootOpenSelected').click()");
  await waitFor('document.querySelector("#boot").hidden', 'boot hidden');
  await waitFor('!!document.querySelector(".cm-offtext-root")', 'CM6 root');
  await waitFor('document.querySelectorAll("#subject option").length > 1', 'subjects');

  const loaded = await evaluate(`(() => ({
    subjects: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
    hash: decodeURIComponent(location.hash),
    title: document.querySelector('.entry-title')?.textContent,
    stats: document.querySelector('#stats').textContent,
    dirtyHidden: document.querySelector('#dirtyBtn').hidden,
    cm: !!document.querySelector('.cm-offtext-root'),
  }))()`);

  // 在正文選一段文字 → 新增詞目 → 同一窗區直接編輯。
  const picked = await chooseNewSelection(8);
  await waitFor('!document.querySelector(".add-term-btn").hidden', 'add term button');
  const selection = await evaluate(`(() => ({
    text: ${JSON.stringify(picked && picked.text)},
    button: document.querySelector('.add-term-btn')?.textContent,
    hidden: document.querySelector('.add-term-btn')?.hidden,
  }))()`);
  await evaluate("document.querySelector('.add-term-btn').click()");
  await waitFor('!!document.querySelector(".cm-offtext-root.cm-editing")', 'inline editor');
  const editor = await evaluate(`(() => ({
    title: document.querySelector('.entry-title')?.textContent,
    rawTitle: decodeURIComponent(location.hash),
    kicker: document.querySelector('.entry-kicker')?.textContent,
    saveHidden: document.querySelector('#saveBtn').hidden,
  }))()`);

  await typeDraft('這是記憶體測試值');
  const dirty = await evaluate(`(() => ({
    save: document.querySelector('#saveBtn')?.textContent,
    saveHidden: document.querySelector('#saveBtn')?.hidden,
    dirtyHidden: document.querySelector('#dirtyBtn').hidden,
    footer: document.querySelector('#stats').textContent,
    value: document.querySelector('.cm-offtext-root')?.__cmView?.state.doc.toString(),
  }))()`);
  await shot('shot-dirty-badge.png');

  await evaluate("document.querySelector('#saveBtn').click()");
  await waitFor('document.querySelector("#saveBtn").hidden', 'save done', 12000);
  const saved = await evaluate(`(() => ({
    toast: document.querySelector('.edit-toast')?.textContent,
    footer: document.querySelector('#stats').textContent,
    dirtyHidden: document.querySelector('#dirtyBtn').hidden,
    title: document.querySelector('.entry-title')?.textContent,
  }))()`);
  const savedFile = await (await fetch(API + '/data/chinese.tsv', { cache: 'no-store' })).text();
  const wroteValue = savedFile.includes(selection.text + '\t這是記憶體測試值');
  await shot('shot-cm-saved.png');

  // 沒有未存檔時，離開直接回啟動頁。
  await evaluate("document.querySelector('#leaveBtn').click()");
  await waitFor('!document.querySelector("#boot").hidden', 'back to boot');
  const left = await evaluate(`(() => ({
    bootVisible: !document.querySelector('#boot').hidden,
    hash: location.hash,
    stats: document.querySelector('#stats').textContent,
  }))()`);

  // 伺服器寫回 API（原內容往返）。
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

  // 未按存檔的草稿：按離開 → 確認 → 先存檔再回啟動頁。
  await evaluate("document.querySelector('#bootOpenSelected').click()");
  await waitFor('document.querySelector("#boot").hidden', 'boot hidden 2');
  await waitFor('!!document.querySelector(".cm-offtext-root")', 'CM6 root 2');
  const picked2 = await chooseNewSelection(10);
  await waitFor('!document.querySelector(".add-term-btn").hidden', 'add term 2');
  await evaluate("document.querySelector('.add-term-btn').click()");
  await waitFor('!!document.querySelector(".cm-offtext-root.cm-editing")', 'inline editor 2');
  await typeDraft('這是離開時儲存測試值');
  const beforeLeave = await evaluate(`(() => ({
    save: document.querySelector('#saveBtn')?.textContent,
    dirtyHidden: document.querySelector('#dirtyBtn').hidden,
    footer: document.querySelector('#stats').textContent,
  }))()`);
  await evaluate('window.confirm = () => true');
  await evaluate("document.querySelector('#leaveBtn').click()");
  await waitFor('!document.querySelector("#boot").hidden', 'boot after save', 15000);
  const leftWithSave = await evaluate(`(() => ({
    bootVisible: !document.querySelector('#boot').hidden,
    hash: location.hash,
    stats: document.querySelector('#stats').textContent,
  }))()`);
  const leaveFile = await (await fetch(API + '/data/chinese.tsv', { cache: 'no-store' })).text();
  const leaveWrote = leaveFile.includes(picked2.text + '\t這是離開時儲存測試值');

  // file:// 模式：不再顯示 TSV 清單，只留本機選檔。
  await send('Page.navigate', { url: FILE_PAGE });
  await waitFor('document.readyState === "complete"', 'file ready');
  await waitFor('!document.querySelector("#boot").hidden', 'file boot');
  const fileMode = await evaluate(`(() => ({
    protocol: location.protocol,
    catalogHidden: document.querySelector('#bootCatalog').hidden,
    count: document.querySelectorAll('.boot-tsv').length,
    openHidden: document.querySelector('#bootOpen').hidden,
    openLabel: document.querySelector('#bootOpen').textContent,
    selectedHidden: document.querySelector('#bootOpenSelected').hidden,
    hasCM: !!window.OfftextCM,
  }))()`);
  await shot('shot-boot-file.png');

  // ?data= 仍可直接載入。
  await send('Page.navigate', {
    url: 'http://127.0.0.1:8123/build/index.html?data=biology,chemistry&edit=1',
  });
  await waitFor('document.readyState === "complete"', 'data ready');
  await waitFor('document.querySelector("#boot").hidden', 'data boot hidden');
  await waitFor('!!document.querySelector(".cm-offtext-root")', 'data cm');
  const fromUrl = await evaluate(`(() => ({
    subjects: [...document.querySelectorAll('#subject option')].map((o) => o.textContent),
    stats: document.querySelector('#stats').textContent,
    title: document.querySelector('.entry-title')?.textContent,
    cm: !!document.querySelector('.cm-offtext-root'),
  }))()`);

  report = {
    catalog,
    loaded,
    selection,
    editor,
    dirty,
    saved,
    wroteValue,
    left,
    serverSave,
    beforeLeave,
    leftWithSave,
    leaveWrote,
    fileMode,
    fromUrl,
  };
} finally {
  const restored = await restoreTarget().catch((e) => ({ ok: false, error: String(e) }));
  report.restored = restored;
  report.exceptions = exceptions;
  report.logs = logs.slice(-5);
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
  await sleep(300);
}
