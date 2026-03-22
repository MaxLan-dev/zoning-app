from flask import Flask

from app.api.health import bp as health_bp
from app.api.scrape import bp as scrape_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(scrape_bp)
