// 從 accelon26 的 simplified-data.ts 產生瀏覽器用的簡繁對照表。
// 用法：node src/tools/gen-simplified.mjs <simplified-data.ts>
// 例：node src/tools/gen-simplified.mjs D:\2026\adb-converter\ts\src\accelon26\simplified-data.ts
//
// 產物 src/simplified-data.js 是 GENERATED FILE，不要手改。
import fs from 'node:fs';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');

const from = process.argv[2];
if (!from) {
  console.error('用法：node src/tools/gen-simplified.mjs <simplified-data.ts>');
  process.exit(1);
}

const text = fs.readFileSync(from, 'utf8');
const pick = (name) => {
  const m = text.match(new RegExp('export const ' + name + ' = "([^"]*)";'));
  if (!m) throw new Error('找不到 ' + name);
  return m[1];
};

const safe = pick('SAFE_PAIRS');
const force = pick('FORCE_PAIRS');
if (safe.length % 2 || force.length % 2) {
  throw new Error('對照表長度必須是偶數（每兩個字一組）');
}

const header = `/*
 * GENERATED FILE — 不要手改。
 *
 * 來源：accelon26 的 simplified-data.ts（由 Unihan_Variants.txt 產生）。
 * 重新產生：node src/tools/gen-simplified.mjs <simplified-data.ts>
 *
 * 每兩個字一組「繁體,簡體」：
 *   safe  —— 只收一對一的繁簡（無損）；多對一的不收。
 *   force —— 全部轉（強制簡體）。
 *
 * 統計：無損 ${safe.length / 2} 組、強制 ${force.length / 2} 組。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.OFFTEXT_SIMPLIFIED = data;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    safe: ${JSON.stringify(safe)},
    force: ${JSON.stringify(force)},
  };
});
`;

const out = path.join(SRC, 'simplified-data.js');
fs.writeFileSync(out, header);
console.log(`已寫入 ${out}（無損 ${safe.length / 2} 組、強制 ${force.length / 2} 組）`);
