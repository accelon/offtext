/* 搜尋
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 搜尋 ---------- */

  let searchHits = [];

  function hideSearch() {
    searchResults.hidden = true;
    searchResults.textContent = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchHits = [];
  }

  function score(entry, needle) {
    if (entry.keyForms.some((form) => form.startsWith(needle))) return 3;
    if (entry.keyForms.some((form) => form.includes(needle))) return 2;
    return 1;
  }

  function renderSearch() {
    const needle = searchInput.value.trim().toLowerCase();
    if (!needle) {
      hideSearch();
      return;
    }

    searchHits = entries
      .filter((entry) => entry.hay.includes(needle))
      .sort((a, b) => score(b, needle) - score(a, needle))
      .slice(0, 12);

    searchResults.textContent = '';

    if (!searchHits.length) {
      searchResults.append(el('div', 'search-empty', '沒有符合「' + searchInput.value.trim() + '」的條目'));
    } else {
      searchHits.forEach((entry) => {
        const item = el('button', 'search-item');
        item.type = 'button';
        const head = el('span', 'search-head');
        head.append(el('span', 'search-key', disp(entry.key)));
        head.append(el('span', 'search-domain', disp(entry.domainName)));
        item.append(head);
        item.append(el('span', 'search-preview', entry.preview));
        item.addEventListener('click', () => {
          searchInput.value = '';
          navigate(entry.domain, entry.key);
        });
        searchResults.append(item);
      });
    }

    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function moveSearchFocus(step) {
    const items = [...searchResults.querySelectorAll('.search-item')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current === -1 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
    items[next].focus();
  }
