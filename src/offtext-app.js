/* GENERATED FILE — 由 src/tools/build-app.mjs 串接 src/app/*.js。
 * 不要直接改這個檔；改 src/app/ 後重跑 npm run build:app。
 */
(function () {
'use strict';

/* ---- 00-core.js ---- */
/* 共用狀態、設定、網域與小工具
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  const NT = window.NT;
  const SETTINGS = window.OfftextSettings || null;
  const READONLY_ONLY = !!window.OFFTEXT_READONLY_ONLY;

  if (!NT) {
    document.getElementById('reader').textContent = '載入失敗：找不到 nestedtext-core.js。';
    return;
  }

  /** 畫面顯示用：套用設定頁的繁簡三態；沒有設定模組就原樣。 */
  function disp(text) {
    return SETTINGS ? SETTINGS.display(text) : String(text == null ? '' : text);
  }

  let DATA = window.OFFTEXT_DOMAINS || null;

  const state = {
    index: NT.buildIndex(DATA || []),
    mode: 'auto',
    expanded: new Set(),
    focusPath: null,
    backlink: null,
    view: 'entry',
    indexDomain: null,
    indexQuery: '',
    indexView: 'all',
    indexSort: 'product',
    indexLimit: 120,
    uiMode: 'desktop',
    readOnly: false,
    editing: false,
    createKey: null,
    pendingEdit: false,
    pendingInsert: null,
    pendingBacklink: null,
    focusEditorOnce: false,
    graph: {
      depth: 2,
      forward: true,
      backward: true,
      fontSize: 12,
      edgeLength: 'medium',
      edgeWidth: 'medium',
      focus: null,
      recenter: false,
    },
    root: { domain: null, key: '_' },
  };

  const query = new URLSearchParams(location.search);

  const UI_KEY = 'offtext.ui.v1';
  function detectUiMode() {
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const touch = coarse || (navigator.maxTouchPoints || 0) > 0;
    const mobileUa = /Mobi|Android|iPhone|iPad|Tablet|HarmonyOS/i.test(navigator.userAgent || '');
    const phoneLike = touch && (mobileUa || window.innerWidth <= 1024);
    let stored = '';
    try {
      stored = localStorage.getItem(UI_KEY) || '';
    } catch (e) {
      /* 私密模式 */
    }
    const requested = query.get('ui');
    // ?edit=1 是要編輯：本機桌面若曾把介面存成 mobile，也先切回桌面，
    // 否則手機介面會隱藏編輯按鈕、自動載入全部科目。
    const wantsEdit = query.get('edit') === '1' && !READONLY_ONLY;
    const mode = phoneLike
      ? 'mobile'
      : requested === 'mobile'
        ? 'mobile'
        : requested === 'desktop' || wantsEdit
          ? 'desktop'
          : stored === 'mobile'
            ? 'mobile'
            : 'desktop';
    return { mode, forced: phoneLike };
  }
  const uiMode = detectUiMode();
  const FORCED_MOBILE = uiMode.forced;
  state.uiMode = uiMode.mode;

  const $ = (sel) => document.querySelector(sel);
  const reader = $('#reader');
  const subjectSelect = $('#subject');
  const viewToggle = $('#viewToggle');
  const readHistorySelect = $('#readHistory');
  const boot = $('#boot');
  const bootOpen = $('#bootOpen');
  const bootStatus = $('#bootStatus');
  const bootCatalog = $('#bootCatalog');
  const bootCatalogList = $('#bootCatalogList');
  const bootCatalogCount = $('#bootCatalogCount');
  const bootOpenSelected = $('#bootOpenSelected');
  const dirtyBtn = $('#dirtyBtn');
  const leaveBtn = $('#leaveBtn');
  const editBtn = $('#editBtn');
  const saveBtn = $('#saveBtn');
  const orphanBtn = $('#orphanBtn');
  const exportBtn = $('#exportBtn');

  const TSV_MANIFEST = Array.isArray(window.OFFTEXT_TSV_MANIFEST)
    ? window.OFFTEXT_TSV_MANIFEST
    : [];

  document.body.classList.toggle('is-mobile-ui', state.uiMode === 'mobile');
  document.body.classList.toggle('is-readonly-online', READONLY_ONLY);

  // 舊網址／舊書籤仍可用；資料檔本身已改成 kebab-case。
  const DOMAIN_ALIASES = new Map([
    ['ancientchina', 'ancient-china'],
    ['worldhistory', 'world-history'],
    ['history', 'modern-chinese-history'],
  ]);

  function canonicalDomainId(id) {
    return DOMAIN_ALIASES.get(id) || id;
  }

  // 只存在記憶體、尚未寫回 TSV 的科目。
  const dirtyDomains = new Set();

  /*
   * 編輯中的草稿：domain:key → {domain,key,value,base,seq}。
   * 打字只更新這裡，不重建索引；按「存檔」才 commit + 檢查 + 重建。
   */
  const drafts = new Map();
  let draftSeq = 0;
  let entryController = null;
  let orphanPanel = null;

  const domains = state.index.order.filter((d) => !d.hidden);

  function domainName(id) {
    const domain = state.index.byId.get(id);
    return domain ? domain.name || domain.id : id;
  }

  function displayKey(domain, key) {
    return key === '_' ? domainName(domain) : key;
  }

  function isReservedKey(key) {
    return !key || String(key).startsWith('@');
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function preview(value) {
    const raw = String(value == null ? '' : value).trim();
    if (raw.startsWith('@')) {
      return disp('→ ' + raw.slice(1).trim().replace(/^[A-Za-z0-9_.-]+:/, ''));
    }
    const text = disp(NT.plainText(raw.replace(/\s+/g, ' ').trim()));
    return text.length > 46 ? text.slice(0, 46) + '…' : text;
  }

  // @ 轉址頁只給系統查表用：不進索引、搜尋或編輯器。
  function isRedirect(value) {
    return String(value == null ? '' : value).trim().startsWith('@');
  }

  function redirectTarget(value) {
    const s = String(value || '').trim().replace(/^@/, '').trim();
    const m = /^([A-Za-z0-9_.-]+)[:/](.+)$/.exec(s);
    return m ? { domain: m[1], key: m[2].trim() } : { domain: null, key: s };
  }

  // 把轉址頁的 key 換成它真正指向的條目。
  function canonicalKey(domain, key) {
    domain = canonicalDomainId(domain);
    if (!state.index || !key || key === '_') return { domain, key };
    const res = NT.resolve(state.index, key, domain);
    if (res.status !== 'ok') return { domain, key };
    return { domain: res.domain, key: res.key };
  }

  const entries = [];

  function rebuildSearchEntries() {
    entries.length = 0;
    domains.forEach((domain) => {
      for (const [key, value] of domain.entries) {
        if (key === '_' || isReservedKey(key) || isRedirect(value)) continue;
        const plain = NT.plainText(value);
        const forms = SETTINGS ? SETTINGS.searchForms(key + ' ' + plain) : [key + ' ' + plain];
        entries.push({
          domain: domain.id,
          domainName: domain.name || domain.id,
          key,
          keyForms: (SETTINGS ? SETTINGS.searchForms(key) : [key]).map((form) =>
            form.toLowerCase()
          ),
          preview: preview(value),
          hay: forms.join(' ').toLowerCase(),
        });
      }
    });
  }

  function updateStats() {
    $('#stats').textContent =
      entries.length +
      ' 條 · ' +
      domains.length +
      ' 個分類' +
      (drafts.size ? ' · 未套用 ' + drafts.size : '') +
      (dirtyDomains.size ? ' · 未存檔 ' + dirtyDomains.size + ' 科' : '');
  }

  function rebuildAllIndex() {
    state.index = NT.buildIndex(DATA);
    domains.length = 0;
    domains.push(...state.index.order.filter((d) => !d.hidden));
    rebuildSearchEntries();
    updateStats();
  }

  rebuildSearchEntries();
  updateStats();

/* ---- 10-boot.js ---- */
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

  function bootWithDomains(nextDomains, options) {
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

/* ---- 20-edit-legacy.js ---- */
/* 舊 textarea 編輯器與建議標記
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 編輯與建議標記 ---------- */

  const addTermBtn = el('button', 'add-term-btn', '＋ 新增詞目');
  addTermBtn.type = 'button';
  addTermBtn.hidden = true;
  document.body.append(addTermBtn);

  let pendingSelection = null;
  let editOverlay = null;
  let recoOverlay = null;
  let loadOverlay = null;
  let dirtyOverlay = null;
  let toastEl = null;
  const fileHandles = new Map(); // domainId -> { handle, name, meta }

  function dataDomain(domainId) {
    return Array.isArray(DATA) ? DATA.find((domain) => domain.id === domainId) : null;
  }

  function setDomainEntry(domainId, key, value) {
    const domain = dataDomain(domainId);
    if (!domain) return;
    if (!domain.entries) domain.entries = {};
    domain.entries[key] = value;
  }

  function parseDomainTsv(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
    let meta = null;
    let metaLine = '';
    const entries = {};
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!metaLine && /^\s*\{.*\}\s*$/.test(line)) {
        metaLine = line;
        const id = /id\s*:\s*"([^"]*)"/.exec(line);
        const name = /name\s*:\s*"([^"]*)"/.exec(line);
        const hidden = /hidden\s*:\s*"?([a-z]+)"?/.exec(line);
        meta = {
          id: id ? id[1] : '',
          name: name ? name[1] : '',
          hidden: hidden ? hidden[1] === 'true' : false,
        };
        continue;
      }
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const key = line.slice(0, tab).trim();
      if (key) entries[key] = line.slice(tab + 1);
    }
    if (!meta || !meta.id) return null;
    return { id: meta.id, name: meta.name, hidden: meta.hidden, meta: metaLine, entries };
  }

  function serializeDomain(domainId) {
    const domain = dataDomain(domainId);
    if (!domain) return '';
    const session = fileHandles.get(domainId);
    const meta =
      domain.meta ||
      (session && session.meta) ||
      `{id:"${domain.id}",name:"${domain.name || domain.id}"}`;
    const body = Object.entries(domain.entries || {})
      .map(([key, value]) => key + '\t' + String(value).replace(/\r?\n/g, ' '))
      .join('\n');
    return meta + '\n' + body + '\n';
  }

  async function saveFileSession(domainId) {
    const session = fileHandles.get(domainId);
    if (!session) throw new Error('尚未開啟該科 TSV');
    let permission = await session.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      permission = await session.handle.requestPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted') throw new Error('沒有寫入權限');
    const writable = await session.handle.createWritable();
    await writable.write(serializeDomain(domainId));
    await writable.close();
  }

  async function saveViaServer(domainId, text) {
    const domain = dataDomain(domainId);
    const file = domain.file || domain.id + '.tsv';
    let response;
    try {
      response = await fetch('/api/tsv/' + encodeURIComponent(file), {
        method: 'POST',
        headers: { 'content-type': 'text/tab-separated-values; charset=utf-8' },
        body: text,
      });
    } catch (e) {
      const err = new Error('無法連線到儲存伺服器');
      err.fallback = true;
      throw err;
    }
    if (response.ok) return;
    let detail = '';
    try {
      const body = await response.json();
      detail = body && body.error ? String(body.error) : '';
    } catch (e) {
      /* 不是 JSON */
    }
    if (response.status === 404 || response.status === 405) {
      const err = new Error('此 HTTP 伺服器沒有儲存 API');
      err.fallback = true;
      throw err;
    }
    throw new Error(detail || 'HTTP 儲存失敗（' + response.status + '）');
  }

  async function saveViaPicker(domainId, text) {
    if (!window.showSaveFilePicker) {
      throw new Error('此瀏覽器不支援另存檔案；請用 Edge 或 Chrome 的 HTTP／file 模式');
    }
    const domain = dataDomain(domainId);
    const handle = await window.showSaveFilePicker({
      suggestedName: domain.file || domain.id + '.tsv',
      types: [
        {
          description: '巢式文字 TSV',
          accept: { 'text/tab-separated-values': ['.tsv'], 'text/plain': ['.tsv'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    fileHandles.set(domainId, {
      handle,
      domainId,
      name: handle.name,
      meta: domain.meta,
    });
    domain.file = handle.name;
  }

  /**
   * 儲存一科：有檔案 handle 就用 handle（此時才要求寫入權限）；
   * HTTP 模式先走 dev server 的 POST，沒有 API 才退回「另存新檔」。
   */
  async function saveDomain(domainId) {
    const domain = dataDomain(domainId);
    if (!domain) throw new Error('找不到科目：' + domainId);
    const text = serializeDomain(domainId);
    if (fileHandles.has(domainId)) {
      await saveFileSession(domainId);
      return;
    }
    if (/^https?:$/.test(location.protocol)) {
      try {
        await saveViaServer(domainId, text);
        return;
      } catch (e) {
        if (!e || !e.fallback) throw e;
      }
    }
    await saveViaPicker(domainId, text);
  }

  function closeLoadMore() {
    if (loadOverlay) loadOverlay.remove();
    loadOverlay = null;
  }

  function addLoadedDomains(loaded) {
    let added = 0;
    for (const domain of loaded) {
      if (DATA.some((item) => item.id === domain.id)) continue;
      DATA.push(domain);
      added++;
    }
    if (!added) return 0;
    state.index = NT.buildIndex(DATA);
    domains.length = 0;
    domains.push(...state.index.order.filter((d) => !d.hidden));
    rebuildSearchEntries();
    updateStats();
    fillSubjectSelect();
    return added;
  }

  async function pickMoreTsVs() {
    if (!window.showOpenFilePicker) throw new Error('此瀏覽器不支援檔案存取');
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: '巢式文字 TSV',
          accept: { 'text/tab-separated-values': ['.tsv'], 'text/plain': ['.tsv'] },
        },
      ],
    });
    const loaded = [];
    const skipped = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      const parsed = parseDomainTsv(await file.text());
      if (!parsed) throw new Error(handle.name + ' 不是有效的 TSV');
      if (DATA.some((domain) => domain.id === parsed.id)) {
        skipped.push(parsed.id);
        continue;
      }
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
    return { loaded, skipped };
  }

  function showMissingTarget(tok, contextDomain, res) {
    closeLoadMore();
    const backdrop = el('div', 'edit-backdrop');
    const panel = el('section', 'edit-panel load-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', '需要其他科目'));
    titles.append(el('h2', 'edit-title', '找不到「' + disp(tok.display || tok.ref) + '」'));
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.addEventListener('click', closeLoadMore);
    head.append(close);
    panel.append(head);

    const loadedNames =
      domains.map((domain) => disp(domain.name || domain.id)).join('、') || '（無）';
    const targetHint = tok.domain
      ? '這個引用指定了 @' + tok.domain + '，但該科尚未載入。'
      : '這個詞目不在目前已載入的科目。';
    panel.append(
      el(
        'p',
        'edit-note',
        targetHint + '目前已載入：' + loadedNames + '。要開啟其他 TSV 嗎？'
      )
    );

    const status = el('p', 'load-status', '');
    const actions = el('div', 'edit-actions');
    const cancel = el('button', 'edit-secondary', '稍後');
    cancel.type = 'button';
    cancel.addEventListener('click', closeLoadMore);
    const open = el('button', 'edit-primary', '選擇其他 TSV…');
    open.type = 'button';
    open.addEventListener('click', async () => {
      open.disabled = true;
      status.textContent = '讀取 TSV…';
      try {
        const result = await pickMoreTsVs();
        const added = addLoadedDomains(result.loaded);
        if (!added) {
          status.textContent =
            result.skipped.length > 0
              ? '這些科目已經載入：' + result.skipped.join('、')
              : '沒有加入新科目。';
          return;
        }
        closeLoadMore();
        const hit = NT.resolve(state.index, tok.ref, tok.domain, contextDomain);
        if (hit.status === 'ok') {
          navigate(hit.domain, hit.key);
        } else {
          render();
          showToast('已加入新科目，但仍找不到「' + disp(tok.ref) + '」');
        }
      } catch (e) {
        status.textContent = '開啟失敗：' + (e && e.message ? e.message : e);
      } finally {
        open.disabled = false;
      }
    });
    actions.append(cancel, open);
    panel.append(status, actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    loadOverlay = backdrop;
  }

  function ensureEditAccess(domainId, onReady) {
    // 編輯不再先要寫入權限：先改記憶體、標記未存檔；按「離開」時才存檔。
    if (!dataDomain(domainId)) return;
    onReady();
  }

  function showToast(text) {
    if (!toastEl) {
      toastEl = el('div', 'edit-toast');
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  function hideAddTerm() {
    addTermBtn.hidden = true;
    pendingSelection = null;
  }

  function captureSelection() {
    if (state.view !== 'entry') {
      hideAddTerm();
      return;
    }
    // 簡體顯示時，選取到的字已經不是 TSV 裡的原文；新增／編輯會寫錯 key。
    // 先請使用者切回「保持原樣」，避免汙染資料。
    if (SETTINGS && SETTINGS.simModeOf() !== 0) {
      hideAddTerm();
      return;
    }

    let text = '';
    let rect = null;
    let domainId = state.root.domain;
    const info = entryController ? entryController.getSelectionInfo() : null;

    if (info) {
      text = String(info.text || '').replace(/\s+/g, ' ').trim();
      rect = info.rect;
      if (info.domain && state.index.byId.has(info.domain)) domainId = info.domain;
    } else {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hideAddTerm();
        return;
      }
      const range = selection.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const element = common.nodeType === 1 ? common : common.parentElement;
      if (!element || !reader.contains(element)) {
        hideAddTerm();
        return;
      }
      if (element.closest('.nt-ref, .nt-exp, .entry-head, .graph, .cm-editor')) {
        hideAddTerm();
        return;
      }
      text = selection.toString().replace(/\s+/g, ' ').trim();
      rect = range.getBoundingClientRect();
    }

    if (!text) {
      hideAddTerm();
      return;
    }
    if (/[\[\]\n\t@|]/.test(text)) {
      hideAddTerm();
      return;
    }
    if ([...text].length > 16) {
      hideAddTerm();
      showToast('條目名稱最多 16 個字（目前 ' + [...text].length + ' 個字）');
      return;
    }
    if (!rect || (!rect.width && !rect.height)) {
      hideAddTerm();
      return;
    }

    const loaded = state.index.byId.get(domainId);
    const exists = !!(loaded && loaded.entries.has(text)) || !!draftFor(domainId, text);
    pendingSelection = { domain: domainId, key: text, exists };
    addTermBtn.textContent = exists ? '編輯詞目' : '＋ 新增詞目';
    addTermBtn.hidden = false;
    addTermBtn.style.left =
      Math.max(10, Math.min(window.innerWidth - 130, rect.left + rect.width / 2 - 60)) + 'px';
    addTermBtn.style.top = Math.min(window.innerHeight - 44, rect.bottom + 8) + 'px';
  }

  function insertAtCursor(area, text) {
    const start = typeof area.selectionStart === 'number' ? area.selectionStart : area.value.length;
    const end = typeof area.selectionEnd === 'number' ? area.selectionEnd : start;
    area.setRangeText(text, start, end, 'end');
    area.focus();
  }

  function closeEditor() {
    if (editOverlay) editOverlay.remove();
    editOverlay = null;
  }

  function closeDirtyDialog() {
    if (dirtyOverlay) dirtyOverlay.remove();
    dirtyOverlay = null;
  }

  function resetToBoot() {
    closeEditor();
    closeRecommendations();
    closeLoadMore();
    closeDirtyDialog();
    closeCheckDialog();
    closeOrphanPanel();
    if (entryController) {
      entryController.destroy();
      entryController = null;
    }
    hideAddTerm();
    hideGraphTip();

    drafts.clear();
    draftSeq = 0;
    lastDraftCount = 0;
    state.editing = false;
    state.createKey = null;
    state.pendingEdit = false;
    state.focusEditorOnce = false;
    document.body.classList.remove('is-editing-entry');
    dirtyDomains.clear();
    fileHandles.clear();
    DATA = null;
    state.index = NT.buildIndex([]);
    state.mode = 'auto';
    state.expanded.clear();
    state.focusPath = null;
    state.backlink = null;
    state.view = 'entry';
    state.indexDomain = null;
    state.readOnly = false;
    state.root = { domain: null, key: '_' };
    state.graph = {
      depth: 2,
      forward: true,
      backward: true,
      fontSize: 12,
      edgeLength: 'medium',
      edgeWidth: 'medium',
      focus: null,
      recenter: false,
    };
    domains.length = 0;
    routeApplied = false;

    reader.textContent = '';
    boot.hidden = false;
    bootStatus.textContent = '';
    bootOpen.disabled = false;
    bootOpenSelected.disabled = false;
    document.body.classList.add('is-booting');
    history.replaceState(null, '', location.pathname + location.search);

    subjectSelect.value = '';
    fillSubjectSelect();
    rebuildSearchEntries();
    updateStats();
    updateDirtyUi();
    updateSaveUi();
    updateOrphanButton();
    renderBootCatalog();
  }

  function leaveSystem() {
    if (drafts.size) {
      const count = drafts.size;
      if (
        !window.confirm(
          '有 ' +
            count +
            ' 個條目尚未套用。\n按「確定」先存檔再離開；按「取消」留下繼續編輯。'
        )
      ) {
        return;
      }
      saveDrafts().then((ok) => {
        if (!ok) return;
        if (dirtyDomains.size) showDirtyDialog({ leave: true });
        else resetToBoot();
      });
      return;
    }
    if (!dirtyDomains.size) {
      resetToBoot();
      return;
    }
    showDirtyDialog({ leave: true });
  }

  /**
   * 未存檔／離開視窗：列出 dirty 科目，儲存時才呼叫 saveDomain（權限也在那時要）。
   */
  function showDirtyDialog(options) {
    const leave = !!(options && options.leave);
    closeRecommendations();
    const ids = [...dirtyDomains];
    if (!ids.length) {
      if (leave) resetToBoot();
      return;
    }
    closeDirtyDialog();

    const backdrop = el('div', 'edit-backdrop');
    const panel = el('section', 'edit-panel leave-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', leave ? '離開系統' : '未存檔'));
    titles.append(el('h2', 'edit-title', leave ? '儲存後離開' : '儲存未存檔的科目'));
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', closeDirtyDialog);
    head.append(close);
    panel.append(head);

    panel.append(
      el(
        'p',
        'dirty-note',
        leave
          ? '下列科目有未存檔的變更。按「儲存並離開」時才會要求寫入權限。直接關閉分頁時瀏覽器只會警告，不會儲存。'
          : '下列科目有未存檔的變更。儲存時才會要求寫入權限。'
      )
    );

    const list = el('div', 'dirty-list');
    const rows = [];
    ids.forEach((id) => {
      const domain = state.index.byId.get(id);
      const session = fileHandles.get(id);
      const item = el('label', 'dirty-item');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = id;
      const name = el('span', 'dirty-name', disp(domainName(id)));
      const file = el(
        'span',
        'dirty-file',
        session ? session.name : domain && domain.file ? domain.file : id + '.tsv'
      );
      const status = el('span', 'dirty-status', '未存檔');
      item.append(input, name, file, status);
      list.append(item);
      rows.push({ id, input, status });
    });
    panel.append(list);

    const actions = el('div', 'edit-actions');
    const cancel = el('button', 'edit-secondary', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', closeDirtyDialog);

    let noSave = null;
    if (leave) {
      noSave = el('button', 'edit-secondary', '不儲存離開');
      noSave.type = 'button';
      noSave.addEventListener('click', () => {
        if (!window.confirm('有 ' + dirtyDomains.size + ' 科未存檔，確定不儲存就離開？')) return;
        resetToBoot();
      });
    }

    const save = el('button', 'edit-primary', leave ? '儲存並離開' : '儲存全部');
    save.type = 'button';

    async function saveSelected() {
      const selected = rows.filter((row) => row.input.checked);
      if (!selected.length) {
        showToast('請至少勾選一個科目');
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      if (noSave) noSave.disabled = true;
      let failed = 0;
      for (const row of selected) {
        row.status.className = 'dirty-status';
        row.status.textContent = '儲存中…';
        try {
          await saveDomain(row.id);
          clearDirty(row.id);
          row.status.classList.add('is-ok');
          row.status.textContent = '已儲存';
        } catch (e) {
          failed++;
          row.status.classList.add('is-error');
          row.status.textContent =
            '失敗：' + (e && e.name === 'AbortError' ? '已取消' : e && e.message ? e.message : e);
        }
      }
      save.disabled = false;
      cancel.disabled = false;
      if (noSave) noSave.disabled = false;
      if (failed) {
        showToast('有 ' + failed + ' 科儲存失敗；可再試一次，或選擇不儲存離開');
        return;
      }
      if (leave && dirtyDomains.size) {
        showToast('還有 ' + dirtyDomains.size + ' 科未勾選；請勾選後再離開');
        return;
      }
      closeDirtyDialog();
      if (leave) resetToBoot();
      else {
        showToast('已儲存 ' + selected.length + ' 科');
        render();
      }
    }

    save.addEventListener('click', saveSelected);
    actions.append(cancel);
    if (noSave) actions.append(noSave);
    actions.append(save);
    const actionWrap = el('div', 'dirty-actions');
    actionWrap.append(actions);
    panel.append(actionWrap);

    backdrop.append(panel);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeDirtyDialog();
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDirtyDialog();
    });
    document.body.append(backdrop);
    dirtyOverlay = backdrop;
    save.focus();
  }

  function openEditor(domainId, key, isNew) {
    closeEditor();
    const domain = dataDomain(domainId);
    if (!domain) return;
    const existing = domain.entries[key];
    if (existing !== undefined && isRedirect(existing)) {
      const target = redirectTarget(existing);
      showToast('這是系統維護的對照頁，不能直接編輯');
      navigate(target.domain || domainId, target.key);
      return;
    }
    const created = existing === undefined;
    const backdrop = el('div', 'edit-backdrop');
    const panel = el('section', 'edit-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', created ? '新增詞目' : '編輯詞目'));
    titles.append(el('h2', 'edit-title', key));
    const session = fileHandles.get(domainId);
    if (session) {
      titles.append(el('div', 'edit-file', session.name + ' · 離開時儲存'));
    } else {
      titles.append(el('div', 'edit-file', '記憶體編輯 · 離開時儲存'));
    }
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉編輯器');
    close.addEventListener('click', closeEditor);
    head.append(close);
    panel.append(head);

    const body = el('div', 'edit-body');
    const side = el('aside', 'edit-side');
    side.append(el('div', 'edit-side-title', '插入名詞'));
    const filter = document.createElement('input');
    filter.className = 'edit-filter';
    filter.type = 'search';
    filter.placeholder = '過濾名詞或內文…';
    side.append(filter);
    const list = el('div', 'edit-list');
    side.append(list);

    const main = el('div', 'edit-main');
    const area = document.createElement('textarea');
    area.className = 'edit-textarea';
    area.value = existing || '';
    area.placeholder = '輸入釋文；左邊可快速插入名詞…';
    main.append(area);
    const note = el(
      'p',
      'edit-note',
      '儲存會先存在記憶體，toolbar 會標示「未存檔」；按「離開」時才要求寫入權限並寫回 TSV。'
    );
    main.append(note);

    const actions = el('div', 'edit-actions');
    const cancel = el('button', 'edit-secondary', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', closeEditor);
    const save = el('button', 'edit-primary', '存入記憶體並找可標記處');
    save.type = 'button';
    actions.append(cancel, save);
    main.append(actions);

    body.append(side, main);
    panel.append(body);
    backdrop.append(panel);
    document.body.append(backdrop);
    editOverlay = backdrop;

    const source = Object.entries(domain.entries).filter(
      ([k, v]) => k !== '_' && k !== key && !isRedirect(v)
    );
    function drawList() {
      const needle = filter.value.trim().toLowerCase();
      list.textContent = '';
      let count = 0;
      for (const [k, v] of source) {
        const plain = k + ' ' + NT.plainText(v);
        const forms = SETTINGS ? SETTINGS.searchForms(plain) : [plain];
        if (needle && !forms.join(' ').toLowerCase().includes(needle)) continue;
        const item = el('button', 'edit-noun');
        item.type = 'button';
        item.append(el('span', 'edit-noun-key', k));
        item.append(el('span', 'edit-noun-preview', preview(v)));
        item.addEventListener('click', () => insertAtCursor(area, '^[' + k + ']'));
        list.append(item);
        if (++count >= 100) break;
      }
      if (!count) list.append(el('div', 'edit-empty', '沒有符合的名詞'));
    }
    filter.addEventListener('input', drawList);
    drawList();

    async function commit() {
      const value = area.value.replace(/\r?\n/g, ' ').trim();
      if (!value) {
        area.focus();
        showToast('釋文不能是空的');
        return;
      }
      if (isRedirect(value)) {
        area.focus();
        showToast('@ 開頭是系統維護的對照頁，請直接編輯目標條目');
        return;
      }
      save.disabled = true;
      setDomainEntry(domainId, key, value);
      markDirty(domainId);
      save.disabled = false;
      rebuildAllIndex();
      closeEditor();
      navigate(domainId, key);
      showToast('已存入記憶體；按「離開」時再儲存');
    }

    save.addEventListener('click', commit);
    area.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditor();
    });
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function findUnlinkedMentions(domainId, key) {
    const domain = dataDomain(domainId);
    if (!domain) return [];
    const groups = [];
    for (const [fromKey, value] of Object.entries(domain.entries || {})) {
      if (fromKey === key || isReservedKey(fromKey)) continue;
      if (isRedirect(value)) continue;
      const hits = [];
      let i = 0;
      while (i < value.length) {
        if (value[i] === '^' && value[i + 1] === '[') {
          const end = value.indexOf(']', i + 2);
          i = end === -1 ? i + 2 : end + 1;
          continue;
        }
        if (value.startsWith(key, i)) {
          hits.push(i);
          i += key.length;
        } else {
          i++;
        }
      }
      if (hits.length) {
        groups.push({
          fromKey,
          value,
          hits,
          contexts: hits.slice(0, 3).map((start) =>
            value.slice(Math.max(0, start - 16), start + key.length + 16).replace(/\s+/g, ' ')
          ),
        });
      }
    }
    return groups;
  }

  function closeRecommendations() {
    if (recoOverlay) recoOverlay.remove();
    recoOverlay = null;
  }

  function showInTextSearch(domainId, key) {
    if (READONLY_ONLY || dirtyOverlay) return;
    const groups = findUnlinkedMentions(domainId, key);
    if (!groups.length) {
      showToast('本科其他內文沒有找到「' + key + '」的可標記處');
      return;
    }

    const backdrop = el('div', 'edit-backdrop reco-backdrop');
    const panel = el('section', 'edit-panel reco-panel');
    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', '文內搜尋'));
    titles.append(el('h2', 'edit-title', '在「' + disp(key) + '」的反鏈接區'));
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.addEventListener('click', closeRecommendations);
    head.append(close);
    panel.append(head);

    panel.append(
      el(
        'p',
        'edit-note',
        '本科有 ' +
          groups.length +
          ' 個條目提到「' +
          disp(key) +
          '」但尚未加連結。點「前往」會跳到該條目，並在該處補上 ^[' +
          key +
          ']；系統標記旁有「取消」。'
      )
    );

    const list = el('div', 'reco-list');
    groups.forEach((group) => {
      const row = el('div', 'reco-item');
      const text = el('span', 'reco-text');
      const title = el(
        'span',
        'reco-source',
        group.fromKey === '_' ? disp(domainName(domainId)) : disp(group.fromKey)
      );
      const contexts = el(
        'span',
        'reco-context',
        group.contexts.join(' ／ ') + (group.hits.length > 3 ? ' …' : '')
      );
      text.append(title, contexts);
      const go = el('button', 'reco-go', '前往');
      go.type = 'button';
      go.title = '跳到「' + group.fromKey + '」並插入 ^[' + key + ']';
      go.addEventListener('click', () => {
        closeRecommendations();
        state.pendingInsert = {
          domain: domainId,
          key: group.fromKey,
          targetKey: key,
          hitIndex: 0,
        };
        openEntryForEdit(domainId, group.fromKey);
      });
      row.append(text, go);
      list.append(row);
    });
    panel.append(list);

    const actions = el('div', 'edit-actions');
    const done = el('button', 'edit-secondary', '關閉');
    done.type = 'button';
    done.addEventListener('click', closeRecommendations);
    actions.append(done);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    recoOverlay = backdrop;
  }

/* ---- 21-edit-cm.js ---- */
/* CodeMirror 編輯、草稿、存檔
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- CodeMirror 內嵌編輯 ---------- */

  let CM = window.OfftextCM || null;
  let cmLoading = null;

  function ensureCM() {
    if (state.uiMode === 'mobile') return Promise.resolve(null);
    if (CM) return Promise.resolve(CM);
    if (cmLoading) return cmLoading;
    cmLoading = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'offtext-cm.js';
      script.onload = () => {
        CM = window.OfftextCM || null;
        resolve(CM);
      };
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    return cmLoading;
  }
  let lastDraftCount = -1;
  let saveBusy = false;
  let checkOverlay = null;

  function draftId(domain, key) {
    return domain + ':' + key;
  }

  function baseValue(domain, key) {
    const data = dataDomain(domain);
    if (!data || !data.entries) return undefined;
    return data.entries[key];
  }

  function draftFor(domain, key) {
    return drafts.get(draftId(domain, key)) || null;
  }

  function valueFor(domain, key) {
    const draft = draftFor(domain, key);
    if (draft) return draft.value;
    const value = baseValue(domain, key);
    return value === undefined ? null : String(value);
  }

  function setDraft(domain, key, value) {
    const text = String(value == null ? '' : value);
    const base = baseValue(domain, key);
    const baseText = base === undefined ? null : String(base);
    const id = draftId(domain, key);
    if (baseText !== null && text === baseText) {
      drafts.delete(id);
    } else {
      const prev = drafts.get(id);
      drafts.set(id, {
        domain,
        key,
        value: text,
        base: baseText,
        seq: prev ? prev.seq : ++draftSeq,
      });
    }
    updateSaveUi();
  }

  function updateSaveUi() {
    if (READONLY_ONLY) {
      for (const button of [saveBtn, editBtn, orphanBtn, exportBtn, dirtyBtn]) {
        if (button) button.hidden = true;
      }
      return;
    }
    const count = drafts.size;
    if (saveBtn) {
      const hidden = count === 0;
      if (saveBtn.hidden !== hidden) saveBtn.hidden = hidden;
      if (saveBtn.dataset.count !== String(count)) {
        saveBtn.dataset.count = String(count);
        saveBtn.textContent = '存檔（' + count + '）';
        saveBtn.title =
          count +
          ' 個條目有未套用的變更；按一下檢查、重建索引，並在可用時寫回 TSV。';
      }
      if (saveBtn.disabled !== saveBusy) saveBtn.disabled = saveBusy;
    }
    if (editBtn) {
      const label = state.editing ? '完成' : '編輯';
      if (editBtn.textContent !== label) editBtn.textContent = label;
      editBtn.classList.toggle('is-active', state.editing);
      editBtn.disabled = state.view !== 'entry';
    }
    if (orphanBtn) {
      const hidden = !state.editing || state.view !== 'entry';
      if (orphanBtn.hidden !== hidden) orphanBtn.hidden = hidden;
    }
    if (exportBtn) {
      const hidden =
        state.uiMode !== 'desktop' ||
        !state.editing ||
        state.view !== 'entry' ||
        state.root.key === '_';
      if (exportBtn.hidden !== hidden) exportBtn.hidden = hidden;
    }
    if (count !== lastDraftCount) {
      lastDraftCount = count;
      updateStats();
    }
  }

  function countOrphans(domainId) {
    const domain = state.index.byId.get(domainId);
    if (!domain) return 0;
    let count = 0;
    for (const [key, value] of domain.entries) {
      if (key === '_' || isRedirect(value)) continue;
      if (!state.index.links.incoming.has(domainId + ':' + key)) count++;
    }
    return count;
  }

  function updateOrphanButton() {
    if (!orphanBtn) return;
    if (!state.editing || state.view !== 'entry') {
      orphanBtn.hidden = true;
      return;
    }
    const count = countOrphans(state.root.domain);
    orphanBtn.hidden = false;
    orphanBtn.textContent = '孤兒' + (count ? ' ' + count : '');
    orphanBtn.classList.toggle('is-empty', count === 0);
    orphanBtn.title =
      '本科有 ' + count + ' 個沒有被任何條目引用的孤兒；點選後直接編寫。';
  }

  /**
   * 編輯時查引用：先看索引，再看草稿。草稿中的新條目在存檔前就能被展開。
   */
  function editorResolve(ref, domain, contextDomain) {
    const name = String(ref == null ? '' : ref).trim();
    const res = NT.resolve(state.index, name, domain, contextDomain);
    if (res.status === 'ok') {
      const draft = draftFor(res.domain, res.key);
      return draft ? { ...res, value: draft.value } : res;
    }
    const candidates = [];
    if (domain) candidates.push(domain);
    if (contextDomain) candidates.push(contextDomain);
    if (state.root.domain) candidates.push(state.root.domain);
    for (const id of new Set(candidates)) {
      const draft = draftFor(id, name);
      if (draft) {
        return { status: 'ok', domain: id, key: name, value: draft.value, chain: [] };
      }
    }
    return res;
  }

  function editorCompletions(query, contextDomain) {
    const q = String(query == null ? '' : query).trim();
    const needle = q.toLowerCase();
    const keyCount = new Map();
    for (const domain of domains) {
      for (const [key, value] of domain.entries) {
        if (key === '_' || isRedirect(value)) continue;
        keyCount.set(key, (keyCount.get(key) || 0) + 1);
      }
    }

    const found = new Map();
    const add = (item) => {
      const prev = found.get(item.key);
      if (!prev || item.score > prev.score) found.set(item.key, item);
    };

    domains.forEach((domain, domainIndex) => {
      for (const [key, value] of domain.entries) {
        if (key === '_' || isRedirect(value)) continue;
        const plain = NT.plainText(value);
        const forms = SETTINGS ? SETTINGS.searchForms(key + ' ' + plain) : [key + ' ' + plain];
        if (needle && !forms.join(' ').toLowerCase().includes(needle)) continue;
        let score = 0;
        if (key === q) score += 1000;
        else if (key.startsWith(q) && q) score += 420;
        else if (key.includes(q) && q) score += 200;
        else score += 30;
        if (domain.id === contextDomain) score += 130;
        if (!q) score += Math.max(0, 80 - [...key].length);
        score -= domainIndex;
        add({
          key,
          domain: domain.id,
          domainName: disp(domain.name || domain.id),
          preview: preview(value),
          score,
        });
      }
    });

    for (const draft of drafts.values()) {
      if (draft.base !== null) continue;
      if (needle && !draft.key.toLowerCase().includes(needle)) continue;
      add({
        key: draft.key,
        domain: draft.domain,
        domainName: disp(domainName(draft.domain)),
        preview: '新條目（尚未存檔）',
        score: (draft.domain === contextDomain ? 160 : 20) + 500,
      });
    }

    return [...found.values()]
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, 'zh-Hant'))
      .map((item) => ({
        ...item,
        apply:
          (keyCount.get(item.key) || 0) > 1 && item.domain !== contextDomain
            ? item.key + '@' + item.domain
            : item.key,
      }));
  }

  function makeEditorHost(domainId, key) {
    return {
      hue: (depth) => NT.hue(depth),
      maxDepth: NT.MAX_DEPTH,
      display: disp,
      simMode: () => (SETTINGS ? SETTINGS.simModeOf() : 0),
      resolve: (ref, domain, contextDomain) => editorResolve(ref, domain, contextDomain),
      chooseMode: (value) => NT.chooseMode(value, state.mode),
      isExpanded: (path) => state.expanded.has(path),
      focusPath: () => state.focusPath,
      toggleExpanded: (path) => toggleEditorPath(path),
      navigate: (target, targetKey) => navigate(target, targetKey),
      showMissing: (tok, contextDomain) => showMissingTarget(tok, contextDomain),
      isBacklinkSource: (res) =>
        !!(
          state.backlink &&
          res &&
          res.status === 'ok' &&
          res.domain === state.backlink.targetDomain &&
          res.key === state.backlink.targetKey
        ),
      navigateBacklink: () => {
        if (state.backlink) navigate(state.backlink.targetDomain, state.backlink.targetKey);
      },
      requestEdit: (target, targetKey) => openEntryForEdit(target, targetKey),
      completions: (text, contextDomain) => editorCompletions(text, contextDomain),
      onChange: (text) => setDraft(domainId, key, text),
      onInsertedCancel: () => {
        state.pendingBacklink = null;
        refreshBacklinks();
      },
      saveShortcut: () => {
        saveDrafts();
      },
    };
  }

  function mountEntryEditor(article, value) {
    if (state.uiMode === 'mobile') return false;
    if (!CM || typeof CM.createEntry !== 'function') return false;
    const body = el('div', 'entry-body');
    article.append(body);
    entryController = CM.createEntry({
      parent: body,
      text: String(value == null ? '' : value),
      domain: state.root.domain,
      key: state.root.key,
      depth: 0,
      editing: !READONLY_ONLY && state.editing,
      maxDepth: NT.MAX_DEPTH,
      host: makeEditorHost(state.root.domain, state.root.key),
    });
    return true;
  }

  function toggleEditorPath(path) {
    clearHoverTimers();
    closeHoverCards();
    if (state.expanded.has(path)) closePath(path);
    else {
      state.expanded.add(path);
      state.focusPath = path;
    }
    reader.classList.toggle('is-focusing', !!state.focusPath && state.view === 'entry');
    if (entryController) {
      entryController.refresh();
      if (state.expanded.has(path)) {
        requestAnimationFrame(() => {
          if (entryController) entryController.scrollToPath(path);
        });
      }
    }
  }

  function refreshBacklinks() {
    if (state.view !== 'entry') return;
    const targetId = state.root.domain + ':' + state.root.key;
    const res = editorResolve(state.root.key, state.root.domain, null);
    if (res.status !== 'ok') return;
    const row = reader.querySelector('.entry-title-row');
    if (!row) return;
    const old = row.querySelector('.backlinks');
    const list = backlinksFor(targetId);
    if (list.length || state.editing) {
      const nav = renderBacklinks(list, res, pendingBacklinkFor(targetId));
      if (old) old.replaceWith(nav);
      else row.append(nav);
    } else if (old) {
      old.remove();
    }
  }

  function setEditing(flag) {
    if (READONLY_ONLY || state.uiMode === 'mobile') return;
    const next = !!flag;
    if (next && (state.view !== 'entry' || !entryController)) {
      showToast('請先開啟一個條目');
      return;
    }
    if (next && SETTINGS && SETTINGS.simModeOf() !== 0) {
      showToast('簡體顯示模式下不能編輯；請先在設置頁切回「保持原樣」');
      return;
    }
    state.editing = next;
    if (entryController) entryController.setEditing(next);
    if (next) closeHoverCards();
    document.body.classList.toggle('is-editing-entry', next);
    refreshBacklinks();
    updateSaveUi();
    updateOrphanButton();
    if (next) refreshOrphanPanel();
    else closeOrphanPanel();
  }

  function openEntryForEdit(domain, key) {
    if (READONLY_ONLY || state.uiMode === 'mobile' || isReservedKey(key)) return;
    if (!CM) {
      // 罕見的 bundle 載入失敗：退回舊版 textarea 編輯器，至少還能編。
      const exists = baseValue(domain, key) !== undefined;
      ensureEditAccess(domain, () => openEditor(domain, key, !exists));
      return;
    }
    state.pendingEdit = true;
    state.focusEditorOnce = true;
    state.createKey = null;
    if (state.view === 'entry' && state.root.domain === domain && state.root.key === key) {
      state.pendingEdit = false;
      state.focusEditorOnce = false;
      setEditing(true);
      return;
    }
    navigate(domain, key);
  }

  function openNewEntry(domain, key) {
    if (READONLY_ONLY || state.uiMode === 'mobile') return;
    const name = String(key == null ? '' : key).trim();
    if (!name) return;
    if (/[@|\[\]\n\t]/.test(name)) {
      showToast('條目名稱不能包含 @、|、[、]');
      return;
    }
    if ([...name].length > 16) {
      showToast('條目名稱最多 16 個字');
      return;
    }
    if (!CM) {
      ensureEditAccess(domain, () => openEditor(domain, name, true));
      return;
    }
    state.pendingEdit = true;
    state.focusEditorOnce = true;
    state.createKey = name;
    if (state.view === 'entry' && state.root.domain === domain && state.root.key === name) {
      state.pendingEdit = false;
      state.focusEditorOnce = false;
      if (!state.editing) setEditing(true);
      else render();
      return;
    }
    navigate(domain, name);
  }

  function validateDrafts() {
    const errors = [];
    const warnings = [];
    const seen = new Set();
    const warn = (text) => {
      if (seen.has(text)) return;
      seen.add(text);
      warnings.push(text);
    };
    for (const draft of drafts.values()) {
      const label = draft.key || '（未命名）';
      if (isReservedKey(String(draft.key))) {
        errors.push(label + '：@ 開頭的 key 是保留字，不能展示或編輯');
      }
      if (!String(draft.value).trim()) errors.push(label + '：釋文不能是空的');
      if (isRedirect(draft.value)) {
        errors.push(label + '：@ 開頭是系統維護的對照頁，不能直接存成條目');
      }
      if (/\t/.test(draft.value)) errors.push(label + '：釋文不能包含 Tab');
      if (/[\r\n]/.test(draft.value)) warn(label + '：換行會在存檔時轉成空白');
      if (draft.base === null) {
        if (!String(draft.key).trim()) errors.push('新條目名稱不能是空的');
        else if ([...String(draft.key)].length > 16) {
          errors.push(label + '：條目名稱超過 16 個字');
        } else if (/[@|\[\]\n\t]/.test(draft.key)) {
          errors.push(label + '：條目名稱不能包含 @、|、[、]');
        }
      }
      for (const tok of NT.parse(draft.value)) {
        if (tok.type !== 'ref') continue;
        if ([...String(tok.inner)].length > 16) {
          errors.push(label + '：引用「^[' + tok.inner + ']」超過 16 個字');
          continue;
        }
        const res = editorResolve(tok.ref, tok.domain, draft.domain);
        if (res.status === 'alias-loop') {
          warn(label + '：引用「' + tok.ref + '」形成別名循環');
        } else if (res.status !== 'ok') {
          warn(label + '：引用「' + tok.ref + '」找不到目標');
        }
      }
    }
    return { errors, warnings };
  }

  function closeCheckDialog() {
    if (checkOverlay) checkOverlay.remove();
    checkOverlay = null;
  }

  function showSaveProblems(errors, warnings) {
    closeCheckDialog();
    const backdrop = el('div', 'edit-backdrop');
    const panel = el('section', 'edit-panel check-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', '存檔檢查'));
    titles.append(el('h2', 'edit-title', '還有 ' + errors.length + ' 項要修正'));
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', closeCheckDialog);
    head.append(close);
    panel.append(head);

    const list = el('div', 'check-list');
    for (const line of errors) list.append(el('div', 'check-line is-error', line));
    if (warnings.length) {
      list.append(el('div', 'check-subtitle', '提醒'));
      for (const line of warnings) list.append(el('div', 'check-line', line));
    }
    panel.append(list);

    const actions = el('div', 'edit-actions');
    const done = el('button', 'edit-primary', '回到編輯');
    done.type = 'button';
    done.addEventListener('click', closeCheckDialog);
    actions.append(done);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    checkOverlay = backdrop;
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeCheckDialog();
    });
    done.focus();
  }

  async function persistDirtyQuiet(domainIds) {
    const written = [];
    const pending = [];
    for (const id of domainIds) {
      if (!dirtyDomains.has(id)) continue;
      const session = fileHandles.get(id);
      if (session) {
        try {
          const permission = await session.handle.queryPermission({ mode: 'readwrite' });
          if (permission === 'granted') {
            await saveFileSession(id);
            clearDirty(id);
            written.push(id);
          } else {
            pending.push(id);
          }
        } catch (e) {
          pending.push(id);
        }
        continue;
      }
      if (/^https?:$/.test(location.protocol)) {
        try {
          await saveViaServer(id, serializeDomain(id));
          clearDirty(id);
          written.push(id);
        } catch (e) {
          pending.push(id);
        }
        continue;
      }
      pending.push(id);
    }
    updateStats();
    return { written, pending };
  }

  async function saveDrafts() {
    if (saveBusy) return false;
    if (!drafts.size) {
      showToast('沒有未套用的變更');
      return false;
    }
    const check = validateDrafts();
    if (check.errors.length) {
      showSaveProblems(check.errors, check.warnings);
      return false;
    }

    saveBusy = true;
    updateSaveUi();
    const list = [...drafts.values()];
    const affected = new Set(list.map((draft) => draft.domain));
    const cursor = entryController ? entryController.view.state.selection.main.head : null;

    for (const draft of list) {
      setDomainEntry(
        draft.domain,
        draft.key,
        String(draft.value).replace(/\r?\n/g, ' ').trim()
      );
    }
    for (const id of affected) markDirty(id);
    drafts.clear();
    draftSeq = 0;
    lastDraftCount = 0;
    state.createKey = null;
    state.pendingInsert = null;
    state.pendingBacklink = null;

    rebuildAllIndex();
    fillSubjectSelect();
    updateSaveUi();
    closeOrphanPanel();
    render();
    if (cursor != null && entryController) {
      entryController.focus();
      const max = entryController.view.state.doc.length;
      entryController.view.dispatch({ selection: { anchor: Math.min(cursor, max) } });
    }

    const persisted = await persistDirtyQuiet(affected);
    saveBusy = false;
    updateSaveUi();

    let orphanTotal = 0;
    for (const id of affected) orphanTotal += countOrphans(id);
    const bits = ['已套用 ' + list.length + ' 個條目', '已重建索引'];
    if (check.warnings.length) bits.push(check.warnings.length + ' 個提醒');
    if (orphanTotal) bits.push(orphanTotal + ' 個孤兒');
    if (persisted.written.length) bits.push('已寫入 ' + persisted.written.length + ' 科');
    if (persisted.pending.length) bits.push(persisted.pending.length + ' 科待離開時儲存');
    showToast(bits.join(' · '));
    updateOrphanButton();
    refreshOrphanPanel();
    return true;
  }

/* ---- 22-orphans.js ---- */
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

  function defaultRoute() {
    const first = domains.find((d) => d.entries.has('_')) || domains[0];
    if (!first) return null;
    return {
      view: 'entry',
      domain: first.id,
      key: first.entries.has('_') ? '_' : [...first.entries.keys()][0],
    };
  }

/* ---- 30-route.js ---- */
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

/* ---- 31-focus.js ---- */
/* 展開狀態與焦點
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 展開狀態與焦點 ---------- */

  function nearestOpenAncestor(path) {
    let p = path;
    while (p.includes('.')) {
      p = p.slice(0, p.lastIndexOf('.'));
      if (state.expanded.has(p)) return p;
    }
    return null;
  }

  function closePath(path) {
    for (const key of [...state.expanded]) {
      if (key === path || key.startsWith(path + '.')) state.expanded.delete(key);
    }
    if (state.focusPath && (state.focusPath === path || state.focusPath.startsWith(path + '.'))) {
      state.focusPath = nearestOpenAncestor(path);
    }
  }

  function toggle(path) {
    clearHoverTimers();
    closeHoverCards();
    if (state.expanded.has(path)) {
      closePath(path);
    } else {
      state.expanded.add(path);
      state.focusPath = path;
    }
    render({ focusPath: path });
  }

/* ---- 40-read.js ---- */
/* DOM 閱讀渲染與反鏈接
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 渲染 ---------- */

  function renderDoc(text, depth, prefix, ancestors, inlineContext, contextDomain) {
    const doc = el('span', 'nt-doc' + (inlineContext ? ' is-inline' : ''));
    const paragraphs = String(text).split(/\n+/).filter((p) => p.trim() !== '');

    paragraphs.forEach((paragraph) => {
      const block = el('span', 'nt-block');
      block.dataset.depth = String(depth);
      block.style.setProperty('--hue', String(NT.hue(depth)));
      block.style.setProperty('--depth', String(depth));

      const line = el('span', 'nt-line');
      const extra = el('span', 'nt-extra');
      const tokens = NT.parse(paragraph);
      const blocks = [];
      let refIndex = 0;

      tokens.forEach((tok) => {
        if (tok.type === 'text') {
          line.append(el('span', 'nt-text', disp(tok.text)));
          return;
        }
        const path = prefix ? prefix + '.' + refIndex : String(refIndex);
        refIndex++;
        const rendered = renderRef(tok, path, depth, ancestors, inlineContext, contextDomain);
        line.append(rendered.inline);
        if (rendered.block) blocks.push(rendered.block);
      });

      block.append(line);
      if (blocks.length) {
        extra.append(...blocks);
        block.append(extra);
      }
      doc.append(block);
    });

    return doc;
  }

  function mobileReadButton(res) {
    if (state.uiMode !== 'mobile' || !res || res.status !== 'ok') return null;
    const btn = el('button', 'nt-mobile-read', '閱讀');
    btn.type = 'button';
    btn.title = '換到「' + disp(res.key) + '」這一頁';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigate(res.domain, res.key);
    });
    return btn;
  }

  function renderRef(tok, path, depth, ancestors, inlineContext, contextDomain) {
    const expanded = state.expanded.has(path);
    const label = disp(tok.display || tok.ref);
    const wrap = el('span', 'nt-refwrap');
    wrap.dataset.path = path;
    const btn = el('button', 'nt-ref', label);
    btn.type = 'button';
    btn.dataset.path = path;
    btn.dataset.ref = tok.ref;
    if (tok.domain) btn.dataset.domain = tok.domain;
    if (contextDomain) btn.dataset.context = contextDomain;
    btn.style.setProperty('--hue', String(NT.hue(depth)));
    if (state.focusPath && state.focusPath.startsWith(path + '.')) {
      btn.classList.add('is-focus-ancestor');
    }
    btn.setAttribute('aria-expanded', String(expanded));
    btn.title =
      (tok.domain ? `^[${tok.ref}@${tok.domain}]` : `^[${tok.ref}]`) +
      '：點擊展開／收合；Ctrl/⌘+點擊直接開啟';

    const res = NT.resolve(state.index, tok.ref, tok.domain, contextDomain);

    btn.addEventListener('click', (e) => {
      if (res.status === 'missing') {
        e.preventDefault();
        showMissingTarget(tok, contextDomain, res);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && state.uiMode !== 'mobile' && res.status === 'ok') {
        e.preventDefault();
        navigate(res.domain, res.key);
        return;
      }
      if (btn.classList.contains('is-backlink-source') && state.backlink) {
        navigate(state.backlink.targetDomain, state.backlink.targetKey);
      } else {
        toggle(path);
      }
    });
    wrap.append(btn);

    // 從反鏈接跳過來時，標出「來源條目中引用原條目」的位置（只看最外層）。
    if (
      depth === 0 &&
      state.backlink &&
      res.status === 'ok' &&
      res.domain === state.backlink.targetDomain &&
      res.key === state.backlink.targetKey
    ) {
      btn.classList.add('is-backlink-source');
      btn.title = '回到 ' + disp(state.backlink.targetKey) + '（反鏈接來源）';
      btn.setAttribute('aria-label', '回到 ' + disp(state.backlink.targetKey));
    }

    if (!expanded) return { inline: wrap, block: null };

    const expId = 'exp-' + path.replace(/\./g, '-');

    if (res.status !== 'ok') {
      wrap.append(noteEl(res.status, res, depth));
      return { inline: wrap, block: null };
    }
    if (!res.value || !res.value.trim()) {
      wrap.append(noteEl('empty', res, depth));
      return { inline: wrap, block: null };
    }

    const id = res.domain + ':' + res.key;
    if (ancestors.has(id)) {
      wrap.append(noteEl('cycle', res, depth));
      return { inline: wrap, block: null };
    }
    if (depth + 1 > NT.MAX_DEPTH) {
      wrap.append(noteEl('limit', res, depth));
      return { inline: wrap, block: null };
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const mode = NT.chooseMode(res.value, state.mode);

    if (mode === 'inline') {
      const exp = el('span', 'nt-exp nt-exp-inline');
      exp.id = expId;
      exp.dataset.path = path;
      exp.dataset.depth = String(depth + 1);
      exp.style.setProperty('--hue', String(NT.hue(depth + 1)));
      exp.append(renderDoc(res.value, depth + 1, path, nextAncestors, true, res.domain));
      wrap.append(exp);
      const read = mobileReadButton(res);
      if (read) wrap.append(read);
      btn.setAttribute('aria-controls', expId);
      btn.classList.add('is-open');
      return { inline: wrap, block: null };
    }

    const block = el('span', 'nt-exp nt-exp-block');
    block.id = expId;
    block.dataset.path = path;
    block.dataset.depth = String(depth + 1);
    block.style.setProperty('--hue', String(NT.hue(depth + 1)));
    block.style.setProperty('--depth', String(depth + 1));

    const head = el('span', 'nt-exp-head');
    head.append(el('span', 'nt-exp-arrow', '↳'));
    head.append(el('span', 'nt-exp-key', disp(res.key)));
    head.append(el('span', 'nt-exp-domain', res.domain));

    const close = el('button', 'nt-exp-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '收合');
    close.title = '收合';
    close.addEventListener('click', () => toggle(path));
    head.append(close);

    block.append(head);
    block.append(renderDoc(res.value, depth + 1, path, nextAncestors, false, res.domain));
    const read = mobileReadButton(res);
    if (read) block.append(read);
    btn.setAttribute('aria-controls', expId);
    btn.classList.add('is-open');
    return { inline: wrap, block };
  }

  function noteEl(kind, res, depth) {
    const span = el('span', 'nt-note nt-note-' + kind);
    span.style.setProperty('--hue', String(NT.hue(depth)));
    let text = '';

    if (kind === 'cycle') text = '↺ 循環：' + disp(res.key || res.name);
    else if (kind === 'alias-loop') text = '↺ 別名迴圈：' + disp(res.name || '');
    else if (kind === 'empty') text = '（尚未定義）';
    else if (kind === 'limit') text = '…已達深度上限（' + NT.MAX_DEPTH + '）';
    else {
      text = '查無「' + disp(res.name || '') + '」';
      const picks = NT.suggest(state.index, res.name || '', 3);
      if (picks.length) text += '，是否指：' + picks.map(disp).join('、');
    }

    span.textContent = text;
    span.title = '展開已停止，但可以再點一次收合。';
    return span;
  }

  function render(options) {
    const opts = options || {};
    document.body.classList.toggle('is-mobile-ui', state.uiMode === 'mobile');
    const scrollY = window.scrollY;
    const backlinkScroll = state.backlink && state.backlink.scroll ? state.backlink : null;
    const recenterGraph = state.view === 'graph' && state.graph.recenter;
    if (entryController) {
      entryController.destroy();
      entryController = null;
    }
    subjectSelect.value =
      state.view === 'index' ? state.indexDomain || 'all' : state.root.domain;
    reader.textContent = '';
    reader.classList.toggle('is-focusing', !!state.focusPath && state.view === 'entry');
    if (state.view !== 'graph') hideGraphTip();
    if (state.view !== 'entry') {
      document.body.classList.remove('is-editing-entry');
      closeOrphanPanel();
    }
    renderReadHistory();
    updateDirtyUi();
    updateSaveUi();
    updateOrphanButton();
    viewToggle.hidden = state.view === 'index';
    const isGraphView = state.view === 'graph';
    viewToggle.classList.toggle('is-graph', isGraphView);
    viewToggle.setAttribute('aria-pressed', String(isGraphView));
    viewToggle.title = isGraphView ? '切換到文字（g）' : '切換到圖譜（g）';
    viewToggle.setAttribute('aria-label', isGraphView ? '切換到文字' : '切換到圖譜');

    if (state.view === 'index') renderIndex();
    else if (state.view === 'graph') renderGraph();
    else renderEntry(opts);

    if (!entryController) applyFocus();
    if (orphanPanel) refreshOrphanPanel();
    requestAnimationFrame(() => {
      if (recenterGraph) {
        state.graph.recenter = false;
        const canvas = reader.querySelector('.graph-canvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const top = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
          window.scrollTo(0, Math.max(0, top));
          return;
        }
      }
      if (backlinkScroll) {
        const mark = reader.querySelector('.nt-ref.is-backlink-source');
        if (mark) {
          const top = mark.getBoundingClientRect().top + window.scrollY - 120;
          window.scrollTo(0, Math.max(0, top));
          mark.focus({ preventScroll: true });
        } else {
          window.scrollTo(0, scrollY);
        }
        backlinkScroll.scroll = false;
        return;
      }
      window.scrollTo(0, scrollY);
    });
  }

  /*
   * 焦點模式：只保留「目前展開的那條路徑」清楚，其餘淡出。
   * 從目標元素往上走，逐層把兄弟節點標成 .nt-dim；refwrap 那層跳過，讓引用本身保持可見。
   */
  function applyFocus() {
    reader.classList.remove('is-focusing');
    reader.querySelectorAll('.nt-dim, .nt-focus-current').forEach((node) => {
      node.classList.remove('nt-dim', 'nt-focus-current');
    });

    if (state.view !== 'entry' || !state.focusPath) return;

    const selector = '[data-path="' + state.focusPath + '"]';
    const target =
      reader.querySelector('.nt-exp' + selector) || reader.querySelector('.nt-refwrap' + selector);
    if (!target) return;

    reader.classList.add('is-focusing');
    target.classList.add('nt-focus-current');

    let node = target;
    while (node && node !== reader) {
      const parent = node.parentElement;
      if (parent && parent !== reader && !parent.classList.contains('nt-refwrap')) {
        for (const child of parent.children) {
          if (child !== node) child.classList.add('nt-dim');
        }
      }
      node = parent;
    }
  }

  function openBacklink(source, target) {
    state.backlink = {
      sourceDomain: source.domain,
      sourceKey: source.key,
      targetDomain: target.domain,
      targetKey: target.key,
      scroll: true,
    };
    navigate(source.domain, source.key, { keepBacklink: true });
  }

  function renderBacklinks(list, target, pending) {
    if (pending) list = [pending, ...list];
    const nav = el('nav', 'backlinks');
    nav.setAttribute('aria-label', '反鏈接');
    nav.title =
      '直接引用本條目的其他條目（共 ' + list.length + ' 筆；前 4 筆直接顯示，其餘在下拉）';
    nav.append(el('span', 'backlinks-label', '反鏈接'));
    nav.append(el('span', 'backlinks-count', String(list.length)));

    const strip = el('div', 'backlinks-list');

    function makeButton(item, menuItem) {
      const btn = el(
        'button',
        'backlink' + (menuItem ? ' backlink-menu-item' : '') + (item.pending ? ' is-pending' : '')
      );
      btn.type = 'button';
      if (item.pending) {
        btn.append(el('span', 'backlink-pending-tag', '新'));
      } else if (item.domain !== target.domain) {
        btn.append(el('span', 'backlink-domain', disp(domainName(item.domain)) + '·'));
      }
      btn.append(document.createTextNode(disp(item.key)));
      btn.title = item.pending
        ? '系統剛加入、尚未存檔的引用；點一下回到「' + disp(item.key) + '」'
        : '跳到 ' +
          disp(domainName(item.domain)) +
          ' · ' +
          disp(item.key) +
          '，並標出引用「' +
          disp(target.key) +
          '」的位置';
      btn.addEventListener('click', () => {
        if (menuItem) menuItem.open = false;
        if (item.pending) {
          navigate(item.domain, item.key);
          return;
        }
        openBacklink(item, target);
      });
      return btn;
    }

    list.slice(0, 4).forEach((item) => strip.append(makeButton(item, null)));

    if (list.length > 4) {
      const more = document.createElement('details');
      more.className = 'backlinks-more';
      const summary = el('summary', 'backlinks-more-btn', '+' + (list.length - 4));
      summary.title = '還有 ' + (list.length - 4) + ' 筆反鏈接';
      summary.setAttribute('aria-label', '還有 ' + (list.length - 4) + ' 筆反鏈接');
      const menu = el('div', 'backlinks-menu');
      list.slice(4).forEach((item) => menu.append(makeButton(item, more)));
      more.append(summary, menu);
      strip.append(more);
    }

    nav.append(strip);
    if (state.editing && target && target.status === 'ok') {
      const search = el('button', 'backlink-search', '文內搜尋');
      search.type = 'button';
      search.title = '在本科其他內文中找「' + disp(target.key) + '」，跳過去補連結';
      search.addEventListener('click', () => showInTextSearch(target.domain, target.key));
      nav.append(search);
    }
    return nav;
  }

/* ---- 41-hover.js ---- */
/* Hover popup
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- Hover popup（桌面閱讀） ---------- */

  const hoverLayer = el('div', 'hover-layer');
  hoverLayer.hidden = true;
  document.body.append(hoverLayer);
  let hoverCards = [];
  let hoverOpenTimer = 0;
  let hoverCloseTimer = 0;

  function clearHoverTimers() {
    clearTimeout(hoverOpenTimer);
    clearTimeout(hoverCloseTimer);
    hoverOpenTimer = 0;
    hoverCloseTimer = 0;
  }

  function closeHoverCards(fromCard) {
    const start = fromCard ? hoverCards.indexOf(fromCard) : 0;
    if (start < 0) return;
    for (const card of hoverCards.slice(start)) card.remove();
    hoverCards = hoverCards.slice(0, start);
    hoverLayer.hidden = hoverCards.length === 0;
  }

  function placeHoverCard(card, anchor) {
    const gap = 10;
    const rect = anchor.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    let left = rect.left + 8;
    let top = rect.bottom + gap;
    if (left + box.width > window.innerWidth - 12) left = rect.right - box.width - 8;
    if (top + box.height > window.innerHeight - 12) top = rect.top - box.height - gap;
    card.style.left = Math.max(12, left) + 'px';
    card.style.top = Math.max(12, top) + 'px';
  }

  function hoverBody(value, domain, depth) {
    const body = el('div', 'hover-card-body');
    for (const tok of NT.parse(value)) {
      if (tok.type === 'text') {
        body.append(document.createTextNode(disp(tok.text)));
        continue;
      }
      const res = editorResolve(tok.ref, tok.domain, domain);
      const label = el('span', 'nt-ref hover-ref' + (res.status === 'ok' ? '' : ' is-missing'));
      label.textContent = disp(tok.display || tok.ref);
      label.style.setProperty('--hue', String(NT.hue(depth)));
      label.dataset.ref = tok.ref;
      if (tok.domain) label.dataset.domain = tok.domain;
      if (domain) label.dataset.context = domain;
      label.title =
        '^[' +
        tok.inner +
        ']' +
        (res.status === 'ok' ? '：Ctrl/⌘+點擊開啟' : '：找不到目標');
      if (res.status === 'ok') {
        label.dataset.hoverReady = '1';
        label.addEventListener('click', (event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          closeHoverCards();
          navigate(res.domain, res.key);
        });
      }
      label.addEventListener('mouseenter', () => scheduleHover(label, label.closest('.hover-card')));
      label.addEventListener('mouseleave', () => {
        const card = label.closest('.hover-card');
        if (card) scheduleClose(card);
      });
      body.append(label);
    }
    return body;
  }

  function isExpandedAnchor(anchor) {
    return !!anchor && anchor.getAttribute && anchor.getAttribute('aria-expanded') === 'true';
  }

  function openHoverCard(anchor, parentCard) {
    if (isExpandedAnchor(anchor)) return null;
    const ref = anchor && anchor.dataset ? anchor.dataset.ref : '';
    if (!ref) return null;
    const res = editorResolve(ref, anchor.dataset.domain || null, anchor.dataset.context || null);
    if (res.status !== 'ok') return null;
    const existing = hoverCards.find((card) => card.__anchor === anchor);
    if (existing) return existing;

    const start = parentCard ? hoverCards.indexOf(parentCard) + 1 : 0;
    if (start < hoverCards.length) closeHoverCards(hoverCards[start]);

    const card = el('section', 'hover-card');
    card.__anchor = anchor;
    card.__parent = parentCard || null;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '引用內容');

    const head = el('header', 'hover-card-head');
    const title = el('strong', 'hover-card-title', disp(displayKey(res.domain, res.key)));
    const domain = el('span', 'hover-card-domain', disp(domainName(res.domain)));
    head.append(title, domain);
    head.append(el('span', 'hover-card-hint', 'Ctrl/⌘+點擊開啟'));
    card.append(head);
    card.append(hoverBody(res.value, res.domain, 1));

    card.addEventListener('mouseenter', clearHoverTimers);
    card.addEventListener('mouseleave', () => scheduleClose(card));

    hoverLayer.hidden = false;
    hoverLayer.append(card);
    hoverCards.push(card);
    card.style.visibility = 'hidden';
    placeHoverCard(card, anchor);
    card.style.visibility = '';
    return card;
  }

  function scheduleHover(anchor, parentCard) {
    if (state.uiMode === 'mobile' || state.editing || !anchor || !anchor.dataset || !anchor.dataset.ref) return;
    if (isExpandedAnchor(anchor)) return;
    clearHoverTimers();
    hoverOpenTimer = setTimeout(() => {
      hoverOpenTimer = 0;
      openHoverCard(anchor, parentCard || null);
    }, 240);
  }

  function scheduleClose(card) {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0;
      const current = hoverCards[hoverCards.length - 1];
      if (current === card || (card && hoverCards.includes(card))) closeHoverCards(card);
    }, 220);
  }

  function hoverAnchorOf(target) {
    const anchor = target && target.closest ? target.closest('.cm-ref, .nt-ref') : null;
    if (!anchor || !reader.contains(anchor) || !anchor.dataset.ref) return null;
    if (isExpandedAnchor(anchor)) return null;
    return anchor;
  }

  document.addEventListener('mouseover', (event) => {
    const anchor = hoverAnchorOf(event.target);
    if (!anchor) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    scheduleHover(anchor, null);
  });

  document.addEventListener('mouseout', (event) => {
    const anchor = hoverAnchorOf(event.target);
    if (!anchor) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    if (hoverCards.length) scheduleClose(hoverCards[0]);
  });

  document.addEventListener('click', (event) => {
    if (hoverLayer.hidden) return;
    if (event.target.closest('.hover-card')) return;
    if (hoverAnchorOf(event.target)) return;
    clearHoverTimers();
    closeHoverCards();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && hoverCards.length) {
      event.preventDefault();
      clearHoverTimers();
      closeHoverCards();
    }
  });

  window.addEventListener('scroll', () => {
    if (!hoverLayer.hidden) {
      clearHoverTimers();
      closeHoverCards();
    }
  });

/* ---- 42-entry.js ---- */
/* 條目頁、文內搜尋插入與標記
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 條目頁 ---------- */

  function pendingBacklinkFor(targetId) {
    const pending = state.pendingBacklink;
    if (!pending || targetId !== pending.targetDomain + ':' + pending.targetKey) return null;
    const value = valueFor(pending.targetDomain, pending.targetKey) || '';
    for (const tok of NT.parse(value)) {
      if (tok.type !== 'ref') continue;
      const res = editorResolve(tok.ref, tok.domain, pending.targetDomain);
      if (
        res.status === 'ok' &&
        res.domain === pending.sourceDomain &&
        res.key === pending.sourceKey
      ) {
        return { domain: pending.sourceDomain, key: pending.sourceKey, pending: true };
      }
    }
    return null;
  }

  function plainOccurrences(text, target) {
    const hits = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '^' && text[i + 1] === '[') {
        const end = text.indexOf(']', i + 2);
        i = end < 0 ? i + 2 : end + 1;
        continue;
      }
      if (text.startsWith(target, i)) {
        hits.push(i);
        i += target.length;
      } else {
        i++;
      }
    }
    return hits;
  }

  function applyPendingInsert() {
    const pending = state.pendingInsert;
    if (!pending || !entryController || !state.editing) return;
    if (state.root.domain !== pending.domain || state.root.key !== pending.key) return;
    const text = entryController.view.state.doc.toString();
    const hits = plainOccurrences(text, pending.targetKey);
    const at = hits[pending.hitIndex] == null ? hits[0] : hits[pending.hitIndex];
    state.pendingInsert = null;
    if (at == null) {
      showToast('「' + pending.targetKey + '」已不在本文中，沒有插入');
      return;
    }
    const from = at;
    const to = at + pending.targetKey.length;
    entryController.view.dispatch({
      changes: [
        { from, insert: '^[' },
        { from: to, insert: ']' },
      ],
      selection: { anchor: to + 3 },
      scrollIntoView: true,
    });
    entryController.markInserted(
      from,
      to + 3,
      'intext-' + Date.now(),
      '^[' + pending.targetKey + ']'
    );
    entryController.focus();
    state.pendingBacklink = {
      targetDomain: pending.domain,
      targetKey: pending.key,
      sourceDomain: pending.domain,
      sourceKey: pending.targetKey,
    };
    refreshBacklinks();
    showToast('已插入 ^[' + pending.targetKey + ']；旁有「取消」可按');
  }

  function renderEntry(options) {
    const opts = options || {};
    if (state.pendingEdit) {
      state.editing = true;
      state.pendingEdit = false;
    }
    if (state.createKey && state.createKey !== state.root.key) state.createKey = null;
    const creating = state.createKey === state.root.key;

    const res = editorResolve(state.root.key, state.root.domain, null);
    if (res.status !== 'ok' && !creating) {
      if (state.editing) {
        state.editing = false;
        document.body.classList.remove('is-editing-entry');
        updateSaveUi();
      }
      reader.append(emptyState(res));
      return;
    }

    // @ 轉址頁不直接顯示；直接換到它指向的條目。
    if (res.status === 'ok' && (res.domain !== state.root.domain || res.key !== state.root.key)) {
      navigate(res.domain, res.key);
      return;
    }

    const value = res.status === 'ok' ? res.value : valueFor(state.root.domain, state.root.key) || '';
    const article = el('article', 'entry' + (state.editing ? ' is-editing' : ''));
    article.dataset.domain = state.root.domain;
    article.dataset.key = state.root.key;
    document.body.classList.toggle('is-editing-entry', !!state.editing);
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', disp(domainName(state.root.domain))));
    const titleRow = el('div', 'entry-title-row');
    titleRow.append(el('h1', 'entry-title', disp(displayKey(state.root.domain, state.root.key))));

    const targetId = state.root.domain + ':' + state.root.key;
    const backlinks = backlinksFor(targetId);
    const pending = pendingBacklinkFor(targetId);
    if (backlinks.length || state.editing) {
      titleRow.append(renderBacklinks(backlinks, res, pending));
    }

    const isOrphan = !state.index.links.incoming.has(targetId);
    if (state.editing && state.root.key !== '_' && !isRedirect(value) && isOrphan) {
      const orphan = el('button', 'entry-orphan', '孤兒');
      orphan.type = 'button';
      orphan.title = '這個條目沒有被任何條目引用；查看孤兒節點清單';
      orphan.addEventListener('click', () => {
        if (!orphanPanel) toggleOrphanPanel();
        else refreshOrphanPanel();
      });
      titleRow.append(orphan);
    }

    head.append(titleRow);
    article.append(head);

    const mounted = mountEntryEditor(article, value);
    if (!mounted) {
      const ancestors = new Set([targetId]);
      article.append(renderDoc(value, 0, '', ancestors, false, state.root.domain));
    }
    reader.append(article);

    if (state.editing && entryController && (state.focusEditorOnce || creating)) {
      state.focusEditorOnce = false;
      const controller = entryController;
      requestAnimationFrame(() => {
        if (entryController !== controller) return;
        controller.focus();
        const len = controller.view.state.doc.length;
        controller.view.dispatch({ selection: { anchor: creating ? len : 0 } });
      });
    }

    if (
      state.pendingInsert &&
      state.pendingInsert.domain === state.root.domain &&
      state.pendingInsert.key === state.root.key &&
      entryController
    ) {
      requestAnimationFrame(applyPendingInsert);
    }

    if (opts.focusPath && entryController) {
      requestAnimationFrame(() => {
        if (entryController) entryController.scrollToPath(opts.focusPath);
      });
    } else if (opts.focusPath) {
      const btn = reader.querySelector('.nt-ref[data-path="' + opts.focusPath + '"]');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

/* ---- 50-graph.js ---- */
/* 圖譜
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 圖譜 ---------- */

  const GRAPH_MAX_NODES = 48;
  const GRAPH_EDGE_WIDTHS = { thin: 1.2, medium: 2.4, thick: 4 };
  const GRAPH_PANEL_KEY = 'offtext.graphPanel.v1';
  let graphPanelCollapsed = false;
  try {
    graphPanelCollapsed = localStorage.getItem(GRAPH_PANEL_KEY) === '1';
  } catch (e) {
    /* 私密模式 */
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value != null) node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  const GRAPH_BREAK_SUFFIXES = [
    'contamination',
    'reinforcement',
    'engineering',
    'propagation',
    'supervised',
    'computing',
    'attention',
    'database',
    'function',
    'diffusion',
    'learning',
    'network',
    'fitting',
    'ability',
    'decoding',
    'privacy',
    'driving',
    'calling',
    'window',
    'tensors',
    'weights',
    'prompt',
    'collapse',
    'algebra',
    'ization',
    'former',
    'source',
    'format',
    'descent',
    'model',
    'meter',
    'typed',
    'tensor',
    'modal',
    'code',
    'type',
    'data',
    'face',
    'izer',
    'gen',
    'use',
  ].sort((a, b) => b.length - a.length);

  function graphLabel(key, domain) {
    const text = disp(key === '_' ? domainName(domain) : String(key));
    const hasHan = /[\u3400-\u9fff]/.test(text);

    if (hasHan) {
      // 中文：4 字以內一行；5 字起換行，最多 3 行，讓圓圈可以縮小。
      if (text.length <= 4) return [text];
      const lineCount = Math.min(3, Math.ceil(text.length / 4));
      const perLine = Math.ceil(text.length / lineCount);
      const lines = [];
      for (let i = 0; i < lineCount; i++) {
        lines.push(text.slice(i * perLine, (i + 1) * perLine));
      }
      return lines.filter(Boolean);
    }

    // 英文／數字：短詞不拆。
    if (text.length <= 10) return [text];

    // 先找常見的英文複合詞尾，避免把 diffusionmodel 切成 diffusi/onmodel。
    for (const suffix of GRAPH_BREAK_SUFFIXES) {
      if (!text.endsWith(suffix)) continue;
      const head = text.slice(0, -suffix.length);
      if (head.length >= 3 && head.length <= 12 && suffix.length <= 12) {
        return [head, suffix];
      }
    }

    // 有空白／連字號時以詞為單位裝行；沒有就整詞一行，不把英文單字切一半。
    const words = text.split(/[\s_-]+/).filter(Boolean);
    if (words.length > 1) {
      const lineCount = Math.min(3, words.length);
      const target = Math.ceil(text.length / lineCount);
      const lines = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word;
        if (line && candidate.length > target && lines.length < lineCount - 1) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines;
    }
    return [text];
  }

  function graphTextWidth(line, fontSize) {
    const size = fontSize || state.graph.fontSize || 12;
    let width = 0;
    for (const ch of line) width += /[\u3400-\u9fff]/.test(ch) ? size : size * 0.6;
    return width;
  }

  function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return h / 997;
  }

  function graphRadius(node) {
    const size = state.graph.fontSize;
    const value = graphDegree(node.id);
    const base = 12 + Math.min(22, Math.sqrt(value) * 4.5);
    const lines = graphLabel(node.key, node.domain);
    const pad = 6;
    const fit = Math.max(
      ...lines.map((line) => graphTextWidth(line, size) / 2 + pad),
      (lines.length * size * 1.12) / 2 + pad
    );
    const min = node.depth === 0 ? size * 1.9 : size * 1.15;
    return Math.max(min, base, fit);
  }

  function graphShortDomain(id) {
    if (id === 'aijargon') return 'AI';
    return disp(domainName(id)).slice(0, 1);
  }

  const graphTip = el('div', 'graph-tip');
  graphTip.hidden = true;
  document.body.append(graphTip);

  function hideGraphTip() {
    graphTip.hidden = true;
  }

  function moveGraphTip(x, y) {
    const pad = 12;
    const box = graphTip.getBoundingClientRect();
    let left = x + 16;
    let top = y + 16;
    if (left + box.width > window.innerWidth - pad) left = x - box.width - 16;
    if (top + box.height > window.innerHeight - pad) top = y - box.height - 16;
    graphTip.style.left = Math.max(pad, left) + 'px';
    graphTip.style.top = Math.max(pad, top) + 'px';
  }

  function showGraphTip(node, x, y) {
    const domain = state.index.byId.get(node.domain);
    const value = domain ? domain.entries.get(node.key) : '';
    const text = NT.plainText(value || '').replace(/\s+/g, ' ').trim();
    const counts = graphCounts(node.id);

    graphTip.textContent = '';
    const head = el('div', 'graph-tip-head');
    head.append(el('strong', 'graph-tip-key', disp(displayKey(node.domain, node.key))));
    head.append(el('span', 'graph-tip-domain', disp(domainName(node.domain))));
    graphTip.append(head);
    graphTip.append(
      el(
        'div',
        'graph-tip-meta',
        '順 ' + counts.forward + ' · 逆 ' + counts.back + ' · 深度 ' + node.depth
      )
    );
    graphTip.append(
      el(
        'p',
        'graph-tip-body',
        disp(text.length > 260 ? text.slice(0, 260) + '…' : text || '（尚無釋文）')
      )
    );
    graphTip.hidden = false;
    moveGraphTip(x, y);
  }

  function buildGraph(rootId, opts) {
    const nodes = new Map();
    const root = nodeInfo(rootId);
    const tree = new Set();
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    nodes.set(rootId, { ...root, depth: 0 });
    let frontier = [rootId];
    let truncated = false;

    for (let level = 0; level < opts.depth; level++) {
      const candidates = new Map();
      for (const id of frontier) {
        const next = new Set();
        if (opts.forward) {
          for (const target of state.index.links.forward.get(id) || []) next.add(target);
        }
        if (opts.backward) {
          for (const source of state.index.links.backward.get(id) || []) next.add(source);
        }
        for (const other of next) {
          if (nodes.has(other) || other === rootId) continue;
          const found = candidates.get(other);
          if (found) found.count++;
          else candidates.set(other, { count: 1, parent: id });
        }
      }

      const ordered = [...candidates.keys()].sort((a, b) => {
        const crossA = candidates.get(a).count;
        const crossB = candidates.get(b).count;
        if (crossA !== crossB) return crossB - crossA;
        const degree = graphDegree(b) - graphDegree(a);
        if (degree) return degree;
        return a.localeCompare(b);
      });

      const nextFrontier = [];
      for (const id of ordered) {
        if (nodes.size >= GRAPH_MAX_NODES) {
          truncated = true;
          break;
        }
        const parent = candidates.get(id).parent;
        nodes.set(id, { ...nodeInfo(id), depth: level + 1, parent });
        tree.add(pairKey(parent, id));
        nextFrontier.push(id);
      }

      frontier = nextFrontier;
      if (!frontier.length || nodes.size >= GRAPH_MAX_NODES) break;
    }

    const edges = [];
    const seen = new Set();
    const addEdge = (from, to, kind) => {
      const key = from + '|' + to + '|' + kind;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ from, to, kind, tree: tree.has(pairKey(from, to)) });
    };

    for (const id of nodes.keys()) {
      if (opts.forward) {
        for (const target of state.index.links.forward.get(id) || []) {
          if (nodes.has(target)) addEdge(id, target, 'forward');
        }
      }
      if (opts.backward) {
        for (const source of state.index.links.backward.get(id) || []) {
          if (nodes.has(source)) addEdge(source, id, 'back');
        }
      }
    }

    return { rootId, nodes, edges, truncated };
  }

  function layoutGraph(graph, width, height) {
    const nodes = [...graph.nodes.values()];
    nodes.forEach((node) => {
      node.r = graphRadius(node);
    });

    const cx = width / 2;
    const cy = height / 2;
    const edgeFactor =
      state.graph.edgeLength === 'short' ? 0.78 : state.graph.edgeLength === 'long' ? 1.28 : 1;
    const byDepth = new Map();
    nodes.forEach((node) => {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
      byDepth.get(node.depth).push(node);
    });

    const angleOf = (node) => Math.atan2(node.y - cy, node.x - cx);
    [...byDepth.keys()]
      .sort((a, b) => a - b)
      .forEach((depth) => {
        const group = byDepth.get(depth);
        // 同一層依父節點角度排序，讓相鄰子樹排在一起，先減少交錯。
        group.sort((a, b) => {
          const pa = a.parent ? graph.nodes.get(a.parent) : null;
          const pb = b.parent ? graph.nodes.get(b.parent) : null;
          if (pa && pb) {
            const diff = angleOf(pa) - angleOf(pb);
            if (Math.abs(diff) > 0.001) return diff;
          }
          const metric = graphDegree(b.id) - graphDegree(a.id);
          if (metric) return metric;
          return a.id.localeCompare(b.id);
        });

        const rx = Math.min(width * 0.42, (82 + depth * 74) * edgeFactor);
        const ry = Math.min(height * 0.42, (82 + depth * 92) * edgeFactor);
        group.forEach((node, i) => {
          if (depth === 0) {
            node.x = cx;
            node.y = cy;
            return;
          }
          const angle = (i / group.length) * Math.PI * 2 + hashId(node.id) * 0.18;
          node.x = cx + Math.cos(angle) * rx;
          node.y = cy + Math.sin(angle) * ry;
        });
      });

    const baseRest = Math.max(76, Math.min(152, width / 4.6)) * edgeFactor;
    for (let iter = 0; iter < 240; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const min = a.r + b.r + 8;
          let force = 5000 / (dist * dist);
          if (dist < min) force += (min - dist) * 0.4;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (a.depth !== 0) {
            a.x -= fx;
            a.y -= fy;
          }
          if (b.depth !== 0) {
            b.x += fx;
            b.y += fy;
          }
        }
      }

      for (const edge of graph.edges) {
        const a = graph.nodes.get(edge.from);
        const b = graph.nodes.get(edge.to);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const rest = baseRest + (a.depth === 0 || b.depth === 0 ? 35 : 0);
        // 只讓 BFS 樹邊有較強彈簧；多出來的交叉邊只輕輕拉住，減少圖面被拉成一團。
        const force = (dist - rest) * (edge.tree ? 0.018 : 0.003);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (a.depth !== 0) {
          a.x += fx;
          a.y += fy;
        }
        if (b.depth !== 0) {
          b.x -= fx;
          b.y -= fy;
        }
      }

      for (const node of nodes) {
        if (node.depth === 0) continue;
        node.x += (cx - node.x) * 0.0004;
        node.y += (cy - node.y) * 0.0004;
        node.x = Math.max(node.r + 8, Math.min(width - node.r - 8, node.x));
        node.y = Math.max(node.r + 8, Math.min(height - node.r - 8, node.y));
      }
    }

    // 最後再單純推開重疊的圓，讓節點多時仍然讀得到詞目。
    for (let pass = 0; pass < 160; pass++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          const min = a.r + b.r + 8;
          if (dist >= min) continue;
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const push = (min - dist) * 0.55 + 0.5;
          const ux = dx / dist;
          const uy = dy / dist;
          if (a.depth !== 0) {
            a.x -= ux * push;
            a.y -= uy * push;
          }
          if (b.depth !== 0) {
            b.x += ux * push;
            b.y += uy * push;
          }
          moved = true;
        }
      }
      for (const node of nodes) {
        node.x = Math.max(node.r + 8, Math.min(width - node.r - 8, node.x));
        node.y = Math.max(node.r + 8, Math.min(height - node.r - 8, node.y));
      }
      if (!moved) break;
    }

    // 節點少時把位置放大，讓圖不要縮在中央；只放大座標，圓與字不變。
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      minY = Math.min(minY, node.y - node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(1.8, (width - 80) / spanX, (height - 80) / spanY);
    if (scale > 1.02) {
      const root = graph.nodes.get(graph.rootId);
      for (const node of nodes) {
        node.x = cx + (node.x - root.x) * scale;
        node.y = cy + (node.y - root.y) * scale;
      }
    }

    // 根節點固定畫布正中央；若放大後有節點超出畫布，再以根節點為中心縮小。
    // 這樣 Ctrl 點新節點重繪時，新中心一定落在 viewBox 的正中央。
    const root = graph.nodes.get(graph.rootId);
    root.x = cx;
    root.y = cy;
    const halfW = Math.max(60, width / 2 - 24);
    const halfH = Math.max(60, height / 2 - 24);
    let maxDx = 0;
    let maxDy = 0;
    for (const node of nodes) {
      if (node === root) continue;
      maxDx = Math.max(maxDx, Math.abs(node.x - root.x) + node.r);
      maxDy = Math.max(maxDy, Math.abs(node.y - root.y) + node.r);
    }
    const fit = Math.min(1, halfW / Math.max(1, maxDx), halfH / Math.max(1, maxDy));
    if (fit < 1) {
      for (const node of nodes) {
        node.x = root.x + (node.x - root.x) * fit;
        node.y = root.y + (node.y - root.y) * fit;
      }
    }
  }

  function cycleGraphFocus(id) {
    const focus = state.graph.focus;
    if (!focus || focus.id !== id) state.graph.focus = { id, mode: 1 };
    else if (focus.mode === 1) state.graph.focus = { id, mode: 2 };
    else state.graph.focus = null;
    render();
  }

  function renderGraphControls(graph) {
    const box = el('div', 'graph-controls');

    const depthLabel = el('label', 'graph-control');
    depthLabel.append(document.createTextNode('層數'));
    const depth = document.createElement('select');
    [1, 2, 3].forEach((n) => {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = String(n);
      depth.append(option);
    });
    depth.id = 'graphDepth';
    depth.value = String(state.graph.depth);
    depth.addEventListener('change', () => {
      state.graph.depth = Number(depth.value);
      state.graph.focus = null;
      render();
    });
    depthLabel.append(depth);

    const fontLabel = el('label', 'graph-control graph-font-control');
    fontLabel.append(document.createTextNode('字級'));
    const font = document.createElement('input');
    font.type = 'range';
    font.id = 'graphFontSize';
    font.min = '12';
    font.max = '24';
    font.step = '0.1';
    font.value = String(state.graph.fontSize);
    const formatSize = (value) => {
      const n = Number(value);
      return (Math.round(n * 10) / 10).toString() + 'px';
    };
    const fontValue = el('span', 'graph-font-value', formatSize(state.graph.fontSize));
    font.addEventListener('input', () => {
      fontValue.textContent = formatSize(font.value);
    });
    font.addEventListener('change', () => {
      state.graph.fontSize = Number(font.value);
      state.graph.focus = null;
      render();
    });
    fontLabel.append(font, fontValue);

    const edgeLabel = el('label', 'graph-control');
    edgeLabel.append(document.createTextNode('連線'));
    const edge = document.createElement('select');
    edge.id = 'graphEdgeLength';
    [
      ['short', '短'],
      ['medium', '中'],
      ['long', '長'],
    ].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      edge.append(option);
    });
    edge.value = state.graph.edgeLength;
    edge.addEventListener('change', () => {
      state.graph.edgeLength = edge.value;
      state.graph.focus = null;
      render();
    });
    edgeLabel.append(edge);

    const widthLabel = el('label', 'graph-control');
    widthLabel.append(document.createTextNode('線粗'));
    const lineWidth = document.createElement('select');
    lineWidth.id = 'graphEdgeWidth';
    [
      ['thin', '細'],
      ['medium', '中'],
      ['thick', '粗'],
    ].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      lineWidth.append(option);
    });
    lineWidth.value = state.graph.edgeWidth;
    lineWidth.addEventListener('change', () => {
      state.graph.edgeWidth = lineWidth.value;
      state.graph.focus = null;
      render();
    });
    widthLabel.append(lineWidth);

    const check = (key, text) => {
      const label = el('label', 'graph-check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = key === 'forward' ? 'graphForward' : 'graphBackward';
      input.checked = state.graph[key];
      input.addEventListener('change', () => {
        state.graph[key] = input.checked;
        state.graph.focus = null;
        render();
      });
      label.append(input);
      label.append(document.createTextNode(text));
      return label;
    };

    const count = el(
      'span',
      'graph-count',
      graph.nodes.size + ' 個節點 · ' + graph.edges.length + ' 條連線'
    );

    const reset = el('button', 'graph-reset', '重設');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      state.graph.depth = 2;
      state.graph.forward = true;
      state.graph.backward = true;
      state.graph.fontSize = 12;
      state.graph.edgeLength = 'medium';
      state.graph.edgeWidth = 'medium';
      state.graph.focus = null;
      render();
    });

    box.append(
      depthLabel,
      fontLabel,
      edgeLabel,
      widthLabel,
      check('forward', '順鏈結'),
      check('backward', '逆鏈結'),
      count,
      reset
    );
    return box;
  }

  function renderGraphLegend() {
    const legend = el('div', 'graph-legend');
    legend.append(el('span', 'graph-legend-label', '深度'));

    for (let d = 0; d <= state.graph.depth; d++) {
      const chip = el('span', 'graph-swatch');
      chip.style.setProperty('--h', String(NT.hue(d)));
      legend.append(chip);
    }
    legend.append(el('span', 'graph-legend-label', '0 → ' + state.graph.depth));

    const addLine = (cls, text) => {
      const item = el('span', 'graph-legend-item');
      item.append(el('span', 'graph-legend-line ' + cls));
      item.append(document.createTextNode(text));
      legend.append(item);
    };
    addLine('is-forward', '順鏈結');
    addLine('is-back', '逆鏈結');
    legend.append(el('span', 'graph-legend-item', '大小＝連結數'));

    const badge = el('span', 'graph-legend-item');
    badge.append(el('span', 'graph-legend-badge', '生'));
    badge.append(document.createTextNode('其他科目'));
    legend.append(badge);
    return legend;
  }

  /**
   * 圖譜設定：半透明浮在畫布上，可收合成一行，讓圖譜拿到更多畫面。
   * 收合狀態存在 localStorage（offtext.graphPanel.v1）。
   */
  function renderGraphPanel(graph) {
    const panel = el('div', 'graph-panel' + (graphPanelCollapsed ? ' is-collapsed' : ''));
    const head = el('div', 'graph-panel-head');
    const toggle = el('button', 'graph-panel-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!graphPanelCollapsed));
    toggle.setAttribute('aria-controls', 'graphPanelBody');
    toggle.title = graphPanelCollapsed ? '展開圖譜設定' : '收合圖譜設定';

    const chevron = el('span', 'graph-panel-chevron', '▾');
    toggle.append(
      el('span', 'graph-panel-icon', '⚙'),
      el('span', 'graph-panel-label', '圖譜設定'),
      chevron
    );

    const body = el('div', 'graph-panel-body');
    body.id = 'graphPanelBody';
    body.append(renderGraphControls(graph), renderGraphLegend());
    panel.append(head, body);
    head.append(toggle);

    toggle.addEventListener('click', () => {
      graphPanelCollapsed = !graphPanelCollapsed;
      panel.classList.toggle('is-collapsed', graphPanelCollapsed);
      toggle.setAttribute('aria-expanded', String(!graphPanelCollapsed));
      toggle.title = graphPanelCollapsed ? '展開圖譜設定' : '收合圖譜設定';
      try {
        localStorage.setItem(GRAPH_PANEL_KEY, graphPanelCollapsed ? '1' : '0');
      } catch (e) {
        /* 私密模式 */
      }
      updateGraphPanelFloat();
    });

    return panel;
  }

  /** 圖譜設定跟著捲動：離開畫布頂端後改成 fixed，仍貼在右側。 */
  function updateGraphPanelFloat() {
    const panel = document.querySelector('.graph-panel');
    if (!panel || state.view !== 'graph') return;
    const stage = panel.closest('.graph-stage');
    if (!stage) return;
    const topbar = document.querySelector('.topbar');
    const top = Math.round((topbar ? topbar.getBoundingClientRect().bottom : 0) + 10);
    const stageRect = stage.getBoundingClientRect();
    const shouldFloat = stageRect.top < top && stageRect.bottom > top + 120;

    panel.classList.toggle('is-floating', shouldFloat);
    if (!shouldFloat) {
      panel.style.top = '';
      panel.style.right = '';
      panel.style.left = '';
      panel.style.width = '';
      return;
    }

    const width = Math.min(370, Math.max(180, Math.round(stageRect.width - 20)));
    panel.style.top = top + 'px';
    panel.style.right =
      Math.max(10, Math.round(window.innerWidth - stageRect.right + 10)) + 'px';
    panel.style.left = 'auto';
    panel.style.width = panel.classList.contains('is-collapsed') ? 'auto' : width + 'px';
  }

  window.addEventListener('scroll', updateGraphPanelFloat, { passive: true });
  window.addEventListener('resize', updateGraphPanelFloat);

  function renderGraphFocusBar(graph) {
    const focus = state.graph.focus;
    if (!focus) return null;
    const node = graph.nodes.get(focus.id);
    if (!node || node.id === graph.rootId) return null;
    const bar = el('div', 'graph-focus-bar');
    bar.append(
      el(
        'span',
        'graph-focus-label',
        '已選：' +
          disp(node.key) +
          ' · ' +
          (focus.mode === 2 ? '逆鏈' : '順鏈')
      )
    );
    const center = el('button', 'graph-focus-center', '設成中心');
    center.type = 'button';
    center.title = '以「' + disp(node.key) + '」為圖譜中心，不離開圖譜';
    center.addEventListener('click', () =>
      navigateGraph(node.domain, node.key, { recenter: true })
    );
    bar.append(center);
    return bar;
  }

  function renderGraphSvg(graph, rootDomain, width, height) {
    const focus = state.graph.focus;
    const litEdges = new Set();
    const litNodes = new Set();

    if (focus) {
      litNodes.add(focus.id);
      for (const edge of graph.edges) {
        if (focus.mode === 1 && edge.kind === 'forward' && edge.from === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.to);
        } else if (focus.mode === 2 && edge.kind === 'back' && edge.to === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.from);
        }
      }
    }

    const svg = svgEl('svg', {
      class: 'graph-svg',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': '條目鏈結圖譜',
    });
    svg.style.setProperty('--graph-font-size', state.graph.fontSize + 'px');
    svg.style.setProperty(
      '--graph-edge-width',
      (GRAPH_EDGE_WIDTHS[state.graph.edgeWidth] || 2.4) + 'px'
    );
    const defs = svgEl('defs');
    const arrow = svgEl('marker', {
      id: 'graph-arrow',
      viewBox: '0 0 10 10',
      refX: '9.5',
      refY: '5',
      markerWidth: '5.5',
      markerHeight: '5.5',
      orient: 'auto',
      markerUnits: 'strokeWidth',
    });
    arrow.append(
      svgEl('path', {
        class: 'graph-arrow-head',
        d: 'M 0 0 L 10 5 L 0 10 z',
        fill: 'context-stroke',
      })
    );
    defs.append(arrow);
    svg.append(defs);
    const bg = svgEl('rect', {
      class: 'graph-bg',
      width,
      height,
    });
    svg.append(bg);

    const edgeLayer = svgEl('g', { class: 'graph-edge-layer' });
    const reverse = new Set(graph.edges.map((edge) => edge.to + '|' + edge.from));
    graph.edges.forEach((edge) => {
      const a = graph.nodes.get(edge.from);
      const b = graph.nodes.get(edge.to);
      if (!a || !b) return;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ux = dx / dist;
      const uy = dy / dist;
      const both = reverse.has(edge.from + '|' + edge.to);
      const off = both ? 2.2 : 0;
      const sign = edge.from < edge.to ? 1 : -1;
      const ox = -uy * off * sign;
      const oy = ux * off * sign;
      const x1 = a.x + ux * (a.r + 2) + ox;
      const y1 = a.y + uy * (a.r + 2) + oy;
      const x2 = b.x - ux * (b.r + 3) + ox;
      const y2 = b.y - uy * (b.r + 3) + oy;

      let cls = 'graph-edge is-' + edge.kind + (edge.tree ? ' is-tree' : ' is-extra');
      if (focus) cls += litEdges.has(edge) ? ' is-lit' : ' is-dim';

      const line = svgEl('line', {
        class: cls,
        x1,
        y1,
        x2,
        y2,
        'marker-end': 'url(#graph-arrow)',
        'data-from': edge.from,
        'data-to': edge.to,
        'data-kind': edge.kind,
      });
      line.style.setProperty('--hue', String(NT.hue(Math.max(a.depth, b.depth))));
      edgeLayer.append(line);
    });
    svg.append(edgeLayer);

    const nodeLayer = svgEl('g', { class: 'graph-node-layer' });
    const ordered = [...graph.nodes.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    ordered.forEach((node) => {
      const cross = node.domain !== rootDomain;
      let cls = 'graph-node';
      if (node.id === graph.rootId) cls += ' is-root';
      if (cross) cls += ' is-cross';
      if (focus) {
        if (node.id === focus.id) cls += ' is-selected';
        else if (litNodes.has(node.id)) cls += ' is-lit';
        else cls += ' is-dim';
      }

      const group = svgEl('g', {
        class: cls,
        transform: 'translate(' + node.x + ' ' + node.y + ')',
        tabindex: 0,
        role: 'button',
        'data-id': node.id,
        'data-key': node.key,
        'data-depth': node.depth,
        'aria-label':
          disp(domainName(node.domain)) +
          ' ' +
          disp(node.key) +
          '；點擊切換順鏈／逆鏈高亮；Ctrl 點擊以此為起點',
      });
      group.style.setProperty('--hue', String(NT.hue(node.depth)));

      const counts = graphCounts(node.id);
      const title = svgEl('title');
      title.textContent =
        disp(domainName(node.domain)) +
        '：' +
        disp(node.key) +
        '（順 ' +
        counts.forward +
        '／逆 ' +
        counts.back +
        '／深度 ' +
        node.depth +
        '）';
      group.append(title);

      if (cross) {
        group.append(svgEl('circle', { class: 'graph-node-halo', r: node.r + 3 }));
      }
      group.append(svgEl('circle', { class: 'graph-node-circle', r: node.r }));

      const lines = graphLabel(node.key, node.domain);
      const text = svgEl('text', {
        class: 'graph-node-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      lines.forEach((line, i) => {
        const tspan = svgEl('tspan', {
          x: 0,
          y: (i - (lines.length - 1) / 2) * state.graph.fontSize * 1.1,
        });
        tspan.textContent = line;
        text.append(tspan);
      });
      group.append(text);

      if (cross) {
        const badge = svgEl('g', { class: 'graph-badge' });
        badge.append(svgEl('circle', { cx: node.r * 0.72, cy: -node.r * 0.72, r: 8 }));
        const badgeText = svgEl('text', {
          x: node.r * 0.72,
          y: -node.r * 0.72 + 2.5,
          'text-anchor': 'middle',
        });
        badgeText.textContent = graphShortDomain(node.domain);
        badge.append(badgeText);
        group.append(badge);
      }

      group.addEventListener('mouseenter', (e) => showGraphTip(node, e.clientX, e.clientY));
      group.addEventListener('mousemove', (e) => {
        if (!graphTip.hidden) moveGraphTip(e.clientX, e.clientY);
      });
      group.addEventListener('mouseleave', hideGraphTip);
      group.addEventListener('focus', () => {
        const rect = group.getBoundingClientRect();
        showGraphTip(node, rect.left + rect.width / 2, rect.top);
      });
      group.addEventListener('blur', hideGraphTip);

      group.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== 'mobile') {
          e.preventDefault();
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });
      group.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== 'mobile') {
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });

      nodeLayer.append(group);
    });
    svg.append(nodeLayer);

    bg.addEventListener('click', () => {
      if (!state.graph.focus) return;
      state.graph.focus = null;
      render();
    });

    return svg;
  }

  function graphContentWidth() {
    const style = getComputedStyle(reader);
    const pad = parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0);
    return Math.max(320, Math.round(reader.clientWidth - pad));
  }

  function graphCanvasHeight(count, width) {
    const fontFactor = 1 + ((state.graph.fontSize - 12) / 12) * 0.65;
    const edgeFactor =
      state.graph.edgeLength === 'short' ? 0.9 : state.graph.edgeLength === 'long' ? 1.15 : 1;
    const base = width * 0.44 + Math.max(0, count - 6) * 18;
    return Math.max(420, Math.min(2800, Math.round(base * fontFactor * edgeFactor)));
  }

  function renderGraph() {
    hideGraphTip();
    const res = NT.resolve(state.index, state.root.key, state.root.domain);
    if (res.status !== 'ok') {
      reader.append(emptyState(res));
      return;
    }

    const rootId = res.domain + ':' + res.key;
    const graph = buildGraph(rootId, state.graph);
    if (state.graph.focus && !graph.nodes.has(state.graph.focus.id)) state.graph.focus = null;
    const width = graphContentWidth();
    const height = graphCanvasHeight(graph.nodes.size, width);
    layoutGraph(graph, width, height);


    const article = el('article', 'graph');
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', '圖譜 · ' + disp(domainName(res.domain))));

    const titleRow = el('div', 'entry-title-row');
    titleRow.append(
      el('h1', 'entry-title', disp(displayKey(res.domain, res.key)))
    );
    const back = el('button', 'graph-back', '回到條目');
    back.type = 'button';
    back.addEventListener('click', () => navigate(res.domain, res.key));
    titleRow.append(back);
    head.append(titleRow);
    head.append(
      el(
        'p',
        'index-hint',
        '以「' +
          disp(displayKey(res.domain, res.key)) +
          '」為起點。滑過節點看釋文；點節點切換順鏈／逆鏈高亮；Ctrl/⌘+點擊以它為起點重繪。'
      )
    );
    article.append(head);

    const stage = el('div', 'graph-stage');
    stage.append(renderGraphPanel(graph));
    const canvas = el('div', 'graph-canvas');
    canvas.append(renderGraphSvg(graph, res.domain, width, height));
    stage.append(canvas);
    const focusBar = renderGraphFocusBar(graph);
    if (focusBar) stage.append(focusBar);
    article.append(stage);

    if (!graph.edges.length) {
      article.append(
        el(
          'p',
          'graph-note',
          state.graph.forward || state.graph.backward
            ? '目前設定下沒有可畫的連線。試試增加層數。'
            : '順鏈結與逆鏈結都關閉了；開啟至少一種才會畫線。'
        )
      );
    }
    if (graph.truncated) {
      article.append(
        el(
          'p',
          'graph-note',
          '節點超過 ' +
            GRAPH_MAX_NODES +
            ' 個，只顯示 ' +
            graph.nodes.size +
            ' 個；降低層數或關閉其中一種鏈結可看得更清楚。'
        )
      );
    }

    reader.append(article);
    requestAnimationFrame(updateGraphPanelFloat);
  }

  /* ---------- 索引：用 graph 連線數探索節點 ---------- */

  const INDEX_VIEWS = [
    ['all', '全部'],
    ['zero', '零連結'],
    ['cross', '跨領域'],
    ['both', '有順有逆'],
  ];
  const INDEX_SORTS = [
    ['product', '乘積（順×逆）'],
    ['forward', '順鏈次數'],
    ['back', '逆鏈次數'],
    ['cross', '跨領域連線'],
    ['name', '名稱'],
  ];
  const INDEX_PAGE_SIZE = 120;

  let indexRowCache = null;
  let indexRowCacheFor = null;
  let indexRowCacheMode = -1;

  function indexCount(domain) {
    let n = 0;
    for (const [key, value] of domain.entries) {
      if (key === '_' || isReservedKey(key) || isRedirect(value)) continue;
      n++;
    }
    return n;
  }

  function indexRows() {
    const mode = SETTINGS ? SETTINGS.simModeOf() : 0;
    if (indexRowCache && indexRowCacheFor === state.index && indexRowCacheMode === mode) {
      return indexRowCache;
    }

    const rows = [];
    for (const entry of entries) {
      const id = entry.domain + ':' + entry.key;
      const forwardSet = state.index.links.forward.get(id);
      const backwardSet = state.index.links.backward.get(id);
      let forward = 0;
      let back = 0;
      let crossOut = 0;
      let crossIn = 0;
      const crossCounts = new Map();
      const addCross = (domain) => {
        crossCounts.set(domain, (crossCounts.get(domain) || 0) + 1);
      };

      if (forwardSet) {
        forward = forwardSet.size;
        for (const target of forwardSet) {
          const domain = target.slice(0, target.indexOf(':'));
          if (domain !== entry.domain) {
            crossOut++;
            addCross(domain);
          }
        }
      }
      if (backwardSet) {
        back = backwardSet.size;
        for (const source of backwardSet) {
          const domain = source.slice(0, source.indexOf(':'));
          if (domain !== entry.domain) {
            crossIn++;
            addCross(domain);
          }
        }
      }

      const crossDomains = [...crossCounts.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort(
          (a, b) =>
            b.count - a.count ||
            domainName(a.domain).localeCompare(domainName(b.domain), 'zh-Hant')
        );

      rows.push({
        ...entry,
        id,
        forward,
        back,
        product: forward * back,
        crossOut,
        crossIn,
        cross: crossOut + crossIn,
        crossDomains,
      });
    }

    indexRowCache = rows;
    indexRowCacheFor = state.index;
    indexRowCacheMode = mode;
    return rows;
  }

  function indexZeroKind(row) {
    if (!row.forward && !row.back) return 'none';
    if (!row.forward) return 'no-forward';
    return 'no-back';
  }

  function indexZeroLabel(row) {
    return { none: '全無', 'no-forward': '無順鏈', 'no-back': '無逆鏈' }[indexZeroKind(row)];
  }

  function indexBaseRows() {
    let rows = indexRows();
    if (state.indexDomain) rows = rows.filter((row) => row.domain === state.indexDomain);

    const query = state.indexQuery.trim().toLowerCase();
    if (query) {
      const forms = SETTINGS ? SETTINGS.searchForms(query) : [query];
      const needles = forms.map((form) => form.toLowerCase());
      rows = rows.filter((row) => needles.some((needle) => row.hay.includes(needle)));
    }
    return rows;
  }

  function indexSortName() {
    const hit = INDEX_SORTS.find(([key]) => key === state.indexSort);
    return hit ? hit[1] : INDEX_SORTS[0][1];
  }

  function sortIndexRows(rows) {
    const byName = (a, b) =>
      a.key.localeCompare(b.key, 'zh-Hant') ||
      a.domainName.localeCompare(b.domainName, 'zh-Hant') ||
      a.domain.localeCompare(b.domain);
    const byTotal = (a, b) => b.forward + b.back - (a.forward + a.back);
    // 零連結時乘積全是 0；預設再依「全無 → 無順鏈 → 無逆鏈」分組，方便逐類補鏈。
    const zeroRank = { none: 0, 'no-forward': 1, 'no-back': 2 };
    const sorters = {
      product: (a, b) => {
        if (state.indexView === 'zero') {
          const rank = zeroRank[indexZeroKind(a)] - zeroRank[indexZeroKind(b)];
          if (rank) return rank;
          return byName(a, b);
        }
        return b.product - a.product || b.cross - a.cross || byTotal(a, b) || byName(a, b);
      },
      forward: (a, b) => b.forward - a.forward || b.product - a.product || byName(a, b),
      back: (a, b) => b.back - a.back || b.product - a.product || byName(a, b),
      cross: (a, b) => b.cross - a.cross || b.product - a.product || byName(a, b),
      name: byName,
    };
    return rows.sort(sorters[state.indexSort] || sorters.product);
  }

  function indexViewCounts(base) {
    return {
      all: base.length,
      zero: base.filter((row) => row.product === 0).length,
      cross: base.filter((row) => row.cross > 0).length,
      both: base.filter((row) => row.product > 0).length,
    };
  }

  function indexViewRows(base) {
    if (state.indexView === 'zero') return base.filter((row) => row.product === 0);
    if (state.indexView === 'cross') return base.filter((row) => row.cross > 0);
    if (state.indexView === 'both') return base.filter((row) => row.product > 0);
    return base.slice();
  }

  function renderIndexTabs(selected) {
    const nav = el('nav', 'index-tabs');
    nav.setAttribute('aria-label', '索引科目');

    const add = (id, label, count) => {
      const active = id === selected;
      const btn = el('button', 'index-tab' + (active ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.domain = id;
      btn.setAttribute('aria-pressed', String(active));
      btn.append(el('span', 'index-tab-name', label));
      btn.append(el('span', 'index-tab-count', String(count)));
      btn.addEventListener('click', () => navigateIndex(id === 'all' ? null : id));
      nav.append(btn);
    };

    add('all', '全部科目', entries.length);
    domains.forEach((domain) => add(domain.id, disp(domain.name || domain.id), indexCount(domain)));
    return nav;
  }

  function renderIndex() {
    const allRows = indexRows();
    const article = el('article', 'index');
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', '資料表'));
    head.append(el('h1', 'entry-title', '索引'));
    head.append(
      el(
        'p',
        'index-hint',
        '共 ' +
          allRows.length +
          ' 條、' +
          domains.length +
          ' 個科目。先用文字搜尋，再依科目、連線狀態與排序縮小範圍。順／逆是順鏈／逆鏈次數，×是兩者乘積；點條目閱讀，按「圖」以該節點開圖譜。'
      )
    );

    const searchRow = el('div', 'index-search-row');
    const searchLabel = el('label', 'index-search-label');
    searchLabel.append(document.createTextNode('搜尋'));
    const search = document.createElement('input');
    search.id = 'indexSearch';
    search.className = 'index-search';
    search.type = 'search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.placeholder = '條目名稱或內容…';
    search.setAttribute('aria-label', '搜尋索引條目');
    search.value = state.indexQuery;
    searchLabel.append(search);
    searchRow.append(searchLabel);

    const clear = el('button', 'index-search-clear', '清除');
    clear.type = 'button';
    clear.title = '清除搜尋字';
    clear.hidden = !state.indexQuery;
    searchRow.append(clear);
    head.append(searchRow);

    head.append(renderIndexTabs(state.indexDomain || 'all'));

    const controls = el('div', 'index-controls');
    const views = el('nav', 'index-views');
    views.setAttribute('aria-label', '節點連線檢視');
    const viewButtons = {};
    INDEX_VIEWS.forEach(([key, label]) => {
      const active = key === state.indexView;
      const btn = el('button', 'index-view' + (active ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.view = key;
      btn.setAttribute('aria-pressed', String(active));
      btn.append(el('span', 'index-view-name', label));
      const count = el('span', 'index-view-count', '0');
      btn.append(count);
      btn.addEventListener('click', () => {
        if (state.indexView === key) return;
        state.indexView = key;
        state.indexLimit = INDEX_PAGE_SIZE;
        refresh();
      });
      viewButtons[key] = { button: btn, count };
      views.append(btn);
    });
    controls.append(views);

    const sortLabel = el('label', 'index-sort');
    sortLabel.append(document.createTextNode('排序'));
    const sort = document.createElement('select');
    sort.id = 'indexSort';
    sort.className = 'index-sort-select';
    sort.setAttribute('aria-label', '索引排序');
    INDEX_SORTS.forEach(([key, label]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label;
      option.selected = key === state.indexSort;
      sort.append(option);
    });
    sort.addEventListener('change', () => {
      state.indexSort = sort.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    sortLabel.append(sort);
    controls.append(sortLabel);
    head.append(controls);

    const summary = el('p', 'index-summary');
    head.append(summary);
    article.append(head);

    const results = el('div', 'index-results');
    article.append(results);

    function refresh() {
      const base = indexBaseRows();
      const counts = indexViewCounts(base);

      Object.entries(viewButtons).forEach(([key, item]) => {
        item.count.textContent = String(counts[key]);
        const active = state.indexView === key;
        item.button.classList.toggle('is-active', active);
        item.button.setAttribute('aria-pressed', String(active));
      });
      clear.hidden = !state.indexQuery;

      const rows = sortIndexRows(indexViewRows(base));
      const query = state.indexQuery.trim();
      const scope = state.indexDomain ? disp(domainName(state.indexDomain)) : '全部科目';
      let text =
        scope +
        ' · 符合 ' +
        rows.length +
        ' 個節點' +
        (query ? '（搜尋「' + query + '」）' : '') +
        ' · 依' +
        indexSortName() +
        '排序';
      if (state.indexView === 'zero') {
        let none = 0;
        let noForward = 0;
        let noBack = 0;
        rows.forEach((row) => {
          if (!row.forward && !row.back) none++;
          else if (!row.forward) noForward++;
          else noBack++;
        });
        text += ' · 全無 ' + none + '、無順鏈 ' + noForward + '、無逆鏈 ' + noBack;
      } else if (state.indexView === 'cross') {
        const outCount = rows.filter((row) => row.crossOut > 0).length;
        const inCount = rows.filter((row) => row.crossIn > 0).length;
        text += ' · 對外 ' + outCount + '、對內 ' + inCount;
      }
      summary.textContent = text;

      results.textContent = '';
      if (!rows.length) {
        const empty = el('div', 'index-empty');
        empty.append(el('strong', null, '沒有符合的節點'));
        empty.append(el('p', null, '換個搜尋字，或把科目／檢視條件放寬。'));
        const reset = el('button', 'ghost', '清除搜尋與篩選');
        reset.type = 'button';
        reset.addEventListener('click', () => {
          state.indexQuery = '';
          state.indexView = 'all';
          state.indexLimit = INDEX_PAGE_SIZE;
          if (state.indexDomain) navigateIndex();
          else render();
        });
        empty.append(reset);
        results.append(empty);
        return;
      }

      const shown = rows.slice(0, state.indexLimit);
      const meta = el(
        'p',
        'index-result-count',
        '顯示 ' +
          shown.length +
          ' / ' +
          rows.length +
          ' 個' +
          (rows.length > shown.length ? ' · 還有 ' + (rows.length - shown.length) + ' 個' : '')
      );
      results.append(meta);

      const list = el('div', 'index-list');
      shown.forEach((row) => list.append(indexItem(row)));
      results.append(list);

      if (rows.length > shown.length) {
        const more = el('button', 'index-more', '顯示更多');
        more.type = 'button';
        more.addEventListener('click', () => {
          state.indexLimit += INDEX_PAGE_SIZE;
          refresh();
        });
        results.append(more);
      }
    }

    search.addEventListener('input', () => {
      state.indexQuery = search.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      state.indexQuery = '';
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = '';
      refresh();
      search.blur();
    });
    clear.addEventListener('click', () => {
      state.indexQuery = '';
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = '';
      refresh();
      search.focus();
    });

    reader.append(article);
    refresh();
  }

  function indexItem(row) {
    const item = el('div', 'index-item');
    item.dataset.domain = row.domain;
    item.dataset.key = row.key;
    const main = el('button', 'index-main');
    main.type = 'button';
    main.title = '閱讀「' + disp(row.key) + '」';
    main.setAttribute('aria-label', '閱讀「' + disp(row.key) + '」');

    const top = el('span', 'index-top');
    top.append(el('span', 'index-key', disp(row.key)));
    if (!state.indexDomain) {
      top.append(el('span', 'index-domain-tag', disp(row.domainName)));
    }
    if (!row.product) {
      top.append(el('span', 'index-zero-tag', indexZeroLabel(row)));
    }
    main.append(top);

    const meta = el('span', 'index-meta');
    const addStat = (text, title, extra) => {
      const stat = el('span', 'index-stat' + (extra ? ' ' + extra : ''), text);
      stat.title = title;
      meta.append(stat);
    };
    addStat('順 ' + row.forward, '順鏈：本條目引用 ' + row.forward + ' 個條目');
    addStat('逆 ' + row.back, '逆鏈：本條目被 ' + row.back + ' 個條目引用');
    addStat('×' + row.product, '順鏈次數 × 逆鏈次數', 'is-product');
    if (row.cross) {
      row.crossDomains.forEach(({ domain, count }) => {
        const name = disp(domainName(domain));
        addStat(name + ' ' + count, '與「' + name + '」的連線 ' + count + ' 條', 'is-cross');
      });
    }
    main.append(meta);

    main.append(el('span', 'index-preview', row.preview));
    main.addEventListener('click', () => navigate(row.domain, row.key));
    item.append(main);

    const graph = el('button', 'index-graph');
    graph.type = 'button';
    graph.title = '以「' + disp(row.key) + '」為中心開圖譜';
    graph.setAttribute('aria-label', '以「' + disp(row.key) + '」為中心開圖譜');
    graph.append(indexGraphGlyph());
    graph.addEventListener('click', () => navigateGraph(row.domain, row.key));
    item.append(graph);
    return item;
  }

  /** 和 toolbar 的「文／圖譜」toggle 相同的三小圈圖示。 */
  function indexGraphGlyph() {
    const svg = svgEl('svg', {
      class: 'index-graph-icon',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.append(svgEl('path', { d: 'M7.8 7.8 11 13.2M16.2 7.8 13 13.2' }));
    svg.append(svgEl('circle', { cx: 7, cy: 6, r: 2.1 }));
    svg.append(svgEl('circle', { cx: 17, cy: 6, r: 2.1 }));
    svg.append(svgEl('circle', { cx: 12, cy: 16.5, r: 3.2 }));
    return svg;
  }

  function emptyState(res) {
    const box = el('div', 'empty');
    box.append(el('h2', null, '找不到這個條目'));
    box.append(el('p', null, disp(res.name || '')));
    const back = el('button', 'ghost', '回到索引');
    back.type = 'button';
    back.addEventListener('click', () => navigateIndex());
    box.append(back);
    return box;
  }

/* ---- 70-export.js ---- */
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

    function el(tag, cls, text) {
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

    function closeCards(from) {
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

/* ---- 80-main.js ---- */
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

/* ---- 90-tour.js ---- */
/* 導覽：右上角 🦮 的快速入門
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 *
 * 每個步驟停留 5 秒，點畫面可提前下一步，Esc／×／🦮 可隨時結束。
 * 進階設置與編輯文本先保留入口，晚點再補內容。
 */

  const TOUR_STEP_MS = 5000;
  const TOUR_TARGET_TIMEOUT = 8000;

  const TOUR_DEFS = [
    {
      id: 'quick',
      title: '快速入門',
      desc: '約 1 分鐘 · 介面、索引、展開引用',
      icon: '🦮',
      ready: true,
    },
    {
      id: 'advanced',
      title: '進階設置',
      desc: '預留，晚點再做',
      icon: '⚙',
      ready: false,
    },
    {
      id: 'edit',
      title: '編輯文本',
      desc: '預留，晚點再做',
      icon: '✎',
      ready: false,
    },
  ];

  let tourBtn = null;
  let tourMenu = null;
  let tourLayer = null;
  let tourSpot = null;
  let tourBubble = null;
  let tourTitleEl = null;
  let tourTextEl = null;
  let tourStepEl = null;
  let tourHintEl = null;
  let tourNoteEl = null;
  let tourNextEl = null;
  let tourBarEl = null;

  let tourSteps = [];
  let tourIndex = -1;
  let tourRunning = false;
  let tourMenuOpen = false;
  let tourTimer = 0;
  let tourToken = 0;
  let tourTarget = null;
  let tourAdvancing = false;

  const tourSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function tourVisible(node) {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(node).visibility !== 'hidden'
    );
  }

  function tourResolve(target) {
    if (!target) return null;
    if (typeof target === 'function') return target();
    return document.querySelector(target);
  }

  function tourClick(selector) {
    const node = document.querySelector(selector);
    if (!node) throw new Error('tour target missing: ' + selector);
    node.click();
  }

  function tourFindIndexRow(key) {
    return [...document.querySelectorAll('.index-item')].find(
      (row) => row.dataset.key === key
    ) || null;
  }

  function tourFindRef(labels) {
    const wanted = Array.isArray(labels) ? labels : [labels];
    const nodes = [...document.querySelectorAll('.cm-ref, .nt-ref')];
    return (
      nodes.find((node) => {
        if (!tourVisible(node)) return false;
        const text = (node.textContent || '').trim();
        const ref = node.dataset.ref || '';
        return wanted.includes(text) || wanted.includes(ref);
      }) || null
    );
  }

  function setTourNote(text) {
    if (!tourNoteEl) return;
    tourNoteEl.textContent = text;
    tourNoteEl.hidden = !text;
  }

  /* ---------- 選單 ---------- */

  function buildTourMenu() {
    tourMenu = el('div', 'tour-menu');
    tourMenu.id = 'tourMenu';
    tourMenu.hidden = true;
    tourMenu.setAttribute('role', 'dialog');
    tourMenu.setAttribute('aria-label', '操作導覽');

    const head = el('div', 'tour-menu-head');
    head.append(el('strong', 'tour-menu-title', '導覽'));
    const close = el('button', 'tour-menu-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉導覽選單');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      setTourMenuOpen(false);
    });
    head.append(close);
    tourMenu.append(head);
    tourMenu.append(
      el('p', 'tour-menu-intro', '跟著畫面走一遍；每一步 5 秒，也可以點畫面提前。')
    );

    TOUR_DEFS.forEach((def) => {
      const card = el('button', 'tour-card' + (def.ready ? ' is-ready' : ' is-disabled'));
      card.type = 'button';
      card.dataset.tour = def.id;
      card.disabled = !def.ready;
      if (!def.ready) card.title = '預留，晚點再做';

      const icon = el('span', 'tour-card-icon', def.icon);
      const body = el('span', 'tour-card-body');
      body.append(el('strong', null, def.title));
      body.append(el('span', 'tour-card-desc', def.desc));
      card.append(icon, body);
      if (def.ready) {
        card.addEventListener('click', (event) => {
          event.stopPropagation();
          startTour(def.id);
        });
      } else {
        card.append(el('span', 'tour-card-badge', '預留'));
      }
      tourMenu.append(card);
    });

    document.body.append(tourMenu);
  }

  function positionTourMenu() {
    if (!tourMenu || !tourBtn || tourMenu.hidden) return;
    const rect = tourBtn.getBoundingClientRect();
    const width = tourMenu.offsetWidth || 300;
    const height = tourMenu.offsetHeight || 220;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 8);
    }
    tourMenu.style.left = Math.round(left) + 'px';
    tourMenu.style.top = Math.round(top) + 'px';
  }

  function setTourMenuOpen(open) {
    if (!tourMenu || !tourBtn) return;
    tourMenuOpen = open;
    tourMenu.hidden = !open;
    tourBtn.setAttribute('aria-expanded', String(open));
    if (open) positionTourMenu();
  }

  /* ---------- 導覽層 ---------- */

  function buildTourLayer() {
    tourLayer = el('div', 'tour-layer');
    tourLayer.id = 'tourLayer';
    tourLayer.hidden = true;

    tourSpot = el('div', 'tour-spot');
    tourSpot.id = 'tourSpot';
    tourSpot.hidden = true;

    tourBubble = el('section', 'tour-bubble');
    tourBubble.id = 'tourBubble';
    tourBubble.hidden = true;
    tourBubble.tabIndex = -1;
    tourBubble.setAttribute('role', 'dialog');
    tourBubble.setAttribute('aria-modal', 'true');
    tourBubble.setAttribute('aria-label', '操作導覽');

    const head = el('div', 'tour-head');
    tourStepEl = el('span', 'tour-step', '');
    tourStepEl.id = 'tourStep';
    const close = el('button', 'tour-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '結束導覽');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      stopTour(false);
    });
    head.append(tourStepEl, close);
    tourBubble.append(head);

    tourTitleEl = el('h2', 'tour-title', '');
    tourTitleEl.id = 'tourTitle';
    tourBubble.setAttribute('aria-labelledby', 'tourTitle');
    tourBubble.append(tourTitleEl);

    tourTextEl = el('p', 'tour-text', '');
    tourTextEl.id = 'tourText';
    tourTextEl.setAttribute('aria-live', 'polite');
    tourBubble.append(tourTextEl);

    tourNoteEl = el('p', 'tour-note', '');
    tourNoteEl.id = 'tourNote';
    tourNoteEl.hidden = true;
    tourBubble.append(tourNoteEl);

    const foot = el('div', 'tour-foot');
    tourHintEl = el('span', 'tour-hint', '');
    tourHintEl.id = 'tourHint';
    tourNextEl = el('button', 'tour-next', '下一步');
    tourNextEl.type = 'button';
    tourNextEl.id = 'tourNext';
    tourNextEl.addEventListener('click', (event) => {
      event.stopPropagation();
      advanceTour();
    });
    foot.append(tourHintEl, tourNextEl);
    tourBubble.append(foot);

    const bar = el('div', 'tour-bar');
    tourBarEl = el('span', 'tour-bar-fill', '');
    tourBarEl.id = 'tourBar';
    bar.append(tourBarEl);
    tourBubble.append(bar);

    tourLayer.append(tourSpot, tourBubble);
    document.body.append(tourLayer);

    tourLayer.addEventListener('click', (event) => {
      if (!tourRunning) return;
      if (event.target.closest('.tour-close, .tour-next')) return;
      event.preventDefault();
      advanceTour();
    });
  }

  function layoutTour() {
    if (!tourRunning || !tourLayer || tourLayer.hidden) return;
    const target = tourTarget && tourVisible(tourTarget) ? tourTarget : null;
    if (!target) {
      tourTarget = null;
      tourLayer.classList.add('is-full');
      tourSpot.hidden = true;
      tourBubble.classList.remove('is-top');
      return;
    }

    tourLayer.classList.remove('is-full');
    const rect = target.getBoundingClientRect();
    const pad = 6;
    tourSpot.hidden = false;
    tourSpot.style.left = Math.round(rect.left - pad) + 'px';
    tourSpot.style.top = Math.round(rect.top - pad) + 'px';
    tourSpot.style.width = Math.round(rect.width + pad * 2) + 'px';
    tourSpot.style.height = Math.round(rect.height + pad * 2) + 'px';

    const lower = rect.top + rect.height / 2 > window.innerHeight / 2;
    tourBubble.classList.toggle('is-top', lower);
  }

  async function waitForTourTarget(target, token) {
    const started = Date.now();
    while (Date.now() - started < TOUR_TARGET_TIMEOUT) {
      if (token !== tourToken || !tourRunning) return null;
      let node = null;
      try {
        node = tourResolve(target);
      } catch (e) {
        node = null;
      }
      if (tourVisible(node)) return node;
      await tourSleep(120);
    }
    return null;
  }

  function startTourTimer(step) {
    const ms = (step && step.seconds ? step.seconds : 5) * 1000;
    if (tourHintEl) {
      tourHintEl.textContent =
        '點畫面繼續 · ' + Math.round(ms / 1000) + ' 秒後自動';
    }
    if (tourBarEl) {
      tourBarEl.style.animation = 'none';
      tourBarEl.style.width = '100%';
      void tourBarEl.offsetWidth;
      tourBarEl.style.animation = 'tourCountdown ' + ms + 'ms linear forwards';
    }
    tourTimer = setTimeout(() => advanceTour(), ms);
  }

  async function showStep(index) {
    const token = ++tourToken;
    clearTimeout(tourTimer);
    tourTimer = 0;
    if (!tourRunning) return;
    if (index >= tourSteps.length) {
      stopTour(true);
      return;
    }

    tourIndex = index;
    const step = tourSteps[index];
    tourTarget = null;
    tourBubble.hidden = false;
    tourLayer.classList.toggle('is-full', !step.target);
    tourBubble.classList.remove('is-top');
    tourSpot.hidden = true;

    if (tourStepEl) tourStepEl.textContent = index + 1 + ' / ' + tourSteps.length;
    if (tourTitleEl) tourTitleEl.textContent = step.title || '';
    if (tourTextEl) tourTextEl.innerHTML = step.text || '';
    if (tourNextEl) {
      tourNextEl.textContent =
        index === tourSteps.length - 1 ? '完成' : index === 0 ? '開始' : '下一步';
    }
    if (tourHintEl) tourHintEl.textContent = '準備畫面…';
    if (tourBarEl) {
      tourBarEl.style.animation = 'none';
      tourBarEl.style.width = '0%';
    }
    setTourNote('');

    if (step.target) {
      const found = await waitForTourTarget(step.target, token);
      if (token !== tourToken || !tourRunning) return;
      if (found) {
        try {
          found.scrollIntoView({ block: 'center', inline: 'nearest' });
        } catch (e) {
          /* 忽略 */
        }
        await tourSleep(140);
        if (token !== tourToken || !tourRunning) return;
        tourTarget = tourVisible(found) ? found : null;
      }
      if (!tourTarget) {
        setTourNote('⚠ 找不到這個畫面元素；可以直接按下一步。');
      }
    }

    layoutTour();
    startTourTimer(step);
  }

  function advanceTour() {
    if (!tourRunning || tourAdvancing) return;
    tourAdvancing = true;
    clearTimeout(tourTimer);
    tourTimer = 0;

    const step = tourSteps[tourIndex];
    if (step && typeof step.action === 'function') {
      try {
        step.action();
      } catch (e) {
        console.warn('[tour] action failed', e);
        setTourNote('⚠ 這一步沒有完成，先繼續。');
      }
    }

    if (tourIndex >= tourSteps.length - 1) {
      tourAdvancing = false;
      stopTour(true);
      return;
    }

    showStep(tourIndex + 1);
    setTimeout(() => {
      tourAdvancing = false;
    }, 350);
  }

  function stopTour(completed) {
    tourAdvancing = false;
    clearTimeout(tourTimer);
    tourTimer = 0;
    if (!tourRunning) {
      if (tourLayer) tourLayer.hidden = true;
      return;
    }
    tourRunning = false;
    tourToken++;
    tourIndex = -1;
    tourTarget = null;
    if (tourLayer) tourLayer.hidden = true;
    if (tourBubble) tourBubble.hidden = true;
    if (tourSpot) tourSpot.hidden = true;
    document.body.classList.remove('tour-running');
    if (completed) showToast('導覽完成；可從右上角 🦮 重看');
  }

  function startTour(id) {
    if (id !== 'quick') return;
    const aiDomain = domains.find((domain) => domain.id === 'aijargon');
    if (!aiDomain || !aiDomain.entries.has('大型語言模型')) {
      showToast('快速入門需要「AI 術語」科目；請先載入它。');
      return;
    }
    setTourMenuOpen(false);
    if (tourRunning) stopTour(false);
    if (SETTINGS && SETTINGS.isOpen && SETTINGS.isOpen()) SETTINGS.close();
    if (state.editing && typeof setEditing === 'function') setEditing(false);

    // 從索引頁開始會看不到「文／圖譜」；先回到一個條目。
    if (state.view === 'index') {
      const route = defaultRoute();
      if (route) navigate(route.domain, route.key);
    }

    tourSteps = quickTourSteps();
    tourIndex = -1;
    tourRunning = true;
    document.body.classList.add('tour-running');
    tourLayer.hidden = false;
    showStep(0);
    requestAnimationFrame(() => {
      if (tourRunning) tourBubble.focus({ preventScroll: true });
    });
  }

  function openIndexForTour() {
    state.indexQuery = '';
    state.indexView = 'all';
    state.indexSort = 'product';
    state.indexLimit = 120;
    navigateIndex();
  }

  function setIndexSortForTour(value) {
    const select = document.querySelector('#indexSort');
    if (!select) throw new Error('index sort missing');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function quickTourSteps() {
    return [
      {
        title: '一分鐘看一遍',
        text:
          '接下來約一分鐘，帶你走一遍：介面、索引、展開引用。<br>' +
          '點畫面任何地方繼續；按 Esc 或右上角 × 可以隨時結束。',
        target: null,
      },
      {
        title: '切換科目',
        text:
          '左上角「科目」切換科目。每一科是一張獨立的知識網，從科目首頁開始讀。',
        target: () => document.querySelector('.subject'),
      },
      {
        title: '文字與圖譜',
        text:
          '右上角的「文／圖譜」切換同一個條目的文字與關聯圖。同一個 toggle，再按一次就回到文字。',
        target: () => document.querySelector('#viewToggle'),
      },
      {
        title: '索引頁',
        text:
          '「索引」是探索 graph 的入口：搜尋、科目、連線檢視與排序都在同一頁。',
        target: () => document.querySelector('#indexBtn'),
        action: openIndexForTour,
      },
      {
        title: '搜尋是第一道過濾',
        text:
          '索引頁最上面是「搜尋」，先用它縮小範圍；下面再用科目、連線檢視與排序篩選。',
        target: () => document.querySelector('.index-search-row'),
      },
      {
        title: '有順有逆',
        text:
          '點「有順有逆」：只留下同時有順鏈與逆鏈的節點，也就是真正把知識網連起來的節點。',
        target: () => document.querySelector('.index-view[data-view="both"]'),
        action: () => tourClick('.index-view[data-view="both"]'),
      },
      {
        title: '逆鏈次數',
        text:
          '排序選「逆鏈次數」：被其他條目引用越多的節點，排得越前面。',
        target: () => document.querySelector('#indexSort'),
        action: () => setIndexSortForTour('back'),
      },
      {
        title: '找到大型語言模型',
        text:
          '找到「大型語言模型」。它的逆鏈很多，是 AI 術語裡的核心節點。',
        target: () => tourFindIndexRow('大型語言模型'),
      },
      {
        title: '打開條目',
        text:
          '點開它。接著看它怎麼用引用，把「參數」、「權重」和「神經元」串成一條鏈。',
        target: () => tourFindIndexRow('大型語言模型'),
        action: () => {
          const row = tourFindIndexRow('大型語言模型');
          if (!row) throw new Error('大型語言模型 not found');
          row.querySelector('.index-main').click();
        },
      },
      {
        title: '展開參數',
        text:
          '先展開「參數」：模型規模由參數數量決定，常以億或兆計。',
        target: () => tourFindRef(['參數']),
        action: () => {
          const ref = tourFindRef(['參數']);
          if (!ref) throw new Error('參數 ref not found');
          ref.click();
        },
      },
      {
        title: '展開權重',
        text:
          '參數裡再展開「權重」：訓練最主要調整的數值，就是每個輸入的重視程度。',
        target: () => tourFindRef(['權重']),
        action: () => {
          const ref = tourFindRef(['權重']);
          if (!ref) throw new Error('權重 ref not found');
          ref.click();
        },
      },
      {
        title: '展開神經元',
        text:
          '最後展開「神經元」：權重調的，就是神經元對每個輸入的重視程度。',
        target: () => tourFindRef(['神經元', '人工神經元']),
        action: () => {
          const ref = tourFindRef(['神經元', '人工神經元']);
          if (!ref) throw new Error('神經元 ref not found');
          ref.click();
        },
      },
      {
        title: '切到圖譜',
        text:
          '最後，把同一個條目切到圖譜模式：看它和相鄰條目的連線。',
        target: () => document.querySelector('#viewToggle'),
        action: () => switchView('graph'),
      },
      {
        title: '完成',
        text:
          '一分鐘到了。你剛剛走過：介面 → 索引 → 引用鏈 → 圖譜。<br>' +
          '這份導覽可以隨時從右上角 🦮 重看。',
        target: () => document.querySelector('.graph-canvas'),
      },
    ];
  }

  function tourState() {
    const step = tourSteps[tourIndex] || null;
    const targetRect =
      tourTarget && tourVisible(tourTarget) ? tourTarget.getBoundingClientRect() : null;
    const spotRect =
      tourSpot && !tourSpot.hidden ? tourSpot.getBoundingClientRect() : null;
    return {
      running: tourRunning,
      step: tourIndex,
      total: tourSteps.length,
      title: step ? step.title : '',
      target: !!targetRect,
      targetRect: targetRect
        ? {
            left: Math.round(targetRect.left),
            top: Math.round(targetRect.top),
            width: Math.round(targetRect.width),
            height: Math.round(targetRect.height),
          }
        : null,
      spotRect: spotRect
        ? {
            left: Math.round(spotRect.left),
            top: Math.round(spotRect.top),
            width: Math.round(spotRect.width),
            height: Math.round(spotRect.height),
          }
        : null,
      note: tourNoteEl ? tourNoteEl.textContent : '',
      timer: !!tourTimer,
      menuOpen: tourMenuOpen,
      hash: location.hash,
      indexView: state.indexView,
      indexSort: state.indexSort,
    };
  }

  function onTourKey(event) {
    if (tourRunning) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stopTour(false);
        return;
      }
      if (event.key === ' ' || event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        advanceTour();
        return;
      }
      if (event.key === '/' || event.key.toLowerCase() === 'g') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      return;
    }
    if (tourMenuOpen && event.key === 'Escape') {
      event.preventDefault();
      setTourMenuOpen(false);
    }
  }

  function initTour() {
    tourBtn = document.getElementById('tourBtn');
    if (!tourBtn) return;
    buildTourMenu();
    buildTourLayer();

    tourBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setTourMenuOpen(!tourMenuOpen);
    });

    document.addEventListener('click', (event) => {
      if (!tourMenuOpen) return;
      if (tourMenu.contains(event.target) || tourBtn.contains(event.target)) return;
      setTourMenuOpen(false);
    });

    document.addEventListener('keydown', onTourKey, true);
    window.addEventListener('resize', () => {
      positionTourMenu();
      layoutTour();
    });
    window.addEventListener(
      'scroll',
      () => {
        if (tourRunning) layoutTour();
      },
      true
    );

    window.OfftextTour = {
      start: startTour,
      stop: () => stopTour(false),
      state: tourState,
      openMenu: () => setTourMenuOpen(true),
      closeMenu: () => setTourMenuOpen(false),
    };
  }

  initTour();

})();
