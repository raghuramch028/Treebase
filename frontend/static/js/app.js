/**
 * app.js — Treebase UI
 */

let _dirty = false;
let _files = [];
let _active = null;

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  mermaid.initialize({ startOnLoad: false, theme: "dark" });
  initEditor();
  renderAll(await api.state());
});

// ── Master render ─────────────────────────────────────────────────────────
function renderAll(state) {
  if (!state) return;
  _files  = state.files  || [];
  _active = state.active_file || null;

  renderFiles(_files, _active);

  if (!_active || !state.vcs_state) {
    setEditorContent("");
    setEditorEnabled(false);
    setText("active-filename", "no file open");
    setText("branch-badge", "—");
    setHtml("activity-log", `<li class="empty-msg">No files yet. Click + to create one.</li>`);
    setHtml("branch-list", "");
    _dirty = false;
    return;
  }

  const v = state.vcs_state;
  setEditorEnabled(true);
  setEditorContent(v.content);
  _dirty = false;
  setText("active-filename", _active);
  setText("branch-badge", v.current_branch);
  setText("tree-file-label", _active);
  renderLog(v.activity_log, v.head ? v.head.id : null);
  renderBranches(v.branches, v.current_branch);
}


// ── File sidebar ──────────────────────────────────────────────────────────
function renderFiles(files, active) {
  const ul = document.getElementById("file-list");
  ul.innerHTML = "";
  files.forEach(name => {
    const li = document.createElement("li");
    li.className = "file-item" + (name === active ? " active" : "");

    const lbl = document.createElement("span");
    lbl.className   = "file-label";
    lbl.textContent = "📄 " + name;
    lbl.onclick     = () => switchFile(name);

    const btns = document.createElement("span");
    btns.className = "file-btns";
    btns.append(_mkBtn("✎", "rename", () => renameFile(name)));
    btns.append(_mkBtn("✕", "delete", () => deleteFile(name)));

    li.append(lbl, btns);
    ul.appendChild(li);
  });
}

function _mkBtn(txt, cls, fn) {
  const b = document.createElement("button");
  b.className   = `file-btn ${cls}`;
  b.textContent = txt;
  b.onclick     = e => { e.stopPropagation(); fn(); };
  return b;
}

// ── Activity log ──────────────────────────────────────────────────────────
function renderLog(log, headId) {
  const ul = document.getElementById("activity-log");
  ul.innerHTML = "";
  if (!log || !log.length) {
    ul.innerHTML = `<li class="empty-msg">No commits yet.</li>`;
    return;
  }
  log.forEach(c => {
    const li = document.createElement("li");
    li.className = "commit-item" + (c.id === headId ? " head" : "");
    li.innerHTML = `
      <div class="c-msg">${esc(c.message)}</div>
      <div class="c-meta">${c.id} · ${c.branch}</div>
      <div class="c-time">${c.timestamp}</div>`;
    li.onclick = () => checkoutCommit(c.id);
    ul.appendChild(li);
  });
}

// ── Branch list ───────────────────────────────────────────────────────────
function renderBranches(branches, current) {
  const ul = document.getElementById("branch-list");
  ul.innerHTML = "";
  (branches || []).forEach(b => {
    const li = document.createElement("li");
    li.className   = "branch-item" + (b === current ? " active" : "");
    li.textContent = "⎇ " + b;
    li.onclick     = () => checkoutBranch(b);
    ul.appendChild(li);
  });
}

// ── File actions ──────────────────────────────────────────────────────────
async function addFile() {
  const name = prompt("New filename (e.g. main.py):");
  if (!name) return;
  const res = await api.addFile(name.trim());
  if (!res.success) return toast("❌ " + res.error);
  renderAll(res);
  toast("✓ Created " + res.active_file);
}

async function deleteFile(name) {
  if (!confirm(`Delete "${name}"? All commit history will be lost.`)) return;
  const res = await api.deleteFile(name);
  if (!res.success) return toast("❌ " + res.error);
  renderAll(res);
  toast("🗑 Deleted " + name);
}

async function renameFile(name) {
  const nw = prompt(`Rename "${name}" to:`, name);
  if (!nw || nw === name) return;
  const res = await api.renameFile(name, nw.trim());
  if (!res.success) return toast("❌ " + res.error);
  renderAll(res);
  toast("✎ Renamed to " + nw);
}

async function switchFile(name) {
  if (name === _active) return;
  if (_dirty) {
    const go = confirm("You have unsaved changes. Switch without committing?");
    if (!go) return;
    await api.revertFile(_active);
    _dirty = false;
  }
  const res = await api.switchFile(name);
  if (!res.success) return toast("❌ " + res.error);
  renderAll(res);
}

function markDirty() { _dirty = true; }

// ── Undo / Redo ───────────────────────────────────────────────────────────
async function doUndo() {
  const r = await api.undo();
  if (!r.success) return toast("Nothing to undo.");
  setEditorContent(r.content);
  toast("↩ Undone");
}
async function doRedo() {
  const r = await api.redo();
  if (!r.success) return toast("Nothing to redo.");
  setEditorContent(r.content);
  toast("↪ Redone");
}

// ── Commit ────────────────────────────────────────────────────────────────
async function doCommit() {
  const msg = document.getElementById("commit-msg").value.trim();
  if (!msg) return toast("❌ Enter a commit message.");
  if (!_active) return toast("❌ No file open.");
  clearTimeout(window._saveTimer);
  await api.updateFile(_active, getEditorContent());
  const r = await api.commit(msg);
  if (!r.success) return toast("❌ " + r.error);
  document.getElementById("commit-msg").value = "";
  _dirty = false;
  renderAll(await api.state());
  toast(`✓ Committed: "${msg}"`);
}

// ── Branch ────────────────────────────────────────────────────────────────
async function createBranch() {
  const name = document.getElementById("branch-input").value.trim();
  if (!name) return toast("❌ Enter a branch name.");
  const r = await api.branch(name);
  if (!r.success) return toast("❌ " + r.error);
  document.getElementById("branch-input").value = "";
  renderAll(await api.state());
  toast(`⎇ Branch "${name}" created`);
}

async function mergeBranch() {
  const b = prompt("Enter branch name to merge into current branch:");
  if (!b) return;
  const r = await api.merge(b.trim());
  if (!r.success) return toast("❌ " + r.error);
  _dirty = false;
  renderAll(await api.state());
  toast(`✓ Merged "${b}" into current`);
}

// ── Checkout ──────────────────────────────────────────────────────────────
async function checkoutCommit(id) {
  if (_dirty && !confirm("Unsaved changes. Checkout anyway?")) return;
  const r = await api.checkoutCommit(id);
  if (!r.success) return toast("❌ " + r.error);
  _dirty = false;
  renderAll(await api.state());
  toast("⏪ Checked out " + id);
}

async function checkoutBranch(name) {
  if (_dirty && !confirm("Unsaved changes. Switch branch anyway?")) return;
  const r = await api.checkoutBranch(name);
  if (!r.success) return toast("❌ " + r.error);
  _dirty = false;
  renderAll(await api.state());
  toast("⎇ Switched to " + name);
}

// ── Run ───────────────────────────────────────────────────────────────────
async function runCode() {
  const code = getEditorContent();
  const fn   = _active;
  const term = document.getElementById("terminal");
  if (!fn)                 { term.textContent = "No file open.";               term.style.color = "#858585"; return; }
  if (!code.trim())        { term.textContent = "Nothing to run.";             term.style.color = "#858585"; return; }
  if (!fn.endsWith(".py")) { term.textContent = `Only .py files can be run.`; term.style.color = "#f87171"; return; }
  term.textContent = "$ Running…"; term.style.color = "#858585";
  const r = await api.run(code, fn);
  let out = "";
  if (r.stdout) out += r.stdout;
  if (r.stderr) out += (out ? "\n── stderr ──\n" : "") + r.stderr;
  term.textContent = out || "(no output)";
  term.style.color = r.returncode === 0 ? "#ffffff" : "#f87171";
}

function clearTerminal() {
  const t = document.getElementById("terminal");
  t.textContent = ""; t.style.color = "#858585";
}

// ── Tree modal ────────────────────────────────────────────────────────────
async function openTree() {
  const modal   = document.getElementById("tree-modal");
  const content = document.getElementById("tree-content");
  modal.classList.remove("hidden");
  content.innerHTML = `<p style="color:#555;font-size:13px;font-family:'JetBrains Mono',monospace">Generating tree…</p>`;
  const r = await api.tree();
  content.innerHTML = `<div class="mermaid">${r.mermaid}</div>`;
  await mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
}
function closeTree() { document.getElementById("tree-modal").classList.add("hidden"); }

// ── History modal ─────────────────────────────────────────────────────────
async function openHistory() {
  if (!_active) return toast("❌ No file open.");
  const modal = document.getElementById("history-modal");
  const list  = document.getElementById("history-list");
  document.getElementById("history-filename").textContent = _active;
  modal.classList.remove("hidden");
  list.innerHTML = `<div style="padding:24px 16px;color:#555;font-size:12px;font-family:'JetBrains Mono',monospace">Loading…</div>`;

  const [stateRes, histRes] = await Promise.all([api.state(), api.getHistory()]);
  const headId = stateRes.vcs_state?.head?.id || null;

  if (!histRes.history || !histRes.history.length) {
    list.innerHTML = `<div style="padding:24px 16px;color:#555;font-size:12px;font-family:'JetBrains Mono',monospace">No commits yet for this file.</div>`;
    return;
  }

  list.innerHTML = "";
  histRes.history.forEach((c, i) => {
    const item = document.createElement("div");
    item.className = "history-item" + (c.id === headId ? " is-head" : "");
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#d4d4d4;font-weight:600">${esc(c.message)}</span>
        ${c.id === headId ? `<span style="font-size:9px;background:rgba(99,102,241,0.2);color:#a5b4fc;padding:1px 6px;border-radius:3px;font-family:'JetBrains Mono',monospace">HEAD</span>` : ""}
      </div>
      <div style="display:flex;gap:16px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#555">
        <span style="color:#6366f1">#${c.id}</span>
        <span>⎇ ${c.branch}</span>
        <span>${c.timestamp}</span>
        <span style="margin-left:auto;color:#444">#${i + 1}</span>
      </div>`;
    item.onclick = async () => {
      if (_dirty && !confirm("Unsaved changes. Checkout this commit anyway?")) return;
      closeHistory();
      const res = await api.checkoutCommit(c.id);
      if (!res.success) return toast("❌ " + res.error);
      _dirty = false;
      renderAll(await api.state());
      toast("⏪ Restored: " + c.message);
    };
    list.appendChild(item);
  });
}
function closeHistory() { document.getElementById("history-modal").classList.add("hidden"); }

// ── Toast ─────────────────────────────────────────────────────────────────
let _tt;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove("show"), 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function setText(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }
function setHtml(id, h) { const e = document.getElementById(id); if (e) e.innerHTML = h; }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
