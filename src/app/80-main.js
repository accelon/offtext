/* 初始化與事件接線
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 初始化 ---------- */

  const legend = $('#legendRow');
  for (let depth = 0; depth <= NT.MAX_DEPTH; depth++) {
    const chip = el('span', 'chip');
    chip.style.setProperty('--h', String(NT.hue(depth)));
    legend.append(chip);
  }

  /* ---------- 設置 ---------- */

  function handleSettingsChange(kind) {
    if (kind === 'font') {
      if (entryController) entryController.refresh();
      return;
    }
    if (kind !== 'sim') return;
    // 顯示模式換了，搜尋索引也要換成對應的簡體形式；畫面重繪。
    // 簡體顯示時不允許編輯（選到的字不是 TSV 原文）。
    hideAddTerm();
    if (SETTINGS && SETTINGS.simModeOf() !== 0 && state.editing) {
      state.editing = false;
      document.body.classList.remove('is-editing-entry');
      closeOrphanPanel();
    }
    rebuildSearchEntries();
    updateStats();
    updateSaveUi();
    if (!document.body.classList.contains('is-booting')) render();
  }

  if (SETTINGS) SETTINGS.init({ onChange: handleSettingsChange });

  function paintUiMode() {
    const buttons = [...document.querySelectorAll('#uiSeg button')];
    buttons.forEach((button) => {
      const active = button.dataset.ui === state.uiMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = FORCED_MOBILE && button.dataset.ui === 'desktop';
    });
    const hint = $('#uiHint');
    if (hint) {
      hint.textContent = FORCED_MOBILE
        ? '此裝置是手機／平板，固定使用簡化介面，不能切回桌面模式。'
        : '手機模式不載入 CodeMirror、不顯示編輯功能，啟動時直接載入全部科目。';
    }
  }

  function setUiMode(mode) {
    if (FORCED_MOBILE || (mode !== 'desktop' && mode !== 'mobile')) return;
    if (mode === state.uiMode) return;
    try {
      localStorage.setItem(UI_KEY, mode);
    } catch (e) {
      /* 私密模式 */
    }
    try {
      const url = new URL(location.href);
      url.searchParams.delete('ui');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* 忽略 */
    }
    location.reload();
  }

  document.querySelectorAll('#uiSeg button').forEach((button) => {
    button.addEventListener('click', () => setUiMode(button.dataset.ui));
  });
  paintUiMode();

  fillSubjectSelect();
  initReadHistory();

  subjectSelect.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    if (id === 'all') {
      navigateIndex();
      return;
    }
    if (state.view === 'index') {
      navigateIndex(id);
      return;
    }
    const domain = state.index.byId.get(id);
    const firstKey = domain && domain.entries.size ? [...domain.entries.keys()][0] : '_';
    navigate(id, domain && domain.entries.has('_') ? '_' : firstKey);
  });

  const initialMode = query.get('mode');
  if (initialMode === 'inline' || initialMode === 'block') state.mode = initialMode;

  const initialDepth = Number(query.get('depth'));
  if (initialDepth >= 1 && initialDepth <= 3) state.graph.depth = initialDepth;
  if (query.get('forward') === '0') state.graph.forward = false;
  if (query.get('back') === '0') state.graph.backward = false;
  const initialFont = Number(query.get('font'));
  if (initialFont >= 12 && initialFont <= 24) state.graph.fontSize = initialFont;
  const initialEdge = query.get('edge');
  if (initialEdge === 'short' || initialEdge === 'medium' || initialEdge === 'long') {
    state.graph.edgeLength = initialEdge;
  }
  const initialEdgeWidth = query.get('edgeWidth');
  if (['thin', 'medium', 'thick'].includes(initialEdgeWidth)) {
    state.graph.edgeWidth = initialEdgeWidth;
  }


  // ?expand=0,0.2 可預先展開，方便截圖與除錯。
  const expand = query.get('expand');
  if (expand) {
    expand
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => state.expanded.add(p));
  }

  // ?focus=0.2 可指定焦點（通常搭配 ?expand 使用）。
  const initialFocus = query.get('focus');
  if (initialFocus) state.focusPath = initialFocus.trim();

  searchInput.addEventListener('input', renderSearch);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) renderSearch();
  });

  // ?q=gpu 可直接開啟搜尋結果（展示、除錯用）
  const initialQuery = query.get('q');
  if (initialQuery) {
    searchInput.value = initialQuery;
    renderSearch();
  }

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      hideSearch();
      searchInput.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSearchFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSearchFocus(-1);
    } else if (e.key === 'Enter' && searchHits.length) {
      e.preventDefault();
      const first = searchResults.querySelector('.search-item');
      if (first) first.click();
    }
  });

  searchResults.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSearchFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSearchFocus(-1);
    } else if (e.key === 'Escape') {
      searchInput.focus();
      hideSearch();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) hideSearch();
  });

  $('#homeBtn').addEventListener('click', () => {
    const route = defaultRoute();
    if (route) navigate(route.domain, '_');
  });

  $('#indexBtn').addEventListener('click', () => navigateIndex());
  dirtyBtn.addEventListener('click', () => {
    if (drafts.size) {
      saveDrafts();
      return;
    }
    showDirtyDialog({ leave: false });
  });
  leaveBtn.addEventListener('click', leaveSystem);

  window.addEventListener('beforeunload', (event) => {
    if (!dirtyDomains.size && !drafts.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  viewToggle.addEventListener('click', () =>
    switchView(state.view === 'graph' ? 'text' : 'graph')
  );
  editBtn.addEventListener('click', () => setEditing(!state.editing));
  saveBtn.addEventListener('click', () => {
    saveDrafts();
  });
  orphanBtn.addEventListener('click', toggleOrphanPanel);
  exportBtn.addEventListener('click', exportCurrentPage);

  document.addEventListener('keydown', (e) => {
    if (SETTINGS && SETTINGS.isOpen()) return;
    const active = document.activeElement;
    const typing =
      /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) ||
      active.isContentEditable ||
      !!active.closest('.cm-editor');
    if (e.key === 'Escape' && orphanPanel) {
      e.preventDefault();
      closeOrphanPanel();
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      const indexSearch = state.view === 'index' ? $('#indexSearch') : null;
      (indexSearch || searchInput).focus();
      return;
    }
    if (
      !typing &&
      !e.repeat &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === 'g'
    ) {
      e.preventDefault();
      if (state.view === 'entry') switchView('graph');
      else if (state.view === 'graph') switchView('text');
    }
  });

  window.addEventListener('hashchange', applyRoute);

  let graphResizeTimer = 0;
  window.addEventListener('resize', () => {
    if (state.view !== 'graph') return;
    clearTimeout(graphResizeTimer);
    graphResizeTimer = setTimeout(() => render(), 160);
  });

  renderBootCatalog();

  // 自動測試用；只有 ?test=1 才暴露，不影響一般使用。
  if (query.get('test') === '1') {
    window.__offtextTest = {
      openNewEntry,
      openEntryForEdit,
      setEditing,
      saveDrafts,
      state,
      drafts: () => [...drafts.values()],
      validateDrafts,
      buildExportHtml,
    };
  }

  const dataParam = query.get('data');

  if (dataParam && /^https?:$/.test(location.protocol)) {
    const ids = dataParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length) bootFromUrl(ids);
    else {
      bootStatus.textContent = '?data= 沒有指定科目。';
    }
  } else if (dataParam) {
    bootStatus.textContent = 'file:// 不支援 fetch；請用「選擇本機 TSV…」開啟。';
  } else if (DATA) {
    // 單一 HTML 匯出檔（或測試注入）自帶資料，直接進主畫面。
    if (state.uiMode === 'mobile') bootWithDomains(DATA);
    else ensureCM().then(() => bootWithDomains(DATA));
  } else if (location.protocol === 'file:') {
    // 只有 file:// 才停在選檔頁；HTTP(S) 讀 data-index.txt 直接載入。
    document.body.classList.add('is-booting');
    boot.hidden = false;
    bootStatus.textContent = '';
  } else {
    bootFromDataIndex();
  }
