// 建置 Wails3 Windows 桌面版。
// 固定順序：前端建置（可略）→ 同步 assets → syso → go build → 資料檢查。
// 用法：node desktop/scripts/build-desktop.mjs [--skip-web] [--console] [--out=<dir>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(DESKTOP, '..');
if (process.platform !== 'win32') {
  throw new Error('目前只支援 Windows 建置；macOS 的待辦見 desktop/build/darwin/README.md');
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const skipWeb = process.argv.includes('--skip-web');
const consoleBuild = process.argv.includes('--console');
const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const outDir = path.resolve(outArg || process.env.OFFTEXT_OUT_DIR || path.join(ROOT, 'offtext-desktop'));
const exeName = process.platform === 'win32' ? 'offtext.exe' : 'offtext';
const exePath = path.join(outDir, exeName);

function run(cmd, args, cwd = ROOT) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} 失敗（exit ${res.status}）`);
}

if (!skipWeb) run(process.execPath, [path.join(ROOT, 'src', 'tools', 'build-all.mjs')], ROOT);
run(process.execPath, [path.join(DESKTOP, 'scripts', 'sync-assets.mjs')], ROOT);

if (!fs.existsSync(path.join(DESKTOP, 'assets', 'index.html'))) {
  throw new Error('desktop/assets/index.html 不存在');
}

fs.mkdirSync(outDir, { recursive: true });
if (process.platform === 'win32') {
  const syso = path.join(DESKTOP, 'app.syso');
  run('wails3', [
    'generate', 'syso',
    '-arch', 'amd64',
    '-icon', path.join(DESKTOP, 'build', 'windows', 'icon.ico'),
    '-manifest', path.join(DESKTOP, 'build', 'windows', 'wails.exe.manifest'),
    '-info', path.join(DESKTOP, 'build', 'windows', 'info.json'),
    '-out', syso,
  ], DESKTOP);
  const size = fs.statSync(syso).size;
  if (size < 1024) throw new Error(`app.syso 只有 ${size} bytes；刪掉並用 -arch 重新產生`);
}

const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ldflags = [`-X main.buildTime=${buildTime}`, `-X main.appVersion=${pkg.version}`];
if (process.platform === 'win32' && !consoleBuild) ldflags.push('-H', 'windowsgui');

// 先刪舊執行檔，讓前端／Go 建置失敗時不會留下看起來可用的舊檔。
fs.rmSync(exePath, { force: true });
run('go', ['build', '-trimpath', ...(consoleBuild ? [] : ['-tags', 'production']), '-ldflags', ldflags.join(' '), '-o', exePath, '.'], DESKTOP);

// 執行檔旁必須有 data/*.tsv；沒有就從 repo 複製一份，避免交付空殼。
const dataDir = path.join(outDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(ROOT, 'data'))) {
    if (!name.toLowerCase().endsWith('.tsv') && name !== 'data-index.txt') continue;
    fs.copyFileSync(path.join(ROOT, 'data', name), path.join(dataDir, name));
  }
}
const tsvCount = fs.readdirSync(dataDir).filter((n) => n.toLowerCase().endsWith('.tsv')).length;
if (!tsvCount) throw new Error('執行檔旁沒有 data/*.tsv');

console.log(`\n完成：${exePath}`);
console.log(`buildTime=${buildTime} version=${pkg.version} data=${tsvCount} TSV`);
console.log(`驗證：${exePath} -selftest -report <path>`);
