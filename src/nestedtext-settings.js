/* GENERATED FILE — 由 src/tools/build-lib.mjs 從 nestedtext-settings.ts 產生；請勿直接編輯。 */
(function(root) {
  "use strict";
  const THEME_KEY = "offtext.theme.v1";
  const SIM_KEY = "offtext.simmode.v1";
  const FONT_KEY = "offtext.fontsize.v1";
  const FONT_MIN = 12;
  const FONT_MAX = 24;
  const FONT_DEFAULT = 17;
  const THEMES = ["light", "dark", "eye"];
  const THEME_LABEL = { light: "\u4EAE\u5E95", dark: "\u6697\u5E95", eye: "\u8B77\u773C" };
  const SIM_LABELS = { 0: "\u4FDD\u6301\u539F\u6A23", 1: "\u7121\u640D\u7C21\u9AD4", 2: "\u5F37\u5236\u7C21\u9AD4" };
  const SIM_DEMO = "\u738B\u540E\u8207\u5F8C\u4EE3\uFF0C\u982D\u9AEE\u4E7E\u71E5\uFF0C\u81FA\u7063\u7684\u91AB\u751F\u5F8C\u4F86\u53C8\u767C\u5FC3\u3002";
  const simplified = root.NTSimplified || {
    normalizeMode: () => 0,
    toSimplified: (text) => String(text == null ? "" : text),
    stats: () => ({ safe: 0, force: 0 }),
    searchForms: (text) => [String(text == null ? "" : text)]
  };
  function readTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      if (THEMES.includes(value)) return value;
    } catch (e) {
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
  function readFontSize() {
    try {
      const value = Number(localStorage.getItem(FONT_KEY));
      if (value >= FONT_MIN && value <= FONT_MAX) return Math.round(value);
    } catch (e) {
    }
    return FONT_DEFAULT;
  }
  const query = new URLSearchParams(location.search);
  const queryTheme = THEMES.includes(query.get("theme")) ? query.get("theme") : null;
  let explicitTheme = queryTheme || readTheme();
  let simMode = readSimMode();
  let fontSize = readFontSize();
  let open = false;
  let lastFocus = null;
  let onChange = null;
  const media = root.matchMedia ? root.matchMedia("(prefers-color-scheme: dark)") : null;
  function systemTheme() {
    return media && media.matches ? "dark" : "light";
  }
  function themeOf() {
    return explicitTheme || systemTheme();
  }
  function applyTheme() {
    const html = document.documentElement;
    if (explicitTheme) html.setAttribute("data-theme", explicitTheme);
    else html.removeAttribute("data-theme");
  }
  function applyFontSize() {
    document.documentElement.style.setProperty("--reading-size", fontSize + "px");
  }
  function setFontSize(value) {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(Number(value) || FONT_DEFAULT)));
    if (next === fontSize) return;
    fontSize = next;
    try {
      localStorage.setItem(FONT_KEY, String(next));
    } catch (e) {
    }
    applyFontSize();
    paint();
    if (onChange) onChange("font", next);
  }
  function setTheme(name) {
    if (!THEMES.includes(name)) return;
    explicitTheme = name;
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch (e) {
    }
    applyTheme();
    paint();
    if (onChange) onChange("theme", name);
  }
  function setSimMode(mode) {
    const next = simplified.normalizeMode(mode);
    if (next === simMode) return;
    simMode = next;
    try {
      localStorage.setItem(SIM_KEY, String(next));
    } catch (e) {
    }
    paint();
    if (onChange) onChange("sim", next);
  }
  function display(text) {
    return simMode ? simplified.toSimplified(text, simMode) : String(text == null ? "" : text);
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
    return [...document.querySelectorAll("#themeSeg button")];
  }
  function simButtons() {
    return [...document.querySelectorAll("#simSeg button")];
  }
  function renderSimDemo() {
    const box = $("#simDemo");
    if (!box) return;
    const base = [...SIM_DEMO];
    const texts = [0, 1, 2].map((mode) => [...simplified.toSimplified(SIM_DEMO, mode)]);
    box.textContent = "";
    texts.forEach((chars, mode) => {
      const row = document.createElement("div");
      row.className = "sim-row" + (mode === simMode ? " is-active" : "");
      row.dataset.mode = String(mode);
      const label = document.createElement("span");
      label.className = "sim-label";
      label.textContent = SIM_LABELS[mode];
      row.append(label);
      const text = document.createElement("span");
      text.className = "sim-text";
      chars.forEach((ch, i) => {
        if (ch === base[i]) {
          text.append(document.createTextNode(ch));
        } else {
          const em = document.createElement("em");
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
    themeButtons().forEach((button2) => {
      const on = button2.dataset.theme === activeTheme;
      button2.classList.toggle("is-active", on);
      button2.setAttribute("aria-pressed", String(on));
    });
    simButtons().forEach((button2) => {
      const on = Number(button2.dataset.mode) === simMode;
      button2.classList.toggle("is-active", on);
      button2.setAttribute("aria-pressed", String(on));
    });
    renderSimDemo();
    const fontInput = $("#readFontSize");
    const fontValue = $("#readFontSizeValue");
    if (fontInput) fontInput.value = String(fontSize);
    if (fontValue) fontValue.textContent = fontSize + "px";
    const stats = $("#setStats");
    if (stats) {
      const table = simplifiedStats();
      const size = simMode === 1 ? table.safe : simMode === 2 ? table.force : 0;
      stats.textContent = "\u6587\u5B57\u986F\u793A\uFF1A" + SIM_LABELS[simMode] + (size ? "\uFF08\u8868 " + size + " \u7D44\uFF09" : "") + " \xB7 \u5B57\u7D1A\uFF1A" + fontSize + "px \xB7 \u4E3B\u984C\uFF1A" + THEME_LABEL[activeTheme];
    }
    const button = $("#settingsBtn");
    if (button) {
      const custom = simMode !== 0 || !!explicitTheme || fontSize !== FONT_DEFAULT;
      button.classList.toggle("is-custom", custom);
      button.title = custom ? "\u8A2D\u7F6E\uFF08\u5DF2\u8ABF\u6574\u4E3B\u984C\u3001\u5B57\u7D1A\u6216\u6587\u5B57\u986F\u793A\uFF09" : "\u8A2D\u7F6E\uFF08\u4E3B\u984C\u3001\u5B57\u7D1A\u3001\u7E41\u7C21\u6587\u5B57\u986F\u793A\uFF09";
    }
  }
  function show(next) {
    open = next;
    const box = $("#settingsBox");
    const backdrop = $("#settingsBackdrop");
    const button = $("#settingsBtn");
    if (box) box.hidden = !next;
    if (backdrop) backdrop.hidden = !next;
    if (button) button.setAttribute("aria-expanded", String(next));
    if (next) {
      paint();
      const close = $("#settingsClose");
      if (close) close.focus();
    } else if (lastFocus && typeof lastFocus.focus === "function") {
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
    onChange = options && options.onChange || null;
    applyTheme();
    applyFontSize();
    const button = $("#settingsBtn");
    if (button) button.addEventListener("click", openSettings);
    const close = $("#settingsClose");
    if (close) close.addEventListener("click", closeSettings);
    const done = $("#settingsDone");
    if (done) done.addEventListener("click", closeSettings);
    const backdrop = $("#settingsBackdrop");
    if (backdrop) backdrop.addEventListener("click", closeSettings);
    themeButtons().forEach((item) => {
      item.addEventListener("click", () => setTheme(item.dataset.theme));
    });
    simButtons().forEach((item) => {
      item.addEventListener("click", () => setSimMode(Number(item.dataset.mode)));
    });
    const fontInput = $("#readFontSize");
    if (fontInput) {
      fontInput.addEventListener("input", () => setFontSize(fontInput.value));
    }
    document.addEventListener(
      "keydown",
      (event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeSettings();
          return;
        }
        if (event.key === "Tab") {
          const box = $("#settingsBox");
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
      if (media.addEventListener) media.addEventListener("change", onSystemChange);
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
    fontSizeOf: () => fontSize,
    setFontSize,
    FONT_MIN,
    FONT_MAX,
    FONT_DEFAULT,
    display,
    toSimplified,
    simplifiedStats,
    searchForms,
    THEME_LABEL,
    SIM_LABELS
  };
})(typeof globalThis !== "undefined" ? globalThis : exports);
