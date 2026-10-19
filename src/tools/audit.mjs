// 資料健檢：解析不到的引用、引用圖中的循環、孤島條目。
// 用法：node src/tools/audit.mjs（先跑 build）
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

const edges = new Map();
const missing = new Map();
const inbound = new Map();
const redirects = [];
let refTotal = 0;

function idOf(domain, key) {
  return domain + ':' + key;
}

for (const d of index.order) {
  for (const [key, value] of d.entries) {
    const from = idOf(d.id, key);
    // @ 轉址頁只給查表用，不列入條目、循環與孤島統計。
    if (key !== '_' && String(value).trim().startsWith('@')) {
      redirects.push(from);
      continue;
    }
    const out = new Set();
    for (const tok of NT.parse(value)) {
      if (tok.type !== 'ref') continue;
      refTotal++;
      const res = NT.resolve(index, tok.ref, tok.domain, d.id);
      if (res.status === 'ok') {
        out.add(idOf(res.domain, res.key));
      } else {
        const label = tok.ref + (tok.domain ? '@' + tok.domain : '');
        missing.set(label, (missing.get(label) || 0) + 1);
      }
    }
    edges.set(from, out);
    for (const target of out) {
      inbound.set(target, (inbound.get(target) || 0) + 1);
    }
  }
}

const nodes = [...edges.keys()].filter((id) => !id.endsWith(':_'));
const cyclic = [];

for (const start of nodes) {
  const seen = new Set();
  const stack = [...(edges.get(start) || [])];
  let found = false;
  while (stack.length) {
    const cur = stack.pop();
    if (cur === start) {
      found = true;
      break;
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) || []) stack.push(next);
  }
  if (found) cyclic.push(start);
}

const orphans = nodes.filter((id) => !inbound.get(id));

// 從某個條目出發，幾次點擊能走到多少條目？
function reachableFrom(start) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of edges.get(cur) || []) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(cur) + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

// 別名指向不存在的條目
const brokenAlias = [];
for (const d of index.order) {
  for (const [key, value] of d.entries) {
    if (key === '_' || !String(value).trim().startsWith('@')) continue;
    const res = NT.resolve(index, key, d.id);
    if (res.status !== 'ok') brokenAlias.push(idOf(d.id, key) + ' → ' + value.trim() + '（' + res.status + '）');
  }
}

const byLabel = (a, b) => b[1] - a[1];
console.log('內容條目：', nodes.length);
console.log('對照頁：', redirects.length, '（@ 轉址，不列入索引）');
console.log('引用總數：', refTotal);
console.log('解析不到：', missing.size, '個不同名稱');
for (const [name, count] of [...missing.entries()].sort(byLabel)) {
  console.log('  ', name, '×', count);
}
console.log('引用圖中會回到自己的條目：', cyclic.length);
for (const id of cyclic.slice(0, 20)) console.log('  ', id);
console.log('沒被任何條目引用的孤島：', orphans.length);
console.log('  ', orphans.slice(0, 12).join(', '));
for (const domain of index.order) {
  if (domain.hidden || !domain.entries.has('_')) continue;
  const start = domain.id + ':_';
  const dist = reachableFrom(start);
  const own = [...domain.entries.entries()]
    .filter(([key, value]) => key !== '_' && !String(value).trim().startsWith('@'))
    .map(([key]) => domain.id + ':' + key);
  const hit = own.filter((id) => dist.has(id));
  console.log(`從 ${domain.id} 首頁可達：${hit.length} / ${own.length} 個條目`);
  const reach = [...dist.entries()]
    .filter(([id]) => id !== start)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6);
  console.log('  ', reach.map(([id, dep]) => id + '@' + dep).join(', '));
}
console.log('壞掉的別名：', brokenAlias.length);
for (const line of brokenAlias) console.log('  ', line);
