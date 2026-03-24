# Treebase 🌳

Treebase is a custom Version Control System (VCS) and Code Editor built from the ground up. It provides Git-like capabilities wrapped in a sleek, modern web interface.

## 🚀 Features

- **In-Browser Code Editor**: Write and edit your code directly in the web UI.
- **Commit History**: Save points in time with commit messages.
- **Branching & Merging**: Create branches to test new features and merge them back seamlessly.
- **Undo / Redo Stack**: Instant local mistake recovery.
- **Visual Commit Tree**: An interactive, automatically generated Mermaid.js diagram showing your branch history and merges.
- **Code Execution Environment**: Run your Python code securely directly from the UI and see the output.

## 🛠️ Tech Stack

- **Backend**: Python, Flask
- **Frontend**: HTML5, CSS3, Vanilla JavaScript, Mermaid.js
- **Deployment**: Docker, Gunicorn

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

4. Open your browser to `http://127.0.0.1:5000`

## 🐳 Docker Deployment (Render)

This project is fully containerized and configured to deploy seamlessly to cloud providers like Render.

1. Connect your repository to Render.
2. Select **Docker** as the runtime.
3. Render will use the provided `render.yaml` and `Dockerfile` to automatically build and launch the scalable `gunicorn` web service.
