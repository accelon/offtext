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
      nodeShape: 'circle',
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
