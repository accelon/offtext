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
        title: '完成',
        text:
          '一分鐘到了。你剛剛走過：介面 → 索引 → 引用鏈。<br>' +
          '這份導覽可以隨時從右上角 🦮 重看。',
        target: null,
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
