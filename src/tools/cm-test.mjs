// CM6 內嵌編輯快速實測：載入、渲染、閱讀/編輯切換、游標、^ 補全、存檔。
// 用法：node src/tools/cm-test.mjs [--url=...] [--headful]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const SHOTS = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CM_CDP_PORT || 9341);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-cm-'));
const URL =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ||
  'http://127.0.0.1:8123/build/index.html?data=aijargon&test=1&edit=1';
const HEADFUL = process.argv.includes('--headful');
const SHOT = process.argv.find((a) => a.startsWith('--shot='))?.slice(6) || 'cm-entry.png';

fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(EDGE)) {
  console.error('找不到 Edge');
  process.exit(1);
}

const child = spawn(
  EDGE,
  [
    HEADFUL ? '' : '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,1100',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    URL,
  ].filter(Boolean),
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
    logs.push(
      msg.params.args
        .map((a) => (a.value != null ? String(a.value) : a.description || ''))
        .join(' ')
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
await send('Log.enable');
await waitFor('document.readyState === "complete"', 'document ready');
await waitFor('document.querySelector("#boot").hidden === true', 'boot hidden');
try {
  await waitFor('!!document.querySelector(".cm-offtext-root")', 'CM6 root');
} catch (e) {
  const dump = await evaluate(`(() => ({
    bodyClass: document.body.className,
    bootHidden: document.querySelector('#boot').hidden,
    bootStatus: document.querySelector('#bootStatus')?.textContent,
    reader: document.querySelector('#reader')?.innerHTML?.slice(0, 1200),
    hasCM: !!window.OfftextCM,
    hash: location.hash,
  }))()`);
  console.log('dump', JSON.stringify(dump, null, 2));
  console.log('exceptions', exceptions);
  console.log('logs', logs);
  ws.close();
  child.kill();
  process.exit(3);
}

const state = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const content = root && root.querySelector('.cm-content');
  return {
    title: document.querySelector('.entry-title')?.textContent,
    hasRoot: !!root,
    editing: root?.classList.contains('cm-editing'),
    readOnlyClass: root?.classList.contains('cm-readonly'),
    contentEditable: content?.getAttribute('contenteditable'),
    text: content?.innerText?.slice(0, 120),
    refs: document.querySelectorAll('.cm-ref').length,
    offtextCm: !!window.OfftextCM,
    saveHidden: document.querySelector('#saveBtn')?.hidden,
    editText: document.querySelector('#editBtn')?.textContent,
  };
})()`);
console.log('initial', JSON.stringify(state, null, 2));

// 記錄 buildIndex 次數：編輯期間不應重建索引。
await evaluate(`(() => {
  window.__buildCount = 0;
  const original = window.NT.buildIndex;
  window.NT.buildIndex = (...args) => {
    window.__buildCount++;
    return original(...args);
  };
})()`);

// 閱讀模式：點第一個引用，展開巢狀 CM6。
await evaluate(`document.querySelector('.cm-ref')?.click()`);
await sleep(450);
const expanded = await evaluate(`(() => ({
  nested: document.querySelectorAll('.cm-nested .cm-editor').length,
  nestedText: document.querySelector('.cm-nested .cm-content')?.innerText?.slice(0, 100),
  expanded: document.querySelectorAll('.cm-nested').length,
  refs: document.querySelectorAll('.cm-ref').length,
  focusCurrent: document.querySelectorAll('.is-focus-current').length,
  dim: document.querySelectorAll('.is-dim').length,
  nestedDim: document.querySelectorAll('.cm-nested .is-dim').length,
  dimText: document.querySelectorAll('.cm-focus-dim-text').length,
  focusing: document.querySelector('#reader').classList.contains('is-focusing'),
}))()`);
console.log('expanded', JSON.stringify(expanded, null, 2));

await evaluate("document.querySelector('.edit-toast')?.classList.remove('is-visible')");
const expandedShot = await send('Page.captureScreenshot', { format: 'png' });
if (expandedShot.result && expandedShot.result.data) {
  fs.writeFileSync(
    path.join(SHOTS, 'cm-expanded.png'),
    Buffer.from(expandedShot.result.data, 'base64')
  );
  console.log('shot', path.join(SHOTS, 'cm-expanded.png'));
}

// 點「編輯」
await evaluate(`document.querySelector('#editBtn').click()`);
await sleep(250);
const editing = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  return {
    hasRoot: !!root,
    editing: root?.classList.contains('cm-editing'),
    editText: document.querySelector('#editBtn').textContent,
    active: document.activeElement?.className,
    cursor: !!root?.querySelector('.cm-cursor'),
    saveHidden: document.querySelector('#saveBtn').hidden,
  };
})()`);
console.log('editing', JSON.stringify(editing, null, 2));

// 編輯模式：點引用，控制代碼現形。
await evaluate(`document.querySelector('.cm-ref')?.click()`);
await sleep(300);
const active = await evaluate(`(() => ({
  active: document.querySelectorAll('.cm-offtag-active').length,
  activeText: document.querySelector('.cm-offtag-active')?.textContent,
  rawHasBracket: document.querySelector('.cm-content')?.innerText?.includes('^['),
}))()`);
console.log('offtag-active', JSON.stringify(active, null, 2));

// 游標移出 offtag：控制代碼消失，回到裝飾文字。
await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  view.focus();
  view.dispatch({ selection: { anchor: 0 } });
})()`);
await sleep(250);
const offTagLeft = await evaluate(`(() => ({
  active: document.querySelectorAll('.cm-offtag-active').length,
  refs: document.querySelectorAll('.cm-ref').length,
}))()`);
console.log('offtag-left', JSON.stringify(offTagLeft, null, 2));

// 在文件尾端輸入 ^，應補成 ^[] 並列出條目。
await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
})()`);
await send('Input.insertText', { text: '^' });
await sleep(500);
const caret = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  return {
    tail: view.state.doc.toString().slice(-30),
    endsWithPair: view.state.doc.toString().endsWith('^[]'),
    panel: !!document.querySelector('.cm-tooltip-autocomplete'),
    options: [...document.querySelectorAll('.cm-tooltip-autocomplete li')].slice(0, 8).map((li) => li.textContent),
    optionCount: document.querySelectorAll('.cm-tooltip-autocomplete li').length,
  };
})()`);
console.log('caret', JSON.stringify(caret, null, 2));

// 在 [] 內輸入文字，補全應過濾。
await send('Input.insertText', { text: '機器' });
await sleep(500);
const filtered = await evaluate(`(() => ({
  panel: !!document.querySelector('.cm-tooltip-autocomplete'),
  options: [...document.querySelectorAll('.cm-tooltip-autocomplete li')].slice(0, 10).map((li) => li.textContent),
  optionCount: document.querySelectorAll('.cm-tooltip-autocomplete li').length,
}))()`);
console.log('filtered', JSON.stringify(filtered, null, 2));

// Enter 選取第一個補全。
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(300);
const picked = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  return root.__cmView.state.doc.toString().slice(-40);
})()`);
console.log('picked', JSON.stringify(picked));

// 把游標移進剛插入的引用，刪左括號應連右括號一起消失。
await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
})()`);
await sleep(250);
await evaluate(`(() => {
  const refs = [...document.querySelectorAll('.cm-ref')];
  const last = refs[refs.length - 1];
  if (last) last.click();
})()`);
const clickInfo = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  const text = view.state.doc.toString();
  return {
    head: view.state.selection.main.head,
    len: text.length,
    lastOpen: text.lastIndexOf('^['),
    tail: text.slice(-24),
    lastRef: [...document.querySelectorAll('.cm-ref')].at(-1)?.textContent,
  };
})()`);
console.log('clickInfo', JSON.stringify(clickInfo, null, 2));
await sleep(350);
const clickAfter = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  const sel = window.getSelection();
  return {
    head: view.state.selection.main.head,
    domAnchor: sel?.anchorNode?.textContent?.slice(0, 30),
    domOffset: sel?.anchorOffset,
    activeEditable: document.activeElement?.isContentEditable,
    activeClass: document.activeElement?.className,
  };
})()`);
console.log('clickAfter', JSON.stringify(clickAfter, null, 2));
const beforeDelete = await evaluate(`(() => ({
  active: document.querySelectorAll('.cm-offtag-active').length,
  text: document.querySelector('.cm-offtag-active')?.textContent,
}))()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await sleep(300);
const afterDelete = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  return {
    tail: root.__cmView.state.doc.toString().slice(-40),
    active: document.querySelectorAll('.cm-offtag-active').length,
  };
})()`);
console.log('bracketDelete', JSON.stringify({ beforeDelete, afterDelete }, null, 2));

const buildBeforeSave = await evaluate(`window.__buildCount`);
console.log('buildIndex before save', buildBeforeSave);

// 避免測試寫回真實 data/：攔截儲存 API。
await evaluate(`(() => {
  const original = window.fetch;
  window.fetch = (url, opts) => {
    if (String(url).includes('/api/tsv/')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }
    return original(url, opts);
  };
})()`);

// 存檔（只存在記憶體＋假的寫回）
await evaluate(`document.querySelector('#saveBtn').click()`);
await sleep(900);
const afterSave = await evaluate(`(() => ({
  saveHidden: document.querySelector('#saveBtn').hidden,
  footer: document.querySelector('#stats').textContent,
  title: document.querySelector('.entry-title')?.textContent,
  toast: document.querySelector('.edit-toast')?.textContent,
  editing: document.querySelector('.cm-offtext-root')?.classList.contains('cm-editing'),
  buildCount: window.__buildCount,
}))()`);
console.log('afterSave', JSON.stringify(afterSave, null, 2));

// 閱讀／編輯切換不換窗、游標保留。
const continuity = await evaluate(`(() => {
  const root = document.querySelector('.cm-offtext-root');
  const view = root.__cmView;
  view.dispatch({ selection: { anchor: 5 } });
  document.querySelector('#editBtn').click();
  const readHead = view.state.selection.main.head;
  const readEditing = root.classList.contains('cm-editing');
  document.querySelector('#editBtn').click();
  const editHead = view.state.selection.main.head;
  const editEditing = root.classList.contains('cm-editing');
  return {
    sameView: document.querySelector('.cm-offtext-root') === root,
    readHead,
    readEditing,
    editHead,
    editEditing,
  };
})()`);
console.log('continuity', JSON.stringify(continuity, null, 2));

// 孤兒面板
await evaluate(`document.querySelector('#orphanBtn').click()`);
await sleep(300);
const orphan = await evaluate(`(() => ({
  panel: !!document.querySelector('.orphan-panel'),
  count: document.querySelector('.orphan-count')?.textContent,
  items: document.querySelectorAll('.orphan-item').length,
  first: document.querySelector('.orphan-item-key')?.textContent,
}))()`);
console.log('orphan', JSON.stringify(orphan, null, 2));

// 點第一個孤兒：應導到該條目並直接進入編輯。
const firstOrphanKey = orphan.first;
await evaluate(`document.querySelector('.orphan-item')?.click()`);
await sleep(700);
const orphanOpened = await evaluate(`(() => ({
  title: document.querySelector('.entry-title')?.textContent,
  hash: decodeURIComponent(location.hash),
  editing: document.querySelector('.cm-offtext-root')?.classList.contains('cm-editing'),
  panel: !!document.querySelector('.orphan-panel'),
  active: document.activeElement?.className,
}))()`);
console.log(
  'orphanOpened',
  JSON.stringify({ firstOrphanKey, ...orphanOpened }, null, 2)
);

// 17 字的新條目應被擋下，且不改變路由。
const hashBeforeLong = await evaluate(`decodeURIComponent(location.hash)`);
const longKey = '一二三四五六七八九十一二三四五六七';
await evaluate(`window.__offtextTest.openNewEntry('aijargon', ${JSON.stringify(longKey)})`);
await sleep(300);
const longResult = await evaluate(`(() => ({
  hash: decodeURIComponent(location.hash),
  toast: document.querySelector('.edit-toast')?.textContent,
}))()`);
console.log(
  'longKey',
  JSON.stringify({ hashBeforeLong, ...longResult, length: [...longKey].length }, null, 2)
);

// 16 字可以建立，並直接進入編輯。
const okKey = '一二三四五六七八九十一二三四五六';
await evaluate(`window.__offtextTest.openNewEntry('aijargon', ${JSON.stringify(okKey)})`);
await sleep(600);
const newEntry = await evaluate(`(() => ({
  title: document.querySelector('.entry-title')?.textContent,
  hash: decodeURIComponent(location.hash),
  editing: document.querySelector('.cm-offtext-root')?.classList.contains('cm-editing'),
  text: document.querySelector('.cm-content')?.innerText,
  saveHidden: document.querySelector('#saveBtn').hidden,
}))()`);
console.log('newEntry', JSON.stringify({ okKey, length: [...okKey].length, ...newEntry }, null, 2));

await evaluate("document.querySelector('.edit-toast')?.classList.remove('is-visible')");
const desktopShot = await send('Page.captureScreenshot', { format: 'png' });
if (desktopShot.result && desktopShot.result.data) {
  fs.writeFileSync(path.join(SHOTS, SHOT), Buffer.from(desktopShot.result.data, 'base64'));
  console.log('shot', path.join(SHOTS, SHOT));
}
// 手機寬度：topbar 不水平溢出；孤兒浮窗改成底部面板。
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(250);
await evaluate("document.querySelector('#orphanBtn')?.click()");
await sleep(350);
const mobile = await evaluate(`(() => {
  const panel = document.querySelector('.orphan-panel');
  const rect = panel?.getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panel: !!panel,
    panelTop: rect ? Math.round(rect.top) : null,
    panelBottom: rect ? Math.round(rect.bottom) : null,
    panelWidth: rect ? Math.round(rect.width) : null,
    bodyClass: document.body.className,
  };
})()`);
console.log('mobile', JSON.stringify(mobile, null, 2));

await evaluate("document.querySelector('.edit-toast')?.classList.remove('is-visible')");
// 截圖
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) {
  fs.writeFileSync(path.join(SHOTS, 'cm-mobile.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('shot', path.join(SHOTS, 'cm-mobile.png'));
}

console.log('exceptions', exceptions);
console.log('logs', logs.slice(-10));
if (expanded.nestedDim > 0) {
  console.error('展開內容裡的可點引用不應被焦點模式淡出：' + expanded.nestedDim + ' 個');
}

ws.close();
child.kill();
await sleep(300);
process.exit(exceptions.length ? 2 : expanded.nestedDim > 0 ? 4 : 0);
