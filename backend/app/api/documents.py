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


@bp.post("/documents/ingest-url")
def ingest_document_url():
    from app.services.source_document_ingest import ingest_pdf_url_to_qdrant

    body = request.get_json(silent=True) or {}
    url = body.get("url")
    if not isinstance(url, str) or not url.strip():
        return jsonify({"error": "missing_url", "message": "Provide string field `url`."}), 400

    municipality = body.get("municipality")
    if municipality is not None and not isinstance(municipality, str):
        return jsonify({"error": "invalid_municipality"}), 400
    zone_code = body.get("zone_code")
    if zone_code is not None and not isinstance(zone_code, str):
        return jsonify({"error": "invalid_zone_code"}), 400
    source_object_id = body.get("source_object_id")
    if source_object_id is not None and not isinstance(source_object_id, str):
        return jsonify({"error": "invalid_source_object_id"}), 400
    force = bool(body.get("force"))

    try:
        app = current_app._get_current_object()
        result = ingest_pdf_url_to_qdrant(
            app,
            url.strip(),
            municipality=municipality.strip() if isinstance(municipality, str) else None,
            zone_code=zone_code.strip() if isinstance(zone_code, str) else None,
            source_object_id=source_object_id.strip()
            if isinstance(source_object_id, str)
            else None,
            force=force,
        )
    except Exception as exc:
        return jsonify({"error": "ingest_failed", "message": str(exc)}), 502

    if result.get("error") == "not_pdf":
        return jsonify(result), 400
    if result.get("error") == "no_extractable_text":
        return jsonify(result), 422
    if result.get("status") == "unchanged":
        return jsonify(result), 200

    return jsonify(result), 201
