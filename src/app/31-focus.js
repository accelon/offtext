/* 展開狀態與焦點
 * 由 src/nestedtext.js 拆出；建置時依檔名順序串成同一個 IIFE。
 */
  /* ---------- 展開狀態與焦點 ---------- */

  function nearestOpenAncestor(path) {
    let p = path;
    while (p.includes('.')) {
      p = p.slice(0, p.lastIndexOf('.'));
      if (state.expanded.has(p)) return p;
    }
    return null;
  }

  function closePath(path) {
    for (const key of [...state.expanded]) {
      if (key === path || key.startsWith(path + '.')) state.expanded.delete(key);
    }
    if (state.focusPath && (state.focusPath === path || state.focusPath.startsWith(path + '.'))) {
      state.focusPath = nearestOpenAncestor(path);
    }
  }

  function toggle(path) {
    if (state.expanded.has(path)) {
      closePath(path);
    } else {
      state.expanded.add(path);
      state.focusPath = path;
    }
    render({ focusPath: path });
  }
