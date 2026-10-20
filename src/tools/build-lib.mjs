// 將 UMD／IIFE 形式的舊式瀏覽器程式庫由 TS 轉譯為同名 .js：
//   src/nestedtext-core.ts       -> src/nestedtext-core.js（瀏覽器 window.NT／Node require）
//   src/nestedtext-settings.ts   -> src/nestedtext-settings.js
//   src/nestedtext-simplified.ts -> src/nestedtext-simplified.js
// 用法：node src/tools/build-lib.mjs
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const SRC = path.resolve(import.meta.dirname, '..');
const FILES = ['nestedtext-core', 'nestedtext-settings', 'nestedtext-simplified'];

for (const base of FILES) {
  const from = path.join(SRC, base + '.ts');
  const to = path.join(SRC, base + '.js');
  const text = fs.readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
  const result = await transform(text, {
    loader: 'ts',
    target: 'chrome110',
    format: 'cjs',
    sourcefile: base + '.ts',
    legalComments: 'none',
  });
  const banner = `/* GENERATED FILE — 由 src/tools/build-lib.mjs 從 ${base}.ts 產生；請勿直接編輯。 */\n`;
  fs.writeFileSync(to, banner + result.code, 'utf8');
  console.log(`${base}.js 已更新（${Buffer.byteLength(banner + result.code)} bytes）`);
}
