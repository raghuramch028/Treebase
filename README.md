# Treebase 🌳

Treebase is a fully-featured, custom Version Control System (VCS) and Code Editor built completely from scratch. It provides Git-like capabilities wrapped in a sleek, modern web interface.

🌐 **Live Demo:** [https://treebase.onrender.com](https://treebase.onrender.com)

## 🔐 Multi-Tenant Architecture
Treebase is designed from the ground up to be securely isolated. **There are no logins required.** 
When a user visits the URL, the Python backend automatically provisions an encrypted session ID and spins up an entirely private sandbox environment securely backed by a **PostgreSQL Database**! 

Every user gets their own files, their own commit history, and a completely private execution environment that absolutely no one else can see.

## 🚀 Key Features

- **Private In-Browser Sandbox**: Write and edit your code directly in the web UI.
- **Commit History**: Save points in time with commit messages permanently to PostgreSQL.
- **Branching & Merging**: Create branches to test new features and merge them back seamlessly.
- **Undo / Redo Stack**: Instant local mistake recovery.
- **Visual Commit Tree**: An interactive, automatically generated Mermaid.js diagram showing your branch history and merges.
- **Code Execution Environment**: Run your Python code securely directly from the UI and see output immediately.

## 🛠️ Tech Stack

- **Backend**: Python, Flask, Psycopg2
- **Database**: PostgreSQL (Production), SQLite (Local Fallback) 
- **Frontend**: HTML5, CSS3, Vanilla JavaScript, Mermaid.js
- **Deployment**: Docker, Gunicorn, Render Blueprint

## 💻 Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/raghuramch028/Treebase.git
   cd Treebase
   ```

2. Install the necessary Python packages:
   ```bash
   pip install -r requirements.txt
   ```

3. Start the application:
   ```bash
   python wsgi.py
   ```
   *(Note: Treebase intelligently creates a local `.treebase_store.db` SQLite file so you can develop entirely offline without needing a massive Postgres installation).*

4. Open your browser to `http://127.0.0.1:5000`

## 🐳 Docker Deployment (Render)

This project is fully containerized and configured to deploy seamlessly to cloud providers like Render.

1. Connect your repository to Render.
2. Select **Docker** as the runtime (or use the provided `render.yaml` Blueprint).
3. Connect a Free PostgreSQL database and pass the `DATABASE_URL` as an Environment Variable.
4. Render will use the provided `Dockerfile` to automatically build, migrate, and launch the scalable `gunicorn` web service seamlessly.
