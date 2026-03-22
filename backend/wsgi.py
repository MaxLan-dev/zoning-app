import app.load_env  # noqa: F401 — ensure .env before app config

from app import create_app

app = create_app()
