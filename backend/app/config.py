import os

from app.load_env import REPO_ROOT


class BaseConfig:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-me")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

    QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
    QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY") or None
    QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "zoning_chunks")
    UPLOAD_FOLDER = str(REPO_ROOT / "backend" / "uploads")
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB", "32")) * 1024 * 1024
    # Short name works with sentence-transformers (downloads weights on first use).
    EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

    GROQ_API_KEY = os.environ.get("GROQ_API_KEY") or None
    GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    # Default to SQLite for a quick start; set DATABASE_URL for Docker Postgres.
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        "sqlite:///zoning_dev.db",
    )


class ProductionConfig(BaseConfig):
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "")


class TestingConfig(BaseConfig):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    GROQ_API_KEY = None


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
