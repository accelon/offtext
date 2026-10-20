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

  function closeHoverCards(fromCard?: any) {
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

  function hoverAnchorOf(target: any) {
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
    if ((event.target as any).closest('.hover-card')) return;
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
