// 簡繁三態的單元測試：node src/tools/test-simplified.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const require = createRequire(import.meta.url);
const S = require(path.join(SRC, 'nestedtext-simplified.js'));

// 1. 模式正規化：不認得的一律回到原樣
assert.equal(S.normalizeMode(0), 0);
assert.equal(S.normalizeMode(1), 1);
assert.equal(S.normalizeMode(2), 2);
assert.equal(S.normalizeMode('2'), 2);
assert.equal(S.normalizeMode(9), 0);
assert.equal(S.normalizeMode(null), 0);

// 2. 原樣不動
const original = '萬與醜，臺灣的醫生後來又發心。';
assert.equal(S.toSimplified(original, 0), original);
assert.equal(S.toSimplified('', 1), '');

// 3. 一對一的字：無損與強制都轉
for (const [trad, simp] of [
  ['薩', '萨'],
  ['萬', '万'],
  ['與', '与'],
  ['醜', '丑'],
  ['醫', '医'],
]) {
  assert.equal(S.simplifyChar(trad, 1), simp, `無損 ${trad}→${simp}`);
  assert.equal(S.simplifyChar(trad, 2), simp, `強制 ${trad}→${simp}`);
}

// 4. 合併字：無損保留原樣，強制才轉
for (const [trad, simp] of [
  ['發', '发'],
  ['髮', '发'],
  ['乾', '干'],
  ['幹', '干'],
  ['裡', '里'],
  ['裏', '里'],
  ['臺', '台'],
  ['後', '后'],
]) {
  assert.equal(S.simplifyChar(trad, 1), trad, `無損保留 ${trad}`);
  assert.equal(S.simplifyChar(trad, 2), simp, `強制 ${trad}→${simp}`);
}

// 5. 整句：示範句的實際輸出
assert.equal(
  S.toSimplified('王后與後代，頭髮乾燥，臺灣的醫生後來又發心。', 1),
  '王后与後代，头髮乾燥，臺湾的医生後来又發心。'
);
assert.equal(
  S.toSimplified('王后與後代，頭髮乾燥，臺灣的醫生後來又發心。', 2),
  '王后与后代，头发干燥，台湾的医生后来又发心。'
);

// 6. 搜尋形式：原文、無損、強制都在，且去重
assert.deepEqual(S.searchForms('臺灣'), ['臺灣', '臺湾', '台湾']);
assert.deepEqual(S.searchForms('neuron'), ['neuron']);

// 7. 對照表規模（來源：accelon26 simplified-data.ts）
const stats = S.stats();
assert.equal(stats.safe, 2641);
assert.equal(stats.force, 2810);
assert.ok(stats.force >= stats.safe);

console.log('test-simplified：全部通過（無損 ' + stats.safe + ' 組、強制 ' + stats.force + ' 組）');
