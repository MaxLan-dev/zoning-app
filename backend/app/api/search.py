from flask import Blueprint, current_app, jsonify, request

bp = Blueprint("search", __name__, url_prefix="/api/v1")


@bp.post("/search")
def search():
    from app.services.vector_search import semantic_search

    body = request.get_json(silent=True) or {}
    q = body.get("q") or body.get("query")
    if not q or not isinstance(q, str) or not q.strip():
        return jsonify({"error": "missing_query", "message": "Provide non-empty string field `q`."}), 400

    limit = body.get("limit", 5)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_limit"}), 400
    limit = max(1, min(limit, 20))

    document_id = body.get("document_id")
    if document_id is not None:
        if not isinstance(document_id, str):
            return jsonify({"error": "invalid_document_id"}), 400
        document_id = document_id.strip() or None

    try:
        app = current_app._get_current_object()
        results = semantic_search(
            app,
            q.strip(),
            limit=limit,
            document_id=document_id,
        )
    except Exception as exc:
        return jsonify({"error": "search_failed", "message": str(exc)}), 502

    return jsonify({"query": q.strip(), "limit": limit, "results": results})
