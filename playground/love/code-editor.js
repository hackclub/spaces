// The code editor: CodeMirror 6 (loaded from esm.sh through the import map
// in index.html), or a plain <textarea> when the CDN can't be reached.
//
// Both implementations share one interface:
//   open(path, text)  show a file (creates its buffer the first time)
//   has(path), getText(path), setText(path, text), close(path), rename(a, b)
//   setError(path, line, message), clearErrors(), gotoLine(line, col)
//   applySettings(settings), normalize(path, {trim, finalNewline})
//   focus(), hide(), current, kind

import { h } from './ui.js';
import { languageOf } from './file-types.js';

export async function loadCodeMirror(timeoutMs = 15000) {
  const modules = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    import('@codemirror/autocomplete'),
    import('@lezer/highlight'),
    import('@codemirror/legacy-modes/mode/lua'),
    import('@codemirror/legacy-modes/mode/clike'),
    import('@codemirror/legacy-modes/mode/javascript'),
  ]);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading CodeMirror')), timeoutMs));
  const [state, view, language, commands, search, autocomplete, highlight, lua, clike, javascript] = await Promise.race([modules, timeout]);
  return { state, view, language, commands, search, autocomplete, highlight, modes: { lua, clike, javascript } };
}

export async function createEditor(parent, opts) {
  // ?editor=textarea forces the fallback (handy for testing it).
  if (new URLSearchParams(location.search).get('editor') === 'textarea') return new TextareaEditor(parent, opts);
  try {
    const cm = await loadCodeMirror();
    return new CMEditor(parent, opts, cm);
  } catch (e) {
    console.warn('CodeMirror could not be loaded; using the fallback editor.', e);
    return new TextareaEditor(parent, opts);
  }
}

// ---------------------------------------------------------------------------
// CodeMirror

/** Lua highlighting tweaks: object fields/methods and `love`/`self` stand out. */
function luaMode(base) {
  return {
    ...base,
    name: 'lua',
    token(stream, state) {
      const style = base.token(stream, state);
      if (style === 'variable') {
        const word = stream.current();
        if (word === 'love') return 'builtin';
        if (word === 'self') return 'variable-2';
        const prev = stream.string.charAt(stream.start - 1);
        const prev2 = stream.string.charAt(stream.start - 2);
        if ((prev === '.' && prev2 !== '.') || prev === ':') return 'property';
        if (/^\s*\(/.test(stream.string.slice(stream.pos))) return 'def';
      }
      return style;
    },
  };
}

class CMEditor {
  constructor(parent, opts, cm) {
    this.kind = 'codemirror';
    this.cm = cm;
    this.opts = opts;
    this.parent = parent;
    this.states = new Map();
    this.current = null;
    this.completionSource = null;
    this.prefs = {
      tabSize: 2, insertSpaces: true, wordWrap: false, lineNumbers: true, highlightActiveLine: true,
      closeBrackets: true, autocomplete: true, showWhitespace: false,
    };

    const { state: S, view: V, language: L, highlight: H } = cm;
    this.prefsCompartment = new S.Compartment();
    const t = H.tags;

    this.setErrorEffect = S.StateEffect.define();
    const setErrorEffect = this.setErrorEffect;

    class ErrorWidget extends V.WidgetType {
      constructor(message) { super(); this.message = message; }
      eq(other) { return other.message === this.message; }
      toDOM() { return h('div', { class: 'cm-error-widget', role: 'alert' }, this.message); }
      ignoreEvent() { return false; }
    }

    this.errorField = S.StateField.define({
      create: () => V.Decoration.none,
      update(deco, tr) {
        for (const e of tr.effects) {
          if (!e.is(setErrorEffect)) continue;
          if (!e.value) return V.Decoration.none;
          const { line, message } = e.value;
          if (line < 1 || line > tr.state.doc.lines) return V.Decoration.none;
          const l = tr.state.doc.line(line);
          const ranges = [V.Decoration.line({ class: 'cm-error-line' }).range(l.from)];
          if (message) ranges.push(V.Decoration.widget({ widget: new ErrorWidget(message), block: true, side: 1 }).range(l.to));
          return V.Decoration.set(ranges);
        }
        return tr.docChanged ? deco.map(tr.changes) : deco;
      },
      provide: (f) => V.EditorView.decorations.from(f),
    });

    this.highlightStyle = L.HighlightStyle.define([
      { tag: t.keyword, color: 'var(--syn-keyword)' },
      { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
      { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--syn-number)' },
      { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--syn-comment)', fontStyle: 'italic' },
      { tag: t.standard(t.variableName), color: 'var(--syn-builtin)' },
      { tag: t.special(t.variableName), color: 'var(--syn-special)', fontStyle: 'italic' },
      { tag: t.propertyName, color: 'var(--syn-property)' },
      { tag: t.definition(t.variableName), color: 'var(--syn-function)' },
      { tag: [t.typeName, t.className], color: 'var(--syn-type)' },
      { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--syn-operator)' },
      { tag: t.variableName, color: 'var(--syn-variable)' },
      { tag: t.invalid, color: 'var(--danger)' },
    ]);

    this.theme = V.EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--fg)', fontSize: 'var(--editor-font-size, 13.5px)' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
      '.cm-content': { caretColor: 'var(--fg)', padding: '8px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--cm-selection) !important' },
      '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--fg-subtle)', border: 'none', paddingRight: '4px' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
      '.cm-activeLine': { backgroundColor: 'var(--cm-active-line)' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--fg-muted)', padding: '0 6px', borderRadius: '4px' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--cm-bracket)', outline: '1px solid var(--cm-bracket-outline)' },
      '.cm-nonmatchingBracket': { color: 'var(--danger)' },
      '.cm-searchMatch': { backgroundColor: 'var(--cm-search)', outline: '1px solid var(--cm-search-outline)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--cm-search-selected)' },
      '.cm-selectionMatch': { backgroundColor: 'var(--cm-selection-match)' },
      '.cm-tooltip': { backgroundColor: 'var(--panel-elev)', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: '8px', boxShadow: 'var(--shadow)', overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', maxHeight: '18em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px 3px 4px !important', lineHeight: '1.5' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--active)', color: 'var(--fg)' },
      '.cm-completionDetail': { color: 'var(--fg-muted)', fontStyle: 'normal', marginLeft: '0.8em' },
      '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent-text)', fontWeight: '600' },
      '.cm-completionInfo': { padding: '8px 10px', maxWidth: '320px', fontFamily: 'var(--font-ui)', fontSize: '12.5px', lineHeight: '1.45' },
      '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--fg)', borderColor: 'var(--border)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-ui)', fontSize: '12.5px' },
      '.cm-panel.cm-search input, .cm-panel.cm-gotoLine input': { background: 'var(--input-bg)', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: '5px', padding: '3px 6px', fontFamily: 'inherit', fontSize: '12.5px' },
      '.cm-panel.cm-search button, .cm-panel.cm-gotoLine button': { background: 'var(--panel-elev)', backgroundImage: 'none', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: '5px', padding: '3px 8px', fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer' },
      '.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--fg-muted)' },
      '.cm-panel button[name=close]': { color: 'var(--fg-muted)', fontSize: '18px', right: '8px', top: '4px' },
      '.cm-error-line': { backgroundColor: 'var(--error-line-bg)', boxShadow: 'inset 3px 0 0 var(--danger)' },
      '.cm-error-widget': { margin: '2px 0 6px', padding: '6px 10px 6px 12px', borderLeft: '3px solid var(--danger)', backgroundColor: 'var(--error-widget-bg)', color: 'var(--error-fg)', fontFamily: 'var(--font-mono)', fontSize: '12px', whiteSpace: 'pre-wrap', borderRadius: '0 6px 6px 0' },
    });

    const { lua } = cm.modes.lua;
    this.languages = {
      lua: L.StreamLanguage.define(luaMode(lua)),
      glsl: L.StreamLanguage.define(cm.modes.clike.shader),
      json: L.StreamLanguage.define(cm.modes.javascript.json),
    };

    this.view = new V.EditorView({ parent });
    this.view.dom.hidden = true;
  }

  extensions(path) {
    const { state: S, view: V, language: L, commands: C, search: Se, autocomplete: A } = this.cm;
    const lang = languageOf(path);
    return [
      this.prefsCompartment.of(this.prefExtensions(path)),
      V.highlightSpecialChars(),
      C.history(),
      L.foldGutter({ openText: '▾', closedText: '▸' }),
      V.drawSelection(),
      V.dropCursor(),
      S.EditorState.allowMultipleSelections.of(true),
      L.indentOnInput(),
      L.syntaxHighlighting(this.highlightStyle),
      L.bracketMatching(),
      V.rectangularSelection(),
      V.crosshairCursor(),
      Se.highlightSelectionMatches(),
      Se.search({ top: true }),
      V.keymap.of([
        ...A.closeBracketsKeymap,
        ...C.defaultKeymap,
        ...Se.searchKeymap,
        ...C.historyKeymap,
        ...L.foldKeymap,
        ...A.completionKeymap,
        C.indentWithTab,
        { key: 'Mod-g', run: Se.gotoLine },
        { key: 'Mod-h', run: Se.openSearchPanel },
      ]),
      this.errorField,
      this.theme,
      lang ? this.languages[lang] : [],
      V.EditorView.updateListener.of((u) => {
        if (u.docChanged) this.opts.onChange?.(this.current);
        if (u.docChanged || u.selectionSet) this.reportCursor(u.state);
      }),
    ];
  }

  /** The parts of the configuration that follow the user's settings. */
  prefExtensions(path) {
    const { state: S, view: V, language: L, autocomplete: A } = this.cm;
    const p = this.prefs;
    const lang = languageOf(path);
    const complete = (ctx) => (this.completionSource ? this.completionSource(ctx, path) : null);
    return [
      p.lineNumbers ? [V.lineNumbers(), V.highlightActiveLineGutter()] : [],
      p.highlightActiveLine ? V.highlightActiveLine() : [],
      p.wordWrap ? V.EditorView.lineWrapping : [],
      p.showWhitespace ? [V.highlightWhitespace(), V.highlightTrailingWhitespace()] : [],
      p.closeBrackets ? A.closeBrackets() : [],
      A.autocompletion({
        override: lang === 'lua' ? [complete] : [A.completeAnyWord],
        icons: true,
        activateOnTyping: p.autocomplete,
      }),
      L.indentUnit.of(p.insertSpaces ? ' '.repeat(p.tabSize) : '\t'),
      S.EditorState.tabSize.of(p.tabSize),
    ];
  }

  applySettings(s) {
    const keys = Object.keys(this.prefs);
    if (keys.every((k) => this.prefs[k] === s[k])) return;
    for (const k of keys) if (k in s) this.prefs[k] = s[k];
    this.stash();
    for (const [path, st] of this.states) {
      const next = st.update({ effects: this.prefsCompartment.reconfigure(this.prefExtensions(path)) }).state;
      this.states.set(path, next);
      if (path === this.current) this.view.setState(next);
    }
  }

  /** Trims trailing whitespace and/or adds a final newline, in place. */
  normalize(path, { trim = false, finalNewline = false } = {}) {
    const st = this.stateOf(path);
    if (!st) return;
    const doc = st.doc;
    const changes = [];
    if (trim) {
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const m = /[ \t]+$/.exec(line.text);
        if (m) changes.push({ from: line.from + m.index, to: line.to });
      }
    }
    if (finalNewline && doc.length > 0 && doc.sliceString(doc.length - 1) !== '\n') changes.push({ from: doc.length, insert: '\n' });
    if (!changes.length) return;
    const tr = { changes };
    if (path === this.current) this.view.dispatch(tr);
    else this.states.set(path, st.update(tr).state);
  }

  /** Refreshes layout after the font size (a CSS variable) changes. */
  remeasure() { this.view.requestMeasure(); }

  openGotoLine() { if (this.current) this.cm.search.gotoLine(this.view); }

  reportCursor(state) {
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    this.opts.onCursor?.(line.number, pos - line.from + 1, state.selection.ranges.length);
  }

  stash() {
    if (this.current && this.states.has(this.current)) this.states.set(this.current, this.view.state);
  }

  has(path) { return this.states.has(path); }

  open(path, text) {
    if (path !== this.current) this.rememberScroll();
    this.stash();
    if (!this.states.has(path)) {
      this.states.set(path, this.cm.state.EditorState.create({ doc: text ?? '', extensions: this.extensions(path) }));
    }
    this.current = path;
    this.view.setState(this.states.get(path));
    this.view.dom.hidden = false;
    this.reportCursor(this.view.state);
    if (this.scrollPositions?.has(path)) {
      const top = this.scrollPositions.get(path);
      requestAnimationFrame(() => { this.view.scrollDOM.scrollTop = top; });
    }
  }

  hide() {
    this.rememberScroll();
    this.stash();
    this.view.dom.hidden = true;
    this.current = null;
  }

  rememberScroll() {
    if (!this.current) return;
    (this.scrollPositions ??= new Map()).set(this.current, this.view.scrollDOM.scrollTop);
  }

  stateOf(path) {
    return path === this.current ? this.view.state : this.states.get(path);
  }

  getText(path) {
    return this.stateOf(path)?.doc.toString();
  }

  setText(path, text) {
    const st = this.stateOf(path);
    if (!st) return;
    const tr = { changes: { from: 0, to: st.doc.length, insert: text } };
    if (path === this.current) this.view.dispatch(tr);
    else this.states.set(path, st.update(tr).state);
  }

  close(path) {
    if (path === this.current) this.hide();
    this.states.delete(path);
    this.scrollPositions?.delete(path);
  }

  rename(from, to) {
    this.stash();
    const st = this.states.get(from);
    if (!st) return;
    this.states.delete(from);
    // Rebuild with the new file's language but keep text and selection.
    const fresh = this.cm.state.EditorState.create({ doc: st.doc, selection: st.selection, extensions: this.extensions(to) });
    this.states.set(to, fresh);
    if (this.current === from) {
      this.current = to;
      this.view.setState(fresh);
    }
  }

  setError(path, line, message) {
    const effects = this.setErrorEffect.of({ line, message });
    if (path === this.current) this.view.dispatch({ effects });
    else if (this.states.has(path)) this.states.set(path, this.states.get(path).update({ effects }).state);
  }

  clearErrors() {
    const effects = this.setErrorEffect.of(null);
    for (const path of this.states.keys()) {
      if (path === this.current) this.view.dispatch({ effects });
      else this.states.set(path, this.states.get(path).update({ effects }).state);
    }
  }

  gotoLine(line, col = 1) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
    this.view.dispatch({ selection: { anchor: pos }, effects: this.cm.view.EditorView.scrollIntoView(pos, { y: 'center' }) });
    this.view.focus();
  }

  focus() { this.view.focus(); }

  openSearch() { this.cm.search.openSearchPanel(this.view); }
}

// ---------------------------------------------------------------------------
// Plain textarea fallback

class TextareaEditor {
  constructor(parent, opts) {
    this.kind = 'textarea';
    this.opts = opts;
    this.texts = new Map();
    this.current = null;
    this.wrap = h('div', { class: 'fallback-wrap', hidden: true });
    this.notice = h('div', { class: 'fallback-notice' }, 'The code editor could not be loaded from the CDN, so this is a plain text editor. Running, saving and exporting still work.');
    this.errorBar = h('button', { type: 'button', class: 'fallback-error', hidden: true });
    this.ta = h('textarea', {
      class: 'fallback-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Code editor',
    });
    this.wrap.append(this.notice, this.errorBar, this.ta);
    parent.append(this.wrap);
    this.errors = new Map();

    this.ta.addEventListener('input', () => {
      if (!this.current) return;
      this.texts.set(this.current, this.ta.value);
      this.opts.onChange?.(this.current);
    });
    const cursor = () => {
      const before = this.ta.value.slice(0, this.ta.selectionStart);
      const lines = before.split('\n');
      this.opts.onCursor?.(lines.length, lines[lines.length - 1].length + 1, 1);
    };
    this.ta.addEventListener('keyup', cursor);
    this.ta.addEventListener('click', cursor);
    this.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en, value } = this.ta;
        this.ta.value = value.slice(0, s) + '  ' + value.slice(en);
        this.ta.selectionStart = this.ta.selectionEnd = s + 2;
        this.ta.dispatchEvent(new Event('input'));
      }
    });
    this.errorBar.addEventListener('click', () => {
      const err = this.errors.get(this.current);
      if (err) this.gotoLine(err.line);
    });
  }

  has(path) { return this.texts.has(path); }

  open(path, text) {
    if (!this.texts.has(path)) this.texts.set(path, text ?? '');
    this.current = path;
    this.ta.value = this.texts.get(path);
    this.wrap.hidden = false;
    this.showError();
  }

  hide() {
    this.wrap.hidden = true;
    this.current = null;
  }

  getText(path) { return this.texts.get(path); }

  setText(path, text) {
    this.texts.set(path, text);
    if (path === this.current) this.ta.value = text;
  }

  close(path) {
    if (path === this.current) this.hide();
    this.texts.delete(path);
  }

  rename(from, to) {
    if (!this.texts.has(from)) return;
    this.texts.set(to, this.texts.get(from));
    this.texts.delete(from);
    if (this.current === from) this.current = to;
  }

  showError() {
    const err = this.errors.get(this.current);
    this.errorBar.hidden = !err;
    if (err) this.errorBar.textContent = `Line ${err.line}: ${err.message || 'error'}`;
  }

  setError(path, line, message) {
    this.errors.set(path, { line, message });
    if (path === this.current) this.showError();
  }

  clearErrors() {
    this.errors.clear();
    this.showError();
  }

  gotoLine(line) {
    const lines = this.ta.value.split('\n');
    const n = Math.max(1, Math.min(line, lines.length));
    let pos = 0;
    for (let i = 0; i < n - 1; i++) pos += lines[i].length + 1;
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos + lines[n - 1].length);
    const lineHeight = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    this.ta.scrollTop = Math.max(0, (n - 5) * lineHeight);
  }

  focus() { this.ta.focus(); }

  applySettings(s) {
    this.ta.style.tabSize = String(s.tabSize);
    this.ta.wrap = s.wordWrap ? 'soft' : 'off';
    this.ta.style.whiteSpace = s.wordWrap ? 'pre-wrap' : 'pre';
  }

  normalize(path, { trim = false, finalNewline = false } = {}) {
    let text = this.getText(path);
    if (text == null) return;
    if (trim) text = text.replace(/[ \t]+$/gm, '');
    if (finalNewline && text && !text.endsWith('\n')) text += '\n';
    if (text !== this.getText(path)) this.setText(path, text);
  }

  remeasure() {}

  openGotoLine() {
    const line = Number(prompt('Go to line'));
    if (line > 0) this.gotoLine(line);
  }

  openSearch() { /* the browser's own find works here */ }
}
