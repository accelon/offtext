/* 巢式文字 MVP
 * 單欄流式版面：條目正文在中間，資料表由「索引」頁與頂欄搜尋進入。
 * 展開路徑以「引用在文件中的序號鏈」表示，例如 0.2.1；
 * 同一 key 出現在不同位置時，收合狀態互不干擾。
 */
(function () {
  'use strict';

  const NT = window.NT;
  const SETTINGS = window.OfftextSettings || null;

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
    readOnly: false,
    editing: false,
    createKey: null,
    pendingEdit: false,
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

  const $ = (sel) => document.querySelector(sel);
  const reader = $('#reader');
  const searchInput = $('#search');
  const searchResults = $('#searchResults');
  const subjectSelect = $('#subject');
  const viewSwitch = $('#viewSwitch');
  const textViewBtn = $('#textViewBtn');
  const glyphViewBtn = $('#glyphViewBtn');
  const rankSelects = {
    important: $('#rankImportant'),
    core: $('#rankCore'),
    hub: $('#rankHub'),
  };
  const readHistorySelect = $('#readHistory');
  const boot = $('#boot');
  const bootOpen = $('#bootOpen');
  const bootStatus = $('#bootStatus');
  const bootCatalog = $('#bootCatalog');
  const bootCatalogList = $('#bootCatalogList');
  const bootCatalogCount = $('#bootCatalogCount');
  const bootCatalogHint = $('#bootCatalogHint');
  const bootOpenSelected = $('#bootOpenSelected');
  const bootSelectAll = $('#bootSelectAll');
  const bootSelectNone = $('#bootSelectNone');
  const dirtyBtn = $('#dirtyBtn');
  const leaveBtn = $('#leaveBtn');
  const editBtn = $('#editBtn');
  const saveBtn = $('#saveBtn');
  const orphanBtn = $('#orphanBtn');

  const TSV_MANIFEST = Array.isArray(window.OFFTEXT_TSV_MANIFEST)
    ? window.OFFTEXT_TSV_MANIFEST
    : [];

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

  function defaultIndexDomain() {
    const current = state.root && state.root.domain;
    if (current && domains.some((d) => d.id === current)) return current;
    return domains[0] ? domains[0].id : 'all';
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
        if (key === '_' || isRedirect(value)) continue;
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
          const domain = item.domain === 'history' ? 'modern-chinese-history' : item.domain;
          return {
            domain,
            key: item.key,
            name:
              domain === 'modern-chinese-history'
                ? '近代中國史'
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
    while (subjectSelect.options.length > 1) subjectSelect.remove(1);
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
        state.view === 'index'
          ? state.indexDomain && state.indexDomain !== 'all'
            ? state.indexDomain
            : null
          : state.root.domain;
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
    if (!TSV_MANIFEST.length) {
      bootCatalog.hidden = true;
      bootOpen.hidden = false;
      return;
    }
    bootCatalog.hidden = false;
    bootOpen.hidden = true;
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
    bootCatalogCount.textContent = TSV_MANIFEST.length + ' 個檔';

    const fileMode = location.protocol === 'file:';
    bootCatalogHint.textContent = fileMode
      ? 'file:// 模式無法自動讀取 data/；清單供對照，請按「選擇本機 TSV…」開啟。編輯仍先存在記憶體。'
      : '直接勾選要載入的科目。編輯先存在記憶體，按「離開」時才儲存。';
    bootOpenSelected.textContent = fileMode ? '選擇本機 TSV…' : '開啟選取的 TSV';
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
    updateRankNav();
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

  async function bootFromCatalog(items) {
    const loaded = await fetchDomainFiles(items);
    bootWithDomains(loaded);
  }

  async function bootFromUrl(ids) {
    bootOpen.disabled = true;
    bootStatus.textContent = '從 URL 載入：' + ids.join('、') + '…';
    try {
      await bootFromCatalog(
        ids.map((rawId) => {
          const id = rawId.replace(/\.tsv$/i, '').trim();
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
  bootSelectAll.addEventListener('click', () => {
    bootCatalogList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = true;
    });
  });
  bootSelectNone.addEventListener('click', () => {
    bootCatalogList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
  });

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
  let recoTimer = 0;
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
    updateRankNav();
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
    clearTimeout(recoTimer);
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
    hideSearch();
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
    updateRankNav();
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
      recoTimer = setTimeout(() => showRecommendations(domainId, key), 260);
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
      if (fromKey === key) continue;
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

  function showRecommendations(domainId, key) {
    if (dirtyOverlay) return;
    const groups = findUnlinkedMentions(domainId, key);
    if (!groups.length) {
      showToast('本科其他內文沒有找到「' + key + '」的可標記處');
      return;
    }

    const backdrop = el('div', 'edit-backdrop reco-backdrop');
    const panel = el('section', 'edit-panel reco-panel');
    const head = el('header', 'edit-head');
    const titles = el('div');
    titles.append(el('div', 'edit-kicker', '建議標記'));
    titles.append(el('h2', 'edit-title', '「' + key + '」可標記的位置'));
    head.append(titles);
    const close = el('button', 'edit-close', '×');
    close.type = 'button';
    close.addEventListener('click', closeRecommendations);
    head.append(close);
    panel.append(head);

    const intro = el(
      'p',
      'edit-note',
      '在本科其他內文找到 ' + groups.length + ' 個條目。勾選後會自動加上 ^[' + key + ']。'
    );
    panel.append(intro);

    const list = el('div', 'reco-list');
    const checks = [];
    groups.forEach((group) => {
      const label = el('label', 'reco-item');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      const text = el('span', 'reco-text');
      const title = el('span', 'reco-source', group.fromKey === '_' ? '首頁' : group.fromKey);
      const contexts = el(
        'span',
        'reco-context',
        group.contexts.join(' ／ ') + (group.hits.length > 3 ? ' …' : '')
      );
      text.append(title, contexts);
      label.append(input, text);
      list.append(label);
      checks.push({ input, group });
    });
    panel.append(list);

    const actions = el('div', 'edit-actions');
    const skip = el('button', 'edit-secondary', '略過');
    skip.type = 'button';
    skip.addEventListener('click', closeRecommendations);
    const apply = el('button', 'edit-primary', '加入選取項目');
    apply.type = 'button';
    apply.addEventListener('click', () => {
      const selected = checks.filter((item) => item.input.checked);
      if (!selected.length) {
        showToast('請至少勾選一個位置');
        return;
      }
      const domain = dataDomain(domainId);
      apply.disabled = true;
      for (const { group } of selected) {
        let value = group.value;
        for (const start of group.hits.slice().sort((a, b) => b - a)) {
          value = value.slice(0, start) + '^[' + key + ']' + value.slice(start + key.length);
        }
        setDomainEntry(domainId, group.fromKey, value);
      }
      markDirty(domainId);
      apply.disabled = false;
      rebuildAllIndex();
      closeRecommendations();
      render();
      showToast(
        '已加入 ' + selected.length + ' 個條目的引用標記（記憶體；離開時儲存）'
      );
    });
    actions.append(skip, apply);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    recoOverlay = backdrop;
  }

  /* ---------- CodeMirror 內嵌編輯 ---------- */

  const CM = window.OfftextCM || null;
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
      saveShortcut: () => {
        saveDrafts();
      },
    };
  }

  function mountEntryEditor(article, value) {
    if (!CM || typeof CM.createEntry !== 'function') return false;
    const body = el('div', 'entry-body');
    article.append(body);
    entryController = CM.createEntry({
      parent: body,
      text: String(value == null ? '' : value),
      domain: state.root.domain,
      key: state.root.key,
      depth: 0,
      editing: state.editing,
      maxDepth: NT.MAX_DEPTH,
      host: makeEditorHost(state.root.domain, state.root.key),
    });
    return true;
  }

  function toggleEditorPath(path) {
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

  function setEditing(flag) {
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
    document.body.classList.toggle('is-editing-entry', next);
    updateSaveUi();
    updateOrphanButton();
    if (next) refreshOrphanPanel();
    else closeOrphanPanel();
  }

  function openEntryForEdit(domain, key) {
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

    rebuildAllIndex();
    fillSubjectSelect();
    updateRankNav();
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

  /* ---------- 孤兒節點 ---------- */

  function computeOrphans(domainId) {
    const domain = state.index.byId.get(domainId);
    if (!domain) return [];
    const out = [];
    for (const [key, value] of domain.entries) {
      if (key === '_' || isRedirect(value)) continue;
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
        if (key === '_' || isRedirect(value)) continue;
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

  /* ---------- 路由 ---------- */

  function readRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return null;

    if (h === 'index' || h.startsWith('index/')) {
      const raw = h.slice(6);
      if (!raw || raw === 'all') return { view: 'index', domain: raw || null };
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch (e) {
        /* 保留原字串 */
      }
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
      state.indexDomain = route.domain || defaultIndexDomain();
    }

    if (route.view === 'entry' && route.key !== '_') {
      recordRead(route.domain, route.key);
    }

    document.title =
      route.view === 'index'
        ? (state.indexDomain === 'all'
            ? '索引'
            : '索引 · ' + domainName(state.indexDomain)) + ' · 巢式文字'
        : route.view === 'graph'
          ? '圖譜 · ' + (route.key === '_' ? '首頁' : route.key) + ' · 巢式文字'
          : (route.key === '_' ? domainName(route.domain) + ' 首頁' : route.key) + ' · 巢式文字';

    render();
  }

  function navigate(domain, key, options) {
    const opts = options || {};
    const canon = canonicalKey(domain, key);
    domain = canon.domain;
    key = canon.key;
    if (!opts.keepBacklink) state.backlink = null;
    const h = '#/' + encodeURIComponent(domain) + '/' + encodeURIComponent(key);
    hideSearch();
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
    hideSearch();
    state.expanded.clear();
    state.focusPath = null;
    state.backlink = null;

    let target = domain;
    if (!target) {
      target =
        (state.view === 'index' && state.indexDomain) ||
        state.root.domain ||
        defaultIndexDomain();
    }
    if (target !== 'all' && !domains.some((d) => d.id === target)) target = defaultIndexDomain();

    const h = target === 'all' ? '#/index/all' : '#/index/' + encodeURIComponent(target);
    window.scrollTo(0, 0);
    if (location.hash === h) render();
    else location.hash = h;
  }

  function navigateGraph(domain, key, options) {
    const canon = canonicalKey(domain, key);
    const h = '#/graph/' + encodeURIComponent(canon.domain) + '/' + encodeURIComponent(canon.key);
    hideSearch();
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

  function openRankNode(id) {
    const cut = id.indexOf(':');
    if (cut < 0) return;
    const domain = id.slice(0, cut);
    const key = id.slice(cut + 1);
    if (state.view === 'graph') navigateGraph(domain, key, { recenter: true });
    else navigate(domain, key);
  }

  const RANK_NAV_CONFIGS = [
    { key: 'important', select: rankSelects.important, metric: 'forward', title: '重要' },
    { key: 'core', select: rankSelects.core, metric: 'back', title: '核心' },
    { key: 'hub', select: rankSelects.hub, metric: 'hub', title: '樞紐' },
  ];

  function currentRankDomain() {
    if (state.view === 'entry' || state.view === 'graph') return state.root.domain;
    if (state.view === 'index' && state.indexDomain && state.indexDomain !== 'all') {
      return state.indexDomain;
    }
    return null;
  }

  function updateRankNav() {
    const domainId = currentRankDomain();
    const rankings = domainId ? state.index.rankings.get(domainId) : null;

    RANK_NAV_CONFIGS.forEach((config) => {
      const select = config.select;
      while (select.options.length > 1) select.remove(1);
      select.disabled = !rankings;
      select.title = rankings
        ? disp(domainName(domainId)) + ' · ' + config.title
        : '先選一個科目，再看該科排行';
      select.value = '';

      if (!rankings) return;
      rankings[config.key].forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        let detail = '';
        if (config.metric === 'forward') detail = '順鏈 ' + item.forward;
        else if (config.metric === 'back') detail = '逆鏈 ' + item.back;
        else detail = '順鏈 ' + item.forward + '、逆鏈 ' + item.back + '、乘積 ' + item.hub;
        option.textContent = disp(item.key);
        option.title = disp(item.key) + '：' + detail;
        option.setAttribute('aria-label', disp(item.key) + '，' + detail);
        select.append(option);
      });
    });
  }

  function initRankNav() {
    RANK_NAV_CONFIGS.forEach((config) => {
      config.select.addEventListener('change', () => {
        const id = config.select.value;
        config.select.value = '';
        if (id) openRankNode(id);
      });
    });
    updateRankNav();
  }

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
    if (state.expanded.has(path)) {
      closePath(path);
    } else {
      state.expanded.add(path);
      state.focusPath = path;
    }
    render({ focusPath: path });
  }

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

  function renderRef(tok, path, depth, ancestors, inlineContext, contextDomain) {
    const expanded = state.expanded.has(path);
    const label = disp(tok.display || tok.ref);
    const wrap = el('span', 'nt-refwrap');
    wrap.dataset.path = path;
    const btn = el('button', 'nt-ref', label);
    btn.type = 'button';
    btn.dataset.path = path;
    btn.style.setProperty('--hue', String(NT.hue(depth)));
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
      if ((e.ctrlKey || e.metaKey) && res.status === 'ok') {
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
    const scrollY = window.scrollY;
    const backlinkScroll = state.backlink && state.backlink.scroll ? state.backlink : null;
    const recenterGraph = state.view === 'graph' && state.graph.recenter;
    if (entryController) {
      entryController.destroy();
      entryController = null;
    }
    subjectSelect.value =
      state.view === 'index'
        ? state.indexDomain === 'all'
          ? ''
          : state.indexDomain
        : state.root.domain;
    reader.textContent = '';
    reader.classList.toggle('is-focusing', !!state.focusPath && state.view === 'entry');
    if (state.view !== 'graph') hideGraphTip();
    if (state.view !== 'entry') {
      document.body.classList.remove('is-editing-entry');
      closeOrphanPanel();
    }
    updateRankNav();
    renderReadHistory();
    updateDirtyUi();
    updateSaveUi();
    updateOrphanButton();
    viewSwitch.hidden = state.view === 'index';
    textViewBtn.classList.toggle('is-active', state.view === 'entry');
    glyphViewBtn.classList.toggle('is-active', state.view === 'graph');
    textViewBtn.setAttribute('aria-pressed', String(state.view === 'entry'));
    glyphViewBtn.setAttribute('aria-pressed', String(state.view === 'graph'));
    textViewBtn.title = '文字閱讀（按 g 切換）';
    glyphViewBtn.title = '圖譜檢視（按 g 切換）';

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

  function renderBacklinks(list, target) {
    const nav = el('nav', 'backlinks');
    nav.setAttribute('aria-label', '反鏈接');
    nav.title =
      '直接引用本條目的其他條目（共 ' + list.length + ' 筆；前 4 筆直接顯示，其餘在下拉）';
    nav.append(el('span', 'backlinks-label', '反鏈接'));
    nav.append(el('span', 'backlinks-count', String(list.length)));

    const strip = el('div', 'backlinks-list');

    function makeButton(item, menuItem) {
      const btn = el('button', 'backlink' + (menuItem ? ' backlink-menu-item' : ''));
      btn.type = 'button';
      if (item.domain !== target.domain) {
        btn.append(el('span', 'backlink-domain', disp(domainName(item.domain)) + '·'));
      }
      btn.append(document.createTextNode(disp(item.key)));
      btn.title =
        '跳到 ' +
        disp(domainName(item.domain)) +
        ' · ' +
        disp(item.key) +
        '，並標出引用「' +
        disp(target.key) +
        '」的位置';
      btn.addEventListener('click', () => {
        if (menuItem) menuItem.open = false;
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
    return nav;
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
    titleRow.append(el('h1', 'entry-title', disp(state.root.key === '_' ? '首頁' : state.root.key)));

    const targetId = state.root.domain + ':' + state.root.key;
    const backlinks = backlinksFor(targetId);
    if (backlinks.length) titleRow.append(renderBacklinks(backlinks, res));

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

    if (opts.focusPath && entryController) {
      requestAnimationFrame(() => {
        if (entryController) entryController.scrollToPath(opts.focusPath);
      });
    } else if (opts.focusPath) {
      const btn = reader.querySelector('.nt-ref[data-path="' + opts.focusPath + '"]');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

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

  function graphLabel(key) {
    const text = disp(key === '_' ? '首頁' : String(key));
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
    const lines = graphLabel(node.key);
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
    head.append(el('strong', 'graph-tip-key', disp(node.key === '_' ? '首頁' : node.key)));
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
    });

    return panel;
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

      const lines = graphLabel(node.key);
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
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });
      group.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) navigateGraph(node.domain, node.key, { recenter: true });
        else cycleGraphFocus(node.id);
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
    const base = width * 0.55 + Math.max(0, count - 6) * 24;
    return Math.max(460, Math.min(2800, Math.round(base * fontFactor * edgeFactor)));
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
      el('h1', 'entry-title', disp(res.key === '_' ? '首頁' : res.key))
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
          disp(res.key === '_' ? '首頁' : res.key) +
          '」為起點。滑過節點看釋文；點節點切換順鏈／逆鏈高亮；Ctrl/⌘+點擊以它為起點重繪。'
      )
    );
    article.append(head);

    const stage = el('div', 'graph-stage');
    stage.append(renderGraphPanel(graph));
    const canvas = el('div', 'graph-canvas');
    canvas.append(renderGraphSvg(graph, res.domain, width, height));
    stage.append(canvas);
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
  }

  function indexCount(domain) {
    let n = 0;
    for (const [key, value] of domain.entries) {
      if (key === '_' || isRedirect(value)) continue;
      n++;
    }
    return n;
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
      btn.addEventListener('click', () => navigateIndex(id));
      nav.append(btn);
    };

    add('all', '全部', entries.length);
    domains.forEach((domain) => add(domain.id, disp(domain.name || domain.id), indexCount(domain)));
    return nav;
  }

  function renderIndex() {
    const selected = state.indexDomain || defaultIndexDomain();
    const chosen = selected === 'all' ? null : state.index.byId.get(selected);
    const shown = chosen ? [chosen] : domains;
    const total = chosen ? indexCount(chosen) : entries.length;

    const article = el('article', 'index');
    const head = el('header', 'entry-head');
    head.append(el('div', 'entry-kicker', '資料表'));
    head.append(el('h1', 'entry-title', '索引'));
    head.append(
      el(
        'p',
        'index-hint',
        '共 ' +
          total +
          ' 條' +
          (chosen ? ' · ' + disp(domainName(chosen.id)) : ' · 全部科目') +
          '。點一個條目開始，或直接用上方搜尋。'
      )
    );
    head.append(renderIndexTabs(selected));
    article.append(head);

    shown.forEach((domain) => {
      const section = el('section', 'index-domain');
      const title = el('h2', 'index-domain-title');
      title.append(el('span', 'domain-name', disp(domain.name || domain.id)));
      title.append(el('span', 'domain-count', String(indexCount(domain))));
      section.append(title);

      const list = el('div', 'index-list');
      if (domain.entries.has('_')) {
        list.append(indexItem(domain.id, '_', '首頁', domain.entries.get('_')));
      }
      for (const [key, value] of domain.entries) {
        if (key === '_' || isRedirect(value)) continue;
        list.append(indexItem(domain.id, key, key, value));
      }
      section.append(list);
      article.append(section);
    });

    reader.append(article);
  }

  function indexItem(domain, key, label, value) {
    const item = el('button', 'index-item');
    item.type = 'button';
    item.append(el('span', 'index-key', disp(label)));
    item.append(el('span', 'index-preview', preview(value)));
    item.addEventListener('click', () => navigate(domain, key));
    return item;
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

  /* ---------- 搜尋 ---------- */

  let searchHits = [];

  function hideSearch() {
    searchResults.hidden = true;
    searchResults.textContent = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchHits = [];
  }

  function score(entry, needle) {
    if (entry.keyForms.some((form) => form.startsWith(needle))) return 3;
    if (entry.keyForms.some((form) => form.includes(needle))) return 2;
    return 1;
  }

  function renderSearch() {
    const needle = searchInput.value.trim().toLowerCase();
    if (!needle) {
      hideSearch();
      return;
    }

    searchHits = entries
      .filter((entry) => entry.hay.includes(needle))
      .sort((a, b) => score(b, needle) - score(a, needle))
      .slice(0, 12);

    searchResults.textContent = '';

    if (!searchHits.length) {
      searchResults.append(el('div', 'search-empty', '沒有符合「' + searchInput.value.trim() + '」的條目'));
    } else {
      searchHits.forEach((entry) => {
        const item = el('button', 'search-item');
        item.type = 'button';
        const head = el('span', 'search-head');
        head.append(el('span', 'search-key', disp(entry.key)));
        head.append(el('span', 'search-domain', disp(entry.domainName)));
        item.append(head);
        item.append(el('span', 'search-preview', entry.preview));
        item.addEventListener('click', () => {
          searchInput.value = '';
          navigate(entry.domain, entry.key);
        });
        searchResults.append(item);
      });
    }

    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function moveSearchFocus(step) {
    const items = [...searchResults.querySelectorAll('.search-item')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current === -1 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
    items[next].focus();
  }

  /* ---------- 初始化 ---------- */

  const legend = $('#legendRow');
  for (let depth = 0; depth <= NT.MAX_DEPTH; depth++) {
    const chip = el('span', 'chip');
    chip.style.setProperty('--h', String(NT.hue(depth)));
    legend.append(chip);
  }

  /* ---------- 設置 ---------- */

  function handleSettingsChange(kind) {
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

  fillSubjectSelect();
  initRankNav();
  initReadHistory();

  subjectSelect.addEventListener('change', (e) => {
    const id = e.target.value;
    if (state.view === 'index') {
      navigateIndex(id || 'all');
      return;
    }
    if (!id) {
      navigateIndex('all');
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

  textViewBtn.addEventListener('click', () => switchView('text'));
  glyphViewBtn.addEventListener('click', () => switchView('graph'));
  editBtn.addEventListener('click', () => setEditing(!state.editing));
  saveBtn.addEventListener('click', () => {
    saveDrafts();
  });
  orphanBtn.addEventListener('click', toggleOrphanPanel);

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
      searchInput.focus();
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
    bootStatus.textContent = 'file:// 不支援 fetch；請用下方「選擇本機 TSV…」開啟。';
  } else if (DATA) {
    bootWithDomains(DATA);
  } else {
    document.body.classList.add('is-booting');
    boot.hidden = false;
    bootStatus.textContent = '';
  }
})();
