/**
 * vcs.js — All API calls to Flask backend.
 * Exposes a single `api` object used throughout app.js.
 * Every call wrapped in try/catch — app never freezes on network error.
 */

const _http = {
  async get(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch(e) {
      console.error("GET failed:", path, e);
      return { success: false, error: "Network error. Is Flask running?" };
    }
  },
  async post(path, body) {
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch(e) {
      console.error("POST failed:", path, e);
      return { success: false, error: "Network error. Is Flask running?" };
    }
  }
};

// BUG1 FIX: define `api` object so app.js api.X() calls work
const api = {
  state:          ()               => _http.get("/api/state"),
  addFile:        (filename)       => _http.post("/api/files/add",    { filename }),
  deleteFile:     (filename)       => _http.post("/api/files/delete", { filename }),
  // BUG2/3 FIX: use correct param names matching app.py
  renameFile:     (old_name, new_name) => _http.post("/api/files/rename", { old_name, new_name }),
  switchFile:     (filename)       => _http.post("/api/files/switch", { filename }),
  updateFile:     (filename, content) => _http.post("/api/files/update", { filename, content }),
  revertFile:     (filename)       => _http.post("/api/files/revert", { filename }),
  undo:           ()               => _http.post("/api/undo",  {}),
  redo:           ()               => _http.post("/api/redo",  {}),
  commit:         (message)        => _http.post("/api/commit", { message }),
  // BUG2 FIX: send `name` not `branch_name` — matches app.py request.json.get("name")
  branch:         (name)           => _http.post("/api/branch", { name }),
  merge:          (name)           => _http.post("/api/merge", { name }),
  checkoutCommit: (commit_id)      => _http.post("/api/checkout/commit", { commit_id }),
  // BUG3 FIX: send `name` not `branch_name` — matches app.py request.json.get("name")
  checkoutBranch: (name)           => _http.post("/api/checkout/branch", { name }),
  tree:           ()               => _http.get("/api/tree"),
  run:            (code, filename) => _http.post("/api/run", { code, filename }),
  // BUG7 FIX: these are now on the api object
  getHistory:     ()               => _http.get("/api/history"),
};
