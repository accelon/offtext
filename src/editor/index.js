/*
 * Offtext × CodeMirror 6
 * ----------------------
 * 一份渲染邏輯，同時服務閱讀與編輯：
 *   - 閱讀：EditorState.readOnly = true，游標仍在，所有輸入被阻擋。
 *   - 編輯：同一個 EditorView 取消 readOnly，游標位置不變。
 *   - 巢狀：^[...] 以 replace widget 呈現；展開時在 widget 內再掛一個唯讀
 *     EditorView，使用同一組 decoration / theme / resolve 規則。
 *
 * 這個檔由 esbuild 打包成 src/offtext-cm.js（IIFE），因此 file:// 也能載入。
 */
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  keymap,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
} from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { charLength, parseSpans } from './parse.js';

export { parseSpans, charLength } from './parse.js';

const refreshEffect = StateEffect.define();
const insertedEffect = StateEffect.define();

/* ---------- 小工具 ---------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function entryId(domain, key) {
  return domain + ':' + key;
}

function focusClass(path, focusPath) {
  if (!focusPath) return '';
  if (path === focusPath) return ' is-focus-current';
  if (focusPath.startsWith(path + '.')) return ' is-focus-ancestor';
  // 焦點路徑所指的展開內容也是「目前這條路徑」的一部分；
  // 內容裡的引用（例如法律條文中的「國家」）不應因其路徑更長而被淡出。
  if (path.startsWith(focusPath + '.')) return '';
  return ' is-dim';
}

function selectionTouches(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.from < to && range.to > from) return true;
  }
  return false;
}

function lineOf(doc, pos) {
  return doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
}

/* ---------- 系統插入標記的「取消」按鈕 ---------- */

class CancelInsertedWidget extends WidgetType {
  constructor(mark) {
    super();
    this.mark = mark;
  }
  eq(other) {
    return (
      other.mark.id === this.mark.id &&
      other.mark.from === this.mark.from &&
      other.mark.to === this.mark.to
    );
  }
  toDOM(view) {
    const button = el('button', 'cm-cancel-insert', '取消');
    button.type = 'button';
    button.title = '取消這次系統加入的引用標記';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        // 只移除系統加的 ^[ 與 ]，保留被標記的詞本身。
        changes: [
          { from: this.mark.from, to: this.mark.from + 2, insert: '' },
          { from: this.mark.to - 1, to: this.mark.to, insert: '' },
        ],
        effects: insertedEffect.of({ remove: this.mark.id }),
      });
      const ctx = view.cmContext;
      if (ctx && ctx.host && ctx.host.onInsertedCancel) ctx.host.onInsertedCancel();
      view.focus();
    });
    return button;
  }
  ignoreEvent() {
    return false;
  }
}

const insertedField = StateField.define({
  create() {
    return [];
  },
  update(marks, tr) {
    let next = marks
      .map((mark) => {
        const from = tr.changes.mapPos(mark.from, 1);
        const to = tr.changes.mapPos(mark.to, -1);
        if (to <= from) return null;
        if (tr.newDoc.sliceString(from, to) !== mark.text) return null;
        return { ...mark, from, to };
      })
      .filter(Boolean);

    for (const effect of tr.effects) {
      if (!effect.is(insertedEffect)) continue;
      if (effect.value.removeAll) {
        next = [];
      }
      if (effect.value.remove) {
        next = next.filter((mark) => mark.id !== effect.value.remove);
      }
      if (effect.value.add) {
        next = next.filter((mark) => mark.id !== effect.value.add.id);
        next.push(effect.value.add);
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (marks) =>
      Decoration.set(
        marks.map((mark) =>
          Decoration.widget({
            widget: new CancelInsertedWidget(mark),
            side: 1,
          }).range(mark.to)
        ),
        true
      )
    ),
});

/* ---------- 裝飾用的 widget ---------- */

class TextWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return other.text === this.text;
  }
  toDOM() {
    return el('span', 'cm-sim-text', this.text);
  }
  ignoreEvent() {
    return false;
  }
}

class RefWidget extends WidgetType {
  constructor(opts) {
    super();
    this.opts = opts;
  }

  eq(other) {
    const a = this.opts;
    const b = other.opts;
    return (
      a.path === b.path &&
      a.label === b.label &&
      a.expanded === b.expanded &&
      a.mode === b.mode &&
      a.status === b.status &&
      a.note === b.note &&
      a.backlink === b.backlink &&
      a.focus === b.focus &&
      a.editMode === b.editMode &&
      a.displayVersion === b.displayVersion &&
      a.depth === b.depth &&
      a.value === b.value &&
      a.ancestorsKey === b.ancestorsKey &&
      a.resDomain === b.resDomain &&
      a.resKey === b.resKey
    );
  }

  toDOM(view) {
    const o = this.opts;
    const wrap = el('span', 'nt-refwrap cm-refwrap' + (o.expanded ? ' is-open' : '') + (o.focus || ''));
    wrap.dataset.path = o.path;
    wrap.style.setProperty('--hue', String(o.hue));
    wrap.style.setProperty('--depth', String(o.depth));

    const label = el('span', 'nt-ref cm-ref' + (o.backlink ? ' is-backlink-source' : ''));
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '-1');
    label.setAttribute('aria-expanded', String(!!o.expanded));
    label.dataset.ref = o.tok.ref;
    if (o.tok.domain) label.dataset.domain = o.tok.domain;
    if (o.contextDomain) label.dataset.context = o.contextDomain;
    label.textContent = o.label;
    if (String(o.focus || '').includes('is-focus-ancestor')) {
      label.classList.add('is-focus-ancestor');
    }
    if (o.status !== 'ok') label.classList.add('is-missing');
    const raw = '^[' + o.inner + ']';
    label.title =
      raw +
      (o.status === 'ok'
        ? '：' + (o.editMode ? '點擊編輯引用；' : '點擊展開／收合；') + 'Ctrl/⌘+點擊直接開啟'
        : '：找不到目標；點擊載入其他科目');
    label.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (o.status !== 'ok') {
        o.host.showMissing(o.tok, o.contextDomain);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && o.status === 'ok') {
        o.host.navigate(o.resDomain, o.resKey);
        return;
      }
      if (o.backlink) {
        o.host.navigateBacklink();
        return;
      }
      if (o.editMode) {
        // 游標移入 offtag：顯示原始 ^[...]，允許直接改寫。
        // 先 focus 再 dispatch；再於下一個 frame 補一次，避免瀏覽器把
        // contenteditable 的舊 DOM selection 蓋回 widget 尾端。
        const anchor = o.tok.from + 2;
        view.focus();
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        requestAnimationFrame(() => {
          try {
            view.dispatch({ selection: { anchor }, scrollIntoView: true });
          } catch (e) {
            /* view 已移除 */
          }
        });
        return;
      }
      o.host.toggleExpanded(o.path);
    });
    wrap.append(label);

    if (o.status === 'ok' && o.expanded && o.inlineContent) {
      const nested = createNestedView(o, o.resValue, o.resDomain, o.resKey, o.ancestors, o.path);
      wrap.append(nested.dom);
      wrap._cmNested = nested;
    }

    if (o.note) {
      wrap.append(el('span', 'nt-note cm-note' + (o.noteClass || ''), o.note));
    }

    // 展開／收合的獨立小控制：編輯時點 label 會進入原始碼，這裡才能收合。
    if (o.status === 'ok' && (o.expanded || o.canExpand) && o.editMode) {
      const caret = el('span', 'cm-ref-caret', o.expanded ? '⌄' : '›');
      caret.setAttribute('role', 'button');
      caret.setAttribute('tabindex', '-1');
      caret.title = o.expanded ? '收合' : '展開';
      caret.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        o.host.toggleExpanded(o.path);
      });
      wrap.append(caret);
    }

    return wrap;
  }

  destroy(dom) {
    if (dom._cmNested) {
      dom._cmNested.destroy();
      dom._cmNested = null;
    }
  }

  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return this.opts.expanded && this.opts.inlineContent ? 46 : 28;
  }
}

class BlockWidget extends WidgetType {
  constructor(opts) {
    super();
    this.opts = opts;
  }

  eq(other) {
    const a = this.opts;
    const b = other.opts;
    return (
      a.path === b.path &&
      a.value === b.value &&
      a.resDomain === b.resDomain &&
      a.resKey === b.resKey &&
      a.depth === b.depth &&
      a.ancestorsKey === b.ancestorsKey &&
      a.focus === b.focus &&
      a.displayVersion === b.displayVersion
    );
  }

  toDOM() {
    const o = this.opts;
    const box = el('div', 'nt-exp nt-exp-block cm-exp-block' + (o.focus || ''));
    box.dataset.path = o.path;
    box.dataset.depth = String(o.depth + 1);
    box.style.setProperty('--hue', String(o.hue));
    box.style.setProperty('--depth', String(o.depth + 1));

    const head = el('div', 'nt-exp-head cm-exp-head');
    head.append(el('span', 'nt-exp-arrow', '↳'));
    head.append(el('span', 'nt-exp-key', o.host.display(o.resKey)));
    head.append(el('span', 'nt-exp-domain', o.resDomain));
    const edit = el('button', 'cm-exp-edit', '編輯');
    edit.type = 'button';
    edit.title = '開啟這個條目編輯';
    edit.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      o.host.requestEdit(o.resDomain, o.resKey);
    });
    const close = el('button', 'nt-exp-close', '×');
    close.type = 'button';
    close.title = '收合';
    close.setAttribute('aria-label', '收合');
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      o.host.toggleExpanded(o.path);
    });
    head.append(edit, close);
    box.append(head);

    const nested = createNestedView(o, o.value, o.resDomain, o.resKey, o.ancestors, o.path);
    box.append(nested.dom);
    box._cmNested = nested;
    return box;
  }

  destroy(dom) {
    if (dom._cmNested) {
      dom._cmNested.destroy();
      dom._cmNested = null;
    }
  }

  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return 120;
  }
}

/* ---------- 巢狀 EditorView ---------- */

function createNestedView(parentOpts, text, domain, key, ancestors, path) {
  const session = parentOpts.session;
  const host = parentOpts.host;
  const depth = parentOpts.depth + 1;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(entryId(domain, key));

  const dom = el(
    'span',
    'cm-nested cm-nested-inline nt-exp nt-exp-inline' + focusClass(path, host.focusPath())
  );
  dom.dataset.path = path;
  dom.dataset.depth = String(depth);
  dom.style.setProperty('--hue', String(host.hue(depth)));
  dom.style.setProperty('--depth', String(depth));

  const ctx = {
    session,
    host,
    domain,
    key,
    depth,
    prefix: path,
    ancestors: nextAncestors,
    editing: false,
    maxDepth: parentOpts.maxDepth,
    root: false,
  };

  const view = new EditorView({
    state: EditorState.create({
      doc: String(text == null ? '' : text),
      extensions: extensionsFor(ctx, true),
    }),
    parent: dom,
  });
  ctx.view = view;
  view.cmContext = ctx;
  session.views.add(view);
  view.dom.addEventListener('focusin', (event) => {
    if (event.target.closest('.cm-editor') !== view.dom) return;
    session.lastActiveView = view;
  });

  return {
    dom,
    view,
    destroy() {
      session.views.delete(view);
      try {
        view.destroy();
      } catch (e) {
        /* 已銷毀 */
      }
    },
  };
}

/* ---------- 裝飾計算 ---------- */

function noteFor(host, res, ancestors, depth, maxDepth) {
  if (res.status === 'missing') return { text: '找不到', cls: ' nt-note-missing' };
  if (res.status === 'alias-loop') return { text: '↺ 循環', cls: ' nt-note-alias-loop' };
  if (!res.value || !String(res.value).trim()) return { text: '（空）', cls: ' nt-note-empty' };
  if (ancestors.has(entryId(res.domain, res.key))) {
    return { text: '↺ 循環', cls: ' nt-note-cycle' };
  }
  if (depth + 1 > maxDepth) return { text: '深度上限', cls: ' nt-note-limit' };
  return null;
}

function buildDecorations(state, ctx) {
  const { host } = ctx;
  const ranges = [];
  const blocks = [];
  const doc = state.doc;
  const spans = parseSpans(doc.toString());
  const focusPath = host.focusPath();
  const simMode = ctx.editing ? 0 : host.simMode();
  let refIndex = 0;

  // 保留舊版 .nt-line 選擇器（測試、截圖、既有 CSS）。
  for (let n = 1; n <= doc.lines; n++) {
    ranges.push(Decoration.line({ class: 'nt-line' }).range(doc.line(n).from));
  }

  for (const tok of spans) {
    if (tok.type === 'text') {
      if (!ctx.editing && focusPath && focusPath !== ctx.prefix) {
        ranges.push(
          Decoration.mark({ class: 'cm-focus-dim-text' }).range(tok.from, tok.to)
        );
      }
      if (simMode !== 0) {
        const shown = host.display(tok.text);
        const first = lineOf(doc, tok.from);
        const last = lineOf(doc, tok.to);
        if (shown !== tok.text && first.number === last.number) {
          ranges.push(Decoration.replace({ widget: new TextWidget(shown) }).range(tok.from, tok.to));
        }
      }
      continue;
    }

    const firstLine = lineOf(doc, tok.from);
    const lastLine = lineOf(doc, tok.to);
    if (firstLine.number !== lastLine.number) continue; // 跨行引用先顯示原始碼

    const path = ctx.prefix ? ctx.prefix + '.' + refIndex : String(refIndex);
    refIndex++;

    const expanded = host.isExpanded(path);
    const active = ctx.editing && selectionTouches(state, tok.from, tok.to);
    if (active) {
      // 游標在 offtag 內：不隱藏控制代碼，讓使用者直接編輯。
      ranges.push(Decoration.mark({ class: 'cm-offtag-active' }).range(tok.from, tok.to));
      continue;
    }

    const res = host.resolve(tok.ref, tok.domain, ctx.domain);
    const label = host.display(tok.display || tok.ref);
    const mode = res.status === 'ok' ? host.chooseMode(res.value) : 'inline';
    const note = expanded
      ? noteFor(host, res, ctx.ancestors, ctx.depth, ctx.maxDepth)
      : null;
    const canExpand =
      res.status === 'ok' &&
      res.value &&
      String(res.value).trim() &&
      !ctx.ancestors.has(entryId(res.domain, res.key)) &&
      ctx.depth + 1 <= ctx.maxDepth;

    const opts = {
      host,
      session: ctx.session,
      tok,
      path,
      depth: ctx.depth,
      maxDepth: ctx.maxDepth,
      hue: host.hue(ctx.depth),
      displayVersion: ctx.session.displayVersion,
      contextDomain: ctx.domain,
      label,
      inner: tok.inner,
      status: res.status,
      resDomain: res.domain,
      resKey: res.key,
      resValue: res.value,
      value: expanded ? res.value : '',
      expanded,
      inlineContent: !!(expanded && canExpand && mode === 'inline'),
      mode,
      canExpand,
      note: note ? note.text : '',
      noteClass: note ? note.cls : '',
      backlink: ctx.depth === 0 && host.isBacklinkSource(res),
      focus: focusClass(path, focusPath),
      editMode: !!ctx.editing,
      ancestors: ctx.ancestors,
      ancestorsKey: [...ctx.ancestors].join('|'),
    };

    ranges.push(
      Decoration.replace({ widget: new RefWidget(opts), inclusive: false }).range(tok.from, tok.to)
    );

    if (expanded && canExpand && mode === 'block') {
      const line = lineOf(doc, tok.to);
      blocks.push(
        Decoration.widget({
          widget: new BlockWidget({
            ...opts,
            hue: host.hue(ctx.depth + 1),
          }),
          side: 1,
          block: true,
        }).range(line.to)
      );
    }
  }

  return Decoration.set(ranges.concat(blocks), true);
}

function decorationField(ctx) {
  return StateField.define({
    create(state) {
      return buildDecorations(state, ctx);
    },
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection != null ||
        tr.effects.some((effect) => effect.is(refreshEffect))
      ) {
        return buildDecorations(tr.state, ctx);
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

/* ---------- 輸入規則 ---------- */

function insideOpenRef(state, pos) {
  const line = state.doc.lineAt(pos);
  const before = state.doc.sliceString(line.from, pos);
  const open = before.lastIndexOf('^[');
  const close = before.lastIndexOf(']');
  return open > close;
}

/* ^ → ^[]，游標停在括號內，並打開條目補全。 */
const caretInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '^') return false;
  const state = view.state;
  if (insideOpenRef(state, from)) return false;
  view.dispatch({
    changes: { from, to, insert: '^[]' },
    selection: { anchor: from + 2 },
    userEvent: 'input.type',
  });
  setTimeout(() => {
    try {
      startCompletion(view);
    } catch (e) {
      /* 沒有補全也不影響輸入 */
    }
  }, 0);
  return true;
});

function findClose(doc, openPos) {
  const line = doc.lineAt(openPos);
  const rest = doc.sliceString(openPos + 1, line.to);
  const at = rest.indexOf(']');
  return at < 0 ? -1 : openPos + 1 + at;
}

/*
 * 刪左括號時，連右括號一起刪。
 * 用 keymap 直接一次 transaction 刪兩個位置，undo 也是一步。
 */
function deleteBracketBackward(view) {
  const state = view.state;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length !== 1) return false;
  const pos = range.head;
  if (pos <= 0) return false;
  const doc = state.doc;
  const before = doc.sliceString(Math.max(0, pos - 2), pos);

  if (before === '^[') {
    const close = findClose(doc, pos - 1);
    if (close < 0) return false;
    view.dispatch({
      changes: [
        { from: pos - 1, to: pos },
        { from: close, to: close + 1 },
      ],
      selection: { anchor: pos - 1 },
      userEvent: 'delete.backward',
    });
    return true;
  }

  if (before.endsWith('^') && doc.sliceString(pos, pos + 2) === '[]') {
    view.dispatch({
      changes: { from: pos - 1, to: pos + 2 },
      selection: { anchor: pos - 1 },
      userEvent: 'delete.backward',
    });
    return true;
  }
  return false;
}

function deleteBracketForward(view) {
  const state = view.state;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length !== 1) return false;
  const pos = range.head;
  const doc = state.doc;
  if (doc.sliceString(pos, pos + 2) !== '^[') return false;
  const close = findClose(doc, pos + 1);
  if (close < 0) return false;
  view.dispatch({
    changes: [
      { from: pos, to: pos + 2 },
      { from: close, to: close + 1 },
    ],
    selection: { anchor: pos },
    userEvent: 'delete.forward',
  });
  return true;
}


/* ---------- 補全 ---------- */

function completionSource(ctx) {
  return (context) => {
    const state = context.state;
    const pos = context.pos;
    const line = state.doc.lineAt(pos);
    const before = state.doc.sliceString(line.from, pos);
    const open = before.lastIndexOf('^[');
    if (open < 0) return null;
    const between = before.slice(open + 2);
    if (between.includes(']')) return null;
    const bar = between.lastIndexOf('|');
    const query = (bar >= 0 ? between.slice(bar + 1) : between).trim();
    const from = line.from + open + 2 + (bar >= 0 ? bar + 1 : 0);

    const items = ctx.host.completions(query, ctx.domain) || [];
    const options = items.map((item) => ({
      label: item.key,
      detail: item.domainName,
      info: item.preview,
      type: 'keyword',
      apply: item.apply || item.key,
      boost: item.boost || 0,
    }));

    const exact = items.some((item) => item.key === query);
    if (query && !exact && charLength(query) <= 16) {
      options.push({
        label: '＋ 建立「' + query + '」',
        detail: '新條目',
        type: 'text',
        apply: query,
        boost: -30,
      });
    }

    return {
      from,
      to: pos,
      options,
      validFor: /^[^\]\n]*$/,
    };
  };
}

/* ---------- 編輯器 extension ---------- */

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--ink)',
    fontSize: 'var(--reading-size, 17px)',
    lineHeight: '2.05',
    fontFamily: 'inherit',
  },
  '&.cm-editor': { outline: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'visible',
  },
  '.cm-content': {
    padding: '0',
    caretColor: 'var(--accent)',
    minHeight: '1.6em',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-tooltip': {
    border: '1px solid var(--line-strong)',
    borderRadius: '10px',
    background: 'var(--panel)',
    color: 'var(--ink)',
    boxShadow: '0 12px 30px rgba(30, 25, 18, 0.18)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    maxHeight: 'min(52vh, 360px)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '5px 9px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'color-mix(in srgb, var(--accent) 13%, var(--panel))',
    color: 'var(--ink)',
  },
  '.cm-completionDetail': {
    marginLeft: '8px',
    color: 'var(--muted)',
    fontStyle: 'normal',
    fontSize: '11px',
  },
  '.cm-completionInfo': {
    padding: '6px 9px',
    borderLeft: '1px solid var(--line)',
    color: 'var(--muted)',
    fontSize: '12px',
    maxWidth: '260px',
  },
});

function extensionsFor(ctx, nested) {
  const root = !nested;
  const exts = [
    EditorView.lineWrapping,
    drawSelection(),
    bracketMatching(),
    editorTheme,
    // 閱讀模式仍保留 contenteditable，才有游標；輸入由 readOnly 阻擋。
    EditorView.editable.of(true),
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      translate: 'no',
    }),
    decorationField(ctx),
  ];

  if (root) {
    ctx.readOnlyComp = new Compartment();
    exts.push(ctx.readOnlyComp.of(EditorState.readOnly.of(!ctx.editing)));
  } else {
    exts.push(EditorState.readOnly.of(true));
  }

  if (root) {
    exts.push(
      history(),
      insertedField,
      closeBrackets(),
      autocompletion({
        override: [completionSource(ctx)],
        activateOnTyping: true,
        closeOnBlur: true,
        maxRenderedOptions: 200,
        defaultKeymap: true,
        icons: false,
      }),
      keymap.of([
        { key: 'Backspace', run: deleteBracketBackward },
        { key: 'Delete', run: deleteBracketForward },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        {
          key: 'Mod-s',
          run: () => {
            if (ctx.host.saveShortcut) ctx.host.saveShortcut();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            if (ctx.host.saveShortcut) ctx.host.saveShortcut();
            return true;
          },
        },
      ]),
      caretInput,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !ctx.suppressChange) {
          ctx.host.onChange(update.state.doc.toString(), ctx);
        }
      })
    );
  } else {
    exts.push(keymap.of([...defaultKeymap]));
  }

  return exts;
}

/* ---------- 對外控制器 ---------- */

function createEntry(options) {
  const opts = options || {};
  const session = {
    views: new Set(),
    lastActiveView: null,
    destroyed: false,
    displayVersion: 0,
  };

  const ctx = {
    session,
    host: opts.host,
    domain: opts.domain,
    key: opts.key,
    depth: opts.depth || 0,
    prefix: opts.prefix || '',
    ancestors: opts.ancestors || new Set([entryId(opts.domain, opts.key)]),
    editing: !!opts.editing,
    maxDepth: opts.maxDepth || 6,
    root: true,
    suppressChange: false,
  };

  const parent = opts.parent;
  parent.textContent = '';
  const shell = el('div', 'cm-offtext-root nt-doc');
  parent.append(shell);

  const view = new EditorView({
    state: EditorState.create({
      doc: String(opts.text == null ? '' : opts.text),
      extensions: extensionsFor(ctx, false),
    }),
    parent: shell,
  });
  shell.classList.toggle('cm-editing', ctx.editing);
  shell.classList.toggle('cm-readonly', !ctx.editing);
  shell.dataset.domain = ctx.domain;
  shell.dataset.key = ctx.key;
  shell.dataset.depth = String(ctx.depth);
  shell.style.setProperty('--hue', String(ctx.host.hue(ctx.depth)));
  shell.style.setProperty('--depth', String(ctx.depth));
  ctx.view = view;
  view.cmContext = ctx;
  session.views.add(view);
  // 供測試／除錯讀取目前 view；不影響 CM6 內部。
  shell.__cmView = view;

  view.dom.addEventListener('focusin', (event) => {
    if (event.target.closest('.cm-editor') !== view.dom) return;
    session.lastActiveView = view;
  });

  const controller = {
    view,
    get editing() {
      return ctx.editing;
    },
    setEditing(flag) {
      const next = !!flag;
      if (ctx.editing === next) return;
      ctx.editing = next;
      shell.classList.toggle('cm-editing', next);
      shell.classList.toggle('cm-readonly', !next);
      view.dispatch({
        effects: [
          ctx.readOnlyComp.reconfigure(EditorState.readOnly.of(!next)),
          refreshEffect.of(null),
        ],
      });
      // 閱讀態也保留焦點，游標才看得見。
      view.focus();
    },
    setText(text) {
      const value = String(text == null ? '' : text);
      if (view.state.doc.toString() === value) return;
      ctx.suppressChange = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
      ctx.suppressChange = false;
    },
    refresh() {
      if (session.destroyed) return;
      session.displayVersion++;
      for (const target of session.views) {
        try {
          target.dispatch({ effects: refreshEffect.of(null) });
        } catch (e) {
          /* view 可能已移除 */
        }
      }
      shell.classList.toggle('cm-editing', ctx.editing);
      shell.classList.toggle('cm-readonly', !ctx.editing);
    },
    focus() {
      view.focus();
    },
    getSelectionInfo() {
      let active = session.lastActiveView || view;
      if (!active || !active.state || !session.views.has(active)) active = view;
      const focused = document.activeElement;
      if (!focused || focused.closest?.('.cm-editor') !== active.dom) return null;
      const range = active.state.selection.main;
      if (range.empty) return null;
      const text = active.state.sliceDoc(range.from, range.to);
      if (!text) return null;
      let rect = null;
      try {
        const a = active.coordsAtPos(range.from);
        const b = active.coordsAtPos(range.to);
        if (a && b) {
          rect = {
            left: Math.min(a.left, b.left),
            right: Math.max(a.right, b.right),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
          };
          rect.width = rect.right - rect.left;
          rect.height = rect.bottom - rect.top;
        }
      } catch (e) {
        /* 尚未量測 */
      }
      const parentCtx = active.cmContext || null;
      return {
        text,
        from: range.from,
        to: range.to,
        rect,
        domain: parentCtx ? parentCtx.domain : ctx.domain,
        key: parentCtx ? parentCtx.key : ctx.key,
        depth: parentCtx ? parentCtx.depth : ctx.depth,
      };
    },
    clearInserted() {
      view.dispatch({ effects: insertedEffect.of({ removeAll: true }) });
    },
    markInserted(from, to, id, text) {
      view.dispatch({
        effects: insertedEffect.of({
          add: { from, to, id, text: String(text) },
        }),
      });
    },
    scrollToPath(path) {
      const target = shell.querySelector(
        '[data-path="' + String(path).replace(/"/g, '\\"') + '"]'
      );
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
    },
    destroy() {
      if (session.destroyed) return;
      session.destroyed = true;
      for (const target of [...session.views]) {
        try {
          target.destroy();
        } catch (e) {
          /* 已銷毀 */
        }
      }
      session.views.clear();
      parent.textContent = '';
    },
  };

  return controller;
}

export { createEntry };
