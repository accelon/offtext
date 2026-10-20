// 把 build/ 的前端產物同步到 desktop/assets，供 go:embed 使用。
// 用法：node desktop/scripts/sync-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUILD = path.join(ROOT, 'build');
const DEST = path.join(ROOT, 'desktop', 'assets');

const REQUIRED = [
  'index.html',
  'nestedtext.css',
  'nestedtext-core.js',
  'simplified-data.js',
  'nestedtext-simplified.js',
  'nestedtext-settings.js',
  'offtext-cm.js',
  'offtext-app.js',
  'tsv-manifest.js',
];

if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
  throw new Error('build/index.html 不存在；先跑 npm run build');
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const name of REQUIRED) {
  const from = path.join(BUILD, name);
  if (!fs.existsSync(from)) throw new Error('缺少前端產物：' + from);
  fs.copyFileSync(from, path.join(DEST, name));
}

// 只複製前端需要的檔案；build/shots 不進 assets。
for (const entry of fs.readdirSync(BUILD, { withFileTypes: true })) {
  if (!entry.isFile() || REQUIRED.includes(entry.name)) continue;
  if (!/\.(html|css|js|json|svg|png|ico|woff2?)$/i.test(entry.name)) continue;
  fs.copyFileSync(path.join(BUILD, entry.name), path.join(DEST, entry.name));
}

console.log(`desktop/assets 已更新（${REQUIRED.length} 個必要檔案）`);
