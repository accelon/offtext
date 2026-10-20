// 前端建置總入口：TS 程式庫 → app bundle → 型別檢查 → CM6 bundle → build/。
// 用法：node src/tools/build-all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const steps = [
  [path.join(ROOT, 'src', 'tools', 'build-lib.mjs')],
  [path.join(ROOT, 'src', 'tools', 'build-app.mjs')],
  [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(ROOT, 'tsconfig.json')],
  [path.join(ROOT, 'src', 'tools', 'build-editor.mjs')],
  [path.join(ROOT, 'src', 'tools', 'build.mjs')],
];

for (const args of steps) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${path.basename(args[0])} 失敗（exit ${res.status}）`);
  }
}
