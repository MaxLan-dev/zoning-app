from flask import Flask

from app.api.health import bp as health_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(health_bp)
