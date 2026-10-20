/* 路由與導覽
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 路由 ---------- */

  function readRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return null;

    if (h === 'index' || h.startsWith('index/')) {
      const raw = h.slice(6);
      if (!raw || raw === 'all') return { view: 'index', domain: null };
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch (e) {
        /* 保留原字串 */
      }
      id = canonicalDomainId(id);
      if (domains.some((d) => d.id === id)) return { view: 'index', domain: id };
      return { view: 'index', domain: null };
    }

    const parts = h.split('/').map((p) => {
      try {
        return decodeURIComponent(p);
      } catch (e) {
        return p;
      }
    });

    if (parts[0] === 'graph' && parts.length >= 3) {
      return { view: 'graph', domain: parts[1], key: parts.slice(2).join('/') };
    }

    if (parts.length >= 2) {
      return { view: 'entry', domain: parts[0], key: parts.slice(1).join('/') };
    }
    return { view: 'entry', domain: parts[0], key: '_' };
  }

  let routeApplied = false;

  function applyRoute() {
    if (!domains.length) return;
    let route = readRoute() || defaultRoute();
    if (!route) return;

    // 舊科目 id 換成新 id，網址也一併換掉。
    if ((route.view === 'entry' || route.view === 'graph') && route.domain) {
      const mapped = canonicalDomainId(route.domain);
      if (mapped !== route.domain) {
        route = { ...route, domain: mapped };
        const h =
          route.view === 'graph'
            ? '#/graph/' + encodeURIComponent(route.domain) + '/' + encodeURIComponent(route.key)
            : '#/' + encodeURIComponent(route.domain) + '/' + encodeURIComponent(route.key);
        if (location.hash !== h) {
          try {
            history.replaceState(null, '', h);
          } catch (e) {
            location.hash = h;
          }
        }
      }
      // @ 開頭的 key 是保留字，不展示也不編輯；回到該科入口。
      if (isReservedKey(route.key)) {
        route = { ...route, key: '_' };
        const h =
          route.view === 'graph'
            ? '#/graph/' + encodeURIComponent(route.domain) + '/_'
            : '#/' + encodeURIComponent(route.domain) + '/_';
        try {
          history.replaceState(null, '', h);
        } catch (e) {
          location.hash = h;
        }
      }
    } else if (route.view === 'index' && route.domain && route.domain !== 'all') {
      const h = '#/index/' + encodeURIComponent(route.domain);
      if (location.hash !== h) {
        try {
          history.replaceState(null, '', h);
        } catch (e) {
          location.hash = h;
        }
      }
    }

    // @ 轉址頁不是給人看的頁面：換成目標條目，網址也一併換掉。
    if (route.view === 'entry' || route.view === 'graph') {
      const canon = canonicalKey(route.domain, route.key);
      if (canon.domain !== route.domain || canon.key !== route.key) {
        route = { ...route, domain: canon.domain, key: canon.key };
        const h =
          route.view === 'graph'
            ? '#/graph/' + encodeURIComponent(route.domain) + '/' + encodeURIComponent(route.key)
            : '#/' + encodeURIComponent(route.domain) + '/' + encodeURIComponent(route.key);
        if (location.hash !== h) {
          try {
            history.replaceState(null, '', h);
          } catch (e) {
            location.hash = h;
          }
        }
      }
    }

    const changed =
      route.view !== state.view ||
      route.domain !== state.root.domain ||
      route.key !== state.root.key;
    if (routeApplied && changed) {
      state.expanded.clear();
      state.focusPath = null;
    }
    if (state.createKey && (route.view !== 'entry' || route.key !== state.createKey)) {
      state.createKey = null;
    }
    if (route.view !== 'entry') {
      state.focusEditorOnce = false;
      closeOrphanPanel();
      state.pendingInsert = null;
    }
    if (
      state.pendingInsert &&
      (route.view !== 'entry' ||
        route.domain !== state.pendingInsert.domain ||
        route.key !== state.pendingInsert.key)
    ) {
      state.pendingInsert = null;
    }
    if (
      state.pendingBacklink &&
      (route.view !== 'entry' ||
        route.domain !== state.pendingBacklink.targetDomain ||
        route.key !== state.pendingBacklink.targetKey)
    ) {
      state.pendingBacklink = null;
    }

    // 反鏈接只對「來源條目」有效；一旦路由離開它，就取消標記。
    if (
      state.backlink &&
      (route.view !== 'entry' ||
        route.domain !== state.backlink.sourceDomain ||
        route.key !== state.backlink.sourceKey)
    ) {
      state.backlink = null;
    }
    routeApplied = true;

    state.view = route.view;
    if (route.view === 'entry' || route.view === 'graph') {
      state.root = route;
    } else {
      // 索引頁的 domain 為 null 代表全部科目（#/index/all）。
      state.indexDomain = route.domain || null;
    }

    if (route.view === 'entry' && route.key !== '_') {
      recordRead(route.domain, route.key);
    }

    document.title =
      route.view === 'index'
        ? '索引 · ' +
          (state.indexDomain ? domainName(state.indexDomain) : '全部科目') +
          ' · 巢式文字'
        : route.view === 'graph'
          ? '圖譜 · ' + displayKey(route.domain, route.key) + ' · 巢式文字'
          : displayKey(route.domain, route.key) + ' · 巢式文字';

    render();
  }

  function navigate(domain, key, options) {
    const opts = options || {};
    domain = canonicalDomainId(domain);
    const canon = canonicalKey(domain, key);
    domain = canon.domain;
    key = canon.key;
    if (!opts.keepBacklink) state.backlink = null;
    const h = '#/' + encodeURIComponent(domain) + '/' + encodeURIComponent(key);
    state.expanded.clear();
    state.focusPath = null;
    window.scrollTo(0, 0);
    if (location.hash === h) {
      render();
    } else {
      location.hash = h;
    }
  }

  function navigateIndex(domain) {
    state.expanded.clear();
    state.focusPath = null;
    state.backlink = null;
    state.indexLimit = 120;

    let target = domain || 'all';
    if (target !== 'all') {
      target = canonicalDomainId(target);
      if (!domains.some((d) => d.id === target)) target = 'all';
    }

    const h = '#/index/' + encodeURIComponent(target);
    window.scrollTo(0, 0);
    if (location.hash === h) render();
    else location.hash = h;
  }

  function navigateGraph(domain, key, options) {
    const canon = canonicalKey(domain, key);
    const h = '#/graph/' + encodeURIComponent(canon.domain) + '/' + encodeURIComponent(canon.key);
    state.backlink = null;
    state.expanded.clear();
    state.focusPath = null;
    state.graph.focus = null;
    state.graph.recenter = !!(options && options.recenter);
    if (!state.graph.recenter) window.scrollTo(0, 0);
    if (location.hash === h) render();
    else location.hash = h;
  }

  function switchView(mode) {
    if (state.view === 'index') return;
    if (mode === 'graph' && state.view === 'graph') return;
    if (mode === 'text' && state.view === 'entry') return;
    const res = NT.resolve(state.index, state.root.key, state.root.domain);
    if (res.status !== 'ok') return;
    if (mode === 'graph') navigateGraph(res.domain, res.key);
    else navigate(res.domain, res.key);
  }
