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
