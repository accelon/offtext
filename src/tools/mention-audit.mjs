// 找出 value 裡反覆出現、卻沒有被任何科目定義的詞。
// 用法：node src/tools/mention-audit.mjs [--min=3] [--top=40] [--domain=fq]
import path from 'node:path';
import { loadDomains } from './tsv-data.mjs';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '..', '..');
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, value] = arg.slice(2).split('=');
      return [key, value == null ? true : value];
    })
);
const MIN = Math.max(2, Number(args.get('min')) || 3);
const TOP = Math.max(5, Number(args.get('top')) || 40);
const onlyDomain = args.get('domain') ? String(args.get('domain')) : null;

const STOP = new Set(
  (
    '可以 例如 一種 這些 那些 因為 所以 但是 以及 或是 並且 對於 透過 其中 這個 那個 我們 他們 自己 ' +
    '包括 通常 主要 重要 形成 產生 造成 影響 使用 具有 提供 需要 必須 可能 約為 之一 等等 稱為 屬於 ' +
    '位於 分為 不同 相同 相關 各種 第一 第二 第三 許多 多數 少數 部分 整體 時間 地方 方式 過程 結果 ' +
    '原因 問題 方法 內容 情況 狀態 程度 範圍 數量 大小 高低 前後 左右 之間 之後 之前 同時 一起 一定 ' +
    '一般 其他 其它 此外 因此 然而 而且 不過 只是 就是 還有 沒有 不會 不能 能夠 應該 想要 知道 看到 ' +
    '發現 出現 發生 進行 完成 建立 改變 增加 減少 提高 降低 維持 控制 選擇 決定 判斷 分析 理解 學習 ' +
    '研究 說明 表示 代表 包含 組成 構成 連接 組合 操作 處理 儲存 傳輸 計算 測量 觀察 實驗 證據 理論 ' +
    '例子 實際 基本 基礎 核心 關鍵 特色 特徵 性質 功能 作用 效果 目的 目標 價值 意義 定義 概念 知識 ' +
    '東西 事情 人物 事件 國家 社會 世界 生活 工作 社會 文化 歷史 時代 世紀 年代 地區 地方 民族 人民 ' +
    '政府 企業 公司 組織 制度 政策 法律 經濟 政治 軍事 科學 技術 藝術 音樂 繪畫 文學 語言 文字 句子 ' +
    '詞語 意義 用法 讀音 字形 形狀 顏色 光線 聲音 力量 能量 速度 溫度 壓力 密度 質量 體積 面積 長度 ' +
    '位置 方向 距離 比例 比率 數字 數值 數據 資料 系統 結構 網路 網絡 程式 程序 檔案 文件 資料庫 數據庫 ' +
    '中國 日本 美國 英國 法國 德國 俄國 蘇聯 歐洲 亞洲 長期 短期 不是 而是 不要 一個 兩個 真正 只看 ' +
    '用來 上升 下降 生成 形式 服務 發展 現象 安全 環境 保護 改革 固定 能力 主張 關係 輸出 常用 變化 化學'
  )
    .split(/\s+/)
    .filter(Boolean)
);

const domains = loadDomains(ROOT);
const defined = new Set();
const entries = [];
for (const domain of domains) {
  if (domain.hidden) continue;
  for (const [key, value] of Object.entries(domain.entries)) {
    if (key === '_' || String(key).startsWith('@')) continue;
    if (String(value).trim().startsWith('@')) {
      defined.add(key); // 別名也算可查
      continue;
    }
    defined.add(key);
    entries.push({ domain: domain.id, key, value: String(value) });
  }
}

const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
const stripRefs = (value) =>
  value.replace(/\^\[([^\]]+)\]/g, (_match, inner) => {
    const [display, rest] = inner.split('|');
    if (display && rest) return display;
    return inner.split('@')[0];
  });

const stats = new Map();
for (const entry of entries) {
  if (onlyDomain && entry.domain !== onlyDomain) continue;
  const seen = new Set();
  for (const part of segmenter.segment(stripRefs(entry.value))) {
    if (!part.isWordLike) continue;
    const word = part.segment.trim();
    if (word.length < 2 || word.length > 8) continue;
    if (!/^[\u4e00-\u9fff]+$/.test(word)) continue;
    if (defined.has(word) || STOP.has(word) || seen.has(word)) continue;
    seen.add(word);
    let item = stats.get(word);
    if (!item) {
      item = { count: 0, domains: new Map(), examples: [] };
      stats.set(word, item);
    }
    item.count++;
    item.domains.set(entry.domain, (item.domains.get(entry.domain) || 0) + 1);
    if (item.examples.length < 2) item.examples.push(entry.key + '｜' + stripRefs(entry.value).slice(0, 40));
  }
}

const rows = [...stats.entries()]
  .filter(([, item]) => item.count >= MIN)
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  .slice(0, TOP);

console.log(
  `未被任何 key／alias 定義、且在 ${onlyDomain || '全部科目'} 出現 ≥${MIN} 條的候選（前 ${rows.length}）：`
);
for (const [word, item] of rows) {
  const dist = [...item.domains.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => `${domain}:${count}`)
    .join(' ');
  console.log(`  ${word.padEnd(6)} ${String(item.count).padStart(3)} 條  ${dist}`);
  for (const example of item.examples) console.log(`      例：${example}`);
}
console.log(`\n共 ${stats.size} 個候選；可用 --min、--top、--domain 調整。`);
