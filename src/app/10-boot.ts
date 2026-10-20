/* 閱讀歷史、啟動頁、TSV 載入
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 閱讀歷史 ---------- */

  const READ_HISTORY_KEY = 'offtext.readHistory.v1';
  const READ_HISTORY_MAX = 15;

  function loadReadHistory() {
    try {
      const raw = localStorage.getItem(READ_HISTORY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list
        .filter(
          (item) =>
            item &&
            typeof item.domain === 'string' &&
            typeof item.key === 'string' &&
            item.key !== '_'
        )
        .slice(0, READ_HISTORY_MAX)
        .map((item) => {
          const domain = canonicalDomainId(item.domain);
          return {
            domain,
            key: item.key,
            name:
              domain === 'modern-chinese-history'
                ? '中國近代史'
                : typeof item.name === 'string'
                  ? item.name
                  : domain,
            at: Number(item.at) || 0,
          };
        });
    } catch (e) {
      return [];
    }
  }

  let readHistory = loadReadHistory();

  function saveReadHistory() {
    try {
      localStorage.setItem(READ_HISTORY_KEY, JSON.stringify(readHistory));
    } catch (e) {
      /* 無痕模式仍保留本次閱讀歷史 */
    }
  }

  function ago(ts) {
    if (!ts) return '';
    const minutes = Math.floor((Date.now() - ts) / 60000);
    if (minutes < 1) return '剛剛';
    if (minutes < 60) return minutes + ' 分鐘前';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小時前';
    return Math.floor(hours / 24) + ' 天前';
  }

  function recordRead(domain, key) {
    if (!domain || !key || key === '_') return;
    const item = { domain, key, name: domainName(domain), at: Date.now() };
    readHistory = [
      item,
      ...readHistory.filter((old) => !(old.domain === domain && old.key === key)),
    ].slice(0, READ_HISTORY_MAX);
    saveReadHistory();
  }

  function openHistoryTarget(domain, key) {
    const hit = NT.resolve(state.index, key, domain, null);
    if (hit.status === 'ok') {
      navigate(hit.domain, hit.key);
      return;
    }
    const loaded = state.index.byId.has(domain);
    showMissingTarget({ ref: key, display: key, domain: loaded ? null : domain }, domain, hit);
  }

  function renderReadHistory() {
    while (readHistorySelect.options.length > 1) readHistorySelect.remove(1);
    readHistory.forEach((item) => {
      const loaded = state.index.byId.get(item.domain);
      const exists = loaded && loaded.entries.has(item.key);
      const suffix = !loaded ? '（未載入）' : exists ? '' : '（找不到）';
      const option = document.createElement('option');
      option.value = item.domain + ':' + item.key;
      option.textContent =
        disp(item.key) + ' · ' + disp(item.name || domainName(item.domain)) + suffix;
      option.title =
        disp(item.key) +
        ' · ' +
        disp(item.name || domainName(item.domain)) +
        (ago(item.at) ? ' · ' + ago(item.at) : '');
      readHistorySelect.append(option);
    });
    readHistorySelect.disabled = readHistory.length === 0;
  }

  function initReadHistory() {
    renderReadHistory();
    readHistorySelect.addEventListener('change', () => {
      const id = readHistorySelect.value;
      readHistorySelect.value = '';
      if (!id) return;
      const cut = id.indexOf(':');
      if (cut < 0) return;
      openHistoryTarget(id.slice(0, cut), id.slice(cut + 1));
    });
  }

  function fillSubjectSelect() {
    subjectSelect.textContent = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部科目';
    subjectSelect.append(all);
    domains.forEach((domain) => {
      const option = document.createElement('option');
      option.value = domain.id;
      option.textContent = disp(domain.name || domain.id) + (dirtyDomains.has(domain.id) ? ' ●' : '');
      subjectSelect.append(option);
    });
  }

  /** 更新 toolbar 的未存檔提示與科目下拉的「●」。 */
  function updateDirtyUi() {
    const value = subjectSelect.value;
    fillSubjectSelect();
    subjectSelect.value = value;

    const dirty = [...dirtyDomains];
    dirtyBtn.hidden = dirty.length === 0;
    if (dirty.length) {
      const currentId =
        state.view === 'index' ? state.indexDomain : state.root.domain;
      dirtyBtn.textContent =
        currentId && dirtyDomains.has(currentId)
          ? '● ' + disp(domainName(currentId)) + ' 未存檔'
          : '● ' + dirty.length + ' 科未存檔';
      dirtyBtn.title =
        '未存檔：' +
        dirty.map((id) => disp(domainName(id))).join('、') +
        '；點一下儲存';
    }
    updateStats();
  }

  function markDirty(domainId) {
    if (!domainId) return;
    dirtyDomains.add(domainId);
    updateDirtyUi();
  }

  function clearDirty(domainId) {
    dirtyDomains.delete(domainId);
    updateDirtyUi();
  }

  /* ---------- 啟動頁的 TSV 清單 ---------- */

  function selectedCatalogItems() {
    const files = new Set(
      [...bootCatalogList.querySelectorAll('input[type="checkbox"]:checked')].map(
        (input) => input.value
      )
    );
    return TSV_MANIFEST.filter((item) => files.has(item.file));
  }

  function renderBootCatalog() {
    const fileMode = location.protocol === 'file:';
    bootOpen.hidden = !fileMode;
    bootOpenSelected.hidden = fileMode;
    bootCatalogCount.textContent = '';

    if (!TSV_MANIFEST.length || fileMode) {
      bootCatalog.hidden = true;
      bootCatalogList.textContent = '';
      if (!TSV_MANIFEST.length) bootOpenSelected.hidden = true;
      return;
    }

    bootCatalog.hidden = false;
    bootCatalogList.textContent = '';
    const groups = ['文科', '理科', '進階', '其他'];
    const byGroup = new Map(groups.map((g) => [g, []]));
    for (const item of TSV_MANIFEST) {
      const g = groups.includes(item.group) ? item.group : '其他';
      byGroup.get(g).push(item);
    }
    for (const group of groups) {
      const items = byGroup.get(group);
      if (!items.length) continue;
      const section = el('section', 'boot-group');
      section.dataset.group = group;
      const head = el('div', 'boot-group-head');
      head.append(el('strong', 'boot-group-name', group));
      head.append(el('span', 'boot-group-count', items.length + ' 科'));
      const controls = el('span', 'boot-group-actions');
      const all = el('button', 'boot-link', '全選');
      all.type = 'button';
      const none = el('button', 'boot-link', '全不選');
      none.type = 'button';
      all.addEventListener('click', () => {
        section.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = true;
        });
      });
      none.addEventListener('click', () => {
        section.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = false;
        });
      });
      controls.append(all, none);
      head.append(controls);
      section.append(head);
      const grid = el('div', 'boot-group-items');
      for (const item of items) {
        const label = el('label', 'boot-tsv' + (item.hidden ? ' is-hidden' : ''));
        label.title = item.file + '（' + item.id + '）';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = item.file;
        input.checked = true;
        label.append(
          input,
          el('span', 'boot-tsv-name', disp(item.name || item.id)),
          el('span', 'boot-tsv-id', item.id),
          el('span', 'boot-tsv-count', (item.count || 0) + ' 條')
        );
        grid.append(label);
      }
      section.append(grid);
      bootCatalogList.append(section);
    }
    bootCatalogCount.textContent = TSV_MANIFEST.length + ' 個科目';
    bootOpenSelected.textContent = '開啟選定的科目';
  }

  async function openSelectedCatalog() {
    if (location.protocol === 'file:') {
      openTsvFiles();
      return;
    }
    const items = selectedCatalogItems();
    if (!items.length) {
      bootStatus.textContent = '請至少勾選一個 TSV。';
      return;
    }
    bootOpenSelected.disabled = true;
    bootStatus.textContent = '讀取 TSV…';
    try {
      const loaded = await fetchDomainFiles(items);
      if (state.uiMode !== 'mobile') await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      bootStatus.textContent = '載入失敗：' + (e && e.message ? e.message : e);
    } finally {
      bootOpenSelected.disabled = false;
    }
  }

  function bootWithDomains(nextDomains, options?: any) {
    DATA = nextDomains;
    state.readOnly = false;
    dirtyDomains.clear();
    state.index = NT.buildIndex(DATA);
    domains.length = 0;
    domains.push(...state.index.order.filter((d) => !d.hidden));
    if (!domains.length) {
      bootStatus.textContent = '選取的檔案沒有可見科目。';
      DATA = null;
      state.index = NT.buildIndex([]);
      return;
    }
    rebuildSearchEntries();
    updateStats();
    fillSubjectSelect();
    updateDirtyUi();

    document.body.classList.remove('is-booting');
    boot.hidden = true;
    bootStatus.textContent = '';

    const requested = readRoute();
    if (
      !location.hash ||
      (requested &&
        requested.domain &&
        requested.domain !== 'all' &&
        !state.index.byId.has(requested.domain))
    ) {
      const route = defaultRoute();
      if (route) {
        history.replaceState(
          null,
          '',
          '#/' + encodeURIComponent(route.domain) + '/' + encodeURIComponent(route.key)
        );
      }
    }
    applyRoute();
  }

  async function openTsvFiles() {
    if (!window.showOpenFilePicker) {
      bootStatus.textContent = '此瀏覽器不支援檔案存取，請使用 Edge 或 Chrome。';
      return;
    }
    bootOpen.disabled = true;
    bootStatus.textContent = '讀取 TSV…';
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: '巢式文字 TSV',
            accept: { 'text/tab-separated-values': ['.tsv'], 'text/plain': ['.tsv'] },
          },
        ],
      });
      if (!handles || !handles.length) throw new Error('沒有選取檔案');

      const loaded = [];
      const ids = new Set();
      for (const handle of handles) {
        // 開檔只讀；編輯先存在記憶體，按「離開」時才要求 readwrite。
        const file = await handle.getFile();
        const parsed = parseDomainTsv(await file.text());
        if (!parsed) throw new Error(handle.name + ' 不是有效的 TSV');
        if (ids.has(parsed.id)) throw new Error('重複的科目 id：' + parsed.id);
        ids.add(parsed.id);
        fileHandles.set(parsed.id, {
          handle,
          domainId: parsed.id,
          name: handle.name,
          meta: parsed.meta,
        });
        loaded.push({
          id: parsed.id,
          name: parsed.name || parsed.id,
          hidden: !!parsed.hidden,
          entries: parsed.entries,
          meta: parsed.meta,
          file: handle.name,
        });
      }
      await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        bootStatus.textContent = '已取消。';
      } else {
        bootStatus.textContent = '開啟失敗：' + (e && e.message ? e.message : e);
      }
    } finally {
      bootOpen.disabled = false;
    }
  }

  /** 依 manifest 的檔案清單 fetch 多個 TSV；HTTP 模式用。 */
  async function fetchDomainFiles(items) {
    const bases = query.get('dataBase') ? [query.get('dataBase')] : ['data', '../data'];
    const loaded = [];
    const seen = new Set();
    for (const item of items) {
      const file = String(item.file || item.id + '.tsv');
      if (!/^[A-Za-z0-9._-]+\.tsv$/i.test(file)) throw new Error('檔名不合法：' + file);
      const expectedId = String(item.id || file.replace(/\.tsv$/i, ''));
      if (!/^[A-Za-z0-9_-]+$/.test(expectedId)) throw new Error('科目 id 不合法：' + expectedId);
      if (seen.has(expectedId)) throw new Error('重複的科目：' + expectedId);

      let text = null;
      for (const base of bases) {
        const prefix = base.endsWith('/') ? base : base + '/';
        const url = new URL(prefix + encodeURIComponent(file), location.href);
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) {
          text = await response.text();
          break;
        }
      }
      if (text === null) throw new Error('找不到 ' + file);

      const parsed = parseDomainTsv(text);
      if (!parsed) throw new Error(file + ' 不是有效的 TSV');
      if (parsed.id !== expectedId) {
        throw new Error(file + ' 的 id 是「' + parsed.id + '」，預期「' + expectedId + '」');
      }
      seen.add(parsed.id);
      loaded.push({
        id: parsed.id,
        name: parsed.name || parsed.id,
        hidden: !!parsed.hidden,
        entries: parsed.entries,
        meta: parsed.meta,
        file,
      });
    }
    return loaded;
  }

  /** data-index.txt：HTTP(S) 模式決定要載入哪些 TSV；file:// 不讀這個檔。 */
  function parseDataIndex(text) {
    const files = [];
    const seen = new Set();
    for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      for (const token of line.split(/[\s,]+/)) {
        let file = token.trim().replace(/^\.\//, '');
        if (!file) continue;
        if (!/\.tsv$/i.test(file)) file += '.tsv';
        if (!/^[A-Za-z0-9._-]+\.tsv$/i.test(file)) {
          throw new Error('data-index.txt 檔名不合法：' + token);
        }
        if (seen.has(file)) continue;
        seen.add(file);
        files.push(file);
      }
    }
    return files;
  }

  async function fetchDataIndexItems() {
    const bases = query.get('dataBase') ? [query.get('dataBase')] : ['data', '../data'];
    for (const base of bases) {
      const prefix = base.endsWith('/') ? base : base + '/';
      const url = new URL(prefix + 'data-index.txt', location.href);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const files = parseDataIndex(await response.text());
      if (!files.length) throw new Error('data-index.txt 沒有列出任何 TSV');
      const known = new Map(TSV_MANIFEST.map((item) => [item.file, item]));
      return files.map((file) => {
        const hit = known.get(file);
        return { file, id: hit ? hit.id : file.replace(/\.tsv$/i, '') };
      });
    }
    return null;
  }

  async function bootFromDataIndex() {
    document.body.classList.add('is-booting');
    boot.hidden = false;
    bootCatalog.hidden = true;
    bootOpenSelected.hidden = true;
    bootOpen.hidden = true;
    bootStatus.textContent = '讀取 data-index.txt…';
    try {
      let items = await fetchDataIndexItems();
      if (!items) {
        // 舊部署或漏檔時退回 manifest 的全部科目，至少不會卡在空白畫面。
        if (!TSV_MANIFEST.length) throw new Error('找不到 data-index.txt');
        items = TSV_MANIFEST.map((item) => ({ id: item.id, file: item.file }));
      }
      bootStatus.textContent = '載入 ' + items.length + ' 個科目…';
      const loaded = await fetchDomainFiles(items);
      if (state.uiMode !== 'mobile') await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      // 自動載入失敗才顯示科目清單，讓使用者手動選。
      bootStatus.textContent = '自動載入失敗：' + (e && e.message ? e.message : e);
      bootOpenSelected.hidden = false;
      renderBootCatalog();
    }
  }

  async function bootFromCatalog(items) {
    const loaded = await fetchDomainFiles(items);
    if (state.uiMode !== 'mobile') await ensureCM();
    bootWithDomains(loaded);
  }

  async function bootFromUrl(ids) {
    bootOpen.disabled = true;
    bootStatus.textContent = '從 URL 載入：' + ids.join('、') + '…';
    try {
      await bootFromCatalog(
        ids.map((rawId) => {
          const id = canonicalDomainId(rawId.replace(/\.tsv$/i, '').trim());
          return { id, file: id + '.tsv' };
        })
      );
      if (!boot.hidden) return;
      showToast('已由 URL 載入：' + ids.join('、'));
    } catch (e) {
      bootStatus.textContent = 'URL 載入失敗：' + (e && e.message ? e.message : e);
    } finally {
      bootOpen.disabled = false;
    }
  }

  bootOpen.addEventListener('click', openTsvFiles);
  bootOpenSelected.addEventListener('click', openSelectedCatalog);
