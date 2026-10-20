/*
 * Offtext 片段解析：帶位置，供 CodeMirror 裝飾使用。
 * 與 nestedtext-core.js 的 NT.parse 規則一致，但額外回傳 from/to。
 */

export function parseRefInner(inner) {
  let display = null;
  let target = String(inner);
  let domain = null;

  const bar = target.indexOf('|');
  if (bar !== -1) {
    display = target.slice(0, bar).trim();
    target = target.slice(bar + 1);
  }

  const at = /^([\s\S]+)@([A-Za-z0-9_.-]+)$/.exec(target.trim());
  if (at) {
    target = at[1];
    domain = at[2];
  }

  return {
    raw: inner,
    display: display || null,
    ref: target.trim(),
    domain,
  };
}

/*
 * 回傳 [{type:'text', from, to, text} | {type:'ref', from, to, innerFrom, innerTo, ...}]
 * ^[...] 之外的 ^ 一律視為普通文字。
 */
export function parseSpans(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  let start = 0;

  while (i < s.length) {
    if (s[i] === '^' && s[i + 1] === '[') {
      const end = s.indexOf(']', i + 2);
      if (end === -1) {
        i += 2;
        continue;
      }
      if (i > start) out.push({ type: 'text', from: start, to: i, text: s.slice(start, i) });
      out.push({
        type: 'ref',
        from: i,
        to: end + 1,
        innerFrom: i + 2,
        innerTo: end,
        inner: s.slice(i + 2, end),
        ...parseRefInner(s.slice(i + 2, end)),
      });
      i = end + 1;
      start = i;
    } else {
      i++;
    }
  }
  if (start < s.length) {
    out.push({ type: 'text', from: start, to: s.length, text: s.slice(start) });
  }
  return out;
}

/* 給 UI 用：一個字串裡有哪些引用（不比對位置）。 */
export function listRefs(text) {
  return parseSpans(text)
    .filter((token) => token.type === 'ref')
    .map((token) => ({ ref: token.ref, domain: token.domain, display: token.display }));
}

/* 條目名稱的字數：以 Unicode code point 計，中文、英文都算一個。 */
export function charLength(text) {
  return Array.from(String(text == null ? '' : text)).length;
}
