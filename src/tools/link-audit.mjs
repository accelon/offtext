// 找出條目內文裡「已經是詞目、卻沒有 ^[...] 標記」的提及。
// 用法：
//   node src/tools/link-audit.mjs                 # 檢查 modern-chinese-history.tsv
//   node src/tools/link-audit.mjs --file data/biology.tsv
//   node src/tools/link-audit.mjs --fix           # 自動補上 ^[...]
//   node src/tools/link-audit.mjs --check         # 有候選時 exit 1
//   node src/tools/link-audit.mjs --orphans       # 只補「完全沒被引用」的詞目
//
// 只掃描同一個 TSV 內的 key；已存在的 ^[...] 會整段跳過。
import fs from 'node:fs';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const DEFAULT_FILE = 'data/modern-chinese-history.tsv';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const check = args.includes('--check');
const all = args.includes('--all');
const orphansOnly = args.includes('--orphans');
const fileArg = args.indexOf('--file');
const minArg = args.indexOf('--min');
const keyArg = args.indexOf('--key');
const file = fileArg >= 0 ? args[fileArg + 1] : DEFAULT_FILE;
const minLength = minArg >= 0 ? Number(args[minArg + 1]) || 2 : 2;
const onlyKeys = keyArg >= 0 ? new Set(args[keyArg + 1].split(',').map((s) => s.trim())) : null;

if (!file) {
  console.error('用法：node src/tools/link-audit.mjs [--file data/modern-chinese-history.tsv] [--min 2] [--key 毛澤東,朱德] [--fix] [--check]');
  process.exit(2);
}

const fullPath = path.resolve(ROOT, file);
if (!fs.existsSync(fullPath)) {
  console.error('找不到檔案：' + fullPath);
  process.exit(2);
}

const raw = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);

const entries = [];
let metaLine = '';
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  if (!metaLine && /^\s*\{.*\}\s*$/.test(line)) {
    metaLine = line;
    continue;
  }
  const tab = line.indexOf('\t');
  if (tab < 0) continue;
  entries.push({ line: i, key: line.slice(0, tab).trim(), value: line.slice(tab + 1) });
}

const keys = entries
  .map((entry) => entry.key)
  .filter((key) => key && key !== '_' && key.length >= minLength)
  .sort((a, b) => b.length - a.length);

const candidates = [];

// 少數詞目會出現在更長的固定語裡，意思不同，不能自動連結。
// 例如「民族解放戰爭」不是國共內戰的「解放戰爭」。
function isBlockedHit(value, index, key) {
  if (key === '解放戰爭' && value.slice(Math.max(0, index - 2), index) === '民族') return true;
  if (key === '現金' && value[index + key.length] === '流') return true;
  return false;
}

function linkedKeysOf(entries) {
  const linked = new Set();
  for (const entry of entries) {
    for (const match of entry.value.matchAll(/\^\[([^\]]+)\]/g)) {
      const target = match[1].split('|').pop().split('@')[0].trim();
      if (target) linked.add(target);
    }
  }
  return linked;
}

function scan(entry) {
  const { key: fromKey, value, line } = entry;
  const found = [];
  let i = 0;

  while (i < value.length) {
    // 跳過既有引用，避免把已經標記的詞再算一次。
    if (value[i] === '^' && value[i + 1] === '[') {
      const end = value.indexOf(']', i + 2);
      i = end === -1 ? i + 2 : end + 1;
      continue;
    }

    let hit = null;
    for (const key of keys) {
      if (key === fromKey) continue;
      if (onlyKeys && !onlyKeys.has(key)) continue;
      if (value.startsWith(key, i)) {
        hit = key;
        break; // keys 已依長度排序，第一個就是最長命中
      }
    }

    if (!hit) {
      i++;
      continue;
    }
    if (isBlockedHit(value, i, hit)) {
      i += hit.length;
      continue;
    }

    found.push({
      line,
      fromKey,
      key: hit,
      start: i,
      context: value.slice(Math.max(0, i - 14), i + hit.length + 14).replace(/\s+/g, ' '),
    });
    i += hit.length;
  }

  return found;
}

for (const entry of entries) {
  if (entry.key === '_') continue;
  candidates.push(...scan(entry));
}

const linked = linkedKeysOf(entries);
const orphanKeys = new Set(keys.filter((key) => !linked.has(key)));
const report = orphansOnly
  ? [...new Map(candidates.filter((item) => orphanKeys.has(item.key)).map((item) => [item.key, item])).values()]
  : candidates;

const byKey = new Map();
for (const item of report) {
  if (!byKey.has(item.key)) byKey.set(item.key, []);
  byKey.get(item.key).push(item);
}

const fileLabel = path.relative(ROOT, fullPath).replace(/\\/g, '/');
console.log(`檔案：${fileLabel}`);
console.log(
  (orphansOnly ? '未被引用的詞目：' : '候選：') +
    report.length +
    ' 處，' +
    byKey.size +
    ' 個不同詞目' +
    (orphansOnly ? `（孤兒 key 共 ${orphanKeys.size} 個）` : '')
);

for (const [key, items] of [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${key} × ${items.length}`);
  for (const item of all ? items : items.slice(0, 8)) {
    console.log(`  L${item.line + 1} ${item.fromKey}：…${item.context}…`);
  }
  if (!all && items.length > 8) console.log(`  …另有 ${items.length - 8} 處`);
}

if (fix && report.length) {
  // 從後面往前替換，讓前面的索引不位移。
  const grouped = new Map();
  for (const item of report) {
    if (!grouped.has(item.fromKey)) grouped.set(item.fromKey, []);
    grouped.get(item.fromKey).push(item);
  }

  const nextLines = lines.slice();
  let changed = 0;
  for (const [fromKey, items] of grouped) {
    const entry = entries.find((e) => e.key === fromKey);
    let value = entry.value;
    for (const item of items.sort((a, b) => b.start - a.start)) {
      value = value.slice(0, item.start) + '^[' + item.key + ']' + value.slice(item.start + item.key.length);
      changed++;
    }
    nextLines[entry.line] = fromKey + '\t' + value;
  }

  fs.writeFileSync(fullPath, nextLines.join('\n'), 'utf8');
  console.log(`\n已寫入 ${changed} 個鏈結：${fileLabel}`);
} else if (report.length) {
  console.log('\n目前是檢查模式；加上 --fix 才會寫入。');
}

if (check && report.length) process.exit(1);
