/*
 * 設置頁：主題（亮底／暗底／護眼）＋ 繁簡文字顯示三態。
 *
 * 只換 CSS 變數與畫面文字，不改資料、不改搜尋原文。
 * 選擇存在 localStorage：
 *   offtext.theme.v1     light | dark | eye（沒有值＝跟隨系統）
 *   offtext.simmode.v1   0 原樣 | 1 無損簡體 | 2 強制簡體
 *
 * 依賴：nestedtext-simplified.js（window.NTSimplified）
 */
(function (root) {
  'use strict';

  const THEME_KEY = 'offtext.theme.v1';
  const SIM_KEY = 'offtext.simmode.v1';
  const THEMES = ['light', 'dark', 'eye'];
  const THEME_LABEL = { light: '亮底', dark: '暗底', eye: '護眼' };
  const SIM_LABELS = { 0: '保持原樣', 1: '無損簡體', 2: '強制簡體' };
  const SIM_DEMO = '王后與後代，頭髮乾燥，臺灣的醫生後來又發心。';

  const simplified = root.NTSimplified || {
    normalizeMode: () => 0,
    toSimplified: (text) => String(text == null ? '' : text),
    stats: () => ({ safe: 0, force: 0 }),
    searchForms: (text) => [String(text == null ? '' : text)],
  };

  function readTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      if (THEMES.includes(value)) return value;
    } catch (e) {
      /* 私密模式 */
    }
    return null;
  }

  function readSimMode() {
    try {
      return simplified.normalizeMode(localStorage.getItem(SIM_KEY));
    } catch (e) {
      return 0;
    }
  }

  const query = new URLSearchParams(location.search);
  const queryTheme = THEMES.includes(query.get('theme')) ? query.get('theme') : null;

  /** null＝跟隨系統；有值＝使用者選過（或 ?theme= 指定） */
  let explicitTheme = queryTheme || readTheme();
  let simMode = readSimMode();
  let open = false;
  let lastFocus = null;
  let onChange = null;

  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;

  function systemTheme() {
    return media && media.matches ? 'dark' : 'light';
  }

  /** 現在實際套用的主題（設定頁要標哪一顆） */
  function themeOf() {
    return explicitTheme || systemTheme();
  }

  function applyTheme() {
    const html = document.documentElement;
    if (explicitTheme) html.setAttribute('data-theme', explicitTheme);
    else html.removeAttribute('data-theme');
  }

  function setTheme(name) {
    if (!THEMES.includes(name)) return;
    explicitTheme = name;
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch (e) {
      /* 私密模式 */
    }
    applyTheme();
    paint();
    if (onChange) onChange('theme', name);
  }

  function setSimMode(mode) {
    const next = simplified.normalizeMode(mode);
    if (next === simMode) return;
    simMode = next;
    try {
      localStorage.setItem(SIM_KEY, String(next));
    } catch (e) {
      /* 私密模式 */
    }
    paint();
    if (onChange) onChange('sim', next);
  }

  /** 顯示用轉換；原樣時直接回傳，不做字串掃描 */
  function display(text) {
    return simMode ? simplified.toSimplified(text, simMode) : String(text == null ? '' : text);
  }

  function toSimplified(text, mode) {
    return simplified.toSimplified(text, mode == null ? simMode : mode);
  }

  function simplifiedStats() {
    return simplified.stats();
  }

  function searchForms(text) {
    return simplified.searchForms(text);
  }

  function $(selector) {
    return document.querySelector(selector);
  }

  function themeButtons() {
    return [...document.querySelectorAll('#themeSeg button')];
  }

  function simButtons() {
    return [...document.querySelectorAll('#simSeg button')];
  }

  function renderSimDemo() {
    const box = $('#simDemo');
    if (!box) return;
    const base = [...SIM_DEMO];
    const texts = [0, 1, 2].map((mode) => [...simplified.toSimplified(SIM_DEMO, mode)]);
    box.textContent = '';
    texts.forEach((chars, mode) => {
      const row = document.createElement('div');
      row.className = 'sim-row' + (mode === simMode ? ' is-active' : '');
      row.dataset.mode = String(mode);

      const label = document.createElement('span');
      label.className = 'sim-label';
      label.textContent = SIM_LABELS[mode];
      row.append(label);

      const text = document.createElement('span');
      text.className = 'sim-text';
      chars.forEach((ch, i) => {
        if (ch === base[i]) {
          text.append(document.createTextNode(ch));
        } else {
          const em = document.createElement('em');
          em.textContent = ch;
          text.append(em);
        }
      });
      row.append(text);
      box.append(row);
    });
  }

  function paint() {
    const activeTheme = themeOf();
    themeButtons().forEach((button) => {
      const on = button.dataset.theme === activeTheme;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    simButtons().forEach((button) => {
      const on = Number(button.dataset.mode) === simMode;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    renderSimDemo();

    const stats = $('#setStats');
    if (stats) {
      const table = simplifiedStats();
      const size = simMode === 1 ? table.safe : simMode === 2 ? table.force : 0;
      stats.textContent =
        '文字顯示：' +
        SIM_LABELS[simMode] +
        (size ? '（表 ' + size + ' 組）' : '') +
        ' · 主題：' +
        THEME_LABEL[activeTheme];
    }

    const button = $('#settingsBtn');
    if (button) {
      const custom = simMode !== 0 || !!explicitTheme;
      button.classList.toggle('is-custom', custom);
      button.title = custom ? '設置（已調整主題或文字顯示）' : '設置（主題、繁簡文字顯示）';
    }
  }

  function show(next) {
    open = next;
    const box = $('#settingsBox');
    const backdrop = $('#settingsBackdrop');
    const button = $('#settingsBtn');
    if (box) box.hidden = !next;
    if (backdrop) backdrop.hidden = !next;
    if (button) button.setAttribute('aria-expanded', String(next));
    if (next) {
      paint();
      const close = $('#settingsClose');
      if (close) close.focus();
    } else if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  function openSettings() {
    if (open) return;
    lastFocus = document.activeElement;
    show(true);
  }

  function closeSettings() {
    if (!open) return;
    show(false);
  }

  function isOpen() {
    return open;
  }

  function init(options) {
    onChange = (options && options.onChange) || null;
    applyTheme();

    const button = $('#settingsBtn');
    if (button) button.addEventListener('click', openSettings);
    const close = $('#settingsClose');
    if (close) close.addEventListener('click', closeSettings);
    const done = $('#settingsDone');
    if (done) done.addEventListener('click', closeSettings);
    const backdrop = $('#settingsBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeSettings);

    themeButtons().forEach((item) => {
      item.addEventListener('click', () => setTheme(item.dataset.theme));
    });
    simButtons().forEach((item) => {
      item.addEventListener('click', () => setSimMode(Number(item.dataset.mode)));
    });

    document.addEventListener(
      'keydown',
      (event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSettings();
          return;
        }
        if (event.key === 'Tab') {
          const box = $('#settingsBox');
          if (!box) return;
          const focusable = [...box.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')].filter(
            (item) => !item.disabled
          );
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
          }
        }
      },
      true
    );

    if (media) {
      const onSystemChange = () => {
        if (!explicitTheme) paint();
      };
      if (media.addEventListener) media.addEventListener('change', onSystemChange);
      else if (media.addListener) media.addListener(onSystemChange);
    }

    paint();
  }

  root.OfftextSettings = {
    init,
    open: openSettings,
    close: closeSettings,
    isOpen,
    themeOf,
    setTheme,
    simModeOf: () => simMode,
    setSimMode,
    display,
    toSimplified,
    simplifiedStats,
    searchForms,
    THEME_LABEL,
    SIM_LABELS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
