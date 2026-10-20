/*
 * 顯示用的「無損簡體」。
 *
 * 三態（與 accelon26 相同）：
 *   0 原樣      —— 不動。
 *   1 無損簡體  —— 只做「一對一」的繁→簡；發／髮、乾／幹、裡／裏、臺／檯 這類
 *                  多對一的合併字保留原字，轉完仍看得出原文是哪個字。
 *   2 強制簡體  —— 全部轉（Unihan kSimplifiedVariant）。
 *
 * 這支只做「字串 → 字串」；顯示、搜尋、比對都還在原文上，切換不影響資料。
 * 資料在 simplified-data.js，由 src/tools/gen-simplified.mjs 產生。
 */
(function (root, factory) {
  const data =
    typeof module === 'object' && module.exports
      ? require('./simplified-data.js')
      : root.OFFTEXT_SIMPLIFIED;
  const api = factory(data || { safe: '', force: '' });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTSimplified = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';

  /** 每兩個字一組「繁體,簡體」。產物只含 BMP 字，所以用 charAt 即可。 */
  function parsePairs(pairs) {
    const map = new Map();
    const text = String(pairs || '');
    for (let i = 0; i + 1 < text.length; i += 2) map.set(text[i], text[i + 1]);
    return map;
  }

  const SAFE = parsePairs(data.safe);
  const FORCE = parsePairs(data.force);

  /** 0＝原樣、1＝無損簡體、2＝強制簡體 */
  function normalizeMode(mode) {
    const n = Number(mode);
    return n === 1 || n === 2 ? n : 0;
  }

  /** 單字轉換（不是漢字、或這個模式不轉 → 原樣） */
  function simplifyChar(ch, mode) {
    const m = normalizeMode(mode);
    if (!m) return ch;
    return (m === 1 ? SAFE.get(ch) : FORCE.get(ch)) || ch;
  }

  /** 字串轉換（逐字；不動標點、數字、拉丁字母） */
  function toSimplified(text, mode) {
    const m = normalizeMode(mode);
    if (!m || !text) return String(text == null ? '' : text);
    const map = m === 1 ? SAFE : FORCE;
    let out = '';
    for (const ch of String(text)) out += map.get(ch) || ch;
    return out;
  }

  /** 這個字在指定模式下會轉嗎（測試／診斷用） */
  function converts(ch, mode) {
    const m = normalizeMode(mode);
    if (!m) return false;
    return (m === 1 ? SAFE : FORCE).has(ch);
  }

  /** 表的大小（設定頁狀態列用） */
  function stats() {
    return { safe: SAFE.size, force: FORCE.size };
  }

  /**
   * 搜尋用：同一個詞在「原文／無損簡體／強制簡體」下的寫法（去重）。
   * 讓使用者在簡體顯示下打簡體字也找得到，原文永遠保留。
   */
  function searchForms(text) {
    const original = String(text == null ? '' : text);
    if (!original) return [];
    const out = [original];
    for (const mode of [1, 2]) {
      const form = toSimplified(original, mode);
      if (!out.includes(form)) out.push(form);
    }
    return out;
  }

  return {
    MODES: [0, 1, 2],
    normalizeMode,
    simplifyChar,
    toSimplified,
    converts,
    stats,
    searchForms,
  };
});
