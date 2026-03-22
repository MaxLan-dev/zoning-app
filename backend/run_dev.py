"""
Run the API locally without the `flask` executable on PATH (common on Windows).

Usage (from this directory, with venv activated or using .venv\\Scripts\\python):

    python run_dev.py
"""

import app.load_env  # noqa: F401 — ensure .env before app config

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
