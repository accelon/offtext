// 直接從 data/*.tsv 讀出 domain，供 Node 測試／健檢使用。
// 瀏覽器端不使用這個檔；使用者在啟動時自己開 TSV。
import fs from 'node:fs';
import path from 'node:path';

export const SOURCES = [
  'chinese.tsv',
  'ancient-china.tsv',
  'world-history.tsv',
  'modern-chinese-history.tsv',
  'modernization.tsv',
  'civics.tsv',
  'art.tsv',
  'math.tsv',
  'physics.tsv',
  'chemistry.tsv',
  'biology.tsv',
  'earthscience.tsv',
  'computing.tsv',
  'aijargon.tsv',
  'economics.tsv',
  'fq.tsv',
];

export function parseTsv(text, fallbackId) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let meta = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (/^\s*\{.*\}\s*$/.test(lines[i] || '')) {
    const line = lines[i];
    const id = /id\s*:\s*"([^"]*)"/.exec(line);
    const name = /name\s*:\s*"([^"]*)"/.exec(line);
    const hidden = /hidden\s*:\s*"?([a-z]+)"?/.exec(line);
    const group = /group\s*:\s*"([^"]*)"/.exec(line);
    if (id) meta.id = id[1];
    if (name) meta.name = name[1];
    if (hidden) meta.hidden = hidden[1] === 'true';
    if (group) meta.group = group[1];
    i++;
  }

  const entries = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const key = (tab < 0 ? line : line.slice(0, tab)).trim();
    if (!key) continue;
    entries[key] = tab < 0 ? '' : line.slice(tab + 1);
  }

  return {
    id: meta.id || fallbackId,
    name: meta.name || meta.id || fallbackId,
    hidden: !!meta.hidden,
    group: meta.group || '',
    entries,
  };
}

export function loadDomains(root) {
  const dataDir = path.join(root, 'data');
  const domains = [];
  for (const file of SOURCES) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) throw new Error('缺少檔案：' + full);
    domains.push({
      ...parseTsv(fs.readFileSync(full, 'utf8'), file.replace(/\.tsv$/, '')),
      file,
    });
  }
  return domains;
}
