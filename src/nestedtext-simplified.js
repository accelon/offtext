/* GENERATED FILE — 由 src/tools/build-lib.mjs 從 nestedtext-simplified.ts 產生；請勿直接編輯。 */
(function(root, factory) {
  const data = typeof module === "object" && module.exports ? require("./simplified-data.js") : root.OFFTEXT_SIMPLIFIED;
  const api = factory(data || { safe: "", force: "" });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NTSimplified = api;
})(typeof globalThis !== "undefined" ? globalThis : exports, function(data) {
  "use strict";
  function parsePairs(pairs) {
    const map = /* @__PURE__ */ new Map();
    const text = String(pairs || "");
    for (let i = 0; i + 1 < text.length; i += 2) map.set(text[i], text[i + 1]);
    return map;
  }
  const SAFE = parsePairs(data.safe);
  const FORCE = parsePairs(data.force);
  function normalizeMode(mode) {
    const n = Number(mode);
    return n === 1 || n === 2 ? n : 0;
  }
  function simplifyChar(ch, mode) {
    const m = normalizeMode(mode);
    if (!m) return ch;
    return (m === 1 ? SAFE.get(ch) : FORCE.get(ch)) || ch;
  }
  function toSimplified(text, mode) {
    const m = normalizeMode(mode);
    if (!m || !text) return String(text == null ? "" : text);
    const map = m === 1 ? SAFE : FORCE;
    let out = "";
    for (const ch of String(text)) out += map.get(ch) || ch;
    return out;
  }
  function converts(ch, mode) {
    const m = normalizeMode(mode);
    if (!m) return false;
    return (m === 1 ? SAFE : FORCE).has(ch);
  }
  function stats() {
    return { safe: SAFE.size, force: FORCE.size };
  }
  function searchForms(text) {
    const original = String(text == null ? "" : text);
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
    searchForms
  };
});
