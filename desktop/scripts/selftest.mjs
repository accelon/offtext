// 跑桌面版 headless 自檢，並解析 JSON 報告。
// 用法：node desktop/scripts/selftest.mjs [--exe=<path>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const exeArg = process.argv.find((a) => a.startsWith('--exe='))?.slice(6);
const exe = path.resolve(exeArg || path.join(ROOT, 'offtext-desktop', process.platform === 'win32' ? 'offtext.exe' : 'offtext'));
if (!fs.existsSync(exe)) throw new Error('找不到執行檔：' + exe);

const report = path.join(os.tmpdir(), 'offtext-selftest-' + Date.now() + '.json');
const res = spawnSync(exe, ['-selftest', '-report', report], { stdio: 'inherit', timeout: 60000 });
if (!fs.existsSync(report)) throw new Error('沒有產生 selftest 報告（exit ' + res.status + '）');
const data = JSON.parse(fs.readFileSync(report, 'utf8'));
const failed = Object.entries(data.checks || {}).filter(([, v]) => String(v).startsWith('FAIL'));
console.log(JSON.stringify({
  ok: data.ok,
  version: data.version,
  buildTime: data.buildTime,
  dataDir: data.dataDir,
  files: data.files?.length,
  totalBytes: data.files?.reduce((a, f) => a + f.bytes, 0),
  assets: data.assets,
  failures: failed,
  problems: data.problems,
}, null, 2));
if (!data.ok || failed.length || res.status !== 0) {
  console.error('SELFTEST FAILED');
  process.exit(1);
}
console.log('SELFTEST OK');
