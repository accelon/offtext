// 導覽實測：選單、5 秒自動前進、點畫面提前、索引示範、展開引用、Esc 放棄。
// 用法：node src/tools/tour-test.mjs（先跑 build，且 serve.mjs 在 8123）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9356;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-tour-'));
const PAGE = 'http://127.0.0.1:8123/build/index.html?edit=1&theme=light';

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1380,1000',
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
    /* 等 */
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
    exceptions.push(msg.params.exceptionDetails.text);
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

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  const state = await evaluate('window.OfftextTour ? window.OfftextTour.state() : null');
  throw new Error('等待逾時：' + label + ' :: ' + JSON.stringify(state));
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

await send('Runtime.enable');
await send('Page.enable');
for (let i = 0; i < 80; i++) {
  if (await evaluate('document.querySelector("#boot") && document.querySelector("#boot").hidden')) break;
  await sleep(100);
}
await sleep(500);

// 入口與選單
const entry = await evaluate(`(() => {
  const btn = document.querySelector('#tourBtn');
  const settings = document.querySelector('#settingsBtn');
  return {
    exists: !!btn,
    tip: btn?.dataset.tip,
    aria: btn?.getAttribute('aria-label'),
    afterSettings: !!(settings.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
    api: !!window.OfftextTour,
  };
})()`);
assert(entry.exists, '缺少導覽按鈕');
assert(entry.tip === '導覽', '導覽按鈕沒有 hover 文字');
assert(entry.afterSettings, '導覽按鈕不在扳手旁');
assert(entry.api, '沒有暴露 OfftextTour');

await evaluate(`document.querySelector('#tourBtn').click()`);
await sleep(150);
const menu = await evaluate(`(() => ({
  open: !document.querySelector('#tourMenu').hidden,
  expanded: document.querySelector('#tourBtn').getAttribute('aria-expanded'),
  cards: [...document.querySelectorAll('.tour-card')].map((c) => ({
    id: c.dataset.tour,
    disabled: c.disabled,
    title: c.querySelector('strong')?.textContent,
  })),
}))()`);
assert(menu.open, '導覽選單沒有開啟');
assert(menu.expanded === 'true', 'aria-expanded 沒有更新');
assert(menu.cards.length === 3, '導覽選單不是三個項目');
assert(menu.cards[0].id === 'quick' && !menu.cards[0].disabled, '快速入門不能按');
assert(menu.cards.slice(1).every((card) => card.disabled), '預留項目不該能按');

// 開始；第一步 5 秒後自動前進
await evaluate(`document.querySelector('.tour-card[data-tour="quick"]').click()`);
await waitFor('window.OfftextTour.state().running', '導覽啟動');
await waitFor('window.OfftextTour.state().step === 0', '第一步');
assert(await evaluate(`document.querySelector('#tourMenu').hidden`), '選單沒有關閉');
await sleep(5400);
await waitFor('window.OfftextTour.state().step === 1', '5 秒自動前進');

const expectedTitles = [
  '切換科目',
  '文字與圖譜',
  '索引頁',
  '搜尋是第一道過濾',
  '有順有逆',
  '逆鏈次數',
  '找到大型語言模型',
  '打開條目',
  '展開參數',
  '展開權重',
  '展開神經元',
  '切到圖譜',
  '完成',
];
const seen = [];
for (let index = 1; index < 14; index++) {
  await waitFor(`window.OfftextTour.state().step === ${index}`, '第 ' + (index + 1) + ' 步');
  const title = await evaluate('window.OfftextTour.state().title');
  assert(title === expectedTitles[index - 1], '第 ' + (index + 1) + ' 步標題不對：' + title);
  await waitFor(
    'window.OfftextTour.state().target === true && window.OfftextTour.state().note === ""',
    '第 ' + (index + 1) + ' 步目標'
  );
  const state = await evaluate('window.OfftextTour.state()');
  assert(state.target, '第 ' + (index + 1) + ' 步沒有 spotlight 目標');
  assert(state.spotRect, '第 ' + (index + 1) + ' 步沒有 spotlight');
  const target = state.targetRect;
  const spot = state.spotRect;
  assert(
    spot.left <= target.left &&
      spot.top <= target.top &&
      spot.left + spot.width >= target.left + target.width &&
      spot.top + spot.height >= target.top + target.height,
    'spotlight 沒有框住第 ' + (index + 1) + ' 步目標'
  );
  if (index === 12) {
    const expanded = await evaluate(
      `[...document.querySelectorAll('.cm-ref[aria-expanded="true"]')].map((n) => n.textContent.trim())`
    );
    for (const label of ['參數', '權重', '神經元']) {
      assert(expanded.includes(label), '切到圖譜前沒有展開 ' + label);
    }
  }
  seen.push({ index, title, target: state.target });
  await evaluate(`document.querySelector('#tourNext').click()`);
  await sleep(420);
}

await waitFor('!window.OfftextTour.state().running', '導覽結束');
const final = await evaluate(`(() => ({
  hash: decodeURIComponent(location.hash),
  title: document.querySelector('.entry-title')?.textContent,
  graph: !!document.querySelector('.graph-canvas'),
  graphSvg: !!document.querySelector('.graph-canvas svg'),
  layerHidden: document.querySelector('#tourLayer').hidden,
  view: window.OfftextTour.state().indexView,
  sort: window.OfftextTour.state().indexSort,
}))()`);
assert(final.hash.includes('/graph/aijargon/大型語言模型'), '最後不在圖譜模式：' + final.hash);
assert(final.title === '大型語言模型', '圖譜標題不對：' + final.title);
assert(final.graph && final.graphSvg, '最後沒有圖譜畫布');
assert(final.layerHidden, '導覽結束後 overlay 沒有隱藏');
assert(final.view === 'both', '沒有切到有順有逆');
assert(final.sort === 'back', '沒有切到逆鏈排序');

// Esc 隨時放棄
await evaluate(`window.OfftextTour.start('quick')`);
await waitFor('window.OfftextTour.state().running', '重播');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(200);
const escaped = await evaluate('({ running: window.OfftextTour.state().running, hidden: document.querySelector("#tourLayer").hidden })');
assert(!escaped.running && escaped.hidden, 'Esc 沒有結束導覽');

// × 隨時放棄
await evaluate(`window.OfftextTour.start('quick')`);
await waitFor('window.OfftextTour.state().running', '重播二');
await evaluate(`document.querySelector('#tourBubble .tour-close').click()`);
await sleep(200);
const closed = await evaluate('({ running: window.OfftextTour.state().running, hidden: document.querySelector("#tourLayer").hidden })');
assert(!closed.running && closed.hidden, '× 沒有結束導覽');

// 點畫面提前下一步
await evaluate(`window.OfftextTour.start('quick')`);
await waitFor('window.OfftextTour.state().step === 0', '再播');
await evaluate(`document.querySelector('#tourLayer').click()`);
await sleep(450);
const clicked = await evaluate('window.OfftextTour.state()');
assert(clicked.running && clicked.step === 1, '點畫面沒有前進下一步');
await evaluate(`window.OfftextTour.stop()`);

// 從索引頁開始：應先回到條目，才能指向「文／圖譜」。
await evaluate(`location.hash = '#/index/all'`);
await waitFor('!!document.querySelector("#indexSearch")', '索引頁');
await evaluate(`window.OfftextTour.start('quick')`);
await waitFor('window.OfftextTour.state().step === 0', '索引起點');
await evaluate(`document.querySelector('#tourNext').click()`);
await sleep(420);
await evaluate(`document.querySelector('#tourNext').click()`);
await waitFor('window.OfftextTour.state().step === 2', '索引起點第二步');
await waitFor('window.OfftextTour.state().target === true', '索引起點的文／圖譜');
const fromIndex = await evaluate(`(() => ({
  hash: decodeURIComponent(location.hash),
  step: window.OfftextTour.state().step,
  target: window.OfftextTour.state().targetRect,
}))()`);
await evaluate(`window.OfftextTour.stop()`);

console.log(
  JSON.stringify(
    {
      entry,
      menu,
      autoAdvance: true,
      steps: seen,
      final,
      escaped,
      closed,
      clicked: { running: clicked.running, step: clicked.step },
      fromIndex,
      exceptions,
    },
    null,
    2
  )
);
assert(exceptions.length === 0, '有 JS 例外：' + exceptions.join(' / '));

ws.close();
child.kill();
await sleep(300);
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (e) {
  /* 忽略 */
}
