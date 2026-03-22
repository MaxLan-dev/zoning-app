from flask import Flask

from app.api.documents import bp as documents_bp
from app.api.health import bp as health_bp
from app.api.root import bp as root_bp
from app.api.rag import bp as rag_bp
from app.api.search import bp as search_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(root_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(rag_bp)
