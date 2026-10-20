/* 孤兒節點與缺目標
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 孤兒節點 ---------- */

  function computeOrphans(domainId) {
    const domain = state.index.byId.get(domainId);
    if (!domain) return [];
    const out = [];
    for (const [key, value] of domain.entries) {
      if (key === '_' || isReservedKey(key) || isRedirect(value)) continue;
      if (!state.index.links.incoming.has(domainId + ':' + key)) {
        out.push({ domain: domainId, key, value });
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key, 'zh-Hant'));
  }

  function computeDangling(domainIds) {
    const found = new Map();
    for (const domainId of domainIds) {
      const domain = state.index.byId.get(domainId);
      if (!domain) continue;
      for (const [key, value] of domain.entries) {
        if (key === '_' || isReservedKey(key) || isRedirect(value)) continue;
        for (const tok of NT.parse(value)) {
          if (tok.type !== 'ref') continue;
          const res = editorResolve(tok.ref, tok.domain, domainId);
          if (res.status === 'ok') continue;
          const targetDomain = tok.domain || domainId;
          const id = targetDomain + ':' + tok.ref;
          let item = found.get(id);
          if (!item) {
            item = { domain: targetDomain, key: tok.ref, sources: [] };
            found.set(id, item);
          }
          if (!item.sources.includes(key) && item.sources.length < 3) item.sources.push(key);
        }
      }
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh-Hant'));
  }

  function refreshOrphanPanel() {
    if (!orphanPanel) return;
    const body = orphanPanel.querySelector('.orphan-body');
    if (!body) return;
    const scopeAll = orphanPanel.dataset.scope === 'all';
    const scope = scopeAll ? domains.map((domain) => domain.id) : [state.root.domain];
    const orphans = [];
    for (const id of scope) orphans.push(...computeOrphans(id));
    const dangling = computeDangling(scope);
    const headCount = orphanPanel.querySelector('.orphan-count');
    if (headCount) {
      headCount.textContent = '孤兒 ' + orphans.length + ' · 缺目標 ' + dangling.length;
    }

    body.textContent = '';

    const orphanTitle = el('div', 'orphan-section-title', '沒有被任何條目引用（含首頁）');
    body.append(orphanTitle);
    if (!orphans.length) {
      body.append(el('div', 'orphan-empty', '這個範圍沒有孤兒條目。'));
    } else {
      for (const item of orphans) {
        const btn = el('button', 'orphan-item');
        btn.type = 'button';
        const head = el('span', 'orphan-item-head');
        head.append(el('span', 'orphan-item-key', disp(item.key)));
        if (scopeAll) head.append(el('span', 'orphan-item-domain', disp(domainName(item.domain))));
        btn.append(head);
        btn.append(el('span', 'orphan-item-preview', preview(item.value)));
        btn.title = '開啟並編輯「' + item.key + '」';
        btn.addEventListener('click', () => {
          closeOrphanPanel();
          openEntryForEdit(item.domain, item.key);
        });
        body.append(btn);
      }
    }

    const missingTitle = el(
      'div',
      'orphan-section-title',
      '缺目標引用（' + dangling.length + '）'
    );
    body.append(missingTitle);
    if (!dangling.length) {
      body.append(el('div', 'orphan-empty', '沒有找不到目標的引用。'));
    } else {
      for (const item of dangling) {
        const loaded = state.index.byId.has(item.domain);
        const btn = el('button', 'orphan-item is-missing');
        btn.type = 'button';
        const head = el('span', 'orphan-item-head');
        head.append(el('span', 'orphan-item-key', disp(item.key)));
        head.append(el('span', 'orphan-item-domain', loaded ? '建立' : '未載入'));
        btn.append(head);
        btn.append(
          el('span', 'orphan-item-preview', '來自：' + item.sources.map(disp).join('、'))
        );
        btn.disabled = !loaded;
        btn.title = loaded
          ? '建立「' + item.key + '」並開始編寫'
          : '目標科目尚未載入';
        if (loaded) {
          btn.addEventListener('click', () => {
            closeOrphanPanel();
            openNewEntry(item.domain, item.key);
          });
        }
        body.append(btn);
      }
    }
  }

  function closeOrphanPanel() {
    if (orphanPanel) orphanPanel.remove();
    orphanPanel = null;
  }

  function toggleOrphanPanel() {
    if (orphanPanel) {
      closeOrphanPanel();
      return;
    }
    const panel = el('section', 'orphan-panel');
    panel.setAttribute('aria-label', '孤兒節點');
    const head = el('header', 'orphan-head');
    head.append(el('strong', 'orphan-title', '孤兒節點'));
    head.append(el('span', 'orphan-count', ''));
    const allLabel = el('label', 'orphan-scope');
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.addEventListener('change', () => {
      panel.dataset.scope = all.checked ? 'all' : 'current';
      refreshOrphanPanel();
    });
    allLabel.append(all, document.createTextNode('全部科目'));
    head.append(allLabel);
    const close = el('button', 'orphan-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉孤兒節點');
    close.addEventListener('click', closeOrphanPanel);
    head.append(close);
    panel.append(head);
    const body = el('div', 'orphan-body');
    panel.append(body);
    document.body.append(panel);
    orphanPanel = panel;
    panel.dataset.scope = 'current';
    refreshOrphanPanel();
  }

  addTermBtn.addEventListener('click', () => {
    const selected = pendingSelection;
    hideAddTerm();
    if (!selected) return;
    if (selected.exists) openEntryForEdit(selected.domain, selected.key);
    else openNewEntry(selected.domain, selected.key);
  });

  reader.addEventListener('mousedown', hideAddTerm);
  reader.addEventListener('mouseup', () => setTimeout(captureSelection, 0));
  reader.addEventListener('keyup', () => setTimeout(captureSelection, 0));
  window.addEventListener('scroll', hideAddTerm, true);
  window.addEventListener('resize', hideAddTerm);
  document.addEventListener('click', (e) => {
    if (!addTermBtn.contains(e.target)) hideAddTerm();
  });

  /*
   * 鏈結、反鏈接都在 NT.buildIndex() 時算好（index.links）；
   * UI 只負責排序與呈現，不再掃描全部條目。
   */
  function nodeInfo(id) {
    const cut = id.indexOf(':');
    return { id, domain: id.slice(0, cut), key: id.slice(cut + 1) };
  }

  function graphDegree(id) {
    const links = state.index.links;
    return (links.forward.get(id) ? links.forward.get(id).size : 0) +
      (links.backward.get(id) ? links.backward.get(id).size : 0);
  }

  function graphCounts(id) {
    const links = state.index.links;
    return {
      forward: links.forward.get(id) ? links.forward.get(id).size : 0,
      back: links.backward.get(id) ? links.backward.get(id).size : 0,
    };
  }

  function backlinksFor(targetId) {
    return NT.backlinksFor(state.index, targetId);
  }

  function defaultRoute(): any {
    const first = domains.find((d) => d.entries.has('_')) || domains[0];
    if (!first) return null;
    return {
      view: 'entry',
      domain: first.id,
      key: first.entries.has('_') ? '_' : [...first.entries.keys()][0],
    };
  }
