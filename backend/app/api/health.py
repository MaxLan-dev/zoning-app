from flask import Blueprint, jsonify

bp = Blueprint("health", __name__, url_prefix="/api/v1")


@bp.get("/health")
def health():
    return jsonify({"status": "ok", "service": "zoning-api"})
