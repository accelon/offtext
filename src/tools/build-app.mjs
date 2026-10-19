// 把 src/app/*.js 依檔名順序串成單一 IIFE，供 file:// 直接載入。
// 用法：node src/tools/build-app.mjs
import fs from 'node:fs';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const APP = path.join(SRC, 'app');
const OUT = path.join(SRC, 'offtext-app.js');

const files = fs
  .readdirSync(APP)
  .filter((name) => name.endsWith('.js'))
  .sort();

if (!files.length) throw new Error('src/app/ 沒有可用的 .js');

const parts = files.map((name) => {
  const text = fs.readFileSync(path.join(APP, name), 'utf8').replace(/\r\n/g, '\n');
  if (/^\s*\(function\s*\(/m.test(text) || /^\}\)\(\);\s*$/m.test(text)) {
    throw new Error(`${name} 含有 IIFE 外框；app 區段應只放函式與狀態`);
  }
  return `/* ---- ${name} ---- */\n${text.trim()}\n`;
});

const header = `/* GENERATED FILE — 由 src/tools/build-app.mjs 串接 src/app/*.js。
 * 不要直接改這個檔；改 src/app/ 後重跑 npm run build:app。
 */
(function () {
'use strict';

`;

const footer = '\n})();\n';
fs.writeFileSync(OUT, header + parts.join('\n') + footer, 'utf8');
console.log(`src/offtext-app.js 已更新（${files.length} 個區段，${Buffer.byteLength(header + parts.join('\n') + footer)} bytes）`);
