from flask import Blueprint, current_app, jsonify, request

bp = Blueprint("rag", __name__, url_prefix="/api/v1")


@bp.post("/rag")
def rag():
    from app.services.rag import run_rag

    if not current_app.config.get("GROQ_API_KEY"):
        return jsonify(
            {
                "error": "groq_not_configured",
                "message": "Set GROQ_API_KEY in the repo-root .env file.",
            }
        ), 503

    body = request.get_json(silent=True) or {}
    q = body.get("q") or body.get("query")
    if not q or not isinstance(q, str) or not q.strip():
        return jsonify({"error": "missing_query", "message": "Provide non-empty string field `q`."}), 400

    limit = body.get("limit", 8)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_limit"}), 400
    limit = max(1, min(limit, 15))

    document_id = body.get("document_id")
    if document_id is not None:
        if not isinstance(document_id, str):
            return jsonify({"error": "invalid_document_id"}), 400
        document_id = document_id.strip() or None

    try:
        app = current_app._get_current_object()
        result = run_rag(app, q.strip(), limit=limit, document_id=document_id)
    except ValueError as exc:
        return jsonify({"error": "configuration_error", "message": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": "rag_failed", "message": str(exc)}), 502

    return jsonify({"query": q.strip(), **result})
