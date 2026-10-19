/*
 * 巢式文字：解析與查表核心。
 * 瀏覽器掛在 window.NT，Node 則 module.exports，方便測試。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NT = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HUE_BASE = 20; // 深度 0：暖色起點
  const HUE_STEP = 30; // 每深一層 +30°，由暖色漸變到冷色
  const MAX_DEPTH = 6; // 展開深度上限
  const MAX_HOPS = 16; // 別名鏈上限
  const INLINE_LIMIT = 200; // 這個字數以內的 value 在點擊處展開
  const WEIGHT_DEPTH = 6; // 間接引用最多算到六跳（1/32 以下已很小）
  const WEIGHT_DECAY = 0.5; // 每多一跳，權重除以 2

  function hue(depth) {
    return (HUE_BASE + depth * HUE_STEP) % 360;
  }

  /* ---------- 解析 ---------- */

  // offtext → [{type:'text', text} | {type:'ref', ...}]
  // 只認 ^[...]；其他 ^ 一律視為普通文字（2＾8 用的是全形 ＾，天然安全）。
  function parse(text) {
    const s = String(text == null ? '' : text);
    const tokens = [];
    let i = 0;
    let start = 0;

    while (i < s.length) {
      if (s[i] === '^' && s[i + 1] === '[') {
        const end = s.indexOf(']', i + 2);
        if (end === -1) {
          i += 2;
          continue;
        }
        if (i > start) tokens.push({ type: 'text', text: s.slice(start, i) });
        tokens.push(parseRef(s.slice(i + 2, end)));
        i = end + 1;
        start = i;
      } else {
        i++;
      }
    }
    if (start < s.length) tokens.push({ type: 'text', text: s.slice(start) });
    return tokens;
  }

  function parseRef(inner) {
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
      type: 'ref',
      raw: inner,
      display: display || null,
      ref: target.trim(),
      domain,
    };
  }

  function plainText(text) {
    return parse(text)
      .map((t) => (t.type === 'text' ? t.text : t.display || t.ref))
      .join('');
  }

  /* ---------- 資料表 ---------- */

  function buildIndex(domains) {
    const byId = new Map();
    const all = [];

    (domains || []).forEach((d) => {
      const rec = {
        id: d.id,
        name: d.name || d.id,
        hidden: !!d.hidden,
        entries: new Map(Object.entries(d.entries || {})),
      };
      byId.set(d.id, rec);
      all.push(rec);
    });

    // 可見的內容 domain 優先，hidden 的別名 domain 殿後。
    const order = all.filter((d) => !d.hidden).concat(all.filter((d) => d.hidden));
    const index = { order, byId };
    // 鏈結與全科目節點排行都在同一次建索引時算好，UI 不必再掃一次。
    index.links = buildLinks(index);
    index.weights = buildWeights(index);
    index.rankings = buildRankings(index);
    return index;
  }

  function lookup(index, name, domain, contextDomain) {
    if (!name) return null;
    if (String(name).startsWith('@')) return null;

    if (domain) {
      const d = index.byId.get(domain);
      if (!d || !d.entries.has(name)) return null;
      return { domain: d.id, key: name, value: d.entries.get(name) };
    }

    if (name === '_') return null; // _ 是 domain 首頁，不參與一般引用

    const hitIn = (d) =>
      d && d.entries.has(name) ? { domain: d.id, key: name, value: d.entries.get(name) } : null;

    // 1. 先看目前閱讀的 domain，同名詞在本科優先。
    if (contextDomain) {
      const hit = hitIn(index.byId.get(contextDomain));
      if (hit) return hit;
    }

    // 2. 再看 hidden 的別名層，中文顯示名才能轉址到真正的 key。
    for (const d of index.order) {
      if (!d.hidden) continue;
      const hit = hitIn(d);
      if (hit) return hit;
    }

    // 3. 最後才是其他內容 domain。
    for (const d of index.order) {
      if (d.hidden) continue;
      const hit = hitIn(d);
      if (hit) return hit;
    }

    return null;
  }

  function parseAliasTarget(value) {
    let s = String(value).trim().replace(/^@/, '').trim();
    if (!s) return null;
    const m = /^([A-Za-z0-9_.-]+)[:/](.+)$/.exec(s);
    if (m) return { domain: m[1], name: m[2].trim() };
    return { name: s, domain: null };
  }

  /*
   * 解析引用：key →（可選 domain）→ 若值是 @xxx 就轉址，直到拿到真正的 offtext。
   * 回傳 status: ok | missing | alias-loop
   */
  function resolve(index, name, domain, contextDomain) {
    const chain = [];
    const seen = new Set();
    let curName = String(name == null ? '' : name).trim();
    let curDomain = domain || null;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const hit = lookup(index, curName, curDomain, contextDomain);
      if (!hit) return { status: 'missing', name: curName, domain: curDomain, chain };

      const id = hit.domain + ':' + hit.key;
      chain.push(id);
      if (seen.has(id)) {
        return { status: 'alias-loop', name: curName, key: hit.key, domain: hit.domain, chain };
      }
      seen.add(id);

      const value = typeof hit.value === 'string' ? hit.value : '';
      if (value.trim().charAt(0) === '@') {
        const target = parseAliasTarget(value);
        if (!target) {
          return { status: 'ok', key: hit.key, domain: hit.domain, value: '', chain };
        }
        curName = target.name;
        curDomain = target.domain;
        continue;
      }

      return { status: 'ok', key: hit.key, domain: hit.domain, value, chain };
    }

    return { status: 'alias-loop', name: curName, domain: curDomain, chain };
  }

  /*
   * 鏈結索引：
   * forward  = 條目 value 裡的順鏈結（首頁也可以往外連）
   * backward = 反過來引用它的條目（首頁不列入，避免六個首頁塞滿反鏈接）
   * backlinks = backward 的去重版本，附上每個來源的引用次數
   *
   * 只處理可見 domain；hidden 的別名層只參與 resolve，不當成鏈結來源。
   */
  function addToSet(map, from, to) {
    let set = map.get(from);
    if (!set) {
      set = new Set();
      map.set(from, set);
    }
    set.add(to);
  }

  function addBacklink(map, targetId, sourceDomain, sourceKey) {
    let sources = map.get(targetId);
    if (!sources) {
      sources = new Map();
      map.set(targetId, sources);
    }
    const sourceId = sourceDomain + ':' + sourceKey;
    const found = sources.get(sourceId);
    if (found) found.count++;
    else sources.set(sourceId, { domain: sourceDomain, key: sourceKey, count: 1 });
  }

  function buildLinks(index) {
    const forward = new Map();
    const backward = new Map();
    const backlinks = new Map();
    const incoming = new Set();

    for (const domain of index.order) {
      if (domain.hidden) continue;
      for (const [key, value] of domain.entries) {
        if (String(key).startsWith('@')) continue;
        const sourceId = domain.id + ':' + key;
        for (const token of parse(value)) {
          if (token.type !== 'ref') continue;
          const hit = resolve(index, token.ref, token.domain, domain.id);
          if (hit.status !== 'ok') continue;
          const targetId = hit.domain + ':' + hit.key;
          if (targetId === sourceId) continue;

          addToSet(forward, sourceId, targetId);
          incoming.add(targetId);
          if (key !== '_') {
            addToSet(backward, targetId, sourceId);
            addBacklink(backlinks, targetId, domain.id, key);
          }
        }
      }
    }

    return { forward, backward, backlinks, incoming };
  }

  function backlinksFor(index, targetId) {
    const sources = index.links && index.links.backlinks.get(targetId);
    if (!sources) return [];
    const visible = index.order.filter((d) => !d.hidden);
    const rank = new Map(visible.map((d, i) => [d.id, i]));
    const targetDomain = targetId.split(':')[0];
    return [...sources.values()].sort((a, b) => {
      const aSame = a.domain === targetDomain ? 0 : 1;
      const bSame = b.domain === targetDomain ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      const order = (rank.get(a.domain) || 0) - (rank.get(b.domain) || 0);
      if (order) return order;
      return a.key.localeCompare(b.key, 'zh-Hant');
    });
  }

  /* ---------- 加權知識網路 ---------- */

  function isContentEntry(key, value) {
    return (
      key !== '_' &&
      !String(key).startsWith('@') &&
      String(value == null ? '' : value).trim().charAt(0) !== '@'
    );
  }

  /*
   * 衰減 BFS：直接引用 1、間接 0.5、二跳 0.25，依此類推。
   * 同一個節點只取「最短距離」一次，避免環路或重複路徑把分數灌大。
   */
  function weightWalk(start, adjacency) {
    const seen = new Set([start]);
    let frontier = [start];
    let total = 0;
    let weight = 1;

    for (let depth = 1; depth <= WEIGHT_DEPTH; depth++) {
      const next = [];
      for (const id of frontier) {
        const targets = adjacency.get(id);
        if (!targets) continue;
        for (const target of targets) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
          total += weight;
        }
      }
      if (!next.length) break;
      frontier = next;
      weight *= WEIGHT_DECAY;
    }
    return total;
  }

  function buildWeights(index) {
    const forward = new Map();
    const backward = new Map();
    const hub = new Map();
    const normalized = new Map();
    const max = new Map();

    for (const domain of index.order) {
      if (domain.hidden) continue;
      const ids = [];
      for (const [key, value] of domain.entries) {
        if (!isContentEntry(key, value)) continue;
        const id = domain.id + ':' + key;
        const f = weightWalk(id, index.links.forward);
        const b = weightWalk(id, index.links.backward);
        forward.set(id, f);
        backward.set(id, b);
        hub.set(id, f * b);
        ids.push(id);
      }

      const domainMax = {
        forward: Math.max(0, ...ids.map((id) => forward.get(id) || 0)),
        backward: Math.max(0, ...ids.map((id) => backward.get(id) || 0)),
        hub: Math.max(0, ...ids.map((id) => hub.get(id) || 0)),
      };
      max.set(domain.id, domainMax);
      for (const id of ids) {
        normalized.set(id, {
          forward: domainMax.forward ? forward.get(id) / domainMax.forward : 0,
          backward: domainMax.backward ? backward.get(id) / domainMax.backward : 0,
          hub: domainMax.hub ? hub.get(id) / domainMax.hub : 0,
        });
      }
    }

    return { depth: WEIGHT_DEPTH, decay: WEIGHT_DECAY, forward, backward, hub, normalized, max };
  }

  /*
   * DAG 健檢：把每個科目合起來看成有向圖，節點是內容條目。
   * 先找強連通分量（環），再把分量縮成 DAG，依「離基礎概念多遠」分層。
   * 正常的邊應該由高層指向低層；指向同層或上層就是「用高階概念定義基本概念」。
   */
  function buildDag(index) {
    const nodes = new Map();
    for (const domain of index.order) {
      if (domain.hidden) continue;
      for (const [key, value] of domain.entries) {
        if (!isContentEntry(key, value)) continue;
        const id = domain.id + ':' + key;
        nodes.set(id, { id, domain: domain.id, key });
      }
    }

    const out = new Map([...nodes.keys()].map((id) => [id, new Set()]));
    const edges = [];
    for (const id of nodes.keys()) {
      for (const target of index.links.forward.get(id) || []) {
        if (!nodes.has(target) || target === id) continue;
        out.get(id).add(target);
        edges.push({ from: id, to: target });
      }
    }

    // Tarjan SCC
    const orderOf = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const rawComponents = [];
    let counter = 0;

    function strongconnect(v) {
      orderOf.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);

      for (const w of out.get(v) || []) {
        if (!orderOf.has(w)) {
          strongconnect(w);
          low.set(v, Math.min(low.get(v), low.get(w)));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), orderOf.get(w)));
        }
      }

      if (low.get(v) === orderOf.get(v)) {
        const component = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        rawComponents.push(component);
      }
    }

    for (const id of nodes.keys()) {
      if (!orderOf.has(id)) strongconnect(id);
    }

    const componentOf = new Map();
    rawComponents.forEach((component, i) => {
      for (const id of component) componentOf.set(id, i);
    });

    const compOut = rawComponents.map(() => new Set());
    for (const edge of edges) {
      const a = componentOf.get(edge.from);
      const b = componentOf.get(edge.to);
      if (a !== b) compOut[a].add(b);
    }

    const layers = new Array(rawComponents.length).fill(0);
    const layerMemo = new Map();
    function layerOfComponent(c) {
      if (layerMemo.has(c)) return layerMemo.get(c);
      let deepest = -1;
      for (const next of compOut[c]) {
        if (next !== c) deepest = Math.max(deepest, layerOfComponent(next));
      }
      const layer = deepest + 1;
      layerMemo.set(c, layer);
      return layer;
    }
    rawComponents.forEach((_, i) => {
      layers[i] = layerOfComponent(i);
    });

    const components = rawComponents.map((ids, i) => ({
      id: i,
      ids,
      size: ids.length,
      layer: layers[i],
    }));
    const cycles = components.filter((component) => component.size > 1);

    /*
     * 分層只能保證「邊由高層指向低層」；它無法判斷高層是不是真的比低層抽象。
     * 這裡另用「基礎度」＝逆鏈權重／(順鏈＋逆鏈) 找反向的定義：
     * 基礎度高的條目去定義基礎度低的條目，通常就是把因果或從屬方向寫反了。
     */
    const weights = index.weights || { forward: new Map(), backward: new Map() };
    const basicity = new Map();
    for (const id of nodes.keys()) {
      const f = weights.forward.get(id) || 0;
      const b = weights.backward.get(id) || 0;
      basicity.set(id, f + b ? b / (f + b) : 0);
    }
    const inversions = [];
    for (const edge of edges) {
      const delta = basicity.get(edge.from) - basicity.get(edge.to);
      if (delta > 0.15) {
        inversions.push({
          from: edge.from,
          to: edge.to,
          fromBasicity: basicity.get(edge.from),
          toBasicity: basicity.get(edge.to),
          delta,
        });
      }
    }
    inversions.sort((a, b) => b.delta - a.delta);

    return {
      nodes,
      edges,
      components,
      componentOf,
      layers,
      cycles,
      inversions,
      layerOf: (id) => {
        const c = componentOf.get(id);
        return c == null ? null : layers[c];
      },
    };
  }

  /*
   * 單一科目的節點排行：
   * important = 順鏈多、core = 逆鏈多、hub = 順鏈 × 逆鏈（兩邊都多才會高）。
   * key 是 domain id；每個科目各自排名，不混在一起。
   */
  function buildRankings(index, limit) {
    const top = limit || 12;
    const rankings = new Map();
    const visible = index.order.filter((d) => !d.hidden);
    const weights = index.weights;

    for (const domain of visible) {
      const rows = [];
      for (const [key, value] of domain.entries) {
        if (!isContentEntry(key, value)) continue;
        const id = domain.id + ':' + key;
        const forward = index.links.forward.get(id) ? index.links.forward.get(id).size : 0;
        const back = index.links.backward.get(id) ? index.links.backward.get(id).size : 0;
        const forwardWeight = weights.forward.get(id) || 0;
        const backWeight = weights.backward.get(id) || 0;
        const norm = weights.normalized.get(id) || { forward: 0, backward: 0, hub: 0 };
        rows.push({
          id,
          domain: domain.id,
          key,
          forward,
          back,
          forwardWeight,
          backWeight,
          hub: forwardWeight * backWeight,
          norm,
        });
      }

      const ranked = (metric) =>
        rows
          .slice()
          .sort(
            (a, b) =>
              b[metric] - a[metric] ||
              b.forwardWeight + b.backWeight - (a.forwardWeight + a.backWeight) ||
              a.key.localeCompare(b.key, 'zh-Hant')
          )
          .slice(0, top);

      rankings.set(domain.id, {
        important: ranked('forwardWeight'),
        core: ranked('backWeight'),
        hub: ranked('hub'),
      });
    }

    return rankings;
  }

  /*
   * 展開形式：200 字（含）以內在點擊處內嵌，超過才放到段落之後。
   * 可由 UI 強制切成 inline / block 對照。
   */
  function chooseMode(value, setting) {
    if (setting === 'inline' || setting === 'block') return setting;
    return plainText(value).trim().length <= INLINE_LIMIT ? 'inline' : 'block';
  }

  function suggest(index, name, limit) {
    const n = String(name || '').trim();
    if (!n) return [];
    const out = [];
    for (const d of index.order) {
      if (d.hidden) continue;
      for (const [key, value] of d.entries) {
        if (key === '_' || String(key).startsWith('@')) continue;
        if (String(value).trim().startsWith('@')) continue; // 轉址頁不是可引用的條目
        if (key.includes(n) || n.includes(key)) out.push(key);
        if (out.length >= (limit || 3)) return out;
      }
    }
    return out;
  }

  return {
    HUE_BASE,
    HUE_STEP,
    MAX_DEPTH,
    INLINE_LIMIT,
    WEIGHT_DEPTH,
    WEIGHT_DECAY,
    hue,
    parse,
    plainText,
    buildIndex,
    buildLinks,
    buildWeights,
    buildDag,
    buildRankings,
    backlinksFor,
    lookup,
    resolve,
    chooseMode,
    suggest,
  };
});
