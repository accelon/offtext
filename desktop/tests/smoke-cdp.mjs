// 啟動桌面版並以 CDP 驗證：頁面真的開了、/wails/runtime.js 有回應、
// 服務橋可用、啟動時載入的 TSV 數量正確，並擷取一張截圖。
// 用法：node desktop/tests/smoke-cdp.mjs [--exe=<path>]
// 只用 Node 內建 fetch/WebSocket；每次使用獨立的 WebView2 資料目錄與 debug port。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const exeArg = process.argv.find((a) => a.startsWith('--exe='))?.slice(6);
const exe = path.resolve(exeArg || path.join(ROOT, 'offtext-desktop', process.platform === 'win32' ? 'offtext.exe' : 'offtext'));
if (!fs.existsSync(exe)) throw new Error('找不到執行檔：' + exe);

const outDir = path.resolve(import.meta.dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offtext-webview-'));
const config = fs.mkdtempSync(path.join(os.tmpdir(), 'offtext-config-'));
const env = {
  ...process.env,
  OFFTEXT_DEBUG_PORT: String(port),
  OFFTEXT_WEBVIEW_DIR: profile,
  OFFTEXT_CONFIG_DIR: config,
};
const child = spawn(exe, [], { env, stdio: 'ignore', windowsHide: false });
let childExited = false;
child.on('exit', () => { childExited = true; });

async function waitForTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    if (childExited) throw new Error('桌面程式在 CDP 連上之前就結束了');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find(
          (t) => t.type === 'page' && t.webSocketDebuggerUrl && /wails\.localhost|offtext/i.test(t.url)
        );
        if (page) return page;
        last = JSON.stringify(list);
      } else {
        last = `HTTP ${res.status}`;
      }
    } catch (e) {
      last = e.message;
    }
    await sleep(250);
  }
  throw new Error(`CDP target not ready: ${last}`);
}

let ws;
try {
  const target = await waitForTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception));
    }
    return result.result.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  const deadline = Date.now() + 30000;
  let state = null;
  while (Date.now() < deadline) {
    try {
      state = await evaluate(`(() => {
        if (!document.body) return null;
        return {
          ready: document.readyState,
          href: location.href,
          bootHidden: document.querySelector('#boot')?.hidden ?? null,
          booting: document.body.classList.contains('is-booting'),
          subjects: document.querySelectorAll('#subject option').length,
          stats: document.querySelector('#stats')?.textContent || '',
          hasNT: typeof window.NT === 'object',
          title: document.title
        };
      })()`);
    } catch {
      state = null;
    }
    if (state && !state.booting && state.bootHidden && state.stats.includes('條')) break;
    await sleep(500);
  }
  if (!state) throw new Error('頁面沒有完成載入（document.body 一直是 null）');

  const runtime = await evaluate(`(async () => {
    const res = await fetch('/wails/runtime.js');
    return { status: res.status, type: res.headers.get('content-type') };
  })()`);

  const bridge = await evaluate(`(async () => {
    const { Call } = await import('/wails/runtime.js');
    const status = await Call.ByName('main.DataService.Status');
    return { dir: status.dir, files: status.files.length, totalBytes: status.totalBytes };
  })()`);

  const reader = await evaluate(`(async () => {
    const sel = document.querySelector('#subject');
    if (sel && sel.options.length > 1) {
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const text = document.querySelector('#reader')?.innerText || '';
    return { length: text.length, sample: text.slice(0, 120) };
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(outDir, 'desktop-boot.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  const result = { state, runtime, bridge, reader, screenshot: shotPath, exe };
  console.log(JSON.stringify(result, null, 2));

  const dataFiles = fs.readdirSync(path.join(path.dirname(exe), 'data')).filter((n) => n.toLowerCase().endsWith('.tsv')).length;
  const ok =
    state &&
    !state.booting &&
    state.bootHidden &&
    state.hasNT &&
    state.subjects >= dataFiles + 1 &&
    state.stats.includes('條') &&
    runtime.status === 200 &&
    bridge.files === dataFiles &&
    bridge.totalBytes > 100000 &&
    reader.length > 20;
  if (!ok) {
    console.error('SMOKE TEST FAILED');
    process.exitCode = 1;
  } else {
    console.log('SMOKE TEST OK');
  }

  // 正常關閉：讓 WebView2 與 Wails 走關窗流程，避免留下 debug 埠與 profile。
  try { await send('Browser.close'); } catch {}
} finally {
  if (ws) ws.close();
  const deadline = Date.now() + 5000;
  while (!childExited && Date.now() < deadline) await sleep(100);
  if (!childExited) child.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(config, { recursive: true, force: true }); } catch {}
}
