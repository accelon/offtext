// 將 src/editor/index.ts 打包成單一 IIFE，讓 file:// 也能用 <script> 載入。
// 用法：node src/tools/build-editor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'src', 'offtext-cm.js');

const result = await build({
  entryPoints: [path.join(ROOT, 'src', 'editor', 'index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'OfftextCM',
  platform: 'browser',
  target: ['chrome110'],
  minify: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: '/* GENERATED FILE — 由 src/tools/build-editor.mjs 從 src/editor/*.ts 產生；請勿直接編輯。 */',
  },
  write: false,
});

// 由 Node 寫檔，避免 esbuild 子程序在部分 Windows 工作區被檔案權限擋住。
fs.writeFileSync(OUT, result.outputFiles[0].text, 'utf8');

console.log('src/offtext-cm.js 已更新（' + result.outputFiles[0].text.length + ' bytes）');
