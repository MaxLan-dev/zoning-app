from flask import Flask

from app.api.health import bp as health_bp
from app.api.jobs import bp as jobs_bp
from app.api.scrape import bp as scrape_bp
from app.api.zones import bp as zones_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(jobs_bp)
    app.register_blueprint(scrape_bp)
    app.register_blueprint(zones_bp)
