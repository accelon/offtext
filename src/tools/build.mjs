// 建置：只複製前端靜態檔。資料不再預先打包，使用者在啟動時開啟 TSV。
// 用法：node src/tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const ROOT = path.resolve(SRC, '..');
const BUILD = path.join(ROOT, 'build');
const SHOTS = path.join(BUILD, 'shots');

const APP_FILES = [
  'index.html',
  'nestedtext.css',
  'nestedtext-core.js',
  'simplified-data.js',
  'nestedtext-simplified.js',
  'nestedtext-settings.js',
  'offtext-cm.js',
  'offtext-app.js',
];

// 清掉 build 頂層的舊產物，但保留 build/shots（展示截圖）。
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const entry of fs.readdirSync(BUILD, { withFileTypes: true })) {
  if (entry.isFile()) fs.rmSync(path.join(BUILD, entry.name));
}

for (const file of APP_FILES) {
  const from = path.join(SRC, file);
  if (!fs.existsSync(from)) throw new Error(`缺少原始檔：${from}`);
  fs.copyFileSync(from, path.join(BUILD, file));
}

// 只做資料檔的基本驗證；不會產生 data.js。
const domains = loadDomains(ROOT);
const manifest = domains.map((domain) => ({
  file: domain.file,
  id: domain.id,
  name: domain.name || domain.id,
  hidden: !!domain.hidden,
  group: domain.group || '其他',
  count: Object.keys(domain.entries).filter(
    (key) =>
      key !== '_' &&
      !String(key).startsWith('@') &&
      !String(domain.entries[key]).trim().startsWith('@')
  ).length,
}));
fs.writeFileSync(
  path.join(BUILD, 'tsv-manifest.js'),
  '/* GENERATED FILE — 由 src/tools/build.mjs 產生；只列檔名，不含 TSV 內容。 */\n' +
    'window.OFFTEXT_TSV_MANIFEST = ' +
    JSON.stringify(manifest, null, 2) +
    ';\n'
);

const counts = manifest
  .filter((item) => !item.hidden)
  .map((item) => `${item.id}=${item.count}`)
  .join(', ');
console.log(`build/ 已更新（不含 data.js；tsv-manifest.js 只列檔名）`);
console.log(`TSV 驗證：${counts}`);
