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

    document_ids: list[str] | None = None
    raw_ids = body.get("document_ids")
    if raw_ids is not None:
        if not isinstance(raw_ids, list):
            return jsonify({"error": "invalid_document_ids", "message": "document_ids must be a JSON array."}), 400
        parsed: list[str] = []
        for item in raw_ids:
            if not isinstance(item, str):
                return jsonify({"error": "invalid_document_ids", "message": "Each document_ids entry must be a string."}), 400
            s = item.strip()
            if s:
                parsed.append(s)
        document_ids = parsed or None

    if document_ids:
        document_id = None

    municipality = body.get("municipality")
    if municipality is not None:
        if not isinstance(municipality, str):
            return jsonify({"error": "invalid_municipality"}), 400
        municipality = municipality.strip().lower() or None

    zone_code = body.get("zone_code")
    if zone_code is not None:
        if not isinstance(zone_code, str):
            return jsonify({"error": "invalid_zone_code"}), 400
        zone_code = zone_code.strip() or None

    source_object_id = body.get("source_object_id")
    if source_object_id is not None:
        if not isinstance(source_object_id, str):
            return jsonify({"error": "invalid_source_object_id"}), 400
        source_object_id = source_object_id.strip() or None

    zone_type = body.get("zone_type")
    if zone_type is not None:
        if not isinstance(zone_type, str):
            return jsonify({"error": "invalid_zone_type"}), 400
        zone_type = zone_type.strip() or None

    zone_name = body.get("zone_name")
    if zone_name is not None:
        if not isinstance(zone_name, str):
            return jsonify({"error": "invalid_zone_name"}), 400
        zone_name = zone_name.strip() or None

    try:
        app = current_app._get_current_object()
        result = run_rag(
            app,
            q.strip(),
            limit=limit,
            document_id=document_id,
            document_ids=document_ids,
            municipality=municipality,
            zone_code=zone_code,
            source_object_id=source_object_id,
            zone_type=zone_type,
            zone_name=zone_name,
        )
    except ValueError as exc:
        return jsonify({"error": "configuration_error", "message": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": "rag_failed", "message": str(exc)}), 502

    return jsonify({"query": q.strip(), **result})
