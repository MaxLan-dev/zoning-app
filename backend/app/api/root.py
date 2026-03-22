from flask import Blueprint, jsonify

bp = Blueprint("root", __name__)


@bp.get("/")
def index():
    return jsonify(
        {
            "service": "zoning-api",
            "message": "API is running. The web UI is served separately (e.g. Vite on port 5173).",
            "endpoints": {
                "health": "/api/v1/health",
                "upload_pdf": "POST /api/v1/documents/upload",
                "search": "POST /api/v1/search",
                "rag": "POST /api/v1/rag",
            },
        }
    )
