import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

bp = Blueprint("documents", __name__, url_prefix="/api/v1")


@bp.post("/documents/upload")
def upload_document():
    from app.services.pdf_vector_ingest import ingest_pdf_to_qdrant

    if "file" not in request.files:
        return jsonify({"error": "missing_file"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "empty_filename"}), 400
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "pdf_only", "message": "Only .pdf files are supported."}), 400

    safe_name = secure_filename(f.filename) or "upload.pdf"
    uploaded_at = datetime.now(timezone.utc)
    dest = Path(current_app.config["UPLOAD_FOLDER"])
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{uuid.uuid4().hex}_{safe_name}"
    f.save(path)

    try:
        app = current_app._get_current_object()
        result = ingest_pdf_to_qdrant(app, path, safe_name, uploaded_at)
    except Exception as exc:
        return jsonify({"error": "ingest_failed", "message": str(exc)}), 502
    finally:
        path.unlink(missing_ok=True)

    if result.get("error") == "no_extractable_text":
        return jsonify(result), 422

    return jsonify(result), 201
