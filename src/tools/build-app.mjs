// 把 src/app/*.ts 依檔名順序串成單一 IIFE，先在 IIFE 內串好再交給 esbuild
// 轉譯；這樣 00-core 的 top-level return 是合法的函式 return，也不會被
// esbuild 誤判成 CommonJS 模組。
// 同時產生 .tmp/offtext-app.typecheck.ts 供 tsc 檢查同一個作用域。
// 用法：node src/tools/build-app.mjs
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const APP = path.join(SRC, 'app');
const OUT = path.join(SRC, 'offtext-app.js');
const TMP = path.join(SRC, '.tmp');
const CHECK_OUT = path.join(TMP, 'offtext-app.typecheck.ts');

const files = fs
  .readdirSync(APP)
  .filter((name) => name.endsWith('.ts'))
  .sort();

if (!files.length) throw new Error('src/app/ 沒有可用的 .ts');

const sources = files.map((name) => {
  const text = fs.readFileSync(path.join(APP, name), 'utf8').replace(/\r\n/g, '\n');
  if (/^\s*\(function\s*\(/m.test(text) || /^\}\)\(\);\s*$/m.test(text)) {
    throw new Error(`${name} 含有 IIFE 外框；app 區段應只放函式與狀態`);
  }
  return { name, text };
});

const header = `/* GENERATED FILE — 由 src/tools/build-app.mjs 從 src/app/*.ts 產生。
 * 不要直接改這個檔；改 src/app/*.ts 後重跑 npm run build:app。
 */
(function () {
'use strict';

`;

const footer = '\n})();\n';
const parts = sources.map(({ name, text }) => `/* ---- ${name} ---- */\n${text.trim()}\n`);
const combined = header + parts.join('\n') + footer;

const result = await transform(combined, {
  loader: 'ts',
  target: 'chrome110',
  sourcefile: 'offtext-app.ts',
  legalComments: 'none',
});
fs.writeFileSync(OUT, result.code, 'utf8');

// 型別檢查用：原始 TS 放進同一個 IIFE，模擬實際執行時的作用域。
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(
  CHECK_OUT,
  `// GENERATED FILE — 由 build-app.mjs 產生，只供 tsc 型別檢查。\n` + combined,
  'utf8'
);

console.log(
  `src/offtext-app.js 已更新（${files.length} 個 TS 區段，${Buffer.byteLength(result.code)} bytes）`
);
