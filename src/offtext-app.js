(function() {
  "use strict";
  const NT = window.NT;
  const SETTINGS = window.OfftextSettings || null;
  const READONLY_ONLY = !!window.OFFTEXT_READONLY_ONLY;
  if (!NT) {
    document.getElementById("reader").textContent = "\u8F09\u5165\u5931\u6557\uFF1A\u627E\u4E0D\u5230 nestedtext-core.js\u3002";
    return;
  }
  function disp(text) {
    return SETTINGS ? SETTINGS.display(text) : String(text == null ? "" : text);
  }
  let DATA = window.OFFTEXT_DOMAINS || null;
  const state = {
    index: NT.buildIndex(DATA || []),
    mode: "auto",
    expanded: /* @__PURE__ */ new Set(),
    focusPath: null,
    backlink: null,
    view: "entry",
    indexDomain: null,
    indexQuery: "",
    indexView: "all",
    indexSort: "product",
    indexLimit: 120,
    uiMode: "desktop",
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
      edgeLength: "medium",
      edgeWidth: "medium",
      nodeShape: "circle",
      focus: null,
      recenter: false
    },
    root: { domain: null, key: "_" }
  };
  const query = new URLSearchParams(location.search);
  const UI_KEY = "offtext.ui.v1";
  function detectUiMode() {
    const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
    const touch = coarse || (navigator.maxTouchPoints || 0) > 0;
    const mobileUa = /Mobi|Android|iPhone|iPad|Tablet|HarmonyOS/i.test(navigator.userAgent || "");
    const phoneLike = touch && (mobileUa || window.innerWidth <= 1024);
    let stored = "";
    try {
      stored = localStorage.getItem(UI_KEY) || "";
    } catch (e) {
    }
    const requested = query.get("ui");
    const wantsEdit = query.get("edit") === "1" && !READONLY_ONLY;
    const mode = phoneLike ? "mobile" : requested === "mobile" ? "mobile" : requested === "desktop" || wantsEdit ? "desktop" : stored === "mobile" ? "mobile" : "desktop";
    return { mode, forced: phoneLike };
  }
  const uiMode = detectUiMode();
  const FORCED_MOBILE = uiMode.forced;
  state.uiMode = uiMode.mode;
  const $ = (sel) => document.querySelector(sel);
  const reader = $("#reader");
  const subjectSelect = $("#subject");
  const viewToggle = $("#viewToggle");
  const readHistorySelect = $("#readHistory");
  const boot = $("#boot");
  const bootOpen = $("#bootOpen");
  const bootStatus = $("#bootStatus");
  const bootCatalog = $("#bootCatalog");
  const bootCatalogList = $("#bootCatalogList");
  const bootCatalogCount = $("#bootCatalogCount");
  const bootOpenSelected = $("#bootOpenSelected");
  const dirtyBtn = $("#dirtyBtn");
  const leaveBtn = $("#leaveBtn");
  const editBtn = $("#editBtn");
  const saveBtn = $("#saveBtn");
  const orphanBtn = $("#orphanBtn");
  const exportBtn = $("#exportBtn");
  const TSV_MANIFEST = Array.isArray(window.OFFTEXT_TSV_MANIFEST) ? window.OFFTEXT_TSV_MANIFEST : [];
  document.body.classList.toggle("is-mobile-ui", state.uiMode === "mobile");
  document.body.classList.toggle("is-readonly-online", READONLY_ONLY);
  const DOMAIN_ALIASES = /* @__PURE__ */ new Map([
    ["ancientchina", "ancient-china"],
    ["worldhistory", "world-history"],
    ["history", "modern-chinese-history"]
  ]);
  function canonicalDomainId(id) {
    return DOMAIN_ALIASES.get(id) || id;
  }
  const dirtyDomains = /* @__PURE__ */ new Set();
  const drafts = /* @__PURE__ */ new Map();
  let draftSeq = 0;
  let entryController = null;
  let orphanPanel = null;
  const domains = state.index.order.filter((d) => !d.hidden);
  function domainName(id) {
    const domain = state.index.byId.get(id);
    return domain ? domain.name || domain.id : id;
  }
  function displayKey(domain, key) {
    return key === "_" ? domainName(domain) : key;
  }
  function isReservedKey(key) {
    return !key || String(key).startsWith("@");
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function preview(value) {
    const raw = String(value == null ? "" : value).trim();
    if (raw.startsWith("@")) {
      return disp("\u2192 " + raw.slice(1).trim().replace(/^[A-Za-z0-9_.-]+:/, ""));
    }
    const text = disp(NT.plainText(raw.replace(/\s+/g, " ").trim()));
    return text.length > 46 ? text.slice(0, 46) + "\u2026" : text;
  }
  function isRedirect(value) {
    return String(value == null ? "" : value).trim().startsWith("@");
  }
  function redirectTarget(value) {
    const s = String(value || "").trim().replace(/^@/, "").trim();
    const m = /^([A-Za-z0-9_.-]+)[:/](.+)$/.exec(s);
    return m ? { domain: m[1], key: m[2].trim() } : { domain: null, key: s };
  }
  function canonicalKey(domain, key) {
    domain = canonicalDomainId(domain);
    if (!state.index || !key || key === "_") return { domain, key };
    const res = NT.resolve(state.index, key, domain);
    if (res.status !== "ok") return { domain, key };
    return { domain: res.domain, key: res.key };
  }
  const entries = [];
  function rebuildSearchEntries() {
    entries.length = 0;
    domains.forEach((domain) => {
      for (const [key, value] of domain.entries) {
        if (key === "_" || isReservedKey(key) || isRedirect(value)) continue;
        const plain = NT.plainText(value);
        const forms = SETTINGS ? SETTINGS.searchForms(key + " " + plain) : [key + " " + plain];
        entries.push({
          domain: domain.id,
          domainName: domain.name || domain.id,
          key,
          keyForms: (SETTINGS ? SETTINGS.searchForms(key) : [key]).map(
            (form) => form.toLowerCase()
          ),
          preview: preview(value),
          hay: forms.join(" ").toLowerCase()
        });
      }
    });
  }
  function updateStats() {
    $("#stats").textContent = entries.length + " \u689D \xB7 " + domains.length + " \u500B\u5206\u985E" + (drafts.size ? " \xB7 \u672A\u5957\u7528 " + drafts.size : "") + (dirtyDomains.size ? " \xB7 \u672A\u5B58\u6A94 " + dirtyDomains.size + " \u79D1" : "");
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
  const READ_HISTORY_KEY = "offtext.readHistory.v1";
  const READ_HISTORY_MAX = 15;
  function loadReadHistory() {
    try {
      const raw = localStorage.getItem(READ_HISTORY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(
        (item) => item && typeof item.domain === "string" && typeof item.key === "string" && item.key !== "_"
      ).slice(0, READ_HISTORY_MAX).map((item) => {
        const domain = canonicalDomainId(item.domain);
        return {
          domain,
          key: item.key,
          name: domain === "modern-chinese-history" ? "\u4E2D\u570B\u8FD1\u4EE3\u53F2" : typeof item.name === "string" ? item.name : domain,
          at: Number(item.at) || 0
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
    }
  }
  function ago(ts) {
    if (!ts) return "";
    const minutes = Math.floor((Date.now() - ts) / 6e4);
    if (minutes < 1) return "\u525B\u525B";
    if (minutes < 60) return minutes + " \u5206\u9418\u524D";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " \u5C0F\u6642\u524D";
    return Math.floor(hours / 24) + " \u5929\u524D";
  }
  function recordRead(domain, key) {
    if (!domain || !key || key === "_") return;
    const item = { domain, key, name: domainName(domain), at: Date.now() };
    readHistory = [
      item,
      ...readHistory.filter((old) => !(old.domain === domain && old.key === key))
    ].slice(0, READ_HISTORY_MAX);
    saveReadHistory();
  }
  function openHistoryTarget(domain, key) {
    const hit = NT.resolve(state.index, key, domain, null);
    if (hit.status === "ok") {
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
      const suffix = !loaded ? "\uFF08\u672A\u8F09\u5165\uFF09" : exists ? "" : "\uFF08\u627E\u4E0D\u5230\uFF09";
      const option = document.createElement("option");
      option.value = item.domain + ":" + item.key;
      option.textContent = disp(item.key) + " \xB7 " + disp(item.name || domainName(item.domain)) + suffix;
      option.title = disp(item.key) + " \xB7 " + disp(item.name || domainName(item.domain)) + (ago(item.at) ? " \xB7 " + ago(item.at) : "");
      readHistorySelect.append(option);
    });
    readHistorySelect.disabled = readHistory.length === 0;
  }
  function initReadHistory() {
    renderReadHistory();
    readHistorySelect.addEventListener("change", () => {
      const id = readHistorySelect.value;
      readHistorySelect.value = "";
      if (!id) return;
      const cut = id.indexOf(":");
      if (cut < 0) return;
      openHistoryTarget(id.slice(0, cut), id.slice(cut + 1));
    });
  }
  function fillSubjectSelect() {
    subjectSelect.textContent = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "\u5168\u90E8\u79D1\u76EE";
    subjectSelect.append(all);
    domains.forEach((domain) => {
      const option = document.createElement("option");
      option.value = domain.id;
      option.textContent = disp(domain.name || domain.id) + (dirtyDomains.has(domain.id) ? " \u25CF" : "");
      subjectSelect.append(option);
    });
  }
  function updateDirtyUi() {
    const value = subjectSelect.value;
    fillSubjectSelect();
    subjectSelect.value = value;
    const dirty = [...dirtyDomains];
    dirtyBtn.hidden = dirty.length === 0;
    if (dirty.length) {
      const currentId = state.view === "index" ? state.indexDomain : state.root.domain;
      dirtyBtn.textContent = currentId && dirtyDomains.has(currentId) ? "\u25CF " + disp(domainName(currentId)) + " \u672A\u5B58\u6A94" : "\u25CF " + dirty.length + " \u79D1\u672A\u5B58\u6A94";
      dirtyBtn.title = "\u672A\u5B58\u6A94\uFF1A" + dirty.map((id) => disp(domainName(id))).join("\u3001") + "\uFF1B\u9EDE\u4E00\u4E0B\u5132\u5B58";
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
  function selectedCatalogItems() {
    const files = new Set(
      [...bootCatalogList.querySelectorAll('input[type="checkbox"]:checked')].map(
        (input) => input.value
      )
    );
    return TSV_MANIFEST.filter((item) => files.has(item.file));
  }
  function renderBootCatalog() {
    const fileMode = location.protocol === "file:";
    bootOpen.hidden = !fileMode;
    bootOpenSelected.hidden = fileMode;
    bootCatalogCount.textContent = "";
    if (!TSV_MANIFEST.length || fileMode) {
      bootCatalog.hidden = true;
      bootCatalogList.textContent = "";
      if (!TSV_MANIFEST.length) bootOpenSelected.hidden = true;
      return;
    }
    bootCatalog.hidden = false;
    bootCatalogList.textContent = "";
    const groups = ["\u6587\u79D1", "\u7406\u79D1", "\u9032\u968E", "\u5176\u4ED6"];
    const byGroup = new Map(groups.map((g) => [g, []]));
    for (const item of TSV_MANIFEST) {
      const g = groups.includes(item.group) ? item.group : "\u5176\u4ED6";
      byGroup.get(g).push(item);
    }
    for (const group of groups) {
      const items = byGroup.get(group);
      if (!items.length) continue;
      const section = el("section", "boot-group");
      section.dataset.group = group;
      const head = el("div", "boot-group-head");
      head.append(el("strong", "boot-group-name", group));
      head.append(el("span", "boot-group-count", items.length + " \u79D1"));
      const controls = el("span", "boot-group-actions");
      const all = el("button", "boot-link", "\u5168\u9078");
      all.type = "button";
      const none = el("button", "boot-link", "\u5168\u4E0D\u9078");
      none.type = "button";
      all.addEventListener("click", () => {
        section.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = true;
        });
      });
      none.addEventListener("click", () => {
        section.querySelectorAll('input[type="checkbox"]').forEach((input) => {
          input.checked = false;
        });
      });
      controls.append(all, none);
      head.append(controls);
      section.append(head);
      const grid = el("div", "boot-group-items");
      for (const item of items) {
        const label = el("label", "boot-tsv" + (item.hidden ? " is-hidden" : ""));
        label.title = item.file + "\uFF08" + item.id + "\uFF09";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = item.file;
        input.checked = true;
        label.append(
          input,
          el("span", "boot-tsv-name", disp(item.name || item.id)),
          el("span", "boot-tsv-id", item.id),
          el("span", "boot-tsv-count", (item.count || 0) + " \u689D")
        );
        grid.append(label);
      }
      section.append(grid);
      bootCatalogList.append(section);
    }
    bootCatalogCount.textContent = TSV_MANIFEST.length + " \u500B\u79D1\u76EE";
    bootOpenSelected.textContent = "\u958B\u555F\u9078\u5B9A\u7684\u79D1\u76EE";
  }
  async function openSelectedCatalog() {
    if (location.protocol === "file:") {
      openTsvFiles();
      return;
    }
    const items = selectedCatalogItems();
    if (!items.length) {
      bootStatus.textContent = "\u8ACB\u81F3\u5C11\u52FE\u9078\u4E00\u500B TSV\u3002";
      return;
    }
    bootOpenSelected.disabled = true;
    bootStatus.textContent = "\u8B80\u53D6 TSV\u2026";
    try {
      const loaded = await fetchDomainFiles(items);
      if (state.uiMode !== "mobile") await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      bootStatus.textContent = "\u8F09\u5165\u5931\u6557\uFF1A" + (e && e.message ? e.message : e);
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
      bootStatus.textContent = "\u9078\u53D6\u7684\u6A94\u6848\u6C92\u6709\u53EF\u898B\u79D1\u76EE\u3002";
      DATA = null;
      state.index = NT.buildIndex([]);
      return;
    }
    rebuildSearchEntries();
    updateStats();
    fillSubjectSelect();
    updateDirtyUi();
    document.body.classList.remove("is-booting");
    boot.hidden = true;
    bootStatus.textContent = "";
    const requested = readRoute();
    if (!location.hash || requested && requested.domain && requested.domain !== "all" && !state.index.byId.has(requested.domain)) {
      const route = defaultRoute();
      if (route) {
        history.replaceState(
          null,
          "",
          "#/" + encodeURIComponent(route.domain) + "/" + encodeURIComponent(route.key)
        );
      }
    }
    applyRoute();
  }
  async function openTsvFiles() {
    if (!window.showOpenFilePicker) {
      bootStatus.textContent = "\u6B64\u700F\u89BD\u5668\u4E0D\u652F\u63F4\u6A94\u6848\u5B58\u53D6\uFF0C\u8ACB\u4F7F\u7528 Edge \u6216 Chrome\u3002";
      return;
    }
    bootOpen.disabled = true;
    bootStatus.textContent = "\u8B80\u53D6 TSV\u2026";
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "\u5DE2\u5F0F\u6587\u5B57 TSV",
            accept: { "text/tab-separated-values": [".tsv"], "text/plain": [".tsv"] }
          }
        ]
      });
      if (!handles || !handles.length) throw new Error("\u6C92\u6709\u9078\u53D6\u6A94\u6848");
      const loaded = [];
      const ids = /* @__PURE__ */ new Set();
      for (const handle of handles) {
        const file = await handle.getFile();
        const parsed = parseDomainTsv(await file.text());
        if (!parsed) throw new Error(handle.name + " \u4E0D\u662F\u6709\u6548\u7684 TSV");
        if (ids.has(parsed.id)) throw new Error("\u91CD\u8907\u7684\u79D1\u76EE id\uFF1A" + parsed.id);
        ids.add(parsed.id);
        fileHandles.set(parsed.id, {
          handle,
          domainId: parsed.id,
          name: handle.name,
          meta: parsed.meta
        });
        loaded.push({
          id: parsed.id,
          name: parsed.name || parsed.id,
          hidden: !!parsed.hidden,
          entries: parsed.entries,
          meta: parsed.meta,
          file: handle.name
        });
      }
      await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      if (e && e.name === "AbortError") {
        bootStatus.textContent = "\u5DF2\u53D6\u6D88\u3002";
      } else {
        bootStatus.textContent = "\u958B\u555F\u5931\u6557\uFF1A" + (e && e.message ? e.message : e);
      }
    } finally {
      bootOpen.disabled = false;
    }
  }
  async function fetchDomainFiles(items) {
    const bases = query.get("dataBase") ? [query.get("dataBase")] : ["data", "../data"];
    const loaded = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of items) {
      const file = String(item.file || item.id + ".tsv");
      if (!/^[A-Za-z0-9._-]+\.tsv$/i.test(file)) throw new Error("\u6A94\u540D\u4E0D\u5408\u6CD5\uFF1A" + file);
      const expectedId = String(item.id || file.replace(/\.tsv$/i, ""));
      if (!/^[A-Za-z0-9_-]+$/.test(expectedId)) throw new Error("\u79D1\u76EE id \u4E0D\u5408\u6CD5\uFF1A" + expectedId);
      if (seen.has(expectedId)) throw new Error("\u91CD\u8907\u7684\u79D1\u76EE\uFF1A" + expectedId);
      let text = null;
      for (const base of bases) {
        const prefix = base.endsWith("/") ? base : base + "/";
        const url = new URL(prefix + encodeURIComponent(file), location.href);
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) {
          text = await response.text();
          break;
        }
      }
      if (text === null) throw new Error("\u627E\u4E0D\u5230 " + file);
      const parsed = parseDomainTsv(text);
      if (!parsed) throw new Error(file + " \u4E0D\u662F\u6709\u6548\u7684 TSV");
      if (parsed.id !== expectedId) {
        throw new Error(file + " \u7684 id \u662F\u300C" + parsed.id + "\u300D\uFF0C\u9810\u671F\u300C" + expectedId + "\u300D");
      }
      seen.add(parsed.id);
      loaded.push({
        id: parsed.id,
        name: parsed.name || parsed.id,
        hidden: !!parsed.hidden,
        entries: parsed.entries,
        meta: parsed.meta,
        file
      });
    }
    return loaded;
  }
  function parseDataIndex(text) {
    const files = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of String(text).replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      for (const token of line.split(/[\s,]+/)) {
        let file = token.trim().replace(/^\.\//, "");
        if (!file) continue;
        if (!/\.tsv$/i.test(file)) file += ".tsv";
        if (!/^[A-Za-z0-9._-]+\.tsv$/i.test(file)) {
          throw new Error("data-index.txt \u6A94\u540D\u4E0D\u5408\u6CD5\uFF1A" + token);
        }
        if (seen.has(file)) continue;
        seen.add(file);
        files.push(file);
      }
    }
    return files;
  }
  async function fetchDataIndexItems() {
    const bases = query.get("dataBase") ? [query.get("dataBase")] : ["data", "../data"];
    for (const base of bases) {
      const prefix = base.endsWith("/") ? base : base + "/";
      const url = new URL(prefix + "data-index.txt", location.href);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const files = parseDataIndex(await response.text());
      if (!files.length) throw new Error("data-index.txt \u6C92\u6709\u5217\u51FA\u4EFB\u4F55 TSV");
      const known = new Map(TSV_MANIFEST.map((item) => [item.file, item]));
      return files.map((file) => {
        const hit = known.get(file);
        return { file, id: hit ? hit.id : file.replace(/\.tsv$/i, "") };
      });
    }
    return null;
  }
  async function bootFromDataIndex() {
    document.body.classList.add("is-booting");
    boot.hidden = false;
    bootCatalog.hidden = true;
    bootOpenSelected.hidden = true;
    bootOpen.hidden = true;
    bootStatus.textContent = "\u8B80\u53D6 data-index.txt\u2026";
    try {
      let items = await fetchDataIndexItems();
      if (!items) {
        if (!TSV_MANIFEST.length) throw new Error("\u627E\u4E0D\u5230 data-index.txt");
        items = TSV_MANIFEST.map((item) => ({ id: item.id, file: item.file }));
      }
      bootStatus.textContent = "\u8F09\u5165 " + items.length + " \u500B\u79D1\u76EE\u2026";
      const loaded = await fetchDomainFiles(items);
      if (state.uiMode !== "mobile") await ensureCM();
      bootWithDomains(loaded);
    } catch (e) {
      bootStatus.textContent = "\u81EA\u52D5\u8F09\u5165\u5931\u6557\uFF1A" + (e && e.message ? e.message : e);
      bootOpenSelected.hidden = false;
      renderBootCatalog();
    }
  }
  async function bootFromCatalog(items) {
    const loaded = await fetchDomainFiles(items);
    if (state.uiMode !== "mobile") await ensureCM();
    bootWithDomains(loaded);
  }
  async function bootFromUrl(ids) {
    bootOpen.disabled = true;
    bootStatus.textContent = "\u5F9E URL \u8F09\u5165\uFF1A" + ids.join("\u3001") + "\u2026";
    try {
      await bootFromCatalog(
        ids.map((rawId) => {
          const id = canonicalDomainId(rawId.replace(/\.tsv$/i, "").trim());
          return { id, file: id + ".tsv" };
        })
      );
      if (!boot.hidden) return;
      showToast("\u5DF2\u7531 URL \u8F09\u5165\uFF1A" + ids.join("\u3001"));
    } catch (e) {
      bootStatus.textContent = "URL \u8F09\u5165\u5931\u6557\uFF1A" + (e && e.message ? e.message : e);
    } finally {
      bootOpen.disabled = false;
    }
  }
  bootOpen.addEventListener("click", openTsvFiles);
  bootOpenSelected.addEventListener("click", openSelectedCatalog);
  const addTermBtn = el("button", "add-term-btn", "\uFF0B \u65B0\u589E\u8A5E\u76EE");
  addTermBtn.type = "button";
  addTermBtn.hidden = true;
  document.body.append(addTermBtn);
  let pendingSelection = null;
  let editOverlay = null;
  let recoOverlay = null;
  let loadOverlay = null;
  let dirtyOverlay = null;
  let toastEl = null;
  const fileHandles = /* @__PURE__ */ new Map();
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
    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
    let meta = null;
    let metaLine = "";
    const entries2 = {};
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!metaLine && /^\s*\{.*\}\s*$/.test(line)) {
        metaLine = line;
        const id = /id\s*:\s*"([^"]*)"/.exec(line);
        const name = /name\s*:\s*"([^"]*)"/.exec(line);
        const hidden = /hidden\s*:\s*"?([a-z]+)"?/.exec(line);
        meta = {
          id: id ? id[1] : "",
          name: name ? name[1] : "",
          hidden: hidden ? hidden[1] === "true" : false
        };
        continue;
      }
      const tab = line.indexOf("	");
      if (tab < 0) continue;
      const key = line.slice(0, tab).trim();
      if (key) entries2[key] = line.slice(tab + 1);
    }
    if (!meta || !meta.id) return null;
    return { id: meta.id, name: meta.name, hidden: meta.hidden, meta: metaLine, entries: entries2 };
  }
  function serializeDomain(domainId) {
    const domain = dataDomain(domainId);
    if (!domain) return "";
    const session = fileHandles.get(domainId);
    const meta = domain.meta || session && session.meta || `{id:"${domain.id}",name:"${domain.name || domain.id}"}`;
    const body = Object.entries(domain.entries || {}).map(([key, value]) => key + "	" + String(value).replace(/\r?\n/g, " ")).join("\n");
    return meta + "\n" + body + "\n";
  }
  async function saveFileSession(domainId) {
    const session = fileHandles.get(domainId);
    if (!session) throw new Error("\u5C1A\u672A\u958B\u555F\u8A72\u79D1 TSV");
    let permission = await session.handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      permission = await session.handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") throw new Error("\u6C92\u6709\u5BEB\u5165\u6B0A\u9650");
    const writable = await session.handle.createWritable();
    await writable.write(serializeDomain(domainId));
    await writable.close();
  }
  async function saveViaServer(domainId, text) {
    const domain = dataDomain(domainId);
    const file = domain.file || domain.id + ".tsv";
    let response;
    try {
      response = await fetch("/api/tsv/" + encodeURIComponent(file), {
        method: "POST",
        headers: { "content-type": "text/tab-separated-values; charset=utf-8" },
        body: text
      });
    } catch (e) {
      const err = new Error("\u7121\u6CD5\u9023\u7DDA\u5230\u5132\u5B58\u4F3A\u670D\u5668");
      err.fallback = true;
      throw err;
    }
    if (response.ok) return;
    let detail = "";
    try {
      const body = await response.json();
      detail = body && body.error ? String(body.error) : "";
    } catch (e) {
    }
    if (response.status === 404 || response.status === 405) {
      const err = new Error("\u6B64 HTTP \u4F3A\u670D\u5668\u6C92\u6709\u5132\u5B58 API");
      err.fallback = true;
      throw err;
    }
    throw new Error(detail || "HTTP \u5132\u5B58\u5931\u6557\uFF08" + response.status + "\uFF09");
  }
  async function saveViaPicker(domainId, text) {
    if (!window.showSaveFilePicker) {
      throw new Error("\u6B64\u700F\u89BD\u5668\u4E0D\u652F\u63F4\u53E6\u5B58\u6A94\u6848\uFF1B\u8ACB\u7528 Edge \u6216 Chrome \u7684 HTTP\uFF0Ffile \u6A21\u5F0F");
    }
    const domain = dataDomain(domainId);
    const handle = await window.showSaveFilePicker({
      suggestedName: domain.file || domain.id + ".tsv",
      types: [
        {
          description: "\u5DE2\u5F0F\u6587\u5B57 TSV",
          accept: { "text/tab-separated-values": [".tsv"], "text/plain": [".tsv"] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    fileHandles.set(domainId, {
      handle,
      domainId,
      name: handle.name,
      meta: domain.meta
    });
    domain.file = handle.name;
  }
  async function saveDomain(domainId) {
    const domain = dataDomain(domainId);
    if (!domain) throw new Error("\u627E\u4E0D\u5230\u79D1\u76EE\uFF1A" + domainId);
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
    if (!window.showOpenFilePicker) throw new Error("\u6B64\u700F\u89BD\u5668\u4E0D\u652F\u63F4\u6A94\u6848\u5B58\u53D6");
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: "\u5DE2\u5F0F\u6587\u5B57 TSV",
          accept: { "text/tab-separated-values": [".tsv"], "text/plain": [".tsv"] }
        }
      ]
    });
    const loaded = [];
    const skipped = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      const parsed = parseDomainTsv(await file.text());
      if (!parsed) throw new Error(handle.name + " \u4E0D\u662F\u6709\u6548\u7684 TSV");
      if (DATA.some((domain) => domain.id === parsed.id)) {
        skipped.push(parsed.id);
        continue;
      }
      fileHandles.set(parsed.id, {
        handle,
        domainId: parsed.id,
        name: handle.name,
        meta: parsed.meta
      });
      loaded.push({
        id: parsed.id,
        name: parsed.name || parsed.id,
        hidden: !!parsed.hidden,
        entries: parsed.entries,
        meta: parsed.meta,
        file: handle.name
      });
    }
    return { loaded, skipped };
  }
  function showMissingTarget(tok, contextDomain, res) {
    closeLoadMore();
    const backdrop = el("div", "edit-backdrop");
    const panel = el("section", "edit-panel load-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const head = el("header", "edit-head");
    const titles = el("div");
    titles.append(el("div", "edit-kicker", "\u9700\u8981\u5176\u4ED6\u79D1\u76EE"));
    titles.append(el("h2", "edit-title", "\u627E\u4E0D\u5230\u300C" + disp(tok.display || tok.ref) + "\u300D"));
    head.append(titles);
    const close = el("button", "edit-close", "\xD7");
    close.type = "button";
    close.addEventListener("click", closeLoadMore);
    head.append(close);
    panel.append(head);
    const loadedNames = domains.map((domain) => disp(domain.name || domain.id)).join("\u3001") || "\uFF08\u7121\uFF09";
    const targetHint = tok.domain ? "\u9019\u500B\u5F15\u7528\u6307\u5B9A\u4E86 @" + tok.domain + "\uFF0C\u4F46\u8A72\u79D1\u5C1A\u672A\u8F09\u5165\u3002" : "\u9019\u500B\u8A5E\u76EE\u4E0D\u5728\u76EE\u524D\u5DF2\u8F09\u5165\u7684\u79D1\u76EE\u3002";
    panel.append(
      el(
        "p",
        "edit-note",
        targetHint + "\u76EE\u524D\u5DF2\u8F09\u5165\uFF1A" + loadedNames + "\u3002\u8981\u958B\u555F\u5176\u4ED6 TSV \u55CE\uFF1F"
      )
    );
    const status = el("p", "load-status", "");
    const actions = el("div", "edit-actions");
    const cancel = el("button", "edit-secondary", "\u7A0D\u5F8C");
    cancel.type = "button";
    cancel.addEventListener("click", closeLoadMore);
    const open = el("button", "edit-primary", "\u9078\u64C7\u5176\u4ED6 TSV\u2026");
    open.type = "button";
    open.addEventListener("click", async () => {
      open.disabled = true;
      status.textContent = "\u8B80\u53D6 TSV\u2026";
      try {
        const result = await pickMoreTsVs();
        const added = addLoadedDomains(result.loaded);
        if (!added) {
          status.textContent = result.skipped.length > 0 ? "\u9019\u4E9B\u79D1\u76EE\u5DF2\u7D93\u8F09\u5165\uFF1A" + result.skipped.join("\u3001") : "\u6C92\u6709\u52A0\u5165\u65B0\u79D1\u76EE\u3002";
          return;
        }
        closeLoadMore();
        const hit = NT.resolve(state.index, tok.ref, tok.domain, contextDomain);
        if (hit.status === "ok") {
          navigate(hit.domain, hit.key);
        } else {
          render();
          showToast("\u5DF2\u52A0\u5165\u65B0\u79D1\u76EE\uFF0C\u4F46\u4ECD\u627E\u4E0D\u5230\u300C" + disp(tok.ref) + "\u300D");
        }
      } catch (e) {
        status.textContent = "\u958B\u555F\u5931\u6557\uFF1A" + (e && e.message ? e.message : e);
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
    if (!dataDomain(domainId)) return;
    onReady();
  }
  function showToast(text) {
    if (!toastEl) {
      toastEl = el("div", "edit-toast");
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }
  function hideAddTerm() {
    addTermBtn.hidden = true;
    pendingSelection = null;
  }
  function captureSelection() {
    if (state.view !== "entry") {
      hideAddTerm();
      return;
    }
    if (SETTINGS && SETTINGS.simModeOf() !== 0) {
      hideAddTerm();
      return;
    }
    let text = "";
    let rect = null;
    let domainId = state.root.domain;
    const info = entryController ? entryController.getSelectionInfo() : null;
    if (info) {
      text = String(info.text || "").replace(/\s+/g, " ").trim();
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
      if (element.closest(".nt-ref, .nt-exp, .entry-head, .graph, .cm-editor")) {
        hideAddTerm();
        return;
      }
      text = selection.toString().replace(/\s+/g, " ").trim();
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
      showToast("\u689D\u76EE\u540D\u7A31\u6700\u591A 16 \u500B\u5B57\uFF08\u76EE\u524D " + [...text].length + " \u500B\u5B57\uFF09");
      return;
    }
    if (!rect || !rect.width && !rect.height) {
      hideAddTerm();
      return;
    }
    const loaded = state.index.byId.get(domainId);
    const exists = !!(loaded && loaded.entries.has(text)) || !!draftFor(domainId, text);
    pendingSelection = { domain: domainId, key: text, exists };
    addTermBtn.textContent = exists ? "\u7DE8\u8F2F\u8A5E\u76EE" : "\uFF0B \u65B0\u589E\u8A5E\u76EE";
    addTermBtn.hidden = false;
    addTermBtn.style.left = Math.max(10, Math.min(window.innerWidth - 130, rect.left + rect.width / 2 - 60)) + "px";
    addTermBtn.style.top = Math.min(window.innerHeight - 44, rect.bottom + 8) + "px";
  }
  function insertAtCursor(area, text) {
    const start = typeof area.selectionStart === "number" ? area.selectionStart : area.value.length;
    const end = typeof area.selectionEnd === "number" ? area.selectionEnd : start;
    area.setRangeText(text, start, end, "end");
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
    document.body.classList.remove("is-editing-entry");
    dirtyDomains.clear();
    fileHandles.clear();
    DATA = null;
    state.index = NT.buildIndex([]);
    state.mode = "auto";
    state.expanded.clear();
    state.focusPath = null;
    state.backlink = null;
    state.view = "entry";
    state.indexDomain = null;
    state.readOnly = false;
    state.root = { domain: null, key: "_" };
    state.graph = {
      depth: 2,
      forward: true,
      backward: true,
      fontSize: 12,
      edgeLength: "medium",
      edgeWidth: "medium",
      nodeShape: "circle",
      focus: null,
      recenter: false
    };
    domains.length = 0;
    routeApplied = false;
    reader.textContent = "";
    boot.hidden = false;
    bootStatus.textContent = "";
    bootOpen.disabled = false;
    bootOpenSelected.disabled = false;
    document.body.classList.add("is-booting");
    history.replaceState(null, "", location.pathname + location.search);
    subjectSelect.value = "";
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
      if (!window.confirm(
        "\u6709 " + count + " \u500B\u689D\u76EE\u5C1A\u672A\u5957\u7528\u3002\n\u6309\u300C\u78BA\u5B9A\u300D\u5148\u5B58\u6A94\u518D\u96E2\u958B\uFF1B\u6309\u300C\u53D6\u6D88\u300D\u7559\u4E0B\u7E7C\u7E8C\u7DE8\u8F2F\u3002"
      )) {
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
  function showDirtyDialog(options) {
    const leave = !!(options && options.leave);
    closeRecommendations();
    const ids = [...dirtyDomains];
    if (!ids.length) {
      if (leave) resetToBoot();
      return;
    }
    closeDirtyDialog();
    const backdrop = el("div", "edit-backdrop");
    const panel = el("section", "edit-panel leave-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const head = el("header", "edit-head");
    const titles = el("div");
    titles.append(el("div", "edit-kicker", leave ? "\u96E2\u958B\u7CFB\u7D71" : "\u672A\u5B58\u6A94"));
    titles.append(el("h2", "edit-title", leave ? "\u5132\u5B58\u5F8C\u96E2\u958B" : "\u5132\u5B58\u672A\u5B58\u6A94\u7684\u79D1\u76EE"));
    head.append(titles);
    const close = el("button", "edit-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u95DC\u9589");
    close.addEventListener("click", closeDirtyDialog);
    head.append(close);
    panel.append(head);
    panel.append(
      el(
        "p",
        "dirty-note",
        leave ? "\u4E0B\u5217\u79D1\u76EE\u6709\u672A\u5B58\u6A94\u7684\u8B8A\u66F4\u3002\u6309\u300C\u5132\u5B58\u4E26\u96E2\u958B\u300D\u6642\u624D\u6703\u8981\u6C42\u5BEB\u5165\u6B0A\u9650\u3002\u76F4\u63A5\u95DC\u9589\u5206\u9801\u6642\u700F\u89BD\u5668\u53EA\u6703\u8B66\u544A\uFF0C\u4E0D\u6703\u5132\u5B58\u3002" : "\u4E0B\u5217\u79D1\u76EE\u6709\u672A\u5B58\u6A94\u7684\u8B8A\u66F4\u3002\u5132\u5B58\u6642\u624D\u6703\u8981\u6C42\u5BEB\u5165\u6B0A\u9650\u3002"
      )
    );
    const list = el("div", "dirty-list");
    const rows = [];
    ids.forEach((id) => {
      const domain = state.index.byId.get(id);
      const session = fileHandles.get(id);
      const item = el("label", "dirty-item");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.value = id;
      const name = el("span", "dirty-name", disp(domainName(id)));
      const file = el(
        "span",
        "dirty-file",
        session ? session.name : domain && domain.file ? domain.file : id + ".tsv"
      );
      const status = el("span", "dirty-status", "\u672A\u5B58\u6A94");
      item.append(input, name, file, status);
      list.append(item);
      rows.push({ id, input, status });
    });
    panel.append(list);
    const actions = el("div", "edit-actions");
    const cancel = el("button", "edit-secondary", "\u53D6\u6D88");
    cancel.type = "button";
    cancel.addEventListener("click", closeDirtyDialog);
    let noSave = null;
    if (leave) {
      noSave = el("button", "edit-secondary", "\u4E0D\u5132\u5B58\u96E2\u958B");
      noSave.type = "button";
      noSave.addEventListener("click", () => {
        if (!window.confirm("\u6709 " + dirtyDomains.size + " \u79D1\u672A\u5B58\u6A94\uFF0C\u78BA\u5B9A\u4E0D\u5132\u5B58\u5C31\u96E2\u958B\uFF1F")) return;
        resetToBoot();
      });
    }
    const save = el("button", "edit-primary", leave ? "\u5132\u5B58\u4E26\u96E2\u958B" : "\u5132\u5B58\u5168\u90E8");
    save.type = "button";
    async function saveSelected() {
      const selected = rows.filter((row) => row.input.checked);
      if (!selected.length) {
        showToast("\u8ACB\u81F3\u5C11\u52FE\u9078\u4E00\u500B\u79D1\u76EE");
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      if (noSave) noSave.disabled = true;
      let failed = 0;
      for (const row of selected) {
        row.status.className = "dirty-status";
        row.status.textContent = "\u5132\u5B58\u4E2D\u2026";
        try {
          await saveDomain(row.id);
          clearDirty(row.id);
          row.status.classList.add("is-ok");
          row.status.textContent = "\u5DF2\u5132\u5B58";
        } catch (e) {
          failed++;
          row.status.classList.add("is-error");
          row.status.textContent = "\u5931\u6557\uFF1A" + (e && e.name === "AbortError" ? "\u5DF2\u53D6\u6D88" : e && e.message ? e.message : e);
        }
      }
      save.disabled = false;
      cancel.disabled = false;
      if (noSave) noSave.disabled = false;
      if (failed) {
        showToast("\u6709 " + failed + " \u79D1\u5132\u5B58\u5931\u6557\uFF1B\u53EF\u518D\u8A66\u4E00\u6B21\uFF0C\u6216\u9078\u64C7\u4E0D\u5132\u5B58\u96E2\u958B");
        return;
      }
      if (leave && dirtyDomains.size) {
        showToast("\u9084\u6709 " + dirtyDomains.size + " \u79D1\u672A\u52FE\u9078\uFF1B\u8ACB\u52FE\u9078\u5F8C\u518D\u96E2\u958B");
        return;
      }
      closeDirtyDialog();
      if (leave) resetToBoot();
      else {
        showToast("\u5DF2\u5132\u5B58 " + selected.length + " \u79D1");
        render();
      }
    }
    save.addEventListener("click", saveSelected);
    actions.append(cancel);
    if (noSave) actions.append(noSave);
    actions.append(save);
    const actionWrap = el("div", "dirty-actions");
    actionWrap.append(actions);
    panel.append(actionWrap);
    backdrop.append(panel);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeDirtyDialog();
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDirtyDialog();
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
    if (existing !== void 0 && isRedirect(existing)) {
      const target = redirectTarget(existing);
      showToast("\u9019\u662F\u7CFB\u7D71\u7DAD\u8B77\u7684\u5C0D\u7167\u9801\uFF0C\u4E0D\u80FD\u76F4\u63A5\u7DE8\u8F2F");
      navigate(target.domain || domainId, target.key);
      return;
    }
    const created = existing === void 0;
    const backdrop = el("div", "edit-backdrop");
    const panel = el("section", "edit-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const head = el("header", "edit-head");
    const titles = el("div");
    titles.append(el("div", "edit-kicker", created ? "\u65B0\u589E\u8A5E\u76EE" : "\u7DE8\u8F2F\u8A5E\u76EE"));
    titles.append(el("h2", "edit-title", key));
    const session = fileHandles.get(domainId);
    if (session) {
      titles.append(el("div", "edit-file", session.name + " \xB7 \u96E2\u958B\u6642\u5132\u5B58"));
    } else {
      titles.append(el("div", "edit-file", "\u8A18\u61B6\u9AD4\u7DE8\u8F2F \xB7 \u96E2\u958B\u6642\u5132\u5B58"));
    }
    head.append(titles);
    const close = el("button", "edit-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u95DC\u9589\u7DE8\u8F2F\u5668");
    close.addEventListener("click", closeEditor);
    head.append(close);
    panel.append(head);
    const body = el("div", "edit-body");
    const side = el("aside", "edit-side");
    side.append(el("div", "edit-side-title", "\u63D2\u5165\u540D\u8A5E"));
    const filter = document.createElement("input");
    filter.className = "edit-filter";
    filter.type = "search";
    filter.placeholder = "\u904E\u6FFE\u540D\u8A5E\u6216\u5167\u6587\u2026";
    side.append(filter);
    const list = el("div", "edit-list");
    side.append(list);
    const main = el("div", "edit-main");
    const area = document.createElement("textarea");
    area.className = "edit-textarea";
    area.value = existing || "";
    area.placeholder = "\u8F38\u5165\u91CB\u6587\uFF1B\u5DE6\u908A\u53EF\u5FEB\u901F\u63D2\u5165\u540D\u8A5E\u2026";
    main.append(area);
    const note = el(
      "p",
      "edit-note",
      "\u5132\u5B58\u6703\u5148\u5B58\u5728\u8A18\u61B6\u9AD4\uFF0Ctoolbar \u6703\u6A19\u793A\u300C\u672A\u5B58\u6A94\u300D\uFF1B\u6309\u300C\u96E2\u958B\u300D\u6642\u624D\u8981\u6C42\u5BEB\u5165\u6B0A\u9650\u4E26\u5BEB\u56DE TSV\u3002"
    );
    main.append(note);
    const actions = el("div", "edit-actions");
    const cancel = el("button", "edit-secondary", "\u53D6\u6D88");
    cancel.type = "button";
    cancel.addEventListener("click", closeEditor);
    const save = el("button", "edit-primary", "\u5B58\u5165\u8A18\u61B6\u9AD4\u4E26\u627E\u53EF\u6A19\u8A18\u8655");
    save.type = "button";
    actions.append(cancel, save);
    main.append(actions);
    body.append(side, main);
    panel.append(body);
    backdrop.append(panel);
    document.body.append(backdrop);
    editOverlay = backdrop;
    const source = Object.entries(domain.entries).filter(
      ([k, v]) => k !== "_" && k !== key && !isRedirect(v)
    );
    function drawList() {
      const needle = filter.value.trim().toLowerCase();
      list.textContent = "";
      let count = 0;
      for (const [k, v] of source) {
        const plain = k + " " + NT.plainText(v);
        const forms = SETTINGS ? SETTINGS.searchForms(plain) : [plain];
        if (needle && !forms.join(" ").toLowerCase().includes(needle)) continue;
        const item = el("button", "edit-noun");
        item.type = "button";
        item.append(el("span", "edit-noun-key", k));
        item.append(el("span", "edit-noun-preview", preview(v)));
        item.addEventListener("click", () => insertAtCursor(area, "^[" + k + "]"));
        list.append(item);
        if (++count >= 100) break;
      }
      if (!count) list.append(el("div", "edit-empty", "\u6C92\u6709\u7B26\u5408\u7684\u540D\u8A5E"));
    }
    filter.addEventListener("input", drawList);
    drawList();
    async function commit() {
      const value = area.value.replace(/\r?\n/g, " ").trim();
      if (!value) {
        area.focus();
        showToast("\u91CB\u6587\u4E0D\u80FD\u662F\u7A7A\u7684");
        return;
      }
      if (isRedirect(value)) {
        area.focus();
        showToast("@ \u958B\u982D\u662F\u7CFB\u7D71\u7DAD\u8B77\u7684\u5C0D\u7167\u9801\uFF0C\u8ACB\u76F4\u63A5\u7DE8\u8F2F\u76EE\u6A19\u689D\u76EE");
        return;
      }
      save.disabled = true;
      setDomainEntry(domainId, key, value);
      markDirty(domainId);
      save.disabled = false;
      rebuildAllIndex();
      closeEditor();
      navigate(domainId, key);
      showToast("\u5DF2\u5B58\u5165\u8A18\u61B6\u9AD4\uFF1B\u6309\u300C\u96E2\u958B\u300D\u6642\u518D\u5132\u5B58");
    }
    save.addEventListener("click", commit);
    area.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeEditor();
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
        if (value[i] === "^" && value[i + 1] === "[") {
          const end = value.indexOf("]", i + 2);
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
          contexts: hits.slice(0, 3).map(
            (start) => value.slice(Math.max(0, start - 16), start + key.length + 16).replace(/\s+/g, " ")
          )
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
      showToast("\u672C\u79D1\u5176\u4ED6\u5167\u6587\u6C92\u6709\u627E\u5230\u300C" + key + "\u300D\u7684\u53EF\u6A19\u8A18\u8655");
      return;
    }
    const backdrop = el("div", "edit-backdrop reco-backdrop");
    const panel = el("section", "edit-panel reco-panel");
    const head = el("header", "edit-head");
    const titles = el("div");
    titles.append(el("div", "edit-kicker", "\u6587\u5167\u641C\u5C0B"));
    titles.append(el("h2", "edit-title", "\u5728\u300C" + disp(key) + "\u300D\u7684\u53CD\u93C8\u63A5\u5340"));
    head.append(titles);
    const close = el("button", "edit-close", "\xD7");
    close.type = "button";
    close.addEventListener("click", closeRecommendations);
    head.append(close);
    panel.append(head);
    panel.append(
      el(
        "p",
        "edit-note",
        "\u672C\u79D1\u6709 " + groups.length + " \u500B\u689D\u76EE\u63D0\u5230\u300C" + disp(key) + "\u300D\u4F46\u5C1A\u672A\u52A0\u9023\u7D50\u3002\u9EDE\u300C\u524D\u5F80\u300D\u6703\u8DF3\u5230\u8A72\u689D\u76EE\uFF0C\u4E26\u5728\u8A72\u8655\u88DC\u4E0A ^[" + key + "]\uFF1B\u7CFB\u7D71\u6A19\u8A18\u65C1\u6709\u300C\u53D6\u6D88\u300D\u3002"
      )
    );
    const list = el("div", "reco-list");
    groups.forEach((group) => {
      const row = el("div", "reco-item");
      const text = el("span", "reco-text");
      const title = el(
        "span",
        "reco-source",
        group.fromKey === "_" ? disp(domainName(domainId)) : disp(group.fromKey)
      );
      const contexts = el(
        "span",
        "reco-context",
        group.contexts.join(" \uFF0F ") + (group.hits.length > 3 ? " \u2026" : "")
      );
      text.append(title, contexts);
      const go = el("button", "reco-go", "\u524D\u5F80");
      go.type = "button";
      go.title = "\u8DF3\u5230\u300C" + group.fromKey + "\u300D\u4E26\u63D2\u5165 ^[" + key + "]";
      go.addEventListener("click", () => {
        closeRecommendations();
        state.pendingInsert = {
          domain: domainId,
          key: group.fromKey,
          targetKey: key,
          hitIndex: 0
        };
        openEntryForEdit(domainId, group.fromKey);
      });
      row.append(text, go);
      list.append(row);
    });
    panel.append(list);
    const actions = el("div", "edit-actions");
    const done = el("button", "edit-secondary", "\u95DC\u9589");
    done.type = "button";
    done.addEventListener("click", closeRecommendations);
    actions.append(done);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    recoOverlay = backdrop;
  }
  let CM = window.OfftextCM || null;
  let cmLoading = null;
  function ensureCM() {
    if (state.uiMode === "mobile") return Promise.resolve(null);
    if (CM) return Promise.resolve(CM);
    if (cmLoading) return cmLoading;
    cmLoading = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "offtext-cm.js";
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
    return domain + ":" + key;
  }
  function baseValue(domain, key) {
    const data = dataDomain(domain);
    if (!data || !data.entries) return void 0;
    return data.entries[key];
  }
  function draftFor(domain, key) {
    return drafts.get(draftId(domain, key)) || null;
  }
  function valueFor(domain, key) {
    const draft = draftFor(domain, key);
    if (draft) return draft.value;
    const value = baseValue(domain, key);
    return value === void 0 ? null : String(value);
  }
  function setDraft(domain, key, value) {
    const text = String(value == null ? "" : value);
    const base = baseValue(domain, key);
    const baseText = base === void 0 ? null : String(base);
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
        seq: prev ? prev.seq : ++draftSeq
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
        saveBtn.textContent = "\u5B58\u6A94\uFF08" + count + "\uFF09";
        saveBtn.title = count + " \u500B\u689D\u76EE\u6709\u672A\u5957\u7528\u7684\u8B8A\u66F4\uFF1B\u6309\u4E00\u4E0B\u6AA2\u67E5\u3001\u91CD\u5EFA\u7D22\u5F15\uFF0C\u4E26\u5728\u53EF\u7528\u6642\u5BEB\u56DE TSV\u3002";
      }
      if (saveBtn.disabled !== saveBusy) saveBtn.disabled = saveBusy;
    }
    if (editBtn) {
      const label = state.editing ? "\u5B8C\u6210" : "\u7DE8\u8F2F";
      if (editBtn.textContent !== label) editBtn.textContent = label;
      editBtn.classList.toggle("is-active", state.editing);
      editBtn.disabled = state.view !== "entry";
    }
    if (orphanBtn) {
      const hidden = !state.editing || state.view !== "entry";
      if (orphanBtn.hidden !== hidden) orphanBtn.hidden = hidden;
    }
    if (exportBtn) {
      const hidden = state.uiMode !== "desktop" || !state.editing || state.view !== "entry" || state.root.key === "_";
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
      if (key === "_" || isRedirect(value)) continue;
      if (!state.index.links.incoming.has(domainId + ":" + key)) count++;
    }
    return count;
  }
  function updateOrphanButton() {
    if (!orphanBtn) return;
    if (!state.editing || state.view !== "entry") {
      orphanBtn.hidden = true;
      return;
    }
    const count = countOrphans(state.root.domain);
    orphanBtn.hidden = false;
    orphanBtn.textContent = "\u5B64\u5152" + (count ? " " + count : "");
    orphanBtn.classList.toggle("is-empty", count === 0);
    orphanBtn.title = "\u672C\u79D1\u6709 " + count + " \u500B\u6C92\u6709\u88AB\u4EFB\u4F55\u689D\u76EE\u5F15\u7528\u7684\u5B64\u5152\uFF1B\u9EDE\u9078\u5F8C\u76F4\u63A5\u7DE8\u5BEB\u3002";
  }
  function editorResolve(ref, domain, contextDomain) {
    const name = String(ref == null ? "" : ref).trim();
    const res = NT.resolve(state.index, name, domain, contextDomain);
    if (res.status === "ok") {
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
        return { status: "ok", domain: id, key: name, value: draft.value, chain: [] };
      }
    }
    return res;
  }
  function editorCompletions(query2, contextDomain) {
    const q = String(query2 == null ? "" : query2).trim();
    const needle = q.toLowerCase();
    const keyCount = /* @__PURE__ */ new Map();
    for (const domain of domains) {
      for (const [key, value] of domain.entries) {
        if (key === "_" || isRedirect(value)) continue;
        keyCount.set(key, (keyCount.get(key) || 0) + 1);
      }
    }
    const found = /* @__PURE__ */ new Map();
    const add = (item) => {
      const prev = found.get(item.key);
      if (!prev || item.score > prev.score) found.set(item.key, item);
    };
    domains.forEach((domain, domainIndex) => {
      for (const [key, value] of domain.entries) {
        if (key === "_" || isRedirect(value)) continue;
        const plain = NT.plainText(value);
        const forms = SETTINGS ? SETTINGS.searchForms(key + " " + plain) : [key + " " + plain];
        if (needle && !forms.join(" ").toLowerCase().includes(needle)) continue;
        let score = 0;
        if (key === q) score += 1e3;
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
          score
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
        preview: "\u65B0\u689D\u76EE\uFF08\u5C1A\u672A\u5B58\u6A94\uFF09",
        score: (draft.domain === contextDomain ? 160 : 20) + 500
      });
    }
    return [...found.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, "zh-Hant")).map((item) => ({
      ...item,
      apply: (keyCount.get(item.key) || 0) > 1 && item.domain !== contextDomain ? item.key + "@" + item.domain : item.key
    }));
  }
  function makeEditorHost(domainId, key) {
    return {
      hue: (depth) => NT.hue(depth),
      maxDepth: NT.MAX_DEPTH,
      display: disp,
      simMode: () => SETTINGS ? SETTINGS.simModeOf() : 0,
      resolve: (ref, domain, contextDomain) => editorResolve(ref, domain, contextDomain),
      chooseMode: (value) => NT.chooseMode(value, state.mode),
      isExpanded: (path) => state.expanded.has(path),
      focusPath: () => state.focusPath,
      toggleExpanded: (path) => toggleEditorPath(path),
      navigate: (target, targetKey) => navigate(target, targetKey),
      showMissing: (tok, contextDomain) => showMissingTarget(tok, contextDomain),
      isBacklinkSource: (res) => !!(state.backlink && res && res.status === "ok" && res.domain === state.backlink.targetDomain && res.key === state.backlink.targetKey),
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
      }
    };
  }
  function mountEntryEditor(article, value) {
    if (state.uiMode === "mobile") return false;
    if (!CM || typeof CM.createEntry !== "function") return false;
    const body = el("div", "entry-body");
    article.append(body);
    entryController = CM.createEntry({
      parent: body,
      text: String(value == null ? "" : value),
      domain: state.root.domain,
      key: state.root.key,
      depth: 0,
      editing: !READONLY_ONLY && state.editing,
      maxDepth: NT.MAX_DEPTH,
      host: makeEditorHost(state.root.domain, state.root.key)
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
    reader.classList.toggle("is-focusing", !!state.focusPath && state.view === "entry");
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
    if (state.view !== "entry") return;
    const targetId = state.root.domain + ":" + state.root.key;
    const res = editorResolve(state.root.key, state.root.domain, null);
    if (res.status !== "ok") return;
    const row = reader.querySelector(".entry-title-row");
    if (!row) return;
    const old = row.querySelector(".backlinks");
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
    if (READONLY_ONLY || state.uiMode === "mobile") return;
    const next = !!flag;
    if (next && (state.view !== "entry" || !entryController)) {
      showToast("\u8ACB\u5148\u958B\u555F\u4E00\u500B\u689D\u76EE");
      return;
    }
    if (next && SETTINGS && SETTINGS.simModeOf() !== 0) {
      showToast("\u7C21\u9AD4\u986F\u793A\u6A21\u5F0F\u4E0B\u4E0D\u80FD\u7DE8\u8F2F\uFF1B\u8ACB\u5148\u5728\u8A2D\u7F6E\u9801\u5207\u56DE\u300C\u4FDD\u6301\u539F\u6A23\u300D");
      return;
    }
    state.editing = next;
    if (entryController) entryController.setEditing(next);
    if (next) closeHoverCards();
    document.body.classList.toggle("is-editing-entry", next);
    refreshBacklinks();
    updateSaveUi();
    updateOrphanButton();
    if (next) refreshOrphanPanel();
    else closeOrphanPanel();
  }
  function openEntryForEdit(domain, key) {
    if (READONLY_ONLY || state.uiMode === "mobile" || isReservedKey(key)) return;
    if (!CM) {
      const exists = baseValue(domain, key) !== void 0;
      ensureEditAccess(domain, () => openEditor(domain, key, !exists));
      return;
    }
    state.pendingEdit = true;
    state.focusEditorOnce = true;
    state.createKey = null;
    if (state.view === "entry" && state.root.domain === domain && state.root.key === key) {
      state.pendingEdit = false;
      state.focusEditorOnce = false;
      setEditing(true);
      return;
    }
    navigate(domain, key);
  }
  function openNewEntry(domain, key) {
    if (READONLY_ONLY || state.uiMode === "mobile") return;
    const name = String(key == null ? "" : key).trim();
    if (!name) return;
    if (/[@|\[\]\n\t]/.test(name)) {
      showToast("\u689D\u76EE\u540D\u7A31\u4E0D\u80FD\u5305\u542B @\u3001|\u3001[\u3001]");
      return;
    }
    if ([...name].length > 16) {
      showToast("\u689D\u76EE\u540D\u7A31\u6700\u591A 16 \u500B\u5B57");
      return;
    }
    if (!CM) {
      ensureEditAccess(domain, () => openEditor(domain, name, true));
      return;
    }
    state.pendingEdit = true;
    state.focusEditorOnce = true;
    state.createKey = name;
    if (state.view === "entry" && state.root.domain === domain && state.root.key === name) {
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
    const seen = /* @__PURE__ */ new Set();
    const warn = (text) => {
      if (seen.has(text)) return;
      seen.add(text);
      warnings.push(text);
    };
    for (const draft of drafts.values()) {
      const label = draft.key || "\uFF08\u672A\u547D\u540D\uFF09";
      if (isReservedKey(String(draft.key))) {
        errors.push(label + "\uFF1A@ \u958B\u982D\u7684 key \u662F\u4FDD\u7559\u5B57\uFF0C\u4E0D\u80FD\u5C55\u793A\u6216\u7DE8\u8F2F");
      }
      if (!String(draft.value).trim()) errors.push(label + "\uFF1A\u91CB\u6587\u4E0D\u80FD\u662F\u7A7A\u7684");
      if (isRedirect(draft.value)) {
        errors.push(label + "\uFF1A@ \u958B\u982D\u662F\u7CFB\u7D71\u7DAD\u8B77\u7684\u5C0D\u7167\u9801\uFF0C\u4E0D\u80FD\u76F4\u63A5\u5B58\u6210\u689D\u76EE");
      }
      if (/\t/.test(draft.value)) errors.push(label + "\uFF1A\u91CB\u6587\u4E0D\u80FD\u5305\u542B Tab");
      if (/[\r\n]/.test(draft.value)) warn(label + "\uFF1A\u63DB\u884C\u6703\u5728\u5B58\u6A94\u6642\u8F49\u6210\u7A7A\u767D");
      if (draft.base === null) {
        if (!String(draft.key).trim()) errors.push("\u65B0\u689D\u76EE\u540D\u7A31\u4E0D\u80FD\u662F\u7A7A\u7684");
        else if ([...String(draft.key)].length > 16) {
          errors.push(label + "\uFF1A\u689D\u76EE\u540D\u7A31\u8D85\u904E 16 \u500B\u5B57");
        } else if (/[@|\[\]\n\t]/.test(draft.key)) {
          errors.push(label + "\uFF1A\u689D\u76EE\u540D\u7A31\u4E0D\u80FD\u5305\u542B @\u3001|\u3001[\u3001]");
        }
      }
      for (const tok of NT.parse(draft.value)) {
        if (tok.type !== "ref") continue;
        if ([...String(tok.inner)].length > 16) {
          errors.push(label + "\uFF1A\u5F15\u7528\u300C^[" + tok.inner + "]\u300D\u8D85\u904E 16 \u500B\u5B57");
          continue;
        }
        const res = editorResolve(tok.ref, tok.domain, draft.domain);
        if (res.status === "alias-loop") {
          warn(label + "\uFF1A\u5F15\u7528\u300C" + tok.ref + "\u300D\u5F62\u6210\u5225\u540D\u5FAA\u74B0");
        } else if (res.status !== "ok") {
          warn(label + "\uFF1A\u5F15\u7528\u300C" + tok.ref + "\u300D\u627E\u4E0D\u5230\u76EE\u6A19");
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
    const backdrop = el("div", "edit-backdrop");
    const panel = el("section", "edit-panel check-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const head = el("header", "edit-head");
    const titles = el("div");
    titles.append(el("div", "edit-kicker", "\u5B58\u6A94\u6AA2\u67E5"));
    titles.append(el("h2", "edit-title", "\u9084\u6709 " + errors.length + " \u9805\u8981\u4FEE\u6B63"));
    head.append(titles);
    const close = el("button", "edit-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u95DC\u9589");
    close.addEventListener("click", closeCheckDialog);
    head.append(close);
    panel.append(head);
    const list = el("div", "check-list");
    for (const line of errors) list.append(el("div", "check-line is-error", line));
    if (warnings.length) {
      list.append(el("div", "check-subtitle", "\u63D0\u9192"));
      for (const line of warnings) list.append(el("div", "check-line", line));
    }
    panel.append(list);
    const actions = el("div", "edit-actions");
    const done = el("button", "edit-primary", "\u56DE\u5230\u7DE8\u8F2F");
    done.type = "button";
    done.addEventListener("click", closeCheckDialog);
    actions.append(done);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    checkOverlay = backdrop;
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCheckDialog();
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
          const permission = await session.handle.queryPermission({ mode: "readwrite" });
          if (permission === "granted") {
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
      showToast("\u6C92\u6709\u672A\u5957\u7528\u7684\u8B8A\u66F4");
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
        String(draft.value).replace(/\r?\n/g, " ").trim()
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
    const bits = ["\u5DF2\u5957\u7528 " + list.length + " \u500B\u689D\u76EE", "\u5DF2\u91CD\u5EFA\u7D22\u5F15"];
    if (check.warnings.length) bits.push(check.warnings.length + " \u500B\u63D0\u9192");
    if (orphanTotal) bits.push(orphanTotal + " \u500B\u5B64\u5152");
    if (persisted.written.length) bits.push("\u5DF2\u5BEB\u5165 " + persisted.written.length + " \u79D1");
    if (persisted.pending.length) bits.push(persisted.pending.length + " \u79D1\u5F85\u96E2\u958B\u6642\u5132\u5B58");
    showToast(bits.join(" \xB7 "));
    updateOrphanButton();
    refreshOrphanPanel();
    return true;
  }
  function computeOrphans(domainId) {
    const domain = state.index.byId.get(domainId);
    if (!domain) return [];
    const out = [];
    for (const [key, value] of domain.entries) {
      if (key === "_" || isReservedKey(key) || isRedirect(value)) continue;
      if (!state.index.links.incoming.has(domainId + ":" + key)) {
        out.push({ domain: domainId, key, value });
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key, "zh-Hant"));
  }
  function computeDangling(domainIds) {
    const found = /* @__PURE__ */ new Map();
    for (const domainId of domainIds) {
      const domain = state.index.byId.get(domainId);
      if (!domain) continue;
      for (const [key, value] of domain.entries) {
        if (key === "_" || isReservedKey(key) || isRedirect(value)) continue;
        for (const tok of NT.parse(value)) {
          if (tok.type !== "ref") continue;
          const res = editorResolve(tok.ref, tok.domain, domainId);
          if (res.status === "ok") continue;
          const targetDomain = tok.domain || domainId;
          const id = targetDomain + ":" + tok.ref;
          let item = found.get(id);
          if (!item) {
            item = { domain: targetDomain, key: tok.ref, sources: [] };
            found.set(id, item);
          }
          if (!item.sources.includes(key) && item.sources.length < 3) item.sources.push(key);
        }
      }
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key, "zh-Hant"));
  }
  function refreshOrphanPanel() {
    if (!orphanPanel) return;
    const body = orphanPanel.querySelector(".orphan-body");
    if (!body) return;
    const scopeAll = orphanPanel.dataset.scope === "all";
    const scope = scopeAll ? domains.map((domain) => domain.id) : [state.root.domain];
    const orphans = [];
    for (const id of scope) orphans.push(...computeOrphans(id));
    const dangling = computeDangling(scope);
    const headCount = orphanPanel.querySelector(".orphan-count");
    if (headCount) {
      headCount.textContent = "\u5B64\u5152 " + orphans.length + " \xB7 \u7F3A\u76EE\u6A19 " + dangling.length;
    }
    body.textContent = "";
    const orphanTitle = el("div", "orphan-section-title", "\u6C92\u6709\u88AB\u4EFB\u4F55\u689D\u76EE\u5F15\u7528\uFF08\u542B\u9996\u9801\uFF09");
    body.append(orphanTitle);
    if (!orphans.length) {
      body.append(el("div", "orphan-empty", "\u9019\u500B\u7BC4\u570D\u6C92\u6709\u5B64\u5152\u689D\u76EE\u3002"));
    } else {
      for (const item of orphans) {
        const btn = el("button", "orphan-item");
        btn.type = "button";
        const head = el("span", "orphan-item-head");
        head.append(el("span", "orphan-item-key", disp(item.key)));
        if (scopeAll) head.append(el("span", "orphan-item-domain", disp(domainName(item.domain))));
        btn.append(head);
        btn.append(el("span", "orphan-item-preview", preview(item.value)));
        btn.title = "\u958B\u555F\u4E26\u7DE8\u8F2F\u300C" + item.key + "\u300D";
        btn.addEventListener("click", () => {
          closeOrphanPanel();
          openEntryForEdit(item.domain, item.key);
        });
        body.append(btn);
      }
    }
    const missingTitle = el(
      "div",
      "orphan-section-title",
      "\u7F3A\u76EE\u6A19\u5F15\u7528\uFF08" + dangling.length + "\uFF09"
    );
    body.append(missingTitle);
    if (!dangling.length) {
      body.append(el("div", "orphan-empty", "\u6C92\u6709\u627E\u4E0D\u5230\u76EE\u6A19\u7684\u5F15\u7528\u3002"));
    } else {
      for (const item of dangling) {
        const loaded = state.index.byId.has(item.domain);
        const btn = el("button", "orphan-item is-missing");
        btn.type = "button";
        const head = el("span", "orphan-item-head");
        head.append(el("span", "orphan-item-key", disp(item.key)));
        head.append(el("span", "orphan-item-domain", loaded ? "\u5EFA\u7ACB" : "\u672A\u8F09\u5165"));
        btn.append(head);
        btn.append(
          el("span", "orphan-item-preview", "\u4F86\u81EA\uFF1A" + item.sources.map(disp).join("\u3001"))
        );
        btn.disabled = !loaded;
        btn.title = loaded ? "\u5EFA\u7ACB\u300C" + item.key + "\u300D\u4E26\u958B\u59CB\u7DE8\u5BEB" : "\u76EE\u6A19\u79D1\u76EE\u5C1A\u672A\u8F09\u5165";
        if (loaded) {
          btn.addEventListener("click", () => {
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
    const panel = el("section", "orphan-panel");
    panel.setAttribute("aria-label", "\u5B64\u5152\u7BC0\u9EDE");
    const head = el("header", "orphan-head");
    head.append(el("strong", "orphan-title", "\u5B64\u5152\u7BC0\u9EDE"));
    head.append(el("span", "orphan-count", ""));
    const allLabel = el("label", "orphan-scope");
    const all = document.createElement("input");
    all.type = "checkbox";
    all.addEventListener("change", () => {
      panel.dataset.scope = all.checked ? "all" : "current";
      refreshOrphanPanel();
    });
    allLabel.append(all, document.createTextNode("\u5168\u90E8\u79D1\u76EE"));
    head.append(allLabel);
    const close = el("button", "orphan-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u95DC\u9589\u5B64\u5152\u7BC0\u9EDE");
    close.addEventListener("click", closeOrphanPanel);
    head.append(close);
    panel.append(head);
    const body = el("div", "orphan-body");
    panel.append(body);
    document.body.append(panel);
    orphanPanel = panel;
    panel.dataset.scope = "current";
    refreshOrphanPanel();
  }
  addTermBtn.addEventListener("click", () => {
    const selected = pendingSelection;
    hideAddTerm();
    if (!selected) return;
    if (selected.exists) openEntryForEdit(selected.domain, selected.key);
    else openNewEntry(selected.domain, selected.key);
  });
  reader.addEventListener("mousedown", hideAddTerm);
  reader.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
  reader.addEventListener("keyup", () => setTimeout(captureSelection, 0));
  window.addEventListener("scroll", hideAddTerm, true);
  window.addEventListener("resize", hideAddTerm);
  document.addEventListener("click", (e) => {
    if (!addTermBtn.contains(e.target)) hideAddTerm();
  });
  function nodeInfo(id) {
    const cut = id.indexOf(":");
    return { id, domain: id.slice(0, cut), key: id.slice(cut + 1) };
  }
  function graphDegree(id) {
    const links = state.index.links;
    return (links.forward.get(id) ? links.forward.get(id).size : 0) + (links.backward.get(id) ? links.backward.get(id).size : 0);
  }
  function graphCounts(id) {
    const links = state.index.links;
    return {
      forward: links.forward.get(id) ? links.forward.get(id).size : 0,
      back: links.backward.get(id) ? links.backward.get(id).size : 0
    };
  }
  function backlinksFor(targetId) {
    return NT.backlinksFor(state.index, targetId);
  }
  function defaultRoute() {
    const first = domains.find((d) => d.entries.has("_")) || domains[0];
    if (!first) return null;
    return {
      view: "entry",
      domain: first.id,
      key: first.entries.has("_") ? "_" : [...first.entries.keys()][0]
    };
  }
  function readRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    if (!h) return null;
    if (h === "index" || h.startsWith("index/")) {
      const raw = h.slice(6);
      if (!raw || raw === "all") return { view: "index", domain: null };
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch (e) {
      }
      id = canonicalDomainId(id);
      if (domains.some((d) => d.id === id)) return { view: "index", domain: id };
      return { view: "index", domain: null };
    }
    const parts = h.split("/").map((p) => {
      try {
        return decodeURIComponent(p);
      } catch (e) {
        return p;
      }
    });
    if (parts[0] === "graph" && parts.length >= 3) {
      return { view: "graph", domain: parts[1], key: parts.slice(2).join("/") };
    }
    if (parts.length >= 2) {
      return { view: "entry", domain: parts[0], key: parts.slice(1).join("/") };
    }
    return { view: "entry", domain: parts[0], key: "_" };
  }
  let routeApplied = false;
  function applyRoute() {
    if (!domains.length) return;
    let route = readRoute() || defaultRoute();
    if (!route) return;
    if ((route.view === "entry" || route.view === "graph") && route.domain) {
      const mapped = canonicalDomainId(route.domain);
      if (mapped !== route.domain) {
        route = { ...route, domain: mapped };
        const h = route.view === "graph" ? "#/graph/" + encodeURIComponent(route.domain) + "/" + encodeURIComponent(route.key) : "#/" + encodeURIComponent(route.domain) + "/" + encodeURIComponent(route.key);
        if (location.hash !== h) {
          try {
            history.replaceState(null, "", h);
          } catch (e) {
            location.hash = h;
          }
        }
      }
      if (isReservedKey(route.key)) {
        route = { ...route, key: "_" };
        const h = route.view === "graph" ? "#/graph/" + encodeURIComponent(route.domain) + "/_" : "#/" + encodeURIComponent(route.domain) + "/_";
        try {
          history.replaceState(null, "", h);
        } catch (e) {
          location.hash = h;
        }
      }
    } else if (route.view === "index" && route.domain && route.domain !== "all") {
      const h = "#/index/" + encodeURIComponent(route.domain);
      if (location.hash !== h) {
        try {
          history.replaceState(null, "", h);
        } catch (e) {
          location.hash = h;
        }
      }
    }
    if (route.view === "entry" || route.view === "graph") {
      const canon = canonicalKey(route.domain, route.key);
      if (canon.domain !== route.domain || canon.key !== route.key) {
        route = { ...route, domain: canon.domain, key: canon.key };
        const h = route.view === "graph" ? "#/graph/" + encodeURIComponent(route.domain) + "/" + encodeURIComponent(route.key) : "#/" + encodeURIComponent(route.domain) + "/" + encodeURIComponent(route.key);
        if (location.hash !== h) {
          try {
            history.replaceState(null, "", h);
          } catch (e) {
            location.hash = h;
          }
        }
      }
    }
    const changed = route.view !== state.view || route.domain !== state.root.domain || route.key !== state.root.key;
    if (routeApplied && changed) {
      state.expanded.clear();
      state.focusPath = null;
    }
    if (state.createKey && (route.view !== "entry" || route.key !== state.createKey)) {
      state.createKey = null;
    }
    if (route.view !== "entry") {
      state.focusEditorOnce = false;
      closeOrphanPanel();
      state.pendingInsert = null;
    }
    if (state.pendingInsert && (route.view !== "entry" || route.domain !== state.pendingInsert.domain || route.key !== state.pendingInsert.key)) {
      state.pendingInsert = null;
    }
    if (state.pendingBacklink && (route.view !== "entry" || route.domain !== state.pendingBacklink.targetDomain || route.key !== state.pendingBacklink.targetKey)) {
      state.pendingBacklink = null;
    }
    if (state.backlink && (route.view !== "entry" || route.domain !== state.backlink.sourceDomain || route.key !== state.backlink.sourceKey)) {
      state.backlink = null;
    }
    routeApplied = true;
    state.view = route.view;
    if (route.view === "entry" || route.view === "graph") {
      state.root = route;
    } else {
      state.indexDomain = route.domain || null;
    }
    if (route.view === "entry" && route.key !== "_") {
      recordRead(route.domain, route.key);
    }
    document.title = route.view === "index" ? "\u7D22\u5F15 \xB7 " + (state.indexDomain ? domainName(state.indexDomain) : "\u5168\u90E8\u79D1\u76EE") + " \xB7 \u5DE2\u5F0F\u6587\u5B57" : route.view === "graph" ? "\u5716\u8B5C \xB7 " + displayKey(route.domain, route.key) + " \xB7 \u5DE2\u5F0F\u6587\u5B57" : displayKey(route.domain, route.key) + " \xB7 \u5DE2\u5F0F\u6587\u5B57";
    render();
  }
  function navigate(domain, key, options) {
    const opts = options || {};
    domain = canonicalDomainId(domain);
    const canon = canonicalKey(domain, key);
    domain = canon.domain;
    key = canon.key;
    if (!opts.keepBacklink) state.backlink = null;
    const h = "#/" + encodeURIComponent(domain) + "/" + encodeURIComponent(key);
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
    let target = domain || "all";
    if (target !== "all") {
      target = canonicalDomainId(target);
      if (!domains.some((d) => d.id === target)) target = "all";
    }
    const h = "#/index/" + encodeURIComponent(target);
    window.scrollTo(0, 0);
    if (location.hash === h) render();
    else location.hash = h;
  }
  function navigateGraph(domain, key, options) {
    const canon = canonicalKey(domain, key);
    const h = "#/graph/" + encodeURIComponent(canon.domain) + "/" + encodeURIComponent(canon.key);
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
    if (state.view === "index") return;
    if (mode === "graph" && state.view === "graph") return;
    if (mode === "text" && state.view === "entry") return;
    const res = NT.resolve(state.index, state.root.key, state.root.domain);
    if (res.status !== "ok") return;
    if (mode === "graph") navigateGraph(res.domain, res.key);
    else navigate(res.domain, res.key);
  }
  function nearestOpenAncestor(path) {
    let p = path;
    while (p.includes(".")) {
      p = p.slice(0, p.lastIndexOf("."));
      if (state.expanded.has(p)) return p;
    }
    return null;
  }
  function closePath(path) {
    for (const key of [...state.expanded]) {
      if (key === path || key.startsWith(path + ".")) state.expanded.delete(key);
    }
    if (state.focusPath && (state.focusPath === path || state.focusPath.startsWith(path + "."))) {
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
  function renderDoc(text, depth, prefix, ancestors, inlineContext, contextDomain) {
    const doc = el("span", "nt-doc" + (inlineContext ? " is-inline" : ""));
    const paragraphs = String(text).split(/\n+/).filter((p) => p.trim() !== "");
    paragraphs.forEach((paragraph) => {
      const block = el("span", "nt-block");
      block.dataset.depth = String(depth);
      block.style.setProperty("--hue", String(NT.hue(depth)));
      block.style.setProperty("--depth", String(depth));
      const line = el("span", "nt-line");
      const extra = el("span", "nt-extra");
      const tokens = NT.parse(paragraph);
      const blocks = [];
      let refIndex = 0;
      tokens.forEach((tok) => {
        if (tok.type === "text") {
          line.append(el("span", "nt-text", disp(tok.text)));
          return;
        }
        const path = prefix ? prefix + "." + refIndex : String(refIndex);
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
    if (state.uiMode !== "mobile" || !res || res.status !== "ok") return null;
    const btn = el("button", "nt-mobile-read", "\u95B1\u8B80");
    btn.type = "button";
    btn.title = "\u63DB\u5230\u300C" + disp(res.key) + "\u300D\u9019\u4E00\u9801";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigate(res.domain, res.key);
    });
    return btn;
  }
  function renderRef(tok, path, depth, ancestors, inlineContext, contextDomain) {
    const expanded = state.expanded.has(path);
    const label = disp(tok.display || tok.ref);
    const wrap = el("span", "nt-refwrap");
    wrap.dataset.path = path;
    const btn = el("button", "nt-ref", label);
    btn.type = "button";
    btn.dataset.path = path;
    btn.dataset.ref = tok.ref;
    if (tok.domain) btn.dataset.domain = tok.domain;
    if (contextDomain) btn.dataset.context = contextDomain;
    btn.style.setProperty("--hue", String(NT.hue(depth)));
    if (state.focusPath && state.focusPath.startsWith(path + ".")) {
      btn.classList.add("is-focus-ancestor");
    }
    btn.setAttribute("aria-expanded", String(expanded));
    btn.title = (tok.domain ? `^[${tok.ref}@${tok.domain}]` : `^[${tok.ref}]`) + "\uFF1A\u9EDE\u64CA\u5C55\u958B\uFF0F\u6536\u5408\uFF1BCtrl/\u2318+\u9EDE\u64CA\u76F4\u63A5\u958B\u555F";
    const res = NT.resolve(state.index, tok.ref, tok.domain, contextDomain);
    btn.addEventListener("click", (e) => {
      if (res.status === "missing") {
        e.preventDefault();
        showMissingTarget(tok, contextDomain, res);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && state.uiMode !== "mobile" && res.status === "ok") {
        e.preventDefault();
        navigate(res.domain, res.key);
        return;
      }
      if (btn.classList.contains("is-backlink-source") && state.backlink) {
        navigate(state.backlink.targetDomain, state.backlink.targetKey);
      } else {
        toggle(path);
      }
    });
    wrap.append(btn);
    if (depth === 0 && state.backlink && res.status === "ok" && res.domain === state.backlink.targetDomain && res.key === state.backlink.targetKey) {
      btn.classList.add("is-backlink-source");
      btn.title = "\u56DE\u5230 " + disp(state.backlink.targetKey) + "\uFF08\u53CD\u93C8\u63A5\u4F86\u6E90\uFF09";
      btn.setAttribute("aria-label", "\u56DE\u5230 " + disp(state.backlink.targetKey));
    }
    if (!expanded) return { inline: wrap, block: null };
    const expId = "exp-" + path.replace(/\./g, "-");
    if (res.status !== "ok") {
      wrap.append(noteEl(res.status, res, depth));
      return { inline: wrap, block: null };
    }
    if (!res.value || !res.value.trim()) {
      wrap.append(noteEl("empty", res, depth));
      return { inline: wrap, block: null };
    }
    const id = res.domain + ":" + res.key;
    if (ancestors.has(id)) {
      wrap.append(noteEl("cycle", res, depth));
      return { inline: wrap, block: null };
    }
    if (depth + 1 > NT.MAX_DEPTH) {
      wrap.append(noteEl("limit", res, depth));
      return { inline: wrap, block: null };
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const mode = NT.chooseMode(res.value, state.mode);
    if (mode === "inline") {
      const exp = el("span", "nt-exp nt-exp-inline");
      exp.id = expId;
      exp.dataset.path = path;
      exp.dataset.depth = String(depth + 1);
      exp.style.setProperty("--hue", String(NT.hue(depth + 1)));
      exp.append(renderDoc(res.value, depth + 1, path, nextAncestors, true, res.domain));
      wrap.append(exp);
      const read2 = mobileReadButton(res);
      if (read2) wrap.append(read2);
      btn.setAttribute("aria-controls", expId);
      btn.classList.add("is-open");
      return { inline: wrap, block: null };
    }
    const block = el("span", "nt-exp nt-exp-block");
    block.id = expId;
    block.dataset.path = path;
    block.dataset.depth = String(depth + 1);
    block.style.setProperty("--hue", String(NT.hue(depth + 1)));
    block.style.setProperty("--depth", String(depth + 1));
    const head = el("span", "nt-exp-head");
    head.append(el("span", "nt-exp-arrow", "\u21B3"));
    head.append(el("span", "nt-exp-key", disp(res.key)));
    head.append(el("span", "nt-exp-domain", res.domain));
    const close = el("button", "nt-exp-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u6536\u5408");
    close.title = "\u6536\u5408";
    close.addEventListener("click", () => toggle(path));
    head.append(close);
    block.append(head);
    block.append(renderDoc(res.value, depth + 1, path, nextAncestors, false, res.domain));
    const read = mobileReadButton(res);
    if (read) block.append(read);
    btn.setAttribute("aria-controls", expId);
    btn.classList.add("is-open");
    return { inline: wrap, block };
  }
  function noteEl(kind, res, depth) {
    const span = el("span", "nt-note nt-note-" + kind);
    span.style.setProperty("--hue", String(NT.hue(depth)));
    let text = "";
    if (kind === "cycle") text = "\u21BA \u5FAA\u74B0\uFF1A" + disp(res.key || res.name);
    else if (kind === "alias-loop") text = "\u21BA \u5225\u540D\u8FF4\u5708\uFF1A" + disp(res.name || "");
    else if (kind === "empty") text = "\uFF08\u5C1A\u672A\u5B9A\u7FA9\uFF09";
    else if (kind === "limit") text = "\u2026\u5DF2\u9054\u6DF1\u5EA6\u4E0A\u9650\uFF08" + NT.MAX_DEPTH + "\uFF09";
    else {
      text = "\u67E5\u7121\u300C" + disp(res.name || "") + "\u300D";
      const picks = NT.suggest(state.index, res.name || "", 3);
      if (picks.length) text += "\uFF0C\u662F\u5426\u6307\uFF1A" + picks.map(disp).join("\u3001");
    }
    span.textContent = text;
    span.title = "\u5C55\u958B\u5DF2\u505C\u6B62\uFF0C\u4F46\u53EF\u4EE5\u518D\u9EDE\u4E00\u6B21\u6536\u5408\u3002";
    return span;
  }
  function render(options) {
    const opts = options || {};
    document.body.classList.toggle("is-mobile-ui", state.uiMode === "mobile");
    const scrollY = window.scrollY;
    const backlinkScroll = state.backlink && state.backlink.scroll ? state.backlink : null;
    const recenterGraph = state.view === "graph" && state.graph.recenter;
    if (entryController) {
      entryController.destroy();
      entryController = null;
    }
    subjectSelect.value = state.view === "index" ? state.indexDomain || "all" : state.root.domain;
    reader.textContent = "";
    reader.classList.toggle("is-focusing", !!state.focusPath && state.view === "entry");
    if (state.view !== "graph") hideGraphTip();
    if (state.view !== "entry") {
      document.body.classList.remove("is-editing-entry");
      closeOrphanPanel();
    }
    renderReadHistory();
    updateDirtyUi();
    updateSaveUi();
    updateOrphanButton();
    viewToggle.hidden = state.view === "index";
    const isGraphView = state.view === "graph";
    viewToggle.classList.toggle("is-graph", isGraphView);
    viewToggle.setAttribute("aria-pressed", String(isGraphView));
    viewToggle.title = isGraphView ? "\u5207\u63DB\u5230\u6587\u5B57\uFF08g\uFF09" : "\u5207\u63DB\u5230\u5716\u8B5C\uFF08g\uFF09";
    viewToggle.setAttribute("aria-label", isGraphView ? "\u5207\u63DB\u5230\u6587\u5B57" : "\u5207\u63DB\u5230\u5716\u8B5C");
    if (state.view === "index") renderIndex();
    else if (state.view === "graph") renderGraph();
    else renderEntry(opts);
    if (!entryController) applyFocus();
    if (orphanPanel) refreshOrphanPanel();
    requestAnimationFrame(() => {
      if (recenterGraph) {
        state.graph.recenter = false;
        const canvas = reader.querySelector(".graph-canvas");
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const top = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
          window.scrollTo(0, Math.max(0, top));
          return;
        }
      }
      if (backlinkScroll) {
        const mark = reader.querySelector(".nt-ref.is-backlink-source");
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
  function applyFocus() {
    reader.classList.remove("is-focusing");
    reader.querySelectorAll(".nt-dim, .nt-focus-current").forEach((node2) => {
      node2.classList.remove("nt-dim", "nt-focus-current");
    });
    if (state.view !== "entry" || !state.focusPath) return;
    const selector = '[data-path="' + state.focusPath + '"]';
    const target = reader.querySelector(".nt-exp" + selector) || reader.querySelector(".nt-refwrap" + selector);
    if (!target) return;
    reader.classList.add("is-focusing");
    target.classList.add("nt-focus-current");
    let node = target;
    while (node && node !== reader) {
      const parent = node.parentElement;
      if (parent && parent !== reader && !parent.classList.contains("nt-refwrap")) {
        for (const child of parent.children) {
          if (child !== node) child.classList.add("nt-dim");
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
      scroll: true
    };
    navigate(source.domain, source.key, { keepBacklink: true });
  }
  function renderBacklinks(list, target, pending) {
    if (pending) list = [pending, ...list];
    const nav = el("nav", "backlinks");
    nav.setAttribute("aria-label", "\u53CD\u93C8\u63A5");
    nav.title = "\u76F4\u63A5\u5F15\u7528\u672C\u689D\u76EE\u7684\u5176\u4ED6\u689D\u76EE\uFF08\u5171 " + list.length + " \u7B46\uFF1B\u524D 4 \u7B46\u76F4\u63A5\u986F\u793A\uFF0C\u5176\u9918\u5728\u4E0B\u62C9\uFF09";
    nav.append(el("span", "backlinks-label", "\u53CD\u93C8\u63A5"));
    nav.append(el("span", "backlinks-count", String(list.length)));
    const strip = el("div", "backlinks-list");
    function makeButton(item, menuItem) {
      const btn = el(
        "button",
        "backlink" + (menuItem ? " backlink-menu-item" : "") + (item.pending ? " is-pending" : "")
      );
      btn.type = "button";
      if (item.pending) {
        btn.append(el("span", "backlink-pending-tag", "\u65B0"));
      } else if (item.domain !== target.domain) {
        btn.append(el("span", "backlink-domain", disp(domainName(item.domain)) + "\xB7"));
      }
      btn.append(document.createTextNode(disp(item.key)));
      btn.title = item.pending ? "\u7CFB\u7D71\u525B\u52A0\u5165\u3001\u5C1A\u672A\u5B58\u6A94\u7684\u5F15\u7528\uFF1B\u9EDE\u4E00\u4E0B\u56DE\u5230\u300C" + disp(item.key) + "\u300D" : "\u8DF3\u5230 " + disp(domainName(item.domain)) + " \xB7 " + disp(item.key) + "\uFF0C\u4E26\u6A19\u51FA\u5F15\u7528\u300C" + disp(target.key) + "\u300D\u7684\u4F4D\u7F6E";
      btn.addEventListener("click", () => {
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
      const more = document.createElement("details");
      more.className = "backlinks-more";
      const summary = el("summary", "backlinks-more-btn", "+" + (list.length - 4));
      summary.title = "\u9084\u6709 " + (list.length - 4) + " \u7B46\u53CD\u93C8\u63A5";
      summary.setAttribute("aria-label", "\u9084\u6709 " + (list.length - 4) + " \u7B46\u53CD\u93C8\u63A5");
      const menu = el("div", "backlinks-menu");
      list.slice(4).forEach((item) => menu.append(makeButton(item, more)));
      more.append(summary, menu);
      strip.append(more);
    }
    nav.append(strip);
    if (state.editing && target && target.status === "ok") {
      const search = el("button", "backlink-search", "\u6587\u5167\u641C\u5C0B");
      search.type = "button";
      search.title = "\u5728\u672C\u79D1\u5176\u4ED6\u5167\u6587\u4E2D\u627E\u300C" + disp(target.key) + "\u300D\uFF0C\u8DF3\u904E\u53BB\u88DC\u9023\u7D50";
      search.addEventListener("click", () => showInTextSearch(target.domain, target.key));
      nav.append(search);
    }
    return nav;
  }
  const hoverLayer = el("div", "hover-layer");
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
    card.style.left = Math.max(12, left) + "px";
    card.style.top = Math.max(12, top) + "px";
  }
  function hoverBody(value, domain, depth) {
    const body = el("div", "hover-card-body");
    for (const tok of NT.parse(value)) {
      if (tok.type === "text") {
        body.append(document.createTextNode(disp(tok.text)));
        continue;
      }
      const res = editorResolve(tok.ref, tok.domain, domain);
      const label = el("span", "nt-ref hover-ref" + (res.status === "ok" ? "" : " is-missing"));
      label.textContent = disp(tok.display || tok.ref);
      label.style.setProperty("--hue", String(NT.hue(depth)));
      label.dataset.ref = tok.ref;
      if (tok.domain) label.dataset.domain = tok.domain;
      if (domain) label.dataset.context = domain;
      label.title = "^[" + tok.inner + "]" + (res.status === "ok" ? "\uFF1ACtrl/\u2318+\u9EDE\u64CA\u958B\u555F" : "\uFF1A\u627E\u4E0D\u5230\u76EE\u6A19");
      if (res.status === "ok") {
        label.dataset.hoverReady = "1";
        label.addEventListener("click", (event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          closeHoverCards();
          navigate(res.domain, res.key);
        });
      }
      label.addEventListener("mouseenter", () => scheduleHover(label, label.closest(".hover-card")));
      label.addEventListener("mouseleave", () => {
        const card = label.closest(".hover-card");
        if (card) scheduleClose(card);
      });
      body.append(label);
    }
    return body;
  }
  function isExpandedAnchor(anchor) {
    return !!anchor && anchor.getAttribute && anchor.getAttribute("aria-expanded") === "true";
  }
  function openHoverCard(anchor, parentCard) {
    if (isExpandedAnchor(anchor)) return null;
    const ref = anchor && anchor.dataset ? anchor.dataset.ref : "";
    if (!ref) return null;
    const res = editorResolve(ref, anchor.dataset.domain || null, anchor.dataset.context || null);
    if (res.status !== "ok") return null;
    const existing = hoverCards.find((card2) => card2.__anchor === anchor);
    if (existing) return existing;
    const start = parentCard ? hoverCards.indexOf(parentCard) + 1 : 0;
    if (start < hoverCards.length) closeHoverCards(hoverCards[start]);
    const card = el("section", "hover-card");
    card.__anchor = anchor;
    card.__parent = parentCard || null;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "\u5F15\u7528\u5167\u5BB9");
    const head = el("header", "hover-card-head");
    const title = el("strong", "hover-card-title", disp(displayKey(res.domain, res.key)));
    const domain = el("span", "hover-card-domain", disp(domainName(res.domain)));
    head.append(title, domain);
    head.append(el("span", "hover-card-hint", "Ctrl/\u2318+\u9EDE\u64CA\u958B\u555F"));
    card.append(head);
    card.append(hoverBody(res.value, res.domain, 1));
    card.addEventListener("mouseenter", clearHoverTimers);
    card.addEventListener("mouseleave", () => scheduleClose(card));
    hoverLayer.hidden = false;
    hoverLayer.append(card);
    hoverCards.push(card);
    card.style.visibility = "hidden";
    placeHoverCard(card, anchor);
    card.style.visibility = "";
    return card;
  }
  function scheduleHover(anchor, parentCard) {
    if (state.uiMode === "mobile" || state.editing || !anchor || !anchor.dataset || !anchor.dataset.ref) return;
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
      if (current === card || card && hoverCards.includes(card)) closeHoverCards(card);
    }, 220);
  }
  function hoverAnchorOf(target) {
    const anchor = target && target.closest ? target.closest(".cm-ref, .nt-ref") : null;
    if (!anchor || !reader.contains(anchor) || !anchor.dataset.ref) return null;
    if (isExpandedAnchor(anchor)) return null;
    return anchor;
  }
  document.addEventListener("mouseover", (event) => {
    const anchor = hoverAnchorOf(event.target);
    if (!anchor) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    scheduleHover(anchor, null);
  });
  document.addEventListener("mouseout", (event) => {
    const anchor = hoverAnchorOf(event.target);
    if (!anchor) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    if (hoverCards.length) scheduleClose(hoverCards[0]);
  });
  document.addEventListener("click", (event) => {
    if (hoverLayer.hidden) return;
    if (event.target.closest(".hover-card")) return;
    if (hoverAnchorOf(event.target)) return;
    clearHoverTimers();
    closeHoverCards();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && hoverCards.length) {
      event.preventDefault();
      clearHoverTimers();
      closeHoverCards();
    }
  });
  window.addEventListener("scroll", () => {
    if (!hoverLayer.hidden) {
      clearHoverTimers();
      closeHoverCards();
    }
  });
  function pendingBacklinkFor(targetId) {
    const pending = state.pendingBacklink;
    if (!pending || targetId !== pending.targetDomain + ":" + pending.targetKey) return null;
    const value = valueFor(pending.targetDomain, pending.targetKey) || "";
    for (const tok of NT.parse(value)) {
      if (tok.type !== "ref") continue;
      const res = editorResolve(tok.ref, tok.domain, pending.targetDomain);
      if (res.status === "ok" && res.domain === pending.sourceDomain && res.key === pending.sourceKey) {
        return { domain: pending.sourceDomain, key: pending.sourceKey, pending: true };
      }
    }
    return null;
  }
  function plainOccurrences(text, target) {
    const hits = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === "^" && text[i + 1] === "[") {
        const end = text.indexOf("]", i + 2);
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
      showToast("\u300C" + pending.targetKey + "\u300D\u5DF2\u4E0D\u5728\u672C\u6587\u4E2D\uFF0C\u6C92\u6709\u63D2\u5165");
      return;
    }
    const from = at;
    const to = at + pending.targetKey.length;
    entryController.view.dispatch({
      changes: [
        { from, insert: "^[" },
        { from: to, insert: "]" }
      ],
      selection: { anchor: to + 3 },
      scrollIntoView: true
    });
    entryController.markInserted(
      from,
      to + 3,
      "intext-" + Date.now(),
      "^[" + pending.targetKey + "]"
    );
    entryController.focus();
    state.pendingBacklink = {
      targetDomain: pending.domain,
      targetKey: pending.key,
      sourceDomain: pending.domain,
      sourceKey: pending.targetKey
    };
    refreshBacklinks();
    showToast("\u5DF2\u63D2\u5165 ^[" + pending.targetKey + "]\uFF1B\u65C1\u6709\u300C\u53D6\u6D88\u300D\u53EF\u6309");
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
    if (res.status !== "ok" && !creating) {
      if (state.editing) {
        state.editing = false;
        document.body.classList.remove("is-editing-entry");
        updateSaveUi();
      }
      reader.append(emptyState(res));
      return;
    }
    if (res.status === "ok" && (res.domain !== state.root.domain || res.key !== state.root.key)) {
      navigate(res.domain, res.key);
      return;
    }
    const value = res.status === "ok" ? res.value : valueFor(state.root.domain, state.root.key) || "";
    const article = el("article", "entry" + (state.editing ? " is-editing" : ""));
    article.dataset.domain = state.root.domain;
    article.dataset.key = state.root.key;
    document.body.classList.toggle("is-editing-entry", !!state.editing);
    const head = el("header", "entry-head");
    head.append(el("div", "entry-kicker", disp(domainName(state.root.domain))));
    const titleRow = el("div", "entry-title-row");
    titleRow.append(el("h1", "entry-title", disp(displayKey(state.root.domain, state.root.key))));
    const targetId = state.root.domain + ":" + state.root.key;
    const backlinks = backlinksFor(targetId);
    const pending = pendingBacklinkFor(targetId);
    if (backlinks.length || state.editing) {
      titleRow.append(renderBacklinks(backlinks, res, pending));
    }
    const isOrphan = !state.index.links.incoming.has(targetId);
    if (state.editing && state.root.key !== "_" && !isRedirect(value) && isOrphan) {
      const orphan = el("button", "entry-orphan", "\u5B64\u5152");
      orphan.type = "button";
      orphan.title = "\u9019\u500B\u689D\u76EE\u6C92\u6709\u88AB\u4EFB\u4F55\u689D\u76EE\u5F15\u7528\uFF1B\u67E5\u770B\u5B64\u5152\u7BC0\u9EDE\u6E05\u55AE";
      orphan.addEventListener("click", () => {
        if (!orphanPanel) toggleOrphanPanel();
        else refreshOrphanPanel();
      });
      titleRow.append(orphan);
    }
    head.append(titleRow);
    article.append(head);
    const mounted = mountEntryEditor(article, value);
    if (!mounted) {
      const ancestors = /* @__PURE__ */ new Set([targetId]);
      article.append(renderDoc(value, 0, "", ancestors, false, state.root.domain));
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
    if (state.pendingInsert && state.pendingInsert.domain === state.root.domain && state.pendingInsert.key === state.root.key && entryController) {
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
  const GRAPH_MAX_NODES = 48;
  const GRAPH_EDGE_WIDTHS = { thin: 1.2, medium: 2.4, thick: 4 };
  const GRAPH_PANEL_KEY = "offtext.graphPanel.v1";
  let graphPanelCollapsed = false;
  try {
    graphPanelCollapsed = localStorage.getItem(GRAPH_PANEL_KEY) === "1";
  } catch (e) {
  }
  const SVG_NS = "http://www.w3.org/2000/svg";
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
    "contamination",
    "reinforcement",
    "engineering",
    "propagation",
    "supervised",
    "computing",
    "attention",
    "database",
    "function",
    "diffusion",
    "learning",
    "network",
    "fitting",
    "ability",
    "decoding",
    "privacy",
    "driving",
    "calling",
    "window",
    "tensors",
    "weights",
    "prompt",
    "collapse",
    "algebra",
    "ization",
    "former",
    "source",
    "format",
    "descent",
    "model",
    "meter",
    "typed",
    "tensor",
    "modal",
    "code",
    "type",
    "data",
    "face",
    "izer",
    "gen",
    "use"
  ].sort((a, b) => b.length - a.length);
  function graphLabel(key, domain) {
    const text = disp(key === "_" ? domainName(domain) : String(key));
    const hasHan = /[\u3400-\u9fff]/.test(text);
    if (hasHan) {
      if (text.length <= 4) return [text];
      const lineCount = Math.min(3, Math.ceil(text.length / 4));
      const perLine = Math.ceil(text.length / lineCount);
      const lines = [];
      for (let i = 0; i < lineCount; i++) {
        lines.push(text.slice(i * perLine, (i + 1) * perLine));
      }
      return lines.filter(Boolean);
    }
    if (text.length <= 10) return [text];
    for (const suffix of GRAPH_BREAK_SUFFIXES) {
      if (!text.endsWith(suffix)) continue;
      const head = text.slice(0, -suffix.length);
      if (head.length >= 3 && head.length <= 12 && suffix.length <= 12) {
        return [head, suffix];
      }
    }
    const words = text.split(/[\s_-]+/).filter(Boolean);
    if (words.length > 1) {
      const lineCount = Math.min(3, words.length);
      const target = Math.ceil(text.length / lineCount);
      const lines = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? line + " " + word : word;
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
  function graphNodeMetrics(node) {
    const size = state.graph.fontSize;
    const value = graphDegree(node.id);
    const base = 12 + Math.min(22, Math.sqrt(value) * 4.5);
    const lines = graphLabel(node.key, node.domain);
    const textWidth = Math.max(...lines.map((line) => graphTextWidth(line, size)));
    const textHeight = (lines.length - 1) * size * 1.1 + size;
    if (state.graph.nodeShape === "rect") {
      const padX = node.depth === 0 ? 10 : 6;
      const padY = node.depth === 0 ? 7 : 4;
      const w = Math.max(size * 2.8, textWidth + padX * 2, base * 1.35);
      const h = Math.max(size * 1.7, textHeight + padY * 2, base * 1.05);
      return { shape: "rect", w, h, r: (w + h) / 4 };
    }
    const fit = Math.max(
      textWidth / 2 + 6,
      lines.length * size * 1.12 / 2 + 6
    );
    const min = node.depth === 0 ? size * 1.9 : size * 1.15;
    const r = Math.max(min, base, fit);
    return { shape: "circle", w: r * 2, h: r * 2, r };
  }
  function graphHalfW(node) {
    return node.shape === "rect" ? node.w / 2 : node.r;
  }
  function graphHalfH(node) {
    return node.shape === "rect" ? node.h / 2 : node.r;
  }
  function graphEdgeGap(node, ux, uy, gap) {
    if (node.shape !== "rect") return node.r + gap;
    const tx = Math.abs(ux) > 1e-6 ? node.w / 2 / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 1e-6 ? node.h / 2 / Math.abs(uy) : Infinity;
    return Math.min(tx, ty) + gap;
  }
  function graphShortDomain(id) {
    if (id === "aijargon") return "AI";
    return disp(domainName(id)).slice(0, 1);
  }
  const graphTip = el("div", "graph-tip");
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
    graphTip.style.left = Math.max(pad, left) + "px";
    graphTip.style.top = Math.max(pad, top) + "px";
  }
  function showGraphTip(node, x, y) {
    const domain = state.index.byId.get(node.domain);
    const value = domain ? domain.entries.get(node.key) : "";
    const text = NT.plainText(value || "").replace(/\s+/g, " ").trim();
    const counts = graphCounts(node.id);
    graphTip.textContent = "";
    const head = el("div", "graph-tip-head");
    head.append(el("strong", "graph-tip-key", disp(displayKey(node.domain, node.key))));
    head.append(el("span", "graph-tip-domain", disp(domainName(node.domain))));
    graphTip.append(head);
    graphTip.append(
      el(
        "div",
        "graph-tip-meta",
        "\u9806 " + counts.forward + " \xB7 \u9006 " + counts.back + " \xB7 \u6DF1\u5EA6 " + node.depth
      )
    );
    graphTip.append(
      el(
        "p",
        "graph-tip-body",
        disp(text.length > 260 ? text.slice(0, 260) + "\u2026" : text || "\uFF08\u5C1A\u7121\u91CB\u6587\uFF09")
      )
    );
    graphTip.hidden = false;
    moveGraphTip(x, y);
  }
  function buildGraph(rootId, opts) {
    const nodes = /* @__PURE__ */ new Map();
    const root = nodeInfo(rootId);
    const tree = /* @__PURE__ */ new Set();
    const pairKey = (a, b) => a < b ? a + "|" + b : b + "|" + a;
    nodes.set(rootId, { ...root, depth: 0 });
    let frontier = [rootId];
    let truncated = false;
    for (let level = 0; level < opts.depth; level++) {
      const candidates = /* @__PURE__ */ new Map();
      for (const id of frontier) {
        const next = /* @__PURE__ */ new Set();
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
    const byDirection = /* @__PURE__ */ new Map();
    const addEdge = (from, to, kind) => {
      const key = from + "|" + to;
      const existing = byDirection.get(key);
      if (existing) {
        if (existing.kind === "back" && kind === "forward") existing.kind = "forward";
        existing.tree = tree.has(pairKey(from, to));
        return;
      }
      const edge = { from, to, kind, tree: tree.has(pairKey(from, to)) };
      byDirection.set(key, edge);
      edges.push(edge);
    };
    for (const id of nodes.keys()) {
      if (opts.forward) {
        for (const target of state.index.links.forward.get(id) || []) {
          if (nodes.has(target)) addEdge(id, target, "forward");
        }
      }
      if (opts.backward) {
        for (const source of state.index.links.backward.get(id) || []) {
          if (nodes.has(source)) addEdge(source, id, "back");
        }
      }
    }
    return { rootId, nodes, edges, truncated };
  }
  function layoutGraph(graph, width, height) {
    const nodes = [...graph.nodes.values()];
    const rectMode = state.graph.nodeShape === "rect";
    nodes.forEach((node) => {
      const metrics = graphNodeMetrics(node);
      node.shape = metrics.shape;
      node.w = metrics.w;
      node.h = metrics.h;
      node.r = metrics.r;
    });
    const cx = width / 2;
    const cy = height / 2;
    const edgeFactor = state.graph.edgeLength === "short" ? 0.78 : state.graph.edgeLength === "long" ? 1.28 : 1;
    const byDepth = /* @__PURE__ */ new Map();
    nodes.forEach((node) => {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
      byDepth.get(node.depth).push(node);
    });
    const angleOf = (node) => Math.atan2(node.y - cy, node.x - cx);
    [...byDepth.keys()].sort((a, b) => a - b).forEach((depth) => {
      const group = byDepth.get(depth);
      group.sort((a, b) => {
        const pa = a.parent ? graph.nodes.get(a.parent) : null;
        const pb = b.parent ? graph.nodes.get(b.parent) : null;
        if (pa && pb) {
          const diff = angleOf(pa) - angleOf(pb);
          if (Math.abs(diff) > 1e-3) return diff;
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
        const angle = i / group.length * Math.PI * 2 + hashId(node.id) * 0.18;
        node.x = cx + Math.cos(angle) * rx;
        node.y = cy + Math.sin(angle) * ry;
      });
    });
    const baseRest = Math.max(76, Math.min(152, width / 4.6)) * edgeFactor * (rectMode ? 0.9 : 1);
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
          let force = 5e3 / (dist * dist);
          if (dist < min) force += (min - dist) * 0.4;
          const fx = dx / dist * force;
          const fy = dy / dist * force;
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
        const force = (dist - rest) * (edge.tree ? 0.018 : 3e-3);
        const fx = dx / dist * force;
        const fy = dy / dist * force;
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
        node.x += (cx - node.x) * 4e-4;
        node.y += (cy - node.y) * 4e-4;
        node.x = Math.max(graphHalfW(node) + 8, Math.min(width - graphHalfW(node) - 8, node.x));
        node.y = Math.max(graphHalfH(node) + 8, Math.min(height - graphHalfH(node) - 8, node.y));
      }
    }
    for (let pass = 0; pass < 160; pass++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (rectMode) {
            const overlapX = (a.w + b.w) / 2 + 8 - Math.abs(dx);
            const overlapY = (a.h + b.h) / 2 + 8 - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) continue;
            moved = true;
            if (overlapX < overlapY) {
              const push2 = (dx >= 0 ? 1 : -1) * overlapX * 0.55;
              if (a.depth !== 0) a.x -= push2;
              if (b.depth !== 0) b.x += push2;
            } else {
              const push2 = (dy >= 0 ? 1 : -1) * overlapY * 0.55;
              if (a.depth !== 0) a.y -= push2;
              if (b.depth !== 0) b.y += push2;
            }
            continue;
          }
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
        node.x = Math.max(graphHalfW(node) + 8, Math.min(width - graphHalfW(node) - 8, node.x));
        node.y = Math.max(graphHalfH(node) + 8, Math.min(height - graphHalfH(node) - 8, node.y));
      }
      if (!moved) break;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - graphHalfW(node));
      maxX = Math.max(maxX, node.x + graphHalfW(node));
      minY = Math.min(minY, node.y - graphHalfH(node));
      maxY = Math.max(maxY, node.y + graphHalfH(node));
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(1.8, (width - 80) / spanX, (height - 80) / spanY);
    if (scale > 1.02) {
      const root2 = graph.nodes.get(graph.rootId);
      for (const node of nodes) {
        node.x = cx + (node.x - root2.x) * scale;
        node.y = cy + (node.y - root2.y) * scale;
      }
    }
    const root = graph.nodes.get(graph.rootId);
    root.x = cx;
    root.y = cy;
    const halfW = Math.max(60, width / 2 - 24);
    const halfH = Math.max(60, height / 2 - 24);
    let maxDx = 0;
    let maxDy = 0;
    for (const node of nodes) {
      if (node === root) continue;
      maxDx = Math.max(maxDx, Math.abs(node.x - root.x) + graphHalfW(node));
      maxDy = Math.max(maxDy, Math.abs(node.y - root.y) + graphHalfH(node));
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
  function graphSegmentControl(id, labelText, options, current, onPick) {
    const wrap = el("div", "graph-control graph-segment-control");
    wrap.id = id;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", labelText);
    wrap.append(el("span", "graph-control-label", labelText));
    const group = el("span", "seg graph-seg");
    options.forEach(([value, text]) => {
      const active = String(current) === String(value);
      const button = el("button", "graph-segment" + (active ? " is-active" : ""), text);
      button.type = "button";
      button.dataset.value = String(value);
      button.setAttribute("aria-pressed", String(active));
      button.title = labelText + "\uFF1A" + text;
      button.addEventListener("click", () => onPick(String(value)));
      group.append(button);
    });
    wrap.append(group);
    return wrap;
  }
  function renderGraphControls(graph) {
    const box = el("div", "graph-controls");
    const depthLabel = graphSegmentControl(
      "graphDepth",
      "\u5C64\u6578",
      [
        ["1", "1"],
        ["2", "2"],
        ["3", "3"]
      ],
      state.graph.depth,
      (value) => {
        state.graph.depth = Number(value);
        state.graph.focus = null;
        render();
      }
    );
    const fontLabel = el("label", "graph-control graph-font-control");
    fontLabel.append(document.createTextNode("\u5B57\u7D1A"));
    const font = document.createElement("input");
    font.type = "range";
    font.id = "graphFontSize";
    font.min = "12";
    font.max = "24";
    font.step = "0.1";
    font.value = String(state.graph.fontSize);
    const formatSize = (value) => {
      const n = Number(value);
      return (Math.round(n * 10) / 10).toString() + "px";
    };
    const fontValue = el("span", "graph-font-value", formatSize(state.graph.fontSize));
    font.addEventListener("input", () => {
      fontValue.textContent = formatSize(font.value);
    });
    font.addEventListener("change", () => {
      state.graph.fontSize = Number(font.value);
      state.graph.focus = null;
      render();
    });
    fontLabel.append(font, fontValue);
    const edgeLabel = graphSegmentControl(
      "graphEdgeLength",
      "\u9023\u7DDA",
      [
        ["short", "\u77ED"],
        ["medium", "\u4E2D"],
        ["long", "\u9577"]
      ],
      state.graph.edgeLength,
      (value) => {
        state.graph.edgeLength = value;
        state.graph.focus = null;
        render();
      }
    );
    const widthLabel = graphSegmentControl(
      "graphEdgeWidth",
      "\u7DDA\u7C97",
      [
        ["thin", "\u7D30"],
        ["medium", "\u4E2D"],
        ["thick", "\u7C97"]
      ],
      state.graph.edgeWidth,
      (value) => {
        state.graph.edgeWidth = value;
        state.graph.focus = null;
        render();
      }
    );
    const shapeLabel = graphSegmentControl(
      "graphNodeShape",
      "\u7BC0\u9EDE",
      [
        ["circle", "\u5713\u5F62"],
        ["rect", "\u77E9\u5F62"]
      ],
      state.graph.nodeShape,
      (value) => {
        state.graph.nodeShape = value;
        state.graph.focus = null;
        render();
      }
    );
    const check = (key, text) => {
      const label = el("label", "graph-check");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = key === "forward" ? "graphForward" : "graphBackward";
      input.checked = state.graph[key];
      input.addEventListener("change", () => {
        state.graph[key] = input.checked;
        state.graph.focus = null;
        render();
      });
      label.append(input);
      label.append(document.createTextNode(text));
      return label;
    };
    const count = el(
      "span",
      "graph-count",
      graph.nodes.size + " \u500B\u7BC0\u9EDE \xB7 " + graph.edges.length + " \u689D\u9023\u7DDA"
    );
    const reset = el("button", "graph-reset", "\u91CD\u8A2D");
    reset.type = "button";
    reset.addEventListener("click", () => {
      state.graph.depth = 2;
      state.graph.forward = true;
      state.graph.backward = true;
      state.graph.fontSize = 12;
      state.graph.edgeLength = "medium";
      state.graph.edgeWidth = "medium";
      state.graph.nodeShape = "circle";
      state.graph.focus = null;
      render();
    });
    box.append(
      depthLabel,
      fontLabel,
      edgeLabel,
      widthLabel,
      shapeLabel,
      check("forward", "\u9806\u93C8\u7D50"),
      check("backward", "\u9006\u93C8\u7D50"),
      count,
      reset
    );
    return box;
  }
  function renderGraphLegend() {
    const legend2 = el("div", "graph-legend");
    legend2.append(el("span", "graph-legend-label", "\u6DF1\u5EA6"));
    for (let d = 0; d <= state.graph.depth; d++) {
      const chip = el("span", "graph-swatch");
      chip.style.setProperty("--h", String(NT.hue(d)));
      legend2.append(chip);
    }
    legend2.append(el("span", "graph-legend-label", "0 \u2192 " + state.graph.depth));
    const addLine = (cls, text) => {
      const item = el("span", "graph-legend-item");
      item.append(el("span", "graph-legend-line " + cls));
      item.append(document.createTextNode(text));
      legend2.append(item);
    };
    addLine("is-forward", "\u9806\u93C8\u7D50");
    addLine("is-back", "\u9006\u93C8\u7D50");
    legend2.append(el("span", "graph-legend-item", "\u5927\u5C0F\uFF1D\u9023\u7D50\u6578"));
    const badge = el("span", "graph-legend-item");
    badge.append(el("span", "graph-legend-badge", "\u751F"));
    badge.append(document.createTextNode("\u5176\u4ED6\u79D1\u76EE"));
    legend2.append(badge);
    return legend2;
  }
  function renderGraphPanel(graph) {
    const panel = el("div", "graph-panel" + (graphPanelCollapsed ? " is-collapsed" : ""));
    const head = el("div", "graph-panel-head");
    const toggle2 = el("button", "graph-panel-toggle");
    toggle2.type = "button";
    toggle2.setAttribute("aria-expanded", String(!graphPanelCollapsed));
    toggle2.setAttribute("aria-controls", "graphPanelBody");
    toggle2.title = graphPanelCollapsed ? "\u5C55\u958B\u5716\u8B5C\u8A2D\u5B9A" : "\u6536\u5408\u5716\u8B5C\u8A2D\u5B9A";
    const chevron = el("span", "graph-panel-chevron", "\u25BE");
    toggle2.append(
      el("span", "graph-panel-icon", "\u2699"),
      el("span", "graph-panel-label", "\u5716\u8B5C\u8A2D\u5B9A"),
      chevron
    );
    const body = el("div", "graph-panel-body");
    body.id = "graphPanelBody";
    body.append(renderGraphControls(graph), renderGraphLegend());
    panel.append(head, body);
    head.append(toggle2);
    toggle2.addEventListener("click", () => {
      graphPanelCollapsed = !graphPanelCollapsed;
      panel.classList.toggle("is-collapsed", graphPanelCollapsed);
      toggle2.setAttribute("aria-expanded", String(!graphPanelCollapsed));
      toggle2.title = graphPanelCollapsed ? "\u5C55\u958B\u5716\u8B5C\u8A2D\u5B9A" : "\u6536\u5408\u5716\u8B5C\u8A2D\u5B9A";
      try {
        localStorage.setItem(GRAPH_PANEL_KEY, graphPanelCollapsed ? "1" : "0");
      } catch (e) {
      }
      updateGraphPanelFloat();
    });
    return panel;
  }
  function updateGraphPanelFloat() {
    const panel = document.querySelector(".graph-panel");
    if (!panel || state.view !== "graph") return;
    const stage = panel.closest(".graph-stage");
    if (!stage) return;
    const topbar = document.querySelector(".topbar");
    const top = Math.round((topbar ? topbar.getBoundingClientRect().bottom : 0) + 10);
    const stageRect = stage.getBoundingClientRect();
    const shouldFloat = stageRect.top < top && stageRect.bottom > top + 120;
    panel.classList.toggle("is-floating", shouldFloat);
    if (!shouldFloat) {
      panel.style.top = "";
      panel.style.right = "";
      panel.style.left = "";
      panel.style.width = "";
      return;
    }
    const width = Math.min(370, Math.max(180, Math.round(stageRect.width - 20)));
    panel.style.top = top + "px";
    panel.style.right = Math.max(10, Math.round(window.innerWidth - stageRect.right + 10)) + "px";
    panel.style.left = "auto";
    panel.style.width = panel.classList.contains("is-collapsed") ? "auto" : width + "px";
  }
  window.addEventListener("scroll", updateGraphPanelFloat, { passive: true });
  window.addEventListener("resize", updateGraphPanelFloat);
  function renderGraphFocusBar(graph) {
    const focus = state.graph.focus;
    if (!focus) return null;
    const node = graph.nodes.get(focus.id);
    if (!node || node.id === graph.rootId) return null;
    const bar = el("div", "graph-focus-bar");
    bar.append(
      el(
        "span",
        "graph-focus-label",
        "\u5DF2\u9078\uFF1A" + disp(node.key) + " \xB7 " + (focus.mode === 2 ? "\u9006\u93C8" : "\u9806\u93C8")
      )
    );
    const center = el("button", "graph-focus-center", "\u8A2D\u6210\u4E2D\u5FC3");
    center.type = "button";
    center.title = "\u4EE5\u300C" + disp(node.key) + "\u300D\u70BA\u5716\u8B5C\u4E2D\u5FC3\uFF0C\u4E0D\u96E2\u958B\u5716\u8B5C";
    center.addEventListener(
      "click",
      () => navigateGraph(node.domain, node.key, { recenter: true })
    );
    bar.append(center);
    return bar;
  }
  function renderGraphSvg(graph, rootDomain, width, height) {
    const focus = state.graph.focus;
    const litEdges = /* @__PURE__ */ new Set();
    const litNodes = /* @__PURE__ */ new Set();
    if (focus) {
      litNodes.add(focus.id);
      for (const edge of graph.edges) {
        if (focus.mode === 1 && edge.from === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.to);
        } else if (focus.mode === 2 && edge.to === focus.id) {
          litEdges.add(edge);
          litNodes.add(edge.from);
        }
      }
    }
    const svg = svgEl("svg", {
      class: "graph-svg",
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": "\u689D\u76EE\u93C8\u7D50\u5716\u8B5C"
    });
    svg.style.setProperty("--graph-font-size", state.graph.fontSize + "px");
    svg.style.setProperty(
      "--graph-edge-width",
      (GRAPH_EDGE_WIDTHS[state.graph.edgeWidth] || 2.4) + "px"
    );
    const defs = svgEl("defs");
    const arrow = svgEl("marker", {
      id: "graph-arrow",
      viewBox: "0 0 10 10",
      refX: "9.5",
      refY: "5",
      markerWidth: "5.5",
      markerHeight: "5.5",
      orient: "auto",
      markerUnits: "strokeWidth"
    });
    arrow.append(
      svgEl("path", {
        class: "graph-arrow-head",
        d: "M 0 0 L 10 5 L 0 10 z",
        fill: "context-stroke"
      })
    );
    defs.append(arrow);
    svg.append(defs);
    const bg = svgEl("rect", {
      class: "graph-bg",
      width,
      height
    });
    svg.append(bg);
    const edgeLayer = svgEl("g", { class: "graph-edge-layer" });
    const reverse = new Set(graph.edges.map((edge) => edge.to + "|" + edge.from));
    graph.edges.forEach((edge) => {
      const a = graph.nodes.get(edge.from);
      const b = graph.nodes.get(edge.to);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ux = dx / dist;
      const uy = dy / dist;
      const both = reverse.has(edge.from + "|" + edge.to);
      const off = both ? 2.2 : 0;
      const sign = edge.from < edge.to ? 1 : -1;
      const ox = -uy * off * sign;
      const oy = ux * off * sign;
      const startGap = graphEdgeGap(a, ux, uy, 2);
      const endGap = graphEdgeGap(b, ux, uy, 3);
      const x1 = a.x + ux * startGap + ox;
      const y1 = a.y + uy * startGap + oy;
      const x2 = b.x - ux * endGap + ox;
      const y2 = b.y - uy * endGap + oy;
      let cls = "graph-edge is-" + edge.kind + (edge.tree ? " is-tree" : " is-extra");
      if (focus) {
        if (litEdges.has(edge)) cls += " is-lit" + (focus.mode === 2 ? " is-inverse" : "");
        else cls += " is-dim";
      }
      const line = svgEl("line", {
        class: cls,
        x1,
        y1,
        x2,
        y2,
        "marker-end": "url(#graph-arrow)",
        "data-from": edge.from,
        "data-to": edge.to,
        "data-kind": edge.kind
      });
      line.style.setProperty("--hue", String(NT.hue(Math.max(a.depth, b.depth))));
      edgeLayer.append(line);
    });
    svg.append(edgeLayer);
    const nodeLayer = svgEl("g", { class: "graph-node-layer" });
    const ordered = [...graph.nodes.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    ordered.forEach((node) => {
      const cross = node.domain !== rootDomain;
      let cls = "graph-node";
      if (node.id === graph.rootId) cls += " is-root";
      if (cross) cls += " is-cross";
      if (focus) {
        if (node.id === focus.id) cls += " is-selected";
        else if (litNodes.has(node.id)) cls += " is-lit";
        else cls += " is-dim";
      }
      const group = svgEl("g", {
        class: cls,
        transform: "translate(" + node.x + " " + node.y + ")",
        tabindex: 0,
        role: "button",
        "data-id": node.id,
        "data-key": node.key,
        "data-depth": node.depth,
        "aria-label": disp(domainName(node.domain)) + " " + disp(node.key) + "\uFF1B\u9EDE\u64CA\u5207\u63DB\u9806\u93C8\uFF0F\u9006\u93C8\u9AD8\u4EAE\uFF1BCtrl \u9EDE\u64CA\u4EE5\u6B64\u70BA\u8D77\u9EDE"
      });
      group.style.setProperty("--hue", String(NT.hue(node.depth)));
      const counts = graphCounts(node.id);
      const title = svgEl("title");
      title.textContent = disp(domainName(node.domain)) + "\uFF1A" + disp(node.key) + "\uFF08\u9806 " + counts.forward + "\uFF0F\u9006 " + counts.back + "\uFF0F\u6DF1\u5EA6 " + node.depth + "\uFF09";
      group.append(title);
      const isRect = node.shape === "rect";
      if (cross) {
        if (isRect) {
          group.append(
            svgEl("rect", {
              class: "graph-node-halo graph-node-rect",
              x: -node.w / 2 - 3,
              y: -node.h / 2 - 3,
              width: node.w + 6,
              height: node.h + 6,
              rx: 8
            })
          );
        } else {
          group.append(svgEl("circle", { class: "graph-node-halo", r: node.r + 3 }));
        }
      }
      if (isRect) {
        group.append(
          svgEl("rect", {
            class: "graph-node-shape graph-node-rect",
            x: -node.w / 2,
            y: -node.h / 2,
            width: node.w,
            height: node.h,
            rx: node.depth === 0 ? 8 : 6
          })
        );
      } else {
        group.append(
          svgEl("circle", { class: "graph-node-shape graph-node-circle", r: node.r })
        );
      }
      const lines = graphLabel(node.key, node.domain);
      const text = svgEl("text", {
        class: "graph-node-label",
        "text-anchor": "middle",
        "dominant-baseline": "middle"
      });
      lines.forEach((line, i) => {
        const tspan = svgEl("tspan", {
          x: 0,
          y: (i - (lines.length - 1) / 2) * state.graph.fontSize * 1.1
        });
        tspan.textContent = line;
        text.append(tspan);
      });
      group.append(text);
      if (cross) {
        const badge = svgEl("g", { class: "graph-badge" });
        const badgeX = isRect ? node.w / 2 - 8 : node.r * 0.72;
        const badgeY = isRect ? -node.h / 2 - 8 : -node.r * 0.72;
        badge.append(svgEl("circle", { cx: badgeX, cy: badgeY, r: 8 }));
        const badgeText = svgEl("text", {
          x: badgeX,
          y: badgeY + 2.5,
          "text-anchor": "middle"
        });
        badgeText.textContent = graphShortDomain(node.domain);
        badge.append(badgeText);
        group.append(badge);
      }
      group.addEventListener("mouseenter", (e) => showGraphTip(node, e.clientX, e.clientY));
      group.addEventListener("mousemove", (e) => {
        if (!graphTip.hidden) moveGraphTip(e.clientX, e.clientY);
      });
      group.addEventListener("mouseleave", hideGraphTip);
      group.addEventListener("focus", () => {
        const rect = group.getBoundingClientRect();
        showGraphTip(node, rect.left + rect.width / 2, rect.top);
      });
      group.addEventListener("blur", hideGraphTip);
      group.addEventListener("click", (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== "mobile") {
          e.preventDefault();
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });
      group.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && state.uiMode !== "mobile") {
          navigateGraph(node.domain, node.key, { recenter: true });
        } else {
          cycleGraphFocus(node.id);
        }
      });
      nodeLayer.append(group);
    });
    svg.append(nodeLayer);
    bg.addEventListener("click", () => {
      if (!state.graph.focus) return;
      state.graph.focus = null;
      render();
    });
    return svg;
  }
  function graphContentWidth() {
    const style = getComputedStyle(reader);
    const pad = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
    return Math.max(320, Math.round(reader.clientWidth - pad));
  }
  function graphCanvasHeight(count, width) {
    const fontFactor = 1 + (state.graph.fontSize - 12) / 12 * 0.65;
    const edgeFactor = state.graph.edgeLength === "short" ? 0.9 : state.graph.edgeLength === "long" ? 1.15 : 1;
    const shapeFactor = state.graph.nodeShape === "rect" ? 0.8 : 1;
    const base = width * 0.44 + Math.max(0, count - 6) * 18;
    return Math.max(420, Math.min(2800, Math.round(base * fontFactor * edgeFactor * shapeFactor)));
  }
  function renderGraph() {
    hideGraphTip();
    const res = NT.resolve(state.index, state.root.key, state.root.domain);
    if (res.status !== "ok") {
      reader.append(emptyState(res));
      return;
    }
    const rootId = res.domain + ":" + res.key;
    const graph = buildGraph(rootId, state.graph);
    if (state.graph.focus && !graph.nodes.has(state.graph.focus.id)) state.graph.focus = null;
    const width = graphContentWidth();
    const height = graphCanvasHeight(graph.nodes.size, width);
    layoutGraph(graph, width, height);
    const article = el("article", "graph");
    const head = el("header", "entry-head");
    head.append(el("div", "entry-kicker", "\u5716\u8B5C \xB7 " + disp(domainName(res.domain))));
    const titleRow = el("div", "entry-title-row");
    titleRow.append(
      el("h1", "entry-title", disp(displayKey(res.domain, res.key)))
    );
    const back = el("button", "graph-back", "\u56DE\u5230\u689D\u76EE");
    back.type = "button";
    back.addEventListener("click", () => navigate(res.domain, res.key));
    titleRow.append(back);
    head.append(titleRow);
    head.append(
      el(
        "p",
        "index-hint",
        "\u4EE5\u300C" + disp(displayKey(res.domain, res.key)) + "\u300D\u70BA\u8D77\u9EDE\u3002\u6ED1\u904E\u7BC0\u9EDE\u770B\u91CB\u6587\uFF1B\u9EDE\u7BC0\u9EDE\u5207\u63DB\u9806\u93C8\uFF0F\u9006\u93C8\u9AD8\u4EAE\uFF1BCtrl/\u2318+\u9EDE\u64CA\u4EE5\u5B83\u70BA\u8D77\u9EDE\u91CD\u7E6A\u3002"
      )
    );
    article.append(head);
    const stage = el("div", "graph-stage");
    stage.append(renderGraphPanel(graph));
    const canvas = el("div", "graph-canvas");
    canvas.append(renderGraphSvg(graph, res.domain, width, height));
    stage.append(canvas);
    const focusBar = renderGraphFocusBar(graph);
    if (focusBar) stage.append(focusBar);
    article.append(stage);
    if (!graph.edges.length) {
      article.append(
        el(
          "p",
          "graph-note",
          state.graph.forward || state.graph.backward ? "\u76EE\u524D\u8A2D\u5B9A\u4E0B\u6C92\u6709\u53EF\u756B\u7684\u9023\u7DDA\u3002\u8A66\u8A66\u589E\u52A0\u5C64\u6578\u3002" : "\u9806\u93C8\u7D50\u8207\u9006\u93C8\u7D50\u90FD\u95DC\u9589\u4E86\uFF1B\u958B\u555F\u81F3\u5C11\u4E00\u7A2E\u624D\u6703\u756B\u7DDA\u3002"
        )
      );
    }
    if (graph.truncated) {
      article.append(
        el(
          "p",
          "graph-note",
          "\u7BC0\u9EDE\u8D85\u904E " + GRAPH_MAX_NODES + " \u500B\uFF0C\u53EA\u986F\u793A " + graph.nodes.size + " \u500B\uFF1B\u964D\u4F4E\u5C64\u6578\u6216\u95DC\u9589\u5176\u4E2D\u4E00\u7A2E\u93C8\u7D50\u53EF\u770B\u5F97\u66F4\u6E05\u695A\u3002"
        )
      );
    }
    reader.append(article);
    requestAnimationFrame(updateGraphPanelFloat);
  }
  const INDEX_VIEWS = [
    ["all", "\u5168\u90E8"],
    ["zero", "\u96F6\u9023\u7D50"],
    ["cross", "\u8DE8\u9818\u57DF"],
    ["both", "\u6709\u9806\u6709\u9006"]
  ];
  const INDEX_SORTS = [
    ["product", "\u4E58\u7A4D\uFF08\u9806\xD7\u9006\uFF09"],
    ["forward", "\u9806\u93C8\u6B21\u6578"],
    ["back", "\u9006\u93C8\u6B21\u6578"],
    ["cross", "\u8DE8\u9818\u57DF\u9023\u7DDA"],
    ["name", "\u540D\u7A31"]
  ];
  const INDEX_PAGE_SIZE = 120;
  let indexRowCache = null;
  let indexRowCacheFor = null;
  let indexRowCacheMode = -1;
  function indexCount(domain) {
    let n = 0;
    for (const [key, value] of domain.entries) {
      if (key === "_" || isReservedKey(key) || isRedirect(value)) continue;
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
      const id = entry.domain + ":" + entry.key;
      const forwardSet = state.index.links.forward.get(id);
      const backwardSet = state.index.links.backward.get(id);
      let forward = 0;
      let back = 0;
      let crossOut = 0;
      let crossIn = 0;
      const crossCounts = /* @__PURE__ */ new Map();
      const addCross = (domain) => {
        crossCounts.set(domain, (crossCounts.get(domain) || 0) + 1);
      };
      if (forwardSet) {
        forward = forwardSet.size;
        for (const target of forwardSet) {
          const domain = target.slice(0, target.indexOf(":"));
          if (domain !== entry.domain) {
            crossOut++;
            addCross(domain);
          }
        }
      }
      if (backwardSet) {
        back = backwardSet.size;
        for (const source of backwardSet) {
          const domain = source.slice(0, source.indexOf(":"));
          if (domain !== entry.domain) {
            crossIn++;
            addCross(domain);
          }
        }
      }
      const crossDomains = [...crossCounts.entries()].map(([domain, count]) => ({ domain, count })).sort(
        (a, b) => b.count - a.count || domainName(a.domain).localeCompare(domainName(b.domain), "zh-Hant")
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
        crossDomains
      });
    }
    indexRowCache = rows;
    indexRowCacheFor = state.index;
    indexRowCacheMode = mode;
    return rows;
  }
  function indexZeroKind(row) {
    if (!row.forward && !row.back) return "none";
    if (!row.forward) return "no-forward";
    return "no-back";
  }
  function indexZeroLabel(row) {
    return { none: "\u5168\u7121", "no-forward": "\u7121\u9806\u93C8", "no-back": "\u7121\u9006\u93C8" }[indexZeroKind(row)];
  }
  function indexBaseRows() {
    let rows = indexRows();
    if (state.indexDomain) rows = rows.filter((row) => row.domain === state.indexDomain);
    const query2 = state.indexQuery.trim().toLowerCase();
    if (query2) {
      const forms = SETTINGS ? SETTINGS.searchForms(query2) : [query2];
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
    const byName = (a, b) => a.key.localeCompare(b.key, "zh-Hant") || a.domainName.localeCompare(b.domainName, "zh-Hant") || a.domain.localeCompare(b.domain);
    const byTotal = (a, b) => b.forward + b.back - (a.forward + a.back);
    const zeroRank = { none: 0, "no-forward": 1, "no-back": 2 };
    const sorters = {
      product: (a, b) => {
        if (state.indexView === "zero") {
          const rank = zeroRank[indexZeroKind(a)] - zeroRank[indexZeroKind(b)];
          if (rank) return rank;
          return byName(a, b);
        }
        return b.product - a.product || b.cross - a.cross || byTotal(a, b) || byName(a, b);
      },
      forward: (a, b) => b.forward - a.forward || b.product - a.product || byName(a, b),
      back: (a, b) => b.back - a.back || b.product - a.product || byName(a, b),
      cross: (a, b) => b.cross - a.cross || b.product - a.product || byName(a, b),
      name: byName
    };
    return rows.sort(sorters[state.indexSort] || sorters.product);
  }
  function indexViewCounts(base) {
    return {
      all: base.length,
      zero: base.filter((row) => row.product === 0).length,
      cross: base.filter((row) => row.cross > 0).length,
      both: base.filter((row) => row.product > 0).length
    };
  }
  function indexViewRows(base) {
    if (state.indexView === "zero") return base.filter((row) => row.product === 0);
    if (state.indexView === "cross") return base.filter((row) => row.cross > 0);
    if (state.indexView === "both") return base.filter((row) => row.product > 0);
    return base.slice();
  }
  function renderIndexTabs(selected) {
    const nav = el("nav", "index-tabs");
    nav.setAttribute("aria-label", "\u7D22\u5F15\u79D1\u76EE");
    const add = (id, label, count) => {
      const active = id === selected;
      const btn = el("button", "index-tab" + (active ? " is-active" : ""));
      btn.type = "button";
      btn.dataset.domain = id;
      btn.setAttribute("aria-pressed", String(active));
      btn.append(el("span", "index-tab-name", label));
      btn.append(el("span", "index-tab-count", String(count)));
      btn.addEventListener("click", () => navigateIndex(id === "all" ? null : id));
      nav.append(btn);
    };
    add("all", "\u5168\u90E8\u79D1\u76EE", entries.length);
    domains.forEach((domain) => add(domain.id, disp(domain.name || domain.id), indexCount(domain)));
    return nav;
  }
  function renderIndex() {
    const allRows = indexRows();
    const article = el("article", "index");
    const head = el("header", "entry-head");
    head.append(el("div", "entry-kicker", "\u8CC7\u6599\u8868"));
    head.append(el("h1", "entry-title", "\u7D22\u5F15"));
    head.append(
      el(
        "p",
        "index-hint",
        "\u5171 " + allRows.length + " \u689D\u3001" + domains.length + " \u500B\u79D1\u76EE\u3002\u5148\u7528\u6587\u5B57\u641C\u5C0B\uFF0C\u518D\u4F9D\u79D1\u76EE\u3001\u9023\u7DDA\u72C0\u614B\u8207\u6392\u5E8F\u7E2E\u5C0F\u7BC4\u570D\u3002\u9806\uFF0F\u9006\u662F\u9806\u93C8\uFF0F\u9006\u93C8\u6B21\u6578\uFF0C\xD7\u662F\u5169\u8005\u4E58\u7A4D\uFF1B\u9EDE\u689D\u76EE\u95B1\u8B80\uFF0C\u6309\u300C\u5716\u300D\u4EE5\u8A72\u7BC0\u9EDE\u958B\u5716\u8B5C\u3002"
      )
    );
    const searchRow = el("div", "index-search-row");
    const searchLabel = el("label", "index-search-label");
    searchLabel.append(document.createTextNode("\u641C\u5C0B"));
    const search = document.createElement("input");
    search.id = "indexSearch";
    search.className = "index-search";
    search.type = "search";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.placeholder = "\u689D\u76EE\u540D\u7A31\u6216\u5167\u5BB9\u2026";
    search.setAttribute("aria-label", "\u641C\u5C0B\u7D22\u5F15\u689D\u76EE");
    search.value = state.indexQuery;
    searchLabel.append(search);
    searchRow.append(searchLabel);
    const clear = el("button", "index-search-clear", "\u6E05\u9664");
    clear.type = "button";
    clear.title = "\u6E05\u9664\u641C\u5C0B\u5B57";
    clear.hidden = !state.indexQuery;
    searchRow.append(clear);
    head.append(searchRow);
    head.append(renderIndexTabs(state.indexDomain || "all"));
    const controls = el("div", "index-controls");
    const views = el("nav", "index-views");
    views.setAttribute("aria-label", "\u7BC0\u9EDE\u9023\u7DDA\u6AA2\u8996");
    const viewButtons = {};
    INDEX_VIEWS.forEach(([key, label]) => {
      const active = key === state.indexView;
      const btn = el("button", "index-view" + (active ? " is-active" : ""));
      btn.type = "button";
      btn.dataset.view = key;
      btn.setAttribute("aria-pressed", String(active));
      btn.append(el("span", "index-view-name", label));
      const count = el("span", "index-view-count", "0");
      btn.append(count);
      btn.addEventListener("click", () => {
        if (state.indexView === key) return;
        state.indexView = key;
        state.indexLimit = INDEX_PAGE_SIZE;
        refresh();
      });
      viewButtons[key] = { button: btn, count };
      views.append(btn);
    });
    controls.append(views);
    const sortLabel = el("label", "index-sort");
    sortLabel.append(document.createTextNode("\u6392\u5E8F"));
    const sort = document.createElement("select");
    sort.id = "indexSort";
    sort.className = "index-sort-select";
    sort.setAttribute("aria-label", "\u7D22\u5F15\u6392\u5E8F");
    INDEX_SORTS.forEach(([key, label]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      option.selected = key === state.indexSort;
      sort.append(option);
    });
    sort.addEventListener("change", () => {
      state.indexSort = sort.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    sortLabel.append(sort);
    controls.append(sortLabel);
    head.append(controls);
    const summary = el("p", "index-summary");
    head.append(summary);
    article.append(head);
    const results = el("div", "index-results");
    article.append(results);
    function refresh() {
      const base = indexBaseRows();
      const counts = indexViewCounts(base);
      Object.entries(viewButtons).forEach(([key, item]) => {
        item.count.textContent = String(counts[key]);
        const active = state.indexView === key;
        item.button.classList.toggle("is-active", active);
        item.button.setAttribute("aria-pressed", String(active));
      });
      clear.hidden = !state.indexQuery;
      const rows = sortIndexRows(indexViewRows(base));
      const query2 = state.indexQuery.trim();
      const scope = state.indexDomain ? disp(domainName(state.indexDomain)) : "\u5168\u90E8\u79D1\u76EE";
      let text = scope + " \xB7 \u7B26\u5408 " + rows.length + " \u500B\u7BC0\u9EDE" + (query2 ? "\uFF08\u641C\u5C0B\u300C" + query2 + "\u300D\uFF09" : "") + " \xB7 \u4F9D" + indexSortName() + "\u6392\u5E8F";
      if (state.indexView === "zero") {
        let none = 0;
        let noForward = 0;
        let noBack = 0;
        rows.forEach((row) => {
          if (!row.forward && !row.back) none++;
          else if (!row.forward) noForward++;
          else noBack++;
        });
        text += " \xB7 \u5168\u7121 " + none + "\u3001\u7121\u9806\u93C8 " + noForward + "\u3001\u7121\u9006\u93C8 " + noBack;
      } else if (state.indexView === "cross") {
        const outCount = rows.filter((row) => row.crossOut > 0).length;
        const inCount = rows.filter((row) => row.crossIn > 0).length;
        text += " \xB7 \u5C0D\u5916 " + outCount + "\u3001\u5C0D\u5167 " + inCount;
      }
      summary.textContent = text;
      results.textContent = "";
      if (!rows.length) {
        const empty = el("div", "index-empty");
        empty.append(el("strong", null, "\u6C92\u6709\u7B26\u5408\u7684\u7BC0\u9EDE"));
        empty.append(el("p", null, "\u63DB\u500B\u641C\u5C0B\u5B57\uFF0C\u6216\u628A\u79D1\u76EE\uFF0F\u6AA2\u8996\u689D\u4EF6\u653E\u5BEC\u3002"));
        const reset = el("button", "ghost", "\u6E05\u9664\u641C\u5C0B\u8207\u7BE9\u9078");
        reset.type = "button";
        reset.addEventListener("click", () => {
          state.indexQuery = "";
          state.indexView = "all";
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
        "p",
        "index-result-count",
        "\u986F\u793A " + shown.length + " / " + rows.length + " \u500B" + (rows.length > shown.length ? " \xB7 \u9084\u6709 " + (rows.length - shown.length) + " \u500B" : "")
      );
      results.append(meta);
      const list = el("div", "index-list");
      shown.forEach((row) => list.append(indexItem(row)));
      results.append(list);
      if (rows.length > shown.length) {
        const more = el("button", "index-more", "\u986F\u793A\u66F4\u591A");
        more.type = "button";
        more.addEventListener("click", () => {
          state.indexLimit += INDEX_PAGE_SIZE;
          refresh();
        });
        results.append(more);
      }
    }
    search.addEventListener("input", () => {
      state.indexQuery = search.value;
      state.indexLimit = INDEX_PAGE_SIZE;
      refresh();
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      state.indexQuery = "";
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = "";
      refresh();
      search.blur();
    });
    clear.addEventListener("click", () => {
      state.indexQuery = "";
      state.indexLimit = INDEX_PAGE_SIZE;
      search.value = "";
      refresh();
      search.focus();
    });
    reader.append(article);
    refresh();
  }
  function indexItem(row) {
    const item = el("div", "index-item");
    item.dataset.domain = row.domain;
    item.dataset.key = row.key;
    const main = el("button", "index-main");
    main.type = "button";
    main.title = "\u95B1\u8B80\u300C" + disp(row.key) + "\u300D";
    main.setAttribute("aria-label", "\u95B1\u8B80\u300C" + disp(row.key) + "\u300D");
    const top = el("span", "index-top");
    top.append(el("span", "index-key", disp(row.key)));
    if (!state.indexDomain) {
      top.append(el("span", "index-domain-tag", disp(row.domainName)));
    }
    if (!row.product) {
      top.append(el("span", "index-zero-tag", indexZeroLabel(row)));
    }
    main.append(top);
    const meta = el("span", "index-meta");
    const addStat = (text, title, extra) => {
      const stat = el("span", "index-stat" + (extra ? " " + extra : ""), text);
      stat.title = title;
      meta.append(stat);
    };
    addStat("\u9806 " + row.forward, "\u9806\u93C8\uFF1A\u672C\u689D\u76EE\u5F15\u7528 " + row.forward + " \u500B\u689D\u76EE");
    addStat("\u9006 " + row.back, "\u9006\u93C8\uFF1A\u672C\u689D\u76EE\u88AB " + row.back + " \u500B\u689D\u76EE\u5F15\u7528");
    addStat("\xD7" + row.product, "\u9806\u93C8\u6B21\u6578 \xD7 \u9006\u93C8\u6B21\u6578", "is-product");
    if (row.cross) {
      row.crossDomains.forEach(({ domain, count }) => {
        const name = disp(domainName(domain));
        addStat(name + " " + count, "\u8207\u300C" + name + "\u300D\u7684\u9023\u7DDA " + count + " \u689D", "is-cross");
      });
    }
    main.append(meta);
    main.append(el("span", "index-preview", row.preview));
    main.addEventListener("click", () => navigate(row.domain, row.key));
    item.append(main);
    const graph = el("button", "index-graph");
    graph.type = "button";
    graph.title = "\u4EE5\u300C" + disp(row.key) + "\u300D\u70BA\u4E2D\u5FC3\u958B\u5716\u8B5C";
    graph.setAttribute("aria-label", "\u4EE5\u300C" + disp(row.key) + "\u300D\u70BA\u4E2D\u5FC3\u958B\u5716\u8B5C");
    graph.append(indexGraphGlyph());
    graph.addEventListener("click", () => navigateGraph(row.domain, row.key));
    item.append(graph);
    return item;
  }
  function indexGraphGlyph() {
    const svg = svgEl("svg", {
      class: "index-graph-icon",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      focusable: "false"
    });
    svg.append(svgEl("path", { d: "M7.8 7.8 11 13.2M16.2 7.8 13 13.2" }));
    svg.append(svgEl("circle", { cx: 7, cy: 6, r: 2.1 }));
    svg.append(svgEl("circle", { cx: 17, cy: 6, r: 2.1 }));
    svg.append(svgEl("circle", { cx: 12, cy: 16.5, r: 3.2 }));
    return svg;
  }
  function emptyState(res) {
    const box = el("div", "empty");
    box.append(el("h2", null, "\u627E\u4E0D\u5230\u9019\u500B\u689D\u76EE"));
    box.append(el("p", null, disp(res.name || "")));
    const back = el("button", "ghost", "\u56DE\u5230\u7D22\u5F15");
    back.type = "button";
    back.addEventListener("click", () => navigateIndex());
    box.append(back);
    return box;
  }
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
    return String(text == null ? "" : text).replace(/[&<>"]/g, (ch) => {
      if (ch === "&") return "&amp;";
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      return "&quot;";
    });
  }
  function buildExportPayload() {
    const start = editorResolve(state.root.key, state.root.domain, null);
    if (start.status !== "ok" || start.key === "_") return null;
    const entries2 = /* @__PURE__ */ new Map();
    const domains2 = /* @__PURE__ */ new Map();
    const aliases = /* @__PURE__ */ new Map();
    const queue = [{ domain: start.domain, key: start.key }];
    const seen = /* @__PURE__ */ new Set();
    while (queue.length) {
      const item = queue.shift();
      const res = editorResolve(item.key, item.domain, item.domain);
      if (res.status !== "ok" || res.key === "_") continue;
      const id = res.domain + ":" + res.key;
      if (seen.has(id)) continue;
      seen.add(id);
      if (isRedirect(res.value)) continue;
      entries2.set(id, res.value);
      domains2.set(res.domain, domainName(res.domain));
      for (const tok of NT.parse(res.value)) {
        if (tok.type !== "ref") continue;
        const next = editorResolve(tok.ref, tok.domain, res.domain);
        if (next.status !== "ok" || next.key === "_" || isRedirect(next.value)) continue;
        const targetId = next.domain + ":" + next.key;
        aliases.set(res.domain + ":" + tok.ref, targetId);
        aliases.set(tok.ref, targetId);
        queue.push({ domain: next.domain, key: next.key });
      }
    }
    return {
      start: start.domain + ":" + start.key,
      domains: Object.fromEntries(domains2),
      entries: Object.fromEntries(entries2),
      aliases: Object.fromEntries(aliases)
    };
  }
  function exportRuntime() {
    "use strict";
    var data = window.OFFTEXT_EXPORT;
    var entries2 = data.entries;
    var domains2 = data.domains;
    var aliases = data.aliases || {};
    var expanded = /* @__PURE__ */ new Set();
    var app = document.getElementById("app");
    var layer = document.getElementById("hover-layer");
    var current = data.start;
    var cards = [];
    var hoverTimer = 0;
    var pointerFine = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)").matches : true;
    function el2(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }
    function parse(text) {
      var s = String(text == null ? "" : text);
      var out = [];
      var i = 0;
      var start = 0;
      while (i < s.length) {
        if (s[i] === "^" && s[i + 1] === "[") {
          var end = s.indexOf("]", i + 2);
          if (end < 0) {
            i += 2;
            continue;
          }
          if (i > start) out.push({ type: "text", text: s.slice(start, i) });
          var inner = s.slice(i + 2, end);
          var display = null;
          var target = inner;
          var bar = target.indexOf("|");
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
            type: "ref",
            inner,
            display,
            ref: target.trim(),
            domain
          });
          i = end + 1;
          start = i;
        } else {
          i++;
        }
      }
      if (start < s.length) out.push({ type: "text", text: s.slice(start) });
      return out;
    }
    function splitId(id) {
      var cut = id.indexOf(":");
      return { domain: id.slice(0, cut), key: id.slice(cut + 1) };
    }
    function inDomain(name, domain) {
      var id = domain + ":" + name;
      return entries2[id] == null ? null : { id, domain, key: name, value: entries2[id] };
    }
    function resolve(name, domain, context) {
      if (!name || name === "_" || name.charAt(0) === "@") return null;
      var alias = aliases[(context || "") + ":" + name] || aliases[name];
      if (alias && entries2[alias] != null) {
        var parts = splitId(alias);
        return { id: alias, domain: parts.domain, key: parts.key, value: entries2[alias] };
      }
      if (domain) return inDomain(name, domain);
      if (context) {
        var hit = inDomain(name, context);
        if (hit) return hit;
      }
      for (var d in domains2) {
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
      card.style.left = Math.max(12, left) + "px";
      card.style.top = Math.max(12, top) + "px";
    }
    function hoverText(value, domain, depth, parent) {
      var box = el2("div");
      parse(value).forEach(function(tok) {
        if (tok.type === "text") {
          box.append(document.createTextNode(tok.text));
          return;
        }
        var res = resolve(tok.ref, tok.domain, domain);
        var label = el2("span", "nt-ref", tok.display || tok.ref);
        label.style.setProperty("--hue", String((20 + depth * 30) % 360));
        if (!res) {
          label.classList.add("is-missing");
          box.append(label);
          return;
        }
        label.title = "^[" + tok.inner + "]";
        label.addEventListener("mouseenter", function() {
          showCard(res, label, parent);
        });
        label.addEventListener("mouseleave", function() {
          if (parent) parent.__closeTimer = setTimeout(function() {
            closeCards(parent);
          }, 200);
        });
        label.addEventListener("click", function(event) {
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
      if (anchor && anchor.getAttribute && anchor.getAttribute("aria-expanded") === "true") return;
      if (parent) {
        clearTimeout(parent.__closeTimer);
        var existing = cards.indexOf(parent);
        if (existing >= 0) closeCards(cards[existing + 1]);
      }
      var card = el2("div", "export-hover");
      card.__anchor = anchor;
      var head = el2("div");
      head.append(el2("strong", "export-hover-title", res.key));
      head.append(el2("span", "export-hover-domain", domains2[res.domain] || res.domain));
      card.append(head);
      card.append(hoverText(res.value, res.domain, 1, card));
      layer.hidden = false;
      layer.append(card);
      cards.push(card);
      card.style.visibility = "hidden";
      place(card, anchor);
      card.style.visibility = "";
      card.addEventListener("mouseenter", function() {
        clearTimeout(card.__closeTimer);
      });
      card.addEventListener("mouseleave", function() {
        card.__closeTimer = setTimeout(function() {
          closeCards(card);
        }, 220);
      });
    }
    function renderText(container, text, domain, depth, ancestors, prefix, inline) {
      String(text).split(/\n+/).filter(function(p) {
        return p.trim() !== "";
      }).forEach(function(paragraph) {
        var block = el2(inline ? "span" : "div", "nt-block" + (inline ? " is-inline" : ""));
        var line = el2("span", "nt-line");
        var refIndex = 0;
        parse(paragraph).forEach(function(tok) {
          if (tok.type === "text") {
            line.append(el2("span", "nt-text", tok.text));
            return;
          }
          var path = prefix ? prefix + "." + refIndex : String(refIndex);
          refIndex++;
          line.append(renderRef2(tok, path, domain, depth, ancestors));
        });
        block.append(line);
        container.append(block);
      });
    }
    function renderRef2(tok, path, domain, depth, ancestors) {
      var wrap = el2("span", "nt-refwrap");
      wrap.style.setProperty("--hue", String((20 + depth * 30) % 360));
      var res = resolve(tok.ref, tok.domain, domain);
      var btn = el2("button", "nt-ref", tok.display || tok.ref);
      btn.type = "button";
      btn.style.setProperty("--hue", String((20 + depth * 30) % 360));
      if (!res) {
        btn.classList.add("is-missing");
        btn.title = "\u627E\u4E0D\u5230\u76EE\u6A19";
        wrap.append(btn);
        return wrap;
      }
      btn.title = "^[" + tok.inner + "]\uFF1A\u9EDE\u64CA\u5C55\u958B" + (pointerFine ? "\uFF1BCtrl/\u2318+\u9EDE\u64CA\u958B\u555F" : "");
      btn.setAttribute("aria-expanded", String(expanded.has(path)));
      btn.addEventListener("click", function(event) {
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
      btn.addEventListener("mouseenter", function() {
        showCard(res, btn, null);
      });
      btn.addEventListener("mouseleave", function() {
        if (!cards.length) return;
        var card = cards[cards.length - 1];
        card.__closeTimer = setTimeout(function() {
          closeCards(card);
        }, 260);
      });
      wrap.append(btn);
      if (expanded.has(path) && !ancestors.has(res.id) && depth < 6) {
        var nextAncestors = new Set(ancestors);
        nextAncestors.add(res.id);
        var exp = el2("span", "nt-exp-inline");
        exp.style.setProperty("--hue", String((20 + (depth + 1) * 30) % 360));
        renderText(exp, res.value, res.domain, depth + 1, nextAncestors, path, true);
        wrap.append(exp);
      } else if (expanded.has(path) && ancestors.has(res.id)) {
        wrap.append(el2("span", "nt-note", "\u21BA \u5FAA\u74B0"));
      } else if (expanded.has(path) && depth >= 6) {
        wrap.append(el2("span", "nt-note", "\u2026\u5DF2\u9054\u6DF1\u5EA6\u4E0A\u9650"));
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
      app.textContent = "";
      var kicker = el2("div", "entry-kicker", domains2[parts.domain] || parts.domain);
      var title = el2("h1", "entry-title", parts.key);
      app.append(kicker, title);
      var doc = el2("div");
      renderText(doc, entries2[current] || "", parts.domain, 0, /* @__PURE__ */ new Set([current]), "", false);
      app.append(doc);
      document.title = parts.key + " \xB7 \u5DE2\u5F0F\u6587\u5B57";
    }
    if (layer) layer.addEventListener("mouseenter", function() {
      cards.forEach(function(card) {
        clearTimeout(card.__closeTimer);
      });
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape") closeCards();
    });
    renderRoot();
  }
  function buildExportHtml() {
    const payload = buildExportPayload();
    if (!payload) return "";
    const theme = document.documentElement.getAttribute("data-theme") || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const start = payload.start;
    const cut = start.indexOf(":");
    const title = start.slice(cut + 1) + " \xB7 " + (payload.domains[start.slice(0, cut)] || "");
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    return '<!doctype html>\n<html lang="zh-Hant" data-theme="' + htmlEscape(theme) + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + htmlEscape(title) + "</title>\n<style>" + EXPORT_CSS + '</style>\n</head>\n<body>\n<main id="app"></main><div id="hover-layer" class="export-hover-layer" hidden></div>\n<script>window.OFFTEXT_EXPORT=' + json + ";<\/script>\n<script>(" + exportRuntime.toString() + ")();<\/script>\n</body>\n</html>\n";
  }
  function exportCurrentPage() {
    if (READONLY_ONLY) return;
    const html = buildExportHtml();
    if (!html) {
      showToast("\u76EE\u524D\u689D\u76EE\u6C92\u6709\u53EF\u532F\u51FA\u7684\u5167\u5BB9");
      return;
    }
    const name = (state.root.domain + "-" + state.root.key).replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80) + ".html";
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
    showToast("\u5DF2\u532F\u51FA " + name);
  }
  const legend = $("#legendRow");
  for (let depth = 0; depth <= NT.MAX_DEPTH; depth++) {
    const chip = el("span", "chip");
    chip.style.setProperty("--h", String(NT.hue(depth)));
    legend.append(chip);
  }
  function handleSettingsChange(kind) {
    if (kind === "font") {
      if (entryController) entryController.refresh();
      return;
    }
    if (kind !== "sim") return;
    hideAddTerm();
    if (SETTINGS && SETTINGS.simModeOf() !== 0 && state.editing) {
      state.editing = false;
      document.body.classList.remove("is-editing-entry");
      closeOrphanPanel();
    }
    rebuildSearchEntries();
    updateStats();
    updateSaveUi();
    if (!document.body.classList.contains("is-booting")) render();
  }
  if (SETTINGS) SETTINGS.init({ onChange: handleSettingsChange });
  function paintUiMode() {
    const buttons = [...document.querySelectorAll("#uiSeg button")];
    buttons.forEach((button) => {
      const active = button.dataset.ui === state.uiMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = FORCED_MOBILE && button.dataset.ui === "desktop";
    });
    const hint = $("#uiHint");
    if (hint) {
      hint.textContent = FORCED_MOBILE ? "\u6B64\u88DD\u7F6E\u662F\u624B\u6A5F\uFF0F\u5E73\u677F\uFF0C\u56FA\u5B9A\u4F7F\u7528\u7C21\u5316\u4ECB\u9762\uFF0C\u4E0D\u80FD\u5207\u56DE\u684C\u9762\u6A21\u5F0F\u3002" : "\u624B\u6A5F\u6A21\u5F0F\u4E0D\u8F09\u5165 CodeMirror\u3001\u4E0D\u986F\u793A\u7DE8\u8F2F\u529F\u80FD\uFF0C\u555F\u52D5\u6642\u76F4\u63A5\u8F09\u5165\u5168\u90E8\u79D1\u76EE\u3002";
    }
  }
  function setUiMode(mode) {
    if (FORCED_MOBILE || mode !== "desktop" && mode !== "mobile") return;
    if (mode === state.uiMode) return;
    try {
      localStorage.setItem(UI_KEY, mode);
    } catch (e) {
    }
    try {
      const url = new URL(location.href);
      url.searchParams.delete("ui");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {
    }
    location.reload();
  }
  document.querySelectorAll("#uiSeg button").forEach((button) => {
    button.addEventListener("click", () => setUiMode(button.dataset.ui));
  });
  paintUiMode();
  fillSubjectSelect();
  initReadHistory();
  subjectSelect.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;
    if (id === "all") {
      navigateIndex();
      return;
    }
    if (state.view === "index") {
      navigateIndex(id);
      return;
    }
    const domain = state.index.byId.get(id);
    const firstKey = domain && domain.entries.size ? [...domain.entries.keys()][0] : "_";
    navigate(id, domain && domain.entries.has("_") ? "_" : firstKey);
  });
  const initialMode = query.get("mode");
  if (initialMode === "inline" || initialMode === "block") state.mode = initialMode;
  const initialDepth = Number(query.get("depth"));
  if (initialDepth >= 1 && initialDepth <= 3) state.graph.depth = initialDepth;
  if (query.get("forward") === "0") state.graph.forward = false;
  if (query.get("back") === "0") state.graph.backward = false;
  const initialFont = Number(query.get("font"));
  if (initialFont >= 12 && initialFont <= 24) state.graph.fontSize = initialFont;
  const initialEdge = query.get("edge");
  if (initialEdge === "short" || initialEdge === "medium" || initialEdge === "long") {
    state.graph.edgeLength = initialEdge;
  }
  const initialEdgeWidth = query.get("edgeWidth");
  if (["thin", "medium", "thick"].includes(initialEdgeWidth)) {
    state.graph.edgeWidth = initialEdgeWidth;
  }
  const initialShape = query.get("shape");
  if (initialShape === "rect" || initialShape === "circle") {
    state.graph.nodeShape = initialShape;
  }
  const expand = query.get("expand");
  if (expand) {
    expand.split(",").map((s) => s.trim()).filter(Boolean).forEach((p) => state.expanded.add(p));
  }
  const initialFocus = query.get("focus");
  if (initialFocus) state.focusPath = initialFocus.trim();
  $("#indexBtn").addEventListener("click", () => navigateIndex());
  dirtyBtn.addEventListener("click", () => {
    if (drafts.size) {
      saveDrafts();
      return;
    }
    showDirtyDialog({ leave: false });
  });
  leaveBtn.addEventListener("click", leaveSystem);
  window.addEventListener("beforeunload", (event) => {
    if (!dirtyDomains.size && !drafts.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
  viewToggle.addEventListener(
    "click",
    () => switchView(state.view === "graph" ? "text" : "graph")
  );
  editBtn.addEventListener("click", () => setEditing(!state.editing));
  saveBtn.addEventListener("click", () => {
    saveDrafts();
  });
  orphanBtn.addEventListener("click", toggleOrphanPanel);
  exportBtn.addEventListener("click", exportCurrentPage);
  document.addEventListener("keydown", (e) => {
    if (SETTINGS && SETTINGS.isOpen()) return;
    const active = document.activeElement;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable || !!active.closest(".cm-editor");
    if (e.key === "Escape" && orphanPanel) {
      e.preventDefault();
      closeOrphanPanel();
      return;
    }
    if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (state.view === "entry") switchView("graph");
      else if (state.view === "graph") switchView("text");
    }
  });
  window.addEventListener("hashchange", applyRoute);
  let graphResizeTimer = 0;
  window.addEventListener("resize", () => {
    if (state.view !== "graph") return;
    clearTimeout(graphResizeTimer);
    graphResizeTimer = setTimeout(() => render(), 160);
  });
  renderBootCatalog();
  if (query.get("test") === "1") {
    window.__offtextTest = {
      openNewEntry,
      openEntryForEdit,
      setEditing,
      saveDrafts,
      state,
      drafts: () => [...drafts.values()],
      validateDrafts,
      buildExportHtml
    };
  }
  const dataParam = query.get("data");
  if (dataParam && /^https?:$/.test(location.protocol)) {
    const ids = dataParam.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length) bootFromUrl(ids);
    else {
      bootStatus.textContent = "?data= \u6C92\u6709\u6307\u5B9A\u79D1\u76EE\u3002";
    }
  } else if (dataParam) {
    bootStatus.textContent = "file:// \u4E0D\u652F\u63F4 fetch\uFF1B\u8ACB\u7528\u300C\u9078\u64C7\u672C\u6A5F TSV\u2026\u300D\u958B\u555F\u3002";
  } else if (DATA) {
    if (state.uiMode === "mobile") bootWithDomains(DATA);
    else ensureCM().then(() => bootWithDomains(DATA));
  } else if (location.protocol === "file:") {
    document.body.classList.add("is-booting");
    boot.hidden = false;
    bootStatus.textContent = "";
  } else {
    bootFromDataIndex();
  }
  const TOUR_STEP_MS = 5e3;
  const TOUR_TARGET_TIMEOUT = 8e3;
  const TOUR_DEFS = [
    {
      id: "quick",
      title: "\u5FEB\u901F\u5165\u9580",
      desc: "\u7D04 1 \u5206\u9418 \xB7 \u4ECB\u9762\u3001\u7D22\u5F15\u3001\u5C55\u958B\u5F15\u7528",
      icon: "\u{1F9AE}",
      ready: true
    },
    {
      id: "advanced",
      title: "\u9032\u968E\u8A2D\u7F6E",
      desc: "\u9810\u7559\uFF0C\u665A\u9EDE\u518D\u505A",
      icon: "\u2699",
      ready: false
    },
    {
      id: "edit",
      title: "\u7DE8\u8F2F\u6587\u672C",
      desc: "\u9810\u7559\uFF0C\u665A\u9EDE\u518D\u505A",
      icon: "\u270E",
      ready: false
    }
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
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
  }
  function tourResolve(target) {
    if (!target) return null;
    if (typeof target === "function") return target();
    return document.querySelector(target);
  }
  function tourClick(selector) {
    const node = document.querySelector(selector);
    if (!node) throw new Error("tour target missing: " + selector);
    node.click();
  }
  function tourFindIndexRow(key) {
    return [...document.querySelectorAll(".index-item")].find(
      (row) => row.dataset.key === key
    ) || null;
  }
  function tourFindRef(labels) {
    const wanted = Array.isArray(labels) ? labels : [labels];
    const nodes = [...document.querySelectorAll(".cm-ref, .nt-ref")];
    return nodes.find((node) => {
      if (!tourVisible(node)) return false;
      const text = (node.textContent || "").trim();
      const ref = node.dataset.ref || "";
      return wanted.includes(text) || wanted.includes(ref);
    }) || null;
  }
  function setTourNote(text) {
    if (!tourNoteEl) return;
    tourNoteEl.textContent = text;
    tourNoteEl.hidden = !text;
  }
  function buildTourMenu() {
    tourMenu = el("div", "tour-menu");
    tourMenu.id = "tourMenu";
    tourMenu.hidden = true;
    tourMenu.setAttribute("role", "dialog");
    tourMenu.setAttribute("aria-label", "\u64CD\u4F5C\u5C0E\u89BD");
    const head = el("div", "tour-menu-head");
    head.append(el("strong", "tour-menu-title", "\u5C0E\u89BD"));
    const close = el("button", "tour-menu-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u95DC\u9589\u5C0E\u89BD\u9078\u55AE");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      setTourMenuOpen(false);
    });
    head.append(close);
    tourMenu.append(head);
    tourMenu.append(
      el("p", "tour-menu-intro", "\u8DDF\u8457\u756B\u9762\u8D70\u4E00\u904D\uFF1B\u6BCF\u4E00\u6B65 5 \u79D2\uFF0C\u4E5F\u53EF\u4EE5\u9EDE\u756B\u9762\u63D0\u524D\u3002")
    );
    TOUR_DEFS.forEach((def) => {
      const card = el("button", "tour-card" + (def.ready ? " is-ready" : " is-disabled"));
      card.type = "button";
      card.dataset.tour = def.id;
      card.disabled = !def.ready;
      if (!def.ready) card.title = "\u9810\u7559\uFF0C\u665A\u9EDE\u518D\u505A";
      const icon = el("span", "tour-card-icon", def.icon);
      const body = el("span", "tour-card-body");
      body.append(el("strong", null, def.title));
      body.append(el("span", "tour-card-desc", def.desc));
      card.append(icon, body);
      if (def.ready) {
        card.addEventListener("click", (event) => {
          event.stopPropagation();
          startTour(def.id);
        });
      } else {
        card.append(el("span", "tour-card-badge", "\u9810\u7559"));
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
    tourMenu.style.left = Math.round(left) + "px";
    tourMenu.style.top = Math.round(top) + "px";
  }
  function setTourMenuOpen(open) {
    if (!tourMenu || !tourBtn) return;
    tourMenuOpen = open;
    tourMenu.hidden = !open;
    tourBtn.setAttribute("aria-expanded", String(open));
    if (open) positionTourMenu();
  }
  function buildTourLayer() {
    tourLayer = el("div", "tour-layer");
    tourLayer.id = "tourLayer";
    tourLayer.hidden = true;
    tourSpot = el("div", "tour-spot");
    tourSpot.id = "tourSpot";
    tourSpot.hidden = true;
    tourBubble = el("section", "tour-bubble");
    tourBubble.id = "tourBubble";
    tourBubble.hidden = true;
    tourBubble.tabIndex = -1;
    tourBubble.setAttribute("role", "dialog");
    tourBubble.setAttribute("aria-modal", "true");
    tourBubble.setAttribute("aria-label", "\u64CD\u4F5C\u5C0E\u89BD");
    const head = el("div", "tour-head");
    tourStepEl = el("span", "tour-step", "");
    tourStepEl.id = "tourStep";
    const close = el("button", "tour-close", "\xD7");
    close.type = "button";
    close.setAttribute("aria-label", "\u7D50\u675F\u5C0E\u89BD");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      stopTour(false);
    });
    head.append(tourStepEl, close);
    tourBubble.append(head);
    tourTitleEl = el("h2", "tour-title", "");
    tourTitleEl.id = "tourTitle";
    tourBubble.setAttribute("aria-labelledby", "tourTitle");
    tourBubble.append(tourTitleEl);
    tourTextEl = el("p", "tour-text", "");
    tourTextEl.id = "tourText";
    tourTextEl.setAttribute("aria-live", "polite");
    tourBubble.append(tourTextEl);
    tourNoteEl = el("p", "tour-note", "");
    tourNoteEl.id = "tourNote";
    tourNoteEl.hidden = true;
    tourBubble.append(tourNoteEl);
    const foot = el("div", "tour-foot");
    tourHintEl = el("span", "tour-hint", "");
    tourHintEl.id = "tourHint";
    tourNextEl = el("button", "tour-next", "\u4E0B\u4E00\u6B65");
    tourNextEl.type = "button";
    tourNextEl.id = "tourNext";
    tourNextEl.addEventListener("click", (event) => {
      event.stopPropagation();
      advanceTour();
    });
    foot.append(tourHintEl, tourNextEl);
    tourBubble.append(foot);
    const bar = el("div", "tour-bar");
    tourBarEl = el("span", "tour-bar-fill", "");
    tourBarEl.id = "tourBar";
    bar.append(tourBarEl);
    tourBubble.append(bar);
    tourLayer.append(tourSpot, tourBubble);
    document.body.append(tourLayer);
    tourLayer.addEventListener("click", (event) => {
      if (!tourRunning) return;
      if (event.target.closest(".tour-close, .tour-next")) return;
      event.preventDefault();
      advanceTour();
    });
  }
  function layoutTour() {
    if (!tourRunning || !tourLayer || tourLayer.hidden) return;
    const target = tourTarget && tourVisible(tourTarget) ? tourTarget : null;
    if (!target) {
      tourTarget = null;
      tourLayer.classList.add("is-full");
      tourSpot.hidden = true;
      tourBubble.classList.remove("is-top");
      return;
    }
    tourLayer.classList.remove("is-full");
    const rect = target.getBoundingClientRect();
    const pad = 6;
    tourSpot.hidden = false;
    tourSpot.style.left = Math.round(rect.left - pad) + "px";
    tourSpot.style.top = Math.round(rect.top - pad) + "px";
    tourSpot.style.width = Math.round(rect.width + pad * 2) + "px";
    tourSpot.style.height = Math.round(rect.height + pad * 2) + "px";
    const lower = rect.top + rect.height / 2 > window.innerHeight / 2;
    tourBubble.classList.toggle("is-top", lower);
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
    const ms = (step && step.seconds ? step.seconds : 5) * 1e3;
    if (tourHintEl) {
      tourHintEl.textContent = "\u9EDE\u756B\u9762\u7E7C\u7E8C \xB7 " + Math.round(ms / 1e3) + " \u79D2\u5F8C\u81EA\u52D5";
    }
    if (tourBarEl) {
      tourBarEl.style.animation = "none";
      tourBarEl.style.width = "100%";
      void tourBarEl.offsetWidth;
      tourBarEl.style.animation = "tourCountdown " + ms + "ms linear forwards";
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
    tourLayer.classList.toggle("is-full", !step.target);
    tourBubble.classList.remove("is-top");
    tourSpot.hidden = true;
    if (tourStepEl) tourStepEl.textContent = index + 1 + " / " + tourSteps.length;
    if (tourTitleEl) tourTitleEl.textContent = step.title || "";
    if (tourTextEl) tourTextEl.innerHTML = step.text || "";
    if (tourNextEl) {
      tourNextEl.textContent = index === tourSteps.length - 1 ? "\u5B8C\u6210" : index === 0 ? "\u958B\u59CB" : "\u4E0B\u4E00\u6B65";
    }
    if (tourHintEl) tourHintEl.textContent = "\u6E96\u5099\u756B\u9762\u2026";
    if (tourBarEl) {
      tourBarEl.style.animation = "none";
      tourBarEl.style.width = "0%";
    }
    setTourNote("");
    if (step.target) {
      const found = await waitForTourTarget(step.target, token);
      if (token !== tourToken || !tourRunning) return;
      if (found) {
        try {
          found.scrollIntoView({ block: "center", inline: "nearest" });
        } catch (e) {
        }
        await tourSleep(140);
        if (token !== tourToken || !tourRunning) return;
        tourTarget = tourVisible(found) ? found : null;
      }
      if (!tourTarget) {
        setTourNote("\u26A0 \u627E\u4E0D\u5230\u9019\u500B\u756B\u9762\u5143\u7D20\uFF1B\u53EF\u4EE5\u76F4\u63A5\u6309\u4E0B\u4E00\u6B65\u3002");
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
    if (step && typeof step.action === "function") {
      try {
        step.action();
      } catch (e) {
        console.warn("[tour] action failed", e);
        setTourNote("\u26A0 \u9019\u4E00\u6B65\u6C92\u6709\u5B8C\u6210\uFF0C\u5148\u7E7C\u7E8C\u3002");
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
    document.body.classList.remove("tour-running");
    if (completed) showToast("\u5C0E\u89BD\u5B8C\u6210\uFF1B\u53EF\u5F9E\u53F3\u4E0A\u89D2 \u{1F9AE} \u91CD\u770B");
  }
  function startTour(id) {
    if (id !== "quick") return;
    const aiDomain = domains.find((domain) => domain.id === "aijargon");
    if (!aiDomain || !aiDomain.entries.has("\u5927\u578B\u8A9E\u8A00\u6A21\u578B")) {
      showToast("\u5FEB\u901F\u5165\u9580\u9700\u8981\u300CAI \u8853\u8A9E\u300D\u79D1\u76EE\uFF1B\u8ACB\u5148\u8F09\u5165\u5B83\u3002");
      return;
    }
    setTourMenuOpen(false);
    if (tourRunning) stopTour(false);
    if (SETTINGS && SETTINGS.isOpen && SETTINGS.isOpen()) SETTINGS.close();
    if (state.editing && typeof setEditing === "function") setEditing(false);
    if (state.view === "index") {
      const route = defaultRoute();
      if (route) navigate(route.domain, route.key);
    }
    tourSteps = quickTourSteps();
    tourIndex = -1;
    tourRunning = true;
    document.body.classList.add("tour-running");
    tourLayer.hidden = false;
    showStep(0);
    requestAnimationFrame(() => {
      if (tourRunning) tourBubble.focus({ preventScroll: true });
    });
  }
  function openIndexForTour() {
    state.indexQuery = "";
    state.indexView = "all";
    state.indexSort = "product";
    state.indexLimit = 120;
    navigateIndex();
  }
  function setIndexSortForTour(value) {
    const select = document.querySelector("#indexSort");
    if (!select) throw new Error("index sort missing");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function quickTourSteps() {
    return [
      {
        title: "\u4E00\u5206\u9418\u770B\u4E00\u904D",
        text: "\u63A5\u4E0B\u4F86\u7D04\u4E00\u5206\u9418\uFF0C\u5E36\u4F60\u8D70\u4E00\u904D\uFF1A\u4ECB\u9762\u3001\u7D22\u5F15\u3001\u5C55\u958B\u5F15\u7528\u3002<br>\u9EDE\u756B\u9762\u4EFB\u4F55\u5730\u65B9\u7E7C\u7E8C\uFF1B\u6309 Esc \u6216\u53F3\u4E0A\u89D2 \xD7 \u53EF\u4EE5\u96A8\u6642\u7D50\u675F\u3002",
        target: null
      },
      {
        title: "\u5207\u63DB\u79D1\u76EE",
        text: "\u5DE6\u4E0A\u89D2\u300C\u79D1\u76EE\u300D\u5207\u63DB\u79D1\u76EE\u3002\u6BCF\u4E00\u79D1\u662F\u4E00\u5F35\u7368\u7ACB\u7684\u77E5\u8B58\u7DB2\uFF0C\u5F9E\u79D1\u76EE\u9996\u9801\u958B\u59CB\u8B80\u3002",
        target: () => document.querySelector(".subject")
      },
      {
        title: "\u6587\u5B57\u8207\u5716\u8B5C",
        text: "\u53F3\u4E0A\u89D2\u7684\u300C\u6587\uFF0F\u5716\u8B5C\u300D\u5207\u63DB\u540C\u4E00\u500B\u689D\u76EE\u7684\u6587\u5B57\u8207\u95DC\u806F\u5716\u3002\u540C\u4E00\u500B toggle\uFF0C\u518D\u6309\u4E00\u6B21\u5C31\u56DE\u5230\u6587\u5B57\u3002",
        target: () => document.querySelector("#viewToggle")
      },
      {
        title: "\u7D22\u5F15\u9801",
        text: "\u300C\u7D22\u5F15\u300D\u662F\u63A2\u7D22 graph \u7684\u5165\u53E3\uFF1A\u641C\u5C0B\u3001\u79D1\u76EE\u3001\u9023\u7DDA\u6AA2\u8996\u8207\u6392\u5E8F\u90FD\u5728\u540C\u4E00\u9801\u3002",
        target: () => document.querySelector("#indexBtn"),
        action: openIndexForTour
      },
      {
        title: "\u641C\u5C0B\u662F\u7B2C\u4E00\u9053\u904E\u6FFE",
        text: "\u7D22\u5F15\u9801\u6700\u4E0A\u9762\u662F\u300C\u641C\u5C0B\u300D\uFF0C\u5148\u7528\u5B83\u7E2E\u5C0F\u7BC4\u570D\uFF1B\u4E0B\u9762\u518D\u7528\u79D1\u76EE\u3001\u9023\u7DDA\u6AA2\u8996\u8207\u6392\u5E8F\u7BE9\u9078\u3002",
        target: () => document.querySelector(".index-search-row")
      },
      {
        title: "\u6709\u9806\u6709\u9006",
        text: "\u9EDE\u300C\u6709\u9806\u6709\u9006\u300D\uFF1A\u53EA\u7559\u4E0B\u540C\u6642\u6709\u9806\u93C8\u8207\u9006\u93C8\u7684\u7BC0\u9EDE\uFF0C\u4E5F\u5C31\u662F\u771F\u6B63\u628A\u77E5\u8B58\u7DB2\u9023\u8D77\u4F86\u7684\u7BC0\u9EDE\u3002",
        target: () => document.querySelector('.index-view[data-view="both"]'),
        action: () => tourClick('.index-view[data-view="both"]')
      },
      {
        title: "\u9006\u93C8\u6B21\u6578",
        text: "\u6392\u5E8F\u9078\u300C\u9006\u93C8\u6B21\u6578\u300D\uFF1A\u88AB\u5176\u4ED6\u689D\u76EE\u5F15\u7528\u8D8A\u591A\u7684\u7BC0\u9EDE\uFF0C\u6392\u5F97\u8D8A\u524D\u9762\u3002",
        target: () => document.querySelector("#indexSort"),
        action: () => setIndexSortForTour("back")
      },
      {
        title: "\u627E\u5230\u5927\u578B\u8A9E\u8A00\u6A21\u578B",
        text: "\u627E\u5230\u300C\u5927\u578B\u8A9E\u8A00\u6A21\u578B\u300D\u3002\u5B83\u7684\u9006\u93C8\u5F88\u591A\uFF0C\u662F AI \u8853\u8A9E\u88E1\u7684\u6838\u5FC3\u7BC0\u9EDE\u3002",
        target: () => tourFindIndexRow("\u5927\u578B\u8A9E\u8A00\u6A21\u578B")
      },
      {
        title: "\u6253\u958B\u689D\u76EE",
        text: "\u9EDE\u958B\u5B83\u3002\u63A5\u8457\u770B\u5B83\u600E\u9EBC\u7528\u5F15\u7528\uFF0C\u628A\u300C\u53C3\u6578\u300D\u3001\u300C\u6B0A\u91CD\u300D\u548C\u300C\u795E\u7D93\u5143\u300D\u4E32\u6210\u4E00\u689D\u93C8\u3002",
        target: () => tourFindIndexRow("\u5927\u578B\u8A9E\u8A00\u6A21\u578B"),
        action: () => {
          const row = tourFindIndexRow("\u5927\u578B\u8A9E\u8A00\u6A21\u578B");
          if (!row) throw new Error("\u5927\u578B\u8A9E\u8A00\u6A21\u578B not found");
          row.querySelector(".index-main").click();
        }
      },
      {
        title: "\u5C55\u958B\u53C3\u6578",
        text: "\u5148\u5C55\u958B\u300C\u53C3\u6578\u300D\uFF1A\u6A21\u578B\u898F\u6A21\u7531\u53C3\u6578\u6578\u91CF\u6C7A\u5B9A\uFF0C\u5E38\u4EE5\u5104\u6216\u5146\u8A08\u3002",
        target: () => tourFindRef(["\u53C3\u6578"]),
        action: () => {
          const ref = tourFindRef(["\u53C3\u6578"]);
          if (!ref) throw new Error("\u53C3\u6578 ref not found");
          ref.click();
        }
      },
      {
        title: "\u5C55\u958B\u6B0A\u91CD",
        text: "\u53C3\u6578\u88E1\u518D\u5C55\u958B\u300C\u6B0A\u91CD\u300D\uFF1A\u8A13\u7DF4\u6700\u4E3B\u8981\u8ABF\u6574\u7684\u6578\u503C\uFF0C\u5C31\u662F\u6BCF\u500B\u8F38\u5165\u7684\u91CD\u8996\u7A0B\u5EA6\u3002",
        target: () => tourFindRef(["\u6B0A\u91CD"]),
        action: () => {
          const ref = tourFindRef(["\u6B0A\u91CD"]);
          if (!ref) throw new Error("\u6B0A\u91CD ref not found");
          ref.click();
        }
      },
      {
        title: "\u5C55\u958B\u795E\u7D93\u5143",
        text: "\u6700\u5F8C\u5C55\u958B\u300C\u795E\u7D93\u5143\u300D\uFF1A\u6B0A\u91CD\u8ABF\u7684\uFF0C\u5C31\u662F\u795E\u7D93\u5143\u5C0D\u6BCF\u500B\u8F38\u5165\u7684\u91CD\u8996\u7A0B\u5EA6\u3002",
        target: () => tourFindRef(["\u795E\u7D93\u5143", "\u4EBA\u5DE5\u795E\u7D93\u5143"]),
        action: () => {
          const ref = tourFindRef(["\u795E\u7D93\u5143", "\u4EBA\u5DE5\u795E\u7D93\u5143"]);
          if (!ref) throw new Error("\u795E\u7D93\u5143 ref not found");
          ref.click();
        }
      },
      {
        title: "\u5207\u5230\u5716\u8B5C",
        text: "\u6700\u5F8C\uFF0C\u628A\u540C\u4E00\u500B\u689D\u76EE\u5207\u5230\u5716\u8B5C\u6A21\u5F0F\uFF1A\u770B\u5B83\u548C\u76F8\u9130\u689D\u76EE\u7684\u9023\u7DDA\u3002",
        target: () => document.querySelector("#viewToggle"),
        action: () => switchView("graph")
      },
      {
        title: "\u5B8C\u6210",
        text: "\u4E00\u5206\u9418\u5230\u4E86\u3002\u4F60\u525B\u525B\u8D70\u904E\uFF1A\u4ECB\u9762 \u2192 \u7D22\u5F15 \u2192 \u5F15\u7528\u93C8 \u2192 \u5716\u8B5C\u3002<br>\u9019\u4EFD\u5C0E\u89BD\u53EF\u4EE5\u96A8\u6642\u5F9E\u53F3\u4E0A\u89D2 \u{1F9AE} \u91CD\u770B\u3002",
        target: () => document.querySelector(".graph-canvas")
      }
    ];
  }
  function tourState() {
    const step = tourSteps[tourIndex] || null;
    const targetRect = tourTarget && tourVisible(tourTarget) ? tourTarget.getBoundingClientRect() : null;
    const spotRect = tourSpot && !tourSpot.hidden ? tourSpot.getBoundingClientRect() : null;
    return {
      running: tourRunning,
      step: tourIndex,
      total: tourSteps.length,
      title: step ? step.title : "",
      target: !!targetRect,
      targetRect: targetRect ? {
        left: Math.round(targetRect.left),
        top: Math.round(targetRect.top),
        width: Math.round(targetRect.width),
        height: Math.round(targetRect.height)
      } : null,
      spotRect: spotRect ? {
        left: Math.round(spotRect.left),
        top: Math.round(spotRect.top),
        width: Math.round(spotRect.width),
        height: Math.round(spotRect.height)
      } : null,
      note: tourNoteEl ? tourNoteEl.textContent : "",
      timer: !!tourTimer,
      menuOpen: tourMenuOpen,
      hash: location.hash,
      indexView: state.indexView,
      indexSort: state.indexSort
    };
  }
  function onTourKey(event) {
    if (tourRunning) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stopTour(false);
        return;
      }
      if (event.key === " " || event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        advanceTour();
        return;
      }
      if (event.key === "/" || event.key.toLowerCase() === "g") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      return;
    }
    if (tourMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setTourMenuOpen(false);
    }
  }
  function initTour() {
    tourBtn = document.getElementById("tourBtn");
    if (!tourBtn) return;
    buildTourMenu();
    buildTourLayer();
    tourBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setTourMenuOpen(!tourMenuOpen);
    });
    document.addEventListener("click", (event) => {
      if (!tourMenuOpen) return;
      if (tourMenu.contains(event.target) || tourBtn.contains(event.target)) return;
      setTourMenuOpen(false);
    });
    document.addEventListener("keydown", onTourKey, true);
    window.addEventListener("resize", () => {
      positionTourMenu();
      layoutTour();
    });
    window.addEventListener(
      "scroll",
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
      closeMenu: () => setTourMenuOpen(false)
    };
  }
  initTour();
})();
