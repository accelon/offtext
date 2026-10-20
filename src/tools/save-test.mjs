// 本機編輯器存檔實測（localhost，不編桌面版）：
//   1. 在 data/ 放一個臨時 TSV，透過 ?data=...&edit=1 開啟
//   2. 真的修改 CodeMirror 文件、按存檔，確認 POST /api/tsv 寫回磁碟
//   3. 用假網域 offtext.test 開同一頁，確認部署版仍是唯讀
// 用法：node src/tools/save-test.mjs（先 npm run build，且 serve.mjs 在 8123）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.SAVE_CDP_PORT || 9346);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-save-'));
const DATA = path.join(ROOT, 'data');
const TEST_FILE = 'zz-save-test.tsv';
const TEST_PATH = path.join(DATA, TEST_FILE);
const TEST_TSV = `{id:"zz-save-test",name:"存檔測試",group:"其他"}
_\t這是一份存檔測試。
甲\t甲條目。
`;
const LOCAL_URL = 'http://127.0.0.1:8123/build/index.html?data=zz-save-test&test=1&edit=1';
const SITE_URL = 'http://offtext.test:8123/build/index.html?edit=1&test=1';
const WAILS_URL = 'http://wails.localhost:8123/build/index.html?edit=1&test=1';
const SHOT = path.join(ROOT, 'build', 'shots', 'save-local.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge');
fs.writeFileSync(TEST_PATH, TEST_TSV, 'utf8');

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1400,1000',
    '--no-proxy-server',
    '--host-resolver-rules=MAP offtext.test 127.0.0.1, MAP wails.localhost 127.0.0.1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    LOCAL_URL,
  ],
  { stdio: 'ignore' }
);

let ws;
let code = 1;
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:8123'));
    } catch {}
    await sleep(200);
  }
  if (!page) throw new Error('Edge 沒有提供 DevTools 頁面');

  ws = new WebSocket(page.webSocketDebuggerUrl);
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
      exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
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
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  const waitFor = async (expression, label, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error('等待逾時：' + label);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor('document.querySelector("#boot")?.hidden === true', 'localhost boot hidden');
  await waitFor('!!document.querySelector(".cm-offtext-root")', 'localhost CM6 root');

  const before = await evaluate(`(() => ({
    readonly: document.body.classList.contains('is-readonly-online'),
    editHidden: document.querySelector('#editBtn')?.hidden,
    saveHidden: document.querySelector('#saveBtn')?.hidden,
    title: document.querySelector('.entry-title')?.textContent
  }))()`);

  await evaluate(`document.querySelector('#editBtn').click()`);
  await waitFor('!!document.querySelector(".cm-offtext-root.cm-editing")', 'editing mode');

  const edited = await evaluate(`(() => {
    const root = document.querySelector('.cm-offtext-root');
    const view = root.__cmView;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '（已寫入磁碟）' } });
    return { length: view.state.doc.length, tail: view.state.doc.toString().slice(-12) };
  })()`);
  await sleep(250);
  await evaluate(`document.querySelector('#saveBtn').click()`);
  await waitFor(
    `(document.querySelector('.edit-toast')?.textContent || '').includes('已寫入')`,
    'save toast',
    30000
  );
  await sleep(300);

  const after = await evaluate(`(() => ({
    toast: document.querySelector('.edit-toast')?.textContent || '',
    saveHidden: document.querySelector('#saveBtn')?.hidden,
    dirty: document.querySelector('#dirtyBtn')?.hidden === false,
    stats: document.querySelector('#stats')?.textContent || ''
  }))()`);

  const onDisk = fs.readFileSync(TEST_PATH, 'utf8');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));

  // Wails 桌面版的 host 也必須被視為本機（但存檔走 Go 的 /api/tsv，不是這支 dev server）。
  await send('Page.navigate', { url: WAILS_URL });
  await waitFor('document.readyState === "complete"', 'wails ready');
  await waitFor('document.querySelector("#boot")?.hidden === true', 'wails boot hidden', 30000);
  const desktopHost = await evaluate(`(() => ({
    host: location.hostname,
    readonly: document.body.classList.contains('is-readonly-online'),
    editHidden: document.querySelector('#editBtn')?.hidden,
    saveHidden: document.querySelector('#saveBtn')?.hidden
  }))()`);

  // 部署版：用非本機 hostname 開同一頁，即使有 ?edit=1 也必須唯讀。
  await send('Page.navigate', { url: SITE_URL });
  await waitFor('document.readyState === "complete"', 'site ready');
  await waitFor('document.querySelector("#boot")?.hidden === true', 'site boot hidden', 30000);
  const site = await evaluate(`(() => ({
    host: location.hostname,
    readonly: document.body.classList.contains('is-readonly-online'),
    editHidden: document.querySelector('#editBtn')?.hidden,
    saveHidden: document.querySelector('#saveBtn')?.hidden,
    orphanHidden: document.querySelector('#orphanBtn')?.hidden,
    exportHidden: document.querySelector('#exportBtn')?.hidden,
    subjects: document.querySelectorAll('#subject option').length
  }))()`);

  const result = {
    before,
    edited,
    after,
    onDiskHasEdit: onDisk.includes('已寫入磁碟'),
    desktopHost,
    site,
    exceptions,
    screenshot: SHOT,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    !before.readonly &&
    before.editHidden === false &&
    edited.length > 0 &&
    after.toast.includes('已寫入') &&
    onDisk.includes('已寫入磁碟') &&
    desktopHost.host === 'wails.localhost' &&
    desktopHost.readonly === false &&
    desktopHost.editHidden === false &&
    site.host === 'offtext.test' &&
    site.readonly === true &&
    site.editHidden === true &&
    site.saveHidden === true &&
    exceptions.length === 0;
  if (!ok) {
    console.error('SAVE TEST FAILED');
  } else {
    console.log('SAVE TEST OK');
    code = 0;
  }
} finally {
  if (ws) ws.close();
  child.kill();
  await sleep(400);
  try {
    fs.rmSync(TEST_PATH, { force: true });
    for (const name of fs.readdirSync(DATA)) {
      if (name.startsWith('.zz-save-test.tsv')) fs.rmSync(path.join(DATA, name), { force: true });
    }
  } catch {}
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
}
process.exitCode = code;
