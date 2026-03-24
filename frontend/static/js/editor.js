/**
 * editor.js — VSCode-style editor for Treebase
 *
 * Architecture:
 *   - A div with contenteditable=false acts as the colored highlight layer
 *   - A textarea sits exactly on top, with color:transparent so you see highlight through it
 *   - Caret and selection are from the textarea (native, reliable)
 *   - Line numbers are a separate scrolling column
 *   - Custom scrollbar via CSS
 */

const PAIRS   = { "(":")", "[":"]", "{":"}", '"':'"', "'":"'" };
const OPENERS = new Set(Object.keys(PAIRS));
const CLOSERS = new Set(Object.values(PAIRS));

function initEditor() {
  const wrapper = document.getElementById("editor-wrapper");
  wrapper.innerHTML = "";
  wrapper.style.cssText = "position:relative;display:flex;flex-direction:row;overflow:hidden;background:transparent;";

  // ── Line numbers pane ────────────────────────────────────────────────
  const linePane = document.createElement("div");
  linePane.id = "ed-lines";
  linePane.style.cssText = [
    "width:56px","min-width:56px","flex-shrink:0",
    "padding:14px 0","overflow:hidden",
    "background:transparent",
    "border-right:1px solid rgba(255,255,255,0.05)",
    "user-select:none","pointer-events:none",
    "font-family:'JetBrains Mono',Consolas,monospace",
    "font-size:14px","line-height:21px",
    "color:#858585","text-align:right",
    "box-sizing:border-box","position:relative","z-index:1"
  ].join(";");
  wrapper.appendChild(linePane);

  // ── Right pane (highlight + textarea) ────────────────────────────────
  const rightPane = document.createElement("div");
  rightPane.style.cssText = "position:relative;flex:1;overflow:hidden;";
  wrapper.appendChild(rightPane);

  // Highlight div (colored text, sits behind textarea)
  const hl = document.createElement("div");
  hl.id = "ed-highlight";
  hl.style.cssText = [
    "position:absolute","top:0","left:0","right:0","bottom:0",
    "padding:14px 0 14px 16px",
    "margin:0","overflow:hidden","pointer-events:none",
    "white-space:pre","word-break:normal","word-wrap:normal",
    "font-family:'JetBrains Mono',Consolas,monospace",
    "font-size:14px","line-height:21px",
    "tab-size:4","-moz-tab-size:4",
    "z-index:1","box-sizing:border-box"
  ].join(";");
  rightPane.appendChild(hl);

  // Textarea (transparent text on top — only caret and selection are visible)
  const ta = document.createElement("textarea");
  ta.id = "editor";
  ta.spellcheck = false;
  ta.autocomplete = "off";
  ta.autocorrect = "off";
  ta.autocapitalize = "off";
  ta.disabled = true;
  ta.style.cssText = [
    "position:absolute","top:0","left:0","right:0","bottom:0",
    "padding:14px 0 14px 16px",
    "margin:0","border:none","outline:none","resize:none",
    "background:transparent",
    "color:transparent",          // text invisible — highlight shows through
    "caret-color:#aeafad",        // VSCode cursor color
    "font-family:'JetBrains Mono',Consolas,monospace",
    "font-size:14px","line-height:21px",
    "tab-size:4","-moz-tab-size:4",
    "white-space:pre","overflow-wrap:normal",
    "overflow:auto","overflow-x:auto","overflow-y:auto",
    "opacity:1","cursor:not-allowed",
    "z-index:2","box-sizing:border-box",
    // Custom scrollbar
    "scrollbar-width:thin","scrollbar-color:#424242 #1e1e1e"
  ].join(";");
  rightPane.appendChild(ta);

  // ── Scrollbar styling via injected style ─────────────────────────────
  if (!document.getElementById("ed-scrollbar-style")) {
    const st = document.createElement("style");
    st.id = "ed-scrollbar-style";
    st.textContent = `
      #editor::-webkit-scrollbar { width:10px; height:10px; }
      #editor::-webkit-scrollbar-track { background:transparent; }
      #editor::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:4px; }
      #editor::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.2); }
      #editor::-webkit-scrollbar-corner { background:transparent; }
      #editor::selection { background:rgba(99,102,241,0.4); }
    `;
    document.head.appendChild(st);
  }

  // ── Sync scroll: textarea → highlight + line numbers ─────────────────
  ta.addEventListener("scroll", () => {
    hl.scrollTop      = ta.scrollTop;
    hl.scrollLeft     = ta.scrollLeft;
    linePane.scrollTop = ta.scrollTop;
  });

  // ── Input handler ─────────────────────────────────────────────────────
  ta.addEventListener("input", () => {
    _updateHighlight(ta.value);
    _updateLineNumbers(ta.value);
    if (typeof markDirty === "function") markDirty();
    clearTimeout(window._saveTimer);
    window._saveTimer = setTimeout(() => {
      if (_active && _active !== "no file open") api.updateFile(_active, ta.value);
    }, 400);
  });

  // ── Keyboard: smart indent, auto-close, tab ──────────────────────────
  ta.addEventListener("keydown", e => {
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;

    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const curLine   = v.slice(lineStart, s);
      const indent    = curLine.match(/^(\s*)/)[1];
      const extra     = curLine.trimEnd().endsWith(":") ? "    " : "";
      _ins(ta, "\n" + indent + extra, indent.length + extra.length + 1);
      return;
    }

    if (e.key === "Backspace" && s === en && s > 0) {
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const curLine   = v.slice(lineStart, s);
      if (/^ +$/.test(curLine) && curLine.length % 4 === 0) {
        e.preventDefault();
        const rm = Math.min(4, curLine.length);
        ta.value = v.slice(0, s - rm) + v.slice(s);
        ta.selectionStart = ta.selectionEnd = s - rm;
        ta.dispatchEvent(new Event("input", { bubbles:true }));
        return;
      }
    }

    if (OPENERS.has(e.key)) {
      const closer = PAIRS[e.key];
      if (e.key === closer && v[s] === closer && s === en) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = s + 1;
        return;
      }
      e.preventDefault();
      const sel = v.slice(s, en);
      _ins(ta, e.key + sel + closer, sel.length + 1);
      return;
    }

    if (CLOSERS.has(e.key) && v[s] === e.key && s === en) {
      e.preventDefault();
      ta.selectionStart = ta.selectionEnd = s + 1;
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      _ins(ta, "    ", 4);
      return;
    }
  });

  _updateHighlight("");
  _updateLineNumbers("");
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _ins(el, text, offset) {
  const s = el.selectionStart, e = el.selectionEnd, v = el.value;
  el.value = v.slice(0, s) + text + v.slice(e);
  el.selectionStart = el.selectionEnd = s + offset;
  el.dispatchEvent(new Event("input", { bubbles:true }));
}

function _updateHighlight(code) {
  const hl = document.getElementById("ed-highlight");
  const ta = document.getElementById("editor");
  if (!hl) return;
  hl.innerHTML = _highlight(code) + "\n";
  if (ta) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
}

function _updateLineNumbers(code) {
  const ln = document.getElementById("ed-lines");
  if (!ln) return;
  const count = code.split("\n").length;
  let html = "";
  for (let i = 1; i <= count; i++) {
    html += `<div style="line-height:21px;padding-right:12px;font-size:14px">${i}</div>`;
  }
  ln.innerHTML = html;
}

// ── Syntax highlighting — VSCode Dark+ exact ─────────────────────────────

/**
 * Apply a regex+replacement ONLY to plain-text regions of `html`,
 * skipping anything already inside a <b ...>...</b> span.
 * Prevents double-wrapping when later passes re-process already-colored text.
 */
function _applyOutside(html, regex, replacement) {
  // Split on existing <b...>...</b> tags — odd indices are the tagged spans
  const parts = html.split(/(<b[^>]*>[\s\S]*?<\/b>)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;           // inside a tag — leave untouched
    return part.replace(regex, replacement);
  }).join("");
}

function _highlight(raw) {
  // Step 1: escape HTML (whole string, safe — no tags yet)
  let o = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Step 2: triple-quoted strings first (multiline) — applied to plain text
  o = _applyOutside(o, /("""[\s\S]*?"""|'''[\s\S]*?''')/g,
    '<b style="color:#ce9178;font-weight:normal">$1</b>');

  // Step 3: single-line strings
  o = _applyOutside(o, /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    '<b style="color:#ce9178;font-weight:normal">$1</b>');

  // Step 4: comments — applied outside strings
  o = _applyOutside(o, /(#[^\n]*)/g,
    '<b style="color:#6a9955;font-weight:normal;font-style:italic">$1</b>');

  // Step 4b: decorators — BEFORE builtins, so @property isn't pre-consumed as a builtin
  o = _applyOutside(o, /(@[a-zA-Z_]\w*)/g,
    '<b style="color:#c586c0;font-weight:normal">$1</b>');

  // Step 5: numbers — outside strings/comments
  o = _applyOutside(o, /\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g,
    '<b style="color:#b5cea8;font-weight:normal">$1</b>');

  // Step 6: keywords (blue) — outside strings/comments/numbers
  const KW = ["False","None","True","and","as","assert","async","await",
    "break","class","continue","def","del","elif","else","except","finally",
    "for","from","global","if","import","in","is","lambda","nonlocal","not",
    "or","pass","raise","return","try","while","with","yield"];
  o = _applyOutside(o, new RegExp(`\\b(${KW.join("|")})\\b`,"g"),
    '<b style="color:#569cd6;font-weight:600">$1</b>');

  // Step 7: builtins (yellow-green) — outside all prior spans
  const BI = ["abs","all","any","bin","bool","bytes","callable","chr","dict",
    "dir","divmod","enumerate","eval","exec","filter","float","format",
    "frozenset","getattr","globals","hasattr","hash","help","hex","id",
    "input","int","isinstance","issubclass","iter","len","list","locals",
    "map","max","min","next","object","oct","open","ord","pow","print",
    "property","range","repr","reversed","round","set","setattr","slice",
    "sorted","staticmethod","str","sum","super","tuple","type","vars","zip"];
  o = _applyOutside(o, new RegExp(`\\b(${BI.join("|")})\\b`,"g"),
    '<b style="color:#dcdcaa;font-weight:normal">$1</b>');

  // Step 8: self / cls
  o = _applyOutside(o, /\b(self|cls)\b/g,
    '<b style="color:#9cdcfe;font-weight:normal">$1</b>');

  // Steps 9-11 match patterns that straddle existing tags intentionally,
  // so they use a targeted replacement that only names the identifier part.

  // Step 9: function name after def — only color the name token
  o = o.replace(/(<b[^>]*>def<\/b>)(\s+)([a-zA-Z_]\w*)/g,
    '$1$2<b style="color:#dcdcaa;font-weight:normal">$3</b>');

  // Step 10: class name after class
  o = o.replace(/(<b[^>]*>class<\/b>)(\s+)([a-zA-Z_]\w*)/g,
    '$1$2<b style="color:#4ec9b0;font-weight:normal">$3</b>');

  return o;
}

// ── Public API ────────────────────────────────────────────────────────────
function setEditorContent(content) {
  const ta = document.getElementById("editor");
  if (!ta) return;
  ta.value = content;
  _updateHighlight(content);
  _updateLineNumbers(content);
  ta.scrollTop = 0; ta.scrollLeft = 0;
  const hl = document.getElementById("ed-highlight");
  const ln = document.getElementById("ed-lines");
  if (hl) { hl.scrollTop = 0; hl.scrollLeft = 0; }
  if (ln) ln.scrollTop = 0;
}

function getEditorContent() {
  const ta = document.getElementById("editor");
  return ta ? ta.value : "";
}

function setEditorEnabled(enabled) {
  const ta = document.getElementById("editor");
  if (!ta) return;
  ta.disabled     = !enabled;
  ta.style.cursor = enabled ? "text" : "not-allowed";
  const hl = document.getElementById("ed-highlight");
  if (hl) hl.style.opacity = enabled ? "1" : "0.35";
  const ln = document.getElementById("ed-lines");
  if (ln) ln.style.opacity = enabled ? "1" : "0.35";
}
