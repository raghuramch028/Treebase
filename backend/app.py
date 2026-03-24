"""
app.py
------
Flask server for Treebase.
Run: python app.py
"""

import os
import sys
import subprocess
import tempfile

from flask import Flask, request, jsonify, render_template
from backend.vcs_engine import VCSEngine

app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static"
)

vcs = VCSEngine()


# ── Pages ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── State ──────────────────────────────────────────────────────────────────

@app.route("/api/state")
def get_state():
    return jsonify(vcs.get_state())


# ── File management ────────────────────────────────────────────────────────

@app.route("/api/files/add", methods=["POST"])
def add_file():
    return jsonify(vcs.add_file(request.json.get("filename", "")))


@app.route("/api/files/delete", methods=["POST"])
def delete_file():
    return jsonify(vcs.delete_file(request.json.get("filename", "")))


@app.route("/api/files/rename", methods=["POST"])
def rename_file():
    d = request.json
    return jsonify(vcs.rename_file(d.get("old_name", ""), d.get("new_name", "")))


@app.route("/api/files/switch", methods=["POST"])
def switch_file():
    return jsonify(vcs.switch_file(request.json.get("filename", "")))


@app.route("/api/files/update", methods=["POST"])
def update_file():
    d = request.json
    return jsonify(vcs.update_content(d.get("filename", ""), d.get("content", "")))


@app.route("/api/files/revert", methods=["POST"])
def revert_file():
    return jsonify(vcs.revert_file(request.json.get("filename", "")))


# ── Undo / Redo ────────────────────────────────────────────────────────────

@app.route("/api/undo", methods=["POST"])
def undo():
    return jsonify(vcs.undo())


@app.route("/api/redo", methods=["POST"])
def redo():
    return jsonify(vcs.redo())


# ── VCS ────────────────────────────────────────────────────────────────────

@app.route("/api/commit", methods=["POST"])
def commit():
    return jsonify(vcs.commit(request.json.get("message", "")))


@app.route("/api/branch", methods=["POST"])
def branch():
    return jsonify(vcs.create_branch(request.json.get("name", "")))


@app.route("/api/merge", methods=["POST"])
def merge():
    return jsonify(vcs.merge_branch(request.json.get("name", "")))


@app.route("/api/checkout/commit", methods=["POST"])
def checkout_commit():
    return jsonify(vcs.checkout_commit(request.json.get("commit_id", "")))


@app.route("/api/checkout/branch", methods=["POST"])
def checkout_branch():
    return jsonify(vcs.checkout_branch(request.json.get("name", "")))


# ── Tree ───────────────────────────────────────────────────────────────────

@app.route("/api/tree")
def get_tree():
    return jsonify({"mermaid": vcs.get_tree_mermaid()})


# ── Run code ───────────────────────────────────────────────────────────────

@app.route("/api/run", methods=["POST"])
def run_code():
    d        = request.json
    code     = d.get("code", "")
    filename = d.get("filename", "script.py")

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, os.path.basename(filename))
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        try:
            result = subprocess.run(
                [sys.executable, path],
                capture_output=True, text=True,
                timeout=10, cwd=tmp
            )
            return jsonify({
                "stdout":     result.stdout,
                "stderr":     result.stderr,
                "returncode": result.returncode
            })
        except subprocess.TimeoutExpired:
            return jsonify({"stdout": "", "stderr": "Timed out (10s limit).", "returncode": -1})
        except Exception as e:
            return jsonify({"stdout": "", "stderr": str(e), "returncode": -1})




@app.route("/api/history")
def get_history():
    return jsonify({"history": vcs.get_full_history()})

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    port  = int(os.environ.get("PORT", 5000))
    app.run(debug=debug, port=port)
