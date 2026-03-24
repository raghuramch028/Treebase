"""
vcs_engine.py
-------------
Core VCS engine for Treebase.

Data structures per file:
  N-ary Tree  — commit history with branching
  Hash Map    — commit_map {id: node}  O(1) checkout
  Hash Map    — file_registry {name: FileVCS}
  Deque       — activity log, maxlen 7
  Deque       — undo_stack, redo_stack (maxlen 50, O(1) eviction)
"""

import uuid
from datetime import datetime
from collections import deque
import pickle
import os
import sqlite3

DATABASE_URL = os.environ.get("DATABASE_URL")

def get_db_connection():
    if DATABASE_URL:
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    else:
        return sqlite3.connect(".treebase_store.db")

def init_db():
    conn = get_db_connection()
    cur = conn.cursor()
    if DATABASE_URL:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id VARCHAR(255) PRIMARY KEY,
                vcs_data BYTEA,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    else:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id TEXT PRIMARY KEY,
                vcs_data BLOB,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    conn.commit()
    conn.close()

init_db()

UNDO_LIMIT = 50


class CommitNode:
    """Single node in the N-ary commit tree."""

    def __init__(self, message, content, parent=None, branch="main"):
        self.id       = str(uuid.uuid4()).split('-')[0]
        self.message  = message
        self.timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.content  = content
        self.parent   = parent
        self.children = []          # N-ary: multiple children = branches
        self.branch   = branch
        self.merged_from = None



class FileVCS:
    """Isolated VCS instance for one file."""

    def __init__(self, filename):
        self.filename       = filename
        self.content        = ""
        self.current_branch = "main"
        self.branches       = {}        # Hash Map: branch_name -> CommitNode
        self.commit_map     = {}        # Hash Map: commit_id   -> CommitNode
        self.activity_log   = deque(maxlen=7)
        self.undo_stack     = deque(maxlen=UNDO_LIMIT)   # LIFO, O(1) eviction
        self.redo_stack     = deque(maxlen=UNDO_LIMIT)   # LIFO, O(1) eviction
        self.root           = None
        self.head           = None

    # ── Content ──────────────────────────────────────────────────────────

    def update_content(self, content):
        self.undo_stack.append(self.content)
        # deque with maxlen automatically evicts oldest entry — O(1)
        self.redo_stack.clear()
        self.content = content

    def undo(self):
        if not self.undo_stack:
            return {"success": False, "error": "Nothing to undo."}
        self.redo_stack.append(self.content)
        self.content = self.undo_stack.pop()
        return {"success": True, "content": self.content}

    def redo(self):
        if not self.redo_stack:
            return {"success": False, "error": "Nothing to redo."}
        self.undo_stack.append(self.content)
        self.content = self.redo_stack.pop()
        return {"success": True, "content": self.content}

    def revert_to_head(self):
        """Discard dirty changes — restore last committed content."""
        current_head = self.head
        if current_head is not None:
            self.content = current_head.content
        else:
            self.content = ""
        self.undo_stack.clear()
        self.redo_stack.clear()
        return {"success": True}

    # ── VCS ───────────────────────────────────────────────────────────────

    def commit(self, message):
        if not message.strip():
            return {"success": False, "error": "Commit message cannot be empty."}

        node = CommitNode(
            message=message,
            content=self.content,
            parent=self.head,
            branch=self.current_branch
        )

        if self.head is None:
            self.root = node
        else:
            self.head.children.append(node)

        self.head = node
        self.branches[self.current_branch] = node
        self.commit_map[node.id] = node
        self.activity_log.appendleft(node)
        self.undo_stack.clear()
        self.redo_stack.clear()

        return {
            "success": True,
            "commit": self._ser(node),
            "log":    self._ser_log()
        }

    def create_branch(self, name):
        if self.head is None:
            return {"success": False, "error": "Make at least one commit before branching."}
        if name in self.branches:
            return {"success": False, "error": f"Branch '{name}' already exists."}
        self.branches[name] = self.head
        self.current_branch = name
        return {
            "success":  True,
            "branch":   name,
            "branches": list(self.branches.keys())
        }

    def checkout_commit(self, commit_id):
        if commit_id not in self.commit_map:
            return {"success": False, "error": "Commit not found."}
        node = self.commit_map[commit_id]   # O(1) hash map lookup
        self.head           = node
        self.current_branch = node.branch
        self.content        = node.content
        self.undo_stack.clear()
        self.redo_stack.clear()
        return {"success": True, "content": self.content}

    def checkout_branch(self, name):
        if name not in self.branches:
            return {"success": False, "error": f"Branch '{name}' not found."}
        node = self.branches[name]
        self.head           = node
        self.current_branch = name
        self.content        = node.content
        self.undo_stack.clear()
        self.redo_stack.clear()
        return {"success": True, "content": self.content}

    def rename(self, new_name):
        self.filename = new_name

    def _find_lca(self, node_a, node_b):
        ancestors = set()
        curr = node_a
        while curr:
            ancestors.add(curr.id)
            curr = curr.parent
        curr = node_b
        while curr:
            if curr.id in ancestors:
                return curr
            curr = curr.parent
        return None

    def merge_branch(self, target_branch):
        if target_branch not in self.branches:
            return {"success": False, "error": f"Branch '{target_branch}' not found."}
        if self.current_branch == target_branch:
             return {"success": False, "error": "Cannot merge branch into itself."}
        
        target_head = self.branches[target_branch]
        merge_msg = f"Merge branch '{target_branch}' into '{self.current_branch}'"
        
        lca = self._find_lca(self.head, target_head)
        base_content = lca.content if lca else ""
        mine_content = self.content
        theirs_content = target_head.content

        merged_content = ""
        if mine_content == theirs_content:
            merged_content = mine_content
        else:
            try:
                import merge3
                m3 = merge3.Merge3(
                    base_content.splitlines(keepends=True),
                    mine_content.splitlines(keepends=True),
                    theirs_content.splitlines(keepends=True)
                )
                
                merged_lines = []
                for chunk in m3.merge_groups():
                    if chunk[0] == 'conflict':
                        merged_lines.append(f"<<<<<<< {self.current_branch}\n")
                        merged_lines.extend(chunk[2]) # mine
                        if chunk[2] and not chunk[2][-1].endswith('\n'): merged_lines.append('\n')
                        merged_lines.append("=======\n")
                        merged_lines.extend(chunk[3]) # theirs
                        if chunk[3] and not chunk[3][-1].endswith('\n'): merged_lines.append('\n')
                        merged_lines.append(f">>>>>>> {target_branch}\n")
                    else:
                        merged_lines.extend(chunk[1])
                        
                merged_content = "".join(merged_lines)
            except ImportError:
                merged_content = self.content + f"\n\n# --- Merged from {target_branch} ---\n" + target_head.content
        
        node = CommitNode(
            message=merge_msg,
            content=merged_content,
            parent=self.head,
            branch=self.current_branch
        )
        node.merged_from = target_head.id
        
        if self.head is None:
            self.root = node
        else:
            self.head.children.append(node)
            
        target_head.children.append(node)
        
        self.head = node
        self.branches[self.current_branch] = node
        self.commit_map[node.id] = node
        self.content = merged_content
        self.activity_log.appendleft(node)
        self.undo_stack.clear()
        self.redo_stack.clear()
        
        return {
            "success": True,
            "commit": self._ser(node),
            "log":    self._ser_log(),
            "content": self.content
        }

    # ── Tree (DFS) ────────────────────────────────────────────────────────

    @staticmethod
    def _mermaid_safe(text):
        """Escape characters that break mermaid node labels inside double-quoted strings."""
        return (text
                .replace("&", "&amp;")
                .replace('"', "#quot;")
                .replace("[", "&#91;")
                .replace("]", "&#93;"))

    def get_tree_mermaid(self):
        if self.root is None:
            return 'graph TD\n    A["No commits yet"]'

        lines   = ["graph TD"]
        visited = set()

        def dfs(node):
            if node is None or node.id in visited:
                return
            visited.add(node.id)
            safe_msg = FileVCS._mermaid_safe(node.message)
            safe_br  = FileVCS._mermaid_safe(node.branch)
            label = f"{safe_msg}<br/>{safe_br} · {node.id}"
            lines.append(f'    {node.id}["{label}"]')
            for child in node.children:
                lines.append(f"    {node.id} --> {child.id}")
                dfs(child)

        dfs(self.root)
        current_head = self.head
        if current_head is not None:
            lines.append(
                f"    style {current_head.id} fill:#6366f1,color:#fff,stroke:#4f46e5,stroke-width:2px"
            )
        return "\n".join(lines)

    # ── Serialize ─────────────────────────────────────────────────────────

    def _ser(self, node):
        return {
            "id":        node.id,
            "message":   node.message,
            "timestamp": node.timestamp,
            "branch":    node.branch,
        }

    def _ser_log(self):
        return [self._ser(n) for n in self.activity_log]

    def get_state(self):
        return {
            "filename":       self.filename,
            "content":        self.content,
            "current_branch": self.current_branch,
            "branches":       list(self.branches.keys()),
            "head":           self._ser(self.head) if self.head else None,
            "activity_log":   self._ser_log(),
            "has_commits":    self.head is not None,
        }


    def get_full_history(self):
        """Return ALL commits in DFS order."""
        if self.root is None:
            return []
        result, visited = [], set()
        def dfs(node):
            if node.id in visited:
                return
            visited.add(node.id)
            result.append(self._ser(node))
            for child in node.children:
                dfs(child)
        dfs(self.root)
        return result

class VCSEngine:
    """
    Top-level manager per user session.
    file_registry: Hash Map {filename -> FileVCS}
    """

    def __init__(self, session_id):
        self.session_id = session_id
        self.file_registry = {}     # Hash Map
        self.active_file   = None

    @classmethod
    def load_from_db(cls, session_id):
        engine = cls(session_id)
        conn = get_db_connection()
        cur = conn.cursor()
        
        try:
            if DATABASE_URL:
                cur.execute("SELECT vcs_data FROM user_sessions WHERE session_id = %s", (session_id,))
            else:
                cur.execute("SELECT vcs_data FROM user_sessions WHERE session_id = ?", (session_id,))
            
            row = cur.fetchone()
            if row and row[0]:
                blob = row[0]
                if not isinstance(blob, bytes):
                    if hasattr(blob, 'tobytes'): blob = blob.tobytes()
                    else: blob = bytes(blob)
                data = pickle.loads(blob)
                engine.file_registry = data.get("registry", {})
                engine.active_file = data.get("active", None)
        finally:
            conn.close()
            
        return engine

    def save_to_db(self):
        data = {"registry": self.file_registry, "active": self.active_file}
        blob = pickle.dumps(data)
        conn = get_db_connection()
        cur = conn.cursor()
        
        try:
            if DATABASE_URL:
                import psycopg2
                cur.execute("""
                    INSERT INTO user_sessions (session_id, vcs_data)
                    VALUES (%s, %s)
                    ON CONFLICT (session_id) DO UPDATE SET vcs_data = EXCLUDED.vcs_data, updated_at = CURRENT_TIMESTAMP
                """, (self.session_id, psycopg2.Binary(blob)))
            else:
                cur.execute("""
                    REPLACE INTO user_sessions (session_id, vcs_data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, (self.session_id, blob))
            conn.commit()
        finally:
            conn.close()

    def _active(self):
        return self.file_registry[self.active_file]

    # ── File management ───────────────────────────────────────────────────

    def add_file(self, filename):
        filename = filename.strip()
        if not filename:
            return {"success": False, "error": "Filename cannot be empty."}
        if filename in self.file_registry:
            return {"success": False, "error": f"'{filename}' already exists."}
        self.file_registry[filename] = FileVCS(filename)
        self.active_file = filename
        self.save_to_db()
        return self._full_state()

    def delete_file(self, filename):
        if filename not in self.file_registry:
            return {"success": False, "error": "File not found."}
        keys = list(self.file_registry.keys())
        idx  = keys.index(filename)
        del self.file_registry[filename]
        if self.active_file == filename:
            remaining = list(self.file_registry.keys())
            self.active_file = remaining[max(0, idx - 1)] if remaining else None
        self.save_to_db()
        return self._full_state()

    def rename_file(self, old_name, new_name):
        new_name = new_name.strip()
        if old_name not in self.file_registry:
            return {"success": False, "error": "File not found."}
        if not new_name:
            return {"success": False, "error": "New name cannot be empty."}
        if new_name in self.file_registry:
            return {"success": False, "error": f"'{new_name}' already exists."}
        fvcs = self.file_registry.pop(old_name)
        fvcs.rename(new_name)
        self.file_registry[new_name] = fvcs
        if self.active_file == old_name:
            self.active_file = new_name
        self.save_to_db()
        return self._full_state()

    def switch_file(self, filename):
        if filename not in self.file_registry:
            return {"success": False, "error": "File not found."}
        self.active_file = filename
        self.save_to_db()
        return self._full_state()

    def update_content(self, filename, content):
        if filename not in self.file_registry:
            return {"success": False, "error": "File not found."}
        self.file_registry[filename].update_content(content)
        self.save_to_db()
        return {"success": True}

    def revert_file(self, filename):
        if filename not in self.file_registry:
            return {"success": False, "error": "File not found."}
        res = self.file_registry[filename].revert_to_head()
        self.save_to_db()
        return res

    # ── Undo / Redo ───────────────────────────────────────────────────────

    def undo(self):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().undo()
        self.save_to_db()
        return res

    def redo(self):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().redo()
        self.save_to_db()
        return res

    # ── VCS ───────────────────────────────────────────────────────────────

    def commit(self, message):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().commit(message)
        self.save_to_db()
        return res

    def create_branch(self, name):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().create_branch(name)
        self.save_to_db()
        return res

    def merge_branch(self, target_branch):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().merge_branch(target_branch)
        self.save_to_db()
        return res

    def checkout_commit(self, commit_id):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().checkout_commit(commit_id)
        self.save_to_db()
        return res

    def checkout_branch(self, name):
        if not self.active_file:
            return {"success": False, "error": "No file open."}
        res = self._active().checkout_branch(name)
        self.save_to_db()
        return res

    def get_tree_mermaid(self):
        if not self.active_file:
            return 'graph TD\n    A["No files yet"]'
        return self._active().get_tree_mermaid()

    # ── State ─────────────────────────────────────────────────────────────

    def _full_state(self):
        return {
            "success":     True,
            "files":       list(self.file_registry.keys()),
            "active_file": self.active_file,
            "vcs_state":   self._active().get_state() if self.active_file else None,
        }

    def get_state(self):
        return self._full_state()

    # ── Full file history (all commits via DFS) ───────────────────────────
    def get_full_history(self) -> list:
        if not self.active_file:
            return []
        return self._active().get_full_history()

