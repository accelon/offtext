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
      nodeShape: 'circle',
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
