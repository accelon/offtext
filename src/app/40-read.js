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
