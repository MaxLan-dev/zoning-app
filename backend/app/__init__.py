import os

import app.load_env  # noqa: F401 — load repo-root .env / .env.local first

from flask import Flask

from app.config import config_by_name
from app.extensions import cors, db, migrate


def _configure_langsmith_tracing() -> None:
    key = os.environ.get("LANGSMITH_API_KEY")
    if not key:
        return
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_API_KEY", key)
    os.environ.setdefault(
        "LANGCHAIN_PROJECT",
        os.environ.get("LANGCHAIN_PROJECT", "zoning-app"),
    )


def create_app(config_name: str | None = None) -> Flask:
    _configure_langsmith_tracing()

    app = Flask(__name__)

    cfg = config_name or os.environ.get("FLASK_ENV", "development")
    app.config.from_object(config_by_name[cfg])

    db.init_app(app)
    from app import models  # noqa: F401

    migrate.init_app(app, db)
    cors.init_app(
        app,
        resources={
            r"/api/*": {
                "origins": app.config.get("CORS_ORIGINS", "*"),
                "supports_credentials": True,
            }
        },
    )

    from app.api import register_blueprints

    register_blueprints(app)

    return app
