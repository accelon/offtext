// 知識網路健檢：加權順／逆鏈、樞紐、DAG 環與「基礎度反轉」。
// 用法：node src/tools/knowledge-audit.mjs [--domain=aijargon] [--top=12]
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const SRC = path.resolve(TOOLS, '..');
const ROOT = path.resolve(SRC, '..');
const require = createRequire(import.meta.url);
const NT = require(path.join(SRC, 'nestedtext-core.js'));

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, value] = arg.slice(2).split('=');
      return [key, value == null ? true : value];
    })
);
const top = Math.max(3, Number(args.get('top')) || 12);
const onlyDomain = args.get('domain') ? String(args.get('domain')) : null;

const domains = loadDomains(ROOT);
const index = NT.buildIndex(domains);
const dag = NT.buildDag(index);
const weights = index.weights;
const domainName = (id) => {
  const domain = index.byId.get(id);
  return domain ? domain.name : id;
};
const label = (id) => {
  const cut = id.indexOf(':');
  return id.slice(cut + 1) + ' · ' + domainName(id.slice(0, cut));
};
const visibleIds = [...dag.nodes.keys()].filter(
  (id) => !onlyDomain || id.startsWith(onlyDomain + ':')
);
const cycles = dag.cycles.filter(
  (component) => !onlyDomain || component.ids.some((id) => id.startsWith(onlyDomain + ':'))
);
const inversions = dag.inversions.filter(
  (item) => !onlyDomain || item.from.startsWith(onlyDomain + ':')
);
const byWeight = (map) =>
  visibleIds
    .slice()
    .sort((a, b) => (map.get(b) || 0) - (map.get(a) || 0) || a.localeCompare(b));

const format = (value) => (Math.round(value * 100) / 100).toFixed(2);
const printList = (title, ids, valueOf, count = top) => {
  console.log(title);
  for (const id of ids.slice(0, count)) {
    console.log('  ', label(id).padEnd(36), format(valueOf(id)));
  }
};

console.log('科目：', index.order.filter((d) => !d.hidden).length);
console.log('內容節點：', dag.nodes.size);
console.log('引用邊：', dag.edges.length);
console.log(
  '加權深度：',
  weights.depth,
  '（直接 1、每多一跳 ×',
  weights.decay,
  '；同一節點取最短距離一次）'
);
console.log('強連通分量：', dag.components.length, '；有環的分量：', cycles.length);
console.log('最大環：', cycles.length ? Math.max(...cycles.map((c) => c.size)) : 0, '個節點');

if (cycles.length) {
  console.log('環（前 5）：');
  for (const component of cycles.slice().sort((a, b) => b.size - a.size).slice(0, 5)) {
    console.log('  ', '[' + component.size + ']', component.ids.slice(0, 8).map(label).join('、'));
  }
}

printList('基礎節點（逆鏈加權前 ' + top + '）', byWeight(weights.backward), (id) => weights.backward.get(id) || 0);
printList('連接節點（順鏈加權前 ' + top + '）', byWeight(weights.forward), (id) => weights.forward.get(id) || 0);
printList('樞紐（順鏈 × 逆鏈）', byWeight(weights.hub), (id) => weights.hub.get(id) || 0);

console.log('基礎度反轉（基礎概念去定義較高階概念；前 ' + top + '）');
for (const item of inversions.slice(0, top)) {
  console.log(
    '  ',
    label(item.from).padEnd(36),
    '→',
    label(item.to),
    'Δ',
    format(item.delta)
  );
}
if (!inversions.length) console.log('   （沒有）');

if (args.get('layers')) {
  const byLayer = new Map();
  for (const id of visibleIds) {
    const layer = dag.layerOf(id);
    if (layer == null) continue;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(id);
  }
  console.log('分層（0＝最基礎）：');
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = byLayer.get(layer).sort((a, b) => a.localeCompare(b));
    console.log('  L' + layer + '（' + ids.length + '）：' + ids.slice(0, top).map(label).join('、'));
  }
}

if (!onlyDomain) {
  console.log('各科摘要：');
  for (const domain of index.order) {
    if (domain.hidden) continue;
    const ids = [...dag.nodes.keys()].filter((id) => id.startsWith(domain.id + ':'));
    const cycles = dag.cycles.filter((component) =>
      component.ids.some((id) => id.startsWith(domain.id + ':'))
    );
    const topHub = ids.slice().sort((a, b) => (weights.hub.get(b) || 0) - (weights.hub.get(a) || 0))[0];
    const topBase = ids.slice().sort((a, b) => (weights.backward.get(b) || 0) - (weights.backward.get(a) || 0))[0];
    console.log(
      '  ',
      domainName(domain.id).padEnd(8),
      '節點',
      String(ids.length).padStart(3),
      '環',
      String(cycles.length).padStart(3),
      '樞紐',
      topHub ? label(topHub) : '—',
      '基礎',
      topBase ? label(topBase) : '—'
    );
  }
}
