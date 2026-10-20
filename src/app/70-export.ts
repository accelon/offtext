/* Export 單一 HTML
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- Export：單一 HTML ---------- */

  const EXPORT_CSS = `
:root{--bg:#f4f2ec;--panel:#fffdf8;--ink:#24262a;--muted:#64665e;--line:#e2ddd1;--line-strong:#cec7b6;--accent:#2c5a86;color-scheme:light}
html[data-theme="dark"]{--bg:#15171b;--panel:#1c1f24;--ink:#e8e4da;--muted:#9a9c95;--line:#2c3037;--line-strong:#3c424b;--accent:#8fb6dc;color-scheme:dark}
html[data-theme="eye"]{--bg:#f1e4cc;--panel:#faf2e0;--ink:#3a3225;--muted:#665b47;--line:#d8c7a8;--line-strong:#c2ad84;--accent:#7a581f;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,-apple-system,"Microsoft JhengHei","Noto Sans TC","PingFang TC",sans-serif;font-size:16px;line-height:1.9}
main{max-width:760px;margin:0 auto;padding:30px 24px 72px}
.entry-kicker{color:var(--muted);font-size:12px;letter-spacing:.08em}
.entry-title{font-size:28px;line-height:1.3;margin:4px 0 18px}
.nt-line{font-size:17px;line-height:2.05}
.nt-block{margin:0 0 1.05em}
.nt-block.is-inline{display:inline;margin:0}
.nt-text{white-space:pre-wrap}
.nt-refwrap{display:inline}
.nt-ref{margin:0;padding:0;border:0;border-bottom:2px solid hsl(var(--hue) 55% 45%);background:transparent;color:hsl(var(--hue) 55% 30%);font:inherit;line-height:inherit;white-space:nowrap;cursor:pointer}
.nt-ref:hover{color:hsl(var(--hue) 65% 22%)}
.nt-ref.is-missing{border-bottom-style:dashed;color:var(--muted)}
.nt-exp-inline{display:inline;margin:0 3px;padding:0 4px 0 5px;border-bottom:1.5px solid hsl(var(--hue) 55% 48%);border-left:2px solid hsl(var(--hue) 55% 52% / .55);border-radius:3px;background:color-mix(in srgb,hsl(var(--hue) 55% 70%) 12%,transparent);-webkit-box-decoration-break:clone;box-decoration-break:clone}
.nt-note{margin-left:4px;color:var(--muted);font-size:12px}
.export-hover-layer{position:fixed;inset:0;z-index:50;pointer-events:none}
.export-hover{position:fixed;width:min(360px,calc(100vw - 24px));max-height:min(60vh,420px);overflow:auto;padding:10px 12px;border:1px solid var(--line-strong);border-radius:12px;background:var(--panel);box-shadow:0 16px 40px rgba(0,0,0,.18);pointer-events:auto;font-size:14px;line-height:1.8}
.export-hover-title{display:block;font-weight:600;margin-bottom:3px}
.export-hover-domain{color:var(--muted);font-size:11px;margin-left:6px}
html[data-theme="dark"] .nt-ref{color:hsl(var(--hue) 65% 78%);border-bottom-color:hsl(var(--hue) 55% 62%)}
html[data-theme="dark"] .nt-ref:hover{color:hsl(var(--hue) 70% 86%)}
html[data-theme="dark"] .export-hover{box-shadow:0 16px 40px rgba(0,0,0,.55)}
@media(max-width:760px){main{padding:22px 16px 56px}.entry-title{font-size:23px}.nt-line{font-size:17px}}
`;

  function htmlEscape(text) {
    return String(text == null ? '' : text).replace(/[&<>"]/g, (ch) => {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      return '&quot;';
    });
  }

  /*
   * 匯出目前條目與所有可達的內容條目；不含 _ 首頁與 @ 對照頁。
   * 另外記下「引用名稱 → 目標」的別名，讓 llm 這類寫法在匯出檔仍可解析。
   */
  function buildExportPayload() {
    const start = editorResolve(state.root.key, state.root.domain, null);
    if (start.status !== 'ok' || start.key === '_') return null;

    const entries = new Map();
    const domains = new Map();
    const aliases = new Map();
    const queue = [{ domain: start.domain, key: start.key }];
    const seen = new Set();

    while (queue.length) {
      const item = queue.shift();
      const res = editorResolve(item.key, item.domain, item.domain);
      if (res.status !== 'ok' || res.key === '_') continue;
      const id = res.domain + ':' + res.key;
      if (seen.has(id)) continue;
      seen.add(id);
      if (isRedirect(res.value)) continue;
      entries.set(id, res.value);
      domains.set(res.domain, domainName(res.domain));

      for (const tok of NT.parse(res.value)) {
        if (tok.type !== 'ref') continue;
        const next = editorResolve(tok.ref, tok.domain, res.domain);
        if (next.status !== 'ok' || next.key === '_' || isRedirect(next.value)) continue;
        const targetId = next.domain + ':' + next.key;
        aliases.set(res.domain + ':' + tok.ref, targetId);
        aliases.set(tok.ref, targetId);
        queue.push({ domain: next.domain, key: next.key });
      }
    }

    return {
      start: start.domain + ':' + start.key,
      domains: Object.fromEntries(domains),
      entries: Object.fromEntries(entries),
      aliases: Object.fromEntries(aliases),
    };
  }

  function exportRuntime() {
    'use strict';
    var data = window.OFFTEXT_EXPORT;
    var entries = data.entries;
    var domains = data.domains;
    var aliases = data.aliases || {};
    var expanded = new Set();
    var app = document.getElementById('app');
    var layer = document.getElementById('hover-layer');
    var current = data.start;
    var cards = [];
    var hoverTimer = 0;
    var pointerFine = window.matchMedia
      ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
      : true;

    function el(tag, cls?, text?) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }

    function parse(text) {
      var s = String(text == null ? '' : text);
      var out = [];
      var i = 0;
      var start = 0;
      while (i < s.length) {
        if (s[i] === '^' && s[i + 1] === '[') {
          var end = s.indexOf(']', i + 2);
          if (end < 0) {
            i += 2;
            continue;
          }
          if (i > start) out.push({ type: 'text', text: s.slice(start, i) });
          var inner = s.slice(i + 2, end);
          var display = null;
          var target = inner;
          var bar = target.indexOf('|');
          if (bar >= 0) {
            display = target.slice(0, bar).trim();
            target = target.slice(bar + 1);
          }
          var domain = null;
          var at = /^(.+)@([A-Za-z0-9_.-]+)$/.exec(target.trim());
          if (at) {
            target = at[1];
            domain = at[2];
          }
          out.push({
            type: 'ref',
            inner: inner,
            display: display,
            ref: target.trim(),
            domain: domain,
          });
          i = end + 1;
          start = i;
        } else {
          i++;
        }
      }
      if (start < s.length) out.push({ type: 'text', text: s.slice(start) });
      return out;
    }

    function splitId(id) {
      var cut = id.indexOf(':');
      return { domain: id.slice(0, cut), key: id.slice(cut + 1) };
    }

    function inDomain(name, domain) {
      var id = domain + ':' + name;
      return entries[id] == null ? null : { id: id, domain: domain, key: name, value: entries[id] };
    }

    function resolve(name, domain, context) {
      if (!name || name === '_' || name.charAt(0) === '@') return null;
      var alias = aliases[(context || '') + ':' + name] || aliases[name];
      if (alias && entries[alias] != null) {
        var parts = splitId(alias);
        return { id: alias, domain: parts.domain, key: parts.key, value: entries[alias] };
      }
      if (domain) return inDomain(name, domain);
      if (context) {
        var hit = inDomain(name, context);
        if (hit) return hit;
      }
      for (var d in domains) {
        var found = inDomain(name, d);
        if (found) return found;
      }
      return null;
    }

    function closeCards(from?: any) {
      var start = from ? cards.indexOf(from) : 0;
      if (start < 0) return;
      for (var i = start; i < cards.length; i++) cards[i].remove();
      cards = cards.slice(0, start);
      layer.hidden = cards.length === 0;
    }

    function place(card, anchor) {
      var r = anchor.getBoundingClientRect();
      var b = card.getBoundingClientRect();
      var left = r.left + 8;
      var top = r.bottom + 8;
      if (left + b.width > innerWidth - 12) left = r.right - b.width - 8;
      if (top + b.height > innerHeight - 12) top = r.top - b.height - 8;
      card.style.left = Math.max(12, left) + 'px';
      card.style.top = Math.max(12, top) + 'px';
    }

    function hoverText(value, domain, depth, parent) {
      var box = el('div');
      parse(value).forEach(function (tok) {
        if (tok.type === 'text') {
          box.append(document.createTextNode(tok.text));
          return;
        }
        var res = resolve(tok.ref, tok.domain, domain);
        var label = el('span', 'nt-ref', tok.display || tok.ref);
        label.style.setProperty('--hue', String((20 + depth * 30) % 360));
        if (!res) {
          label.classList.add('is-missing');
          box.append(label);
          return;
        }
        label.title = '^[' + tok.inner + ']';
        label.addEventListener('mouseenter', function () {
          showCard(res, label, parent);
        });
        label.addEventListener('mouseleave', function () {
          if (parent) parent.__closeTimer = setTimeout(function () {
            closeCards(parent);
          }, 200);
        });
        label.addEventListener('click', function (event) {
          if ((event.ctrlKey || event.metaKey) && pointerFine) {
            event.preventDefault();
            closeCards();
            openRoot(res.id);
          }
        });
        box.append(label);
      });
      return box;
    }

    function showCard(res, anchor, parent) {
      if (!pointerFine) return;
      if (anchor && anchor.getAttribute && anchor.getAttribute('aria-expanded') === 'true') return;
      if (parent) {
        clearTimeout(parent.__closeTimer);
        var existing = cards.indexOf(parent);
        if (existing >= 0) closeCards(cards[existing + 1]);
      }
      var card = el('div', 'export-hover');
      card.__anchor = anchor;
      var head = el('div');
      head.append(el('strong', 'export-hover-title', res.key));
      head.append(el('span', 'export-hover-domain', domains[res.domain] || res.domain));
      card.append(head);
      card.append(hoverText(res.value, res.domain, 1, card));
      layer.hidden = false;
      layer.append(card);
      cards.push(card);
      card.style.visibility = 'hidden';
      place(card, anchor);
      card.style.visibility = '';
      card.addEventListener('mouseenter', function () {
        clearTimeout(card.__closeTimer);
      });
      card.addEventListener('mouseleave', function () {
        card.__closeTimer = setTimeout(function () {
          closeCards(card);
        }, 220);
      });
    }

    function renderText(container, text, domain, depth, ancestors, prefix, inline) {
      String(text)
        .split(/\n+/)
        .filter(function (p) {
          return p.trim() !== '';
        })
        .forEach(function (paragraph) {
          var block = el(inline ? 'span' : 'div', 'nt-block' + (inline ? ' is-inline' : ''));
          var line = el('span', 'nt-line');
          var refIndex = 0;
          parse(paragraph).forEach(function (tok) {
            if (tok.type === 'text') {
              line.append(el('span', 'nt-text', tok.text));
              return;
            }
            var path = prefix ? prefix + '.' + refIndex : String(refIndex);
            refIndex++;
            line.append(renderRef(tok, path, domain, depth, ancestors));
          });
          block.append(line);
          container.append(block);
        });
    }

    function renderRef(tok, path, domain, depth, ancestors) {
      var wrap = el('span', 'nt-refwrap');
      wrap.style.setProperty('--hue', String((20 + depth * 30) % 360));
      var res = resolve(tok.ref, tok.domain, domain);
      var btn = el('button', 'nt-ref', tok.display || tok.ref);
      btn.type = 'button';
      btn.style.setProperty('--hue', String((20 + depth * 30) % 360));
      if (!res) {
        btn.classList.add('is-missing');
        btn.title = '找不到目標';
        wrap.append(btn);
        return wrap;
      }
      btn.title = '^[' + tok.inner + ']：點擊展開' + (pointerFine ? '；Ctrl/⌘+點擊開啟' : '');
      btn.setAttribute('aria-expanded', String(expanded.has(path)));
      btn.addEventListener('click', function (event) {
        if ((event.ctrlKey || event.metaKey) && pointerFine) {
          event.preventDefault();
          openRoot(res.id);
          return;
        }
        closeCards();
        if (expanded.has(path)) expanded.delete(path);
        else expanded.add(path);
        renderRoot();
      });
      btn.addEventListener('mouseenter', function () {
        showCard(res, btn, null);
      });
      btn.addEventListener('mouseleave', function () {
        if (!cards.length) return;
        var card = cards[cards.length - 1];
        card.__closeTimer = setTimeout(function () {
          closeCards(card);
        }, 260);
      });
      wrap.append(btn);

      if (expanded.has(path) && !ancestors.has(res.id) && depth < 6) {
        var nextAncestors = new Set(ancestors);
        nextAncestors.add(res.id);
        var exp = el('span', 'nt-exp-inline');
        exp.style.setProperty('--hue', String((20 + (depth + 1) * 30) % 360));
        renderText(exp, res.value, res.domain, depth + 1, nextAncestors, path, true);
        wrap.append(exp);
      } else if (expanded.has(path) && ancestors.has(res.id)) {
        wrap.append(el('span', 'nt-note', '↺ 循環'));
      } else if (expanded.has(path) && depth >= 6) {
        wrap.append(el('span', 'nt-note', '…已達深度上限'));
      }
      return wrap;
    }

    function openRoot(id) {
      current = id;
      expanded.clear();
      closeCards();
      renderRoot();
      window.scrollTo(0, 0);
    }

    function renderRoot() {
      var parts = splitId(current);
      app.textContent = '';
      var kicker = el('div', 'entry-kicker', domains[parts.domain] || parts.domain);
      var title = el('h1', 'entry-title', parts.key);
      app.append(kicker, title);
      var doc = el('div');
      renderText(doc, entries[current] || '', parts.domain, 0, new Set([current]), '', false);
      app.append(doc);
      document.title = parts.key + ' · 巢式文字';
    }

    if (layer) layer.addEventListener('mouseenter', function () {
      cards.forEach(function (card) {
        clearTimeout(card.__closeTimer);
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeCards();
    });
    renderRoot();
  }

  function buildExportHtml() {
    const payload = buildExportPayload();
    if (!payload) return '';
    const theme =
      document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');
    const start = payload.start;
    const cut = start.indexOf(':');
    const title = start.slice(cut + 1) + ' · ' + (payload.domains[start.slice(0, cut)] || '');
    const json = JSON.stringify(payload).replace(/</g, '\\u003c');
    return (
      '<!doctype html>\n<html lang="zh-Hant" data-theme="' +
      htmlEscape(theme) +
      '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      htmlEscape(title) +
      '</title>\n<style>' +
      EXPORT_CSS +
      '</style>\n</head>\n<body>\n<main id="app"></main><div id="hover-layer" class="export-hover-layer" hidden></div>\n<script>window.OFFTEXT_EXPORT=' +
      json +
      ';<\/script>\n<script>(' +
      exportRuntime.toString() +
      ')();<\/script>\n</body>\n</html>\n'
    );
  }

  function exportCurrentPage() {
    if (READONLY_ONLY) return;
    const html = buildExportHtml();
    if (!html) {
      showToast('目前條目沒有可匯出的內容');
      return;
    }
    const name =
      (state.root.domain + '-' + state.root.key)
        .replace(/[\\/:*?"<>|\s]+/g, '-')
        .slice(0, 80) + '.html';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已匯出 ' + name);
  }
