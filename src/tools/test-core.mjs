// 核心邏輯的快速驗證：node src/tools/test-core.mjs（先跑 build）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const ROOT = path.resolve(SRC, '..');
const require = createRequire(import.meta.url);
const NT = require(path.join(SRC, 'nestedtext-core.js'));

const domains = loadDomains(ROOT);
const index = NT.buildIndex(domains);

// 1. 解析引用
const tokens = NT.parse('構成^[神經網絡]的基本單元。');
assert.equal(tokens.length, 3);
assert.deepEqual(tokens[1], {
  type: 'ref',
  raw: '神經網絡',
  display: null,
  ref: '神經網絡',
  domain: null,
});

// 2. 顯示名 + domain 語法
const t2 = NT.parse('^[顯示名|人工神經元@aijargon]');
assert.equal(t2[0].display, '顯示名');
assert.equal(t2[0].ref, '人工神經元');
assert.equal(t2[0].domain, 'aijargon');

// 3. 中文別名：同一科目內的 @ 轉址頁（在 AI 術語裡閱讀時）
const r1 = NT.resolve(index, '神經元', null, 'aijargon');
assert.equal(r1.status, 'ok');
assert.equal(r1.domain, 'aijargon');
assert.equal(r1.key, '人工神經元');
assert.deepEqual(r1.chain, ['aijargon:神經元', 'aijargon:人工神經元']);

// 3b. 沒有指定科目時，依載入順序先命中生物課本自己的神經元
assert.equal(NT.resolve(index, '神經元').domain, 'biology');

// 4. 直接命中內容層
const r2 = NT.resolve(index, '人工神經元');
assert.equal(r2.status, 'ok');
assert.equal(r2.key, '人工神經元');

// 5. 找不到
const r3 = NT.resolve(index, '內存');
assert.equal(r3.status, 'missing');
assert.ok(NT.suggest(index, '內存', 3).length >= 0);

// 6. _ 只能以指定 domain 的方式取得
assert.equal(NT.resolve(index, '_', 'aijargon').status, 'ok');
assert.equal(NT.resolve(index, '_').status, 'missing');

// 7. 展開形式：200 字以內一律在點擊處內嵌
assert.equal(NT.chooseMode('構成^[神經網絡]的基本單元。', 'auto'), 'inline');
assert.equal(NT.chooseMode('a'.repeat(200), 'auto'), 'inline');
assert.equal(NT.chooseMode('a'.repeat(201), 'auto'), 'block');
assert.equal(NT.chooseMode('a'.repeat(500), 'inline'), 'inline');
assert.equal(NT.INLINE_LIMIT, 200);

// 8. 別名迴圈
const loopIndex = NT.buildIndex([
  { id: 'a', entries: { x: '@y' } },
  { id: 'b', hidden: true, entries: { y: '@x' } },
]);
assert.equal(NT.resolve(loopIndex, 'x').status, 'alias-loop');

// 9. 別名可跨 domain 指定
const crossIndex = NT.buildIndex([
  { id: 'a', entries: { x: '@b:y' } },
  { id: 'b', hidden: true, entries: { y: '內容' } },
]);
assert.equal(NT.resolve(crossIndex, 'x').value, '內容');

// 10. 深度色相
assert.equal(NT.hue(0), 20);
assert.equal(NT.hue(1), 50);

// 11. buildIndex 時已算好順鏈、逆鏈與反鏈接
assert.ok(index.links);
assert.ok(index.links.forward.get('aijargon:人工神經元').has('aijargon:權重'));
assert.ok(index.links.backward.get('aijargon:人工神經元').has('aijargon:權重'));
const neuronBacklinks = NT.backlinksFor(index, 'aijargon:人工神經元');
assert.ok(neuronBacklinks.length >= 8);
assert.ok(neuronBacklinks.some((item) => item.domain === 'aijargon' && item.key === '權重'));

// 首頁可以向外連，但不列入別人的反鏈接。
const homeSources = [...index.links.backlinks.values()].some((sources) =>
  [...sources.values()].some((item) => item.key === '_')
);
assert.equal(homeSources, false);

// 12. 每個科目各自的節點排行在建索引時算好
const aiRankings = index.rankings.get('aijargon');
assert.ok(aiRankings.important.length > 0);
assert.ok(aiRankings.core.length > 0);
assert.ok(aiRankings.hub.length > 0);
for (let i = 1; i < aiRankings.important.length; i++) {
  assert.ok(aiRankings.important[i - 1].forward >= aiRankings.important[i].forward);
}
for (const item of aiRankings.hub) assert.equal(item.hub, item.forward * item.back);
for (const domain of index.order.filter((d) => !d.hidden)) {
  assert.ok(index.rankings.has(domain.id));
}

console.log('core: 全部通過');
