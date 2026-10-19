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
