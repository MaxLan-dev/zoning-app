from __future__ import annotations

import json

from flask import Blueprint, current_app, jsonify, request

from app.models import ZoningRecord
from app.services.source_document_ingest import ingest_documents_for_zone
from app.services.zone_spatial import parse_geometry_dict, point_in_geometry

bp = Blueprint("zones", __name__, url_prefix="/api/v1/zones")

# Curated entry points when open data does not embed per-zone PDF URLs (common for ArcGIS layers).
MUNICIPALITY_PUBLIC_RESOURCES: dict[str, list[dict[str, str]]] = {
    "waterloo": [
        {
            "label": "Zoning Bylaw & maps (City of Waterloo)",
            "url": "https://www.waterloo.ca/en/government/zoning-bylaw.aspx",
        },
        {
            "label": "Planning & land use data",
            "url": "https://www.waterloo.ca/en/government/planning-and-land-use-data.aspx",
        },
        {
            "label": "Interactive zoning map",
            "url": "https://maps.waterloo.ca/html5viewer/?viewer=waterlooviewer&layerTheme=Zoning",
        },
    ],
    "kitchener": [
        {
            "label": "Zoning (City of Kitchener)",
            "url": "https://www.kitchener.ca/en/development-and-construction/zoning.aspx",
        },
        {
            "label": "Zoning bylaw (searchable)",
            "url": "https://app2.kitchener.ca/appdocs/zonebylaw/",
        },
    ],
}

# Default map region (City of Waterloo + City of Kitchener ingested slugs)
REGION_WATERLOO_KITCHENER_SLUGS: tuple[str, ...] = ("waterloo", "kitchener")
_MAX_MUNICIPALITIES = 20


def _slugs_for_geojson() -> list[str] | None:
    region = (request.args.get("region") or "").strip().lower()
    if region == "waterloo-kitchener":
        return list(REGION_WATERLOO_KITCHENER_SLUGS)
    raw_multi = (request.args.get("municipalities") or "").strip()
    if raw_multi:
        parts = [p.strip().lower() for p in raw_multi.split(",") if p.strip()]
        if not parts or len(parts) > _MAX_MUNICIPALITIES:
            return None
        return parts
    municipality = (request.args.get("municipality") or "").strip()
    if municipality:
        return [municipality.lower()]
    return None


def _slugs_for_at_point() -> list[str]:
    region = (request.args.get("region") or "").strip().lower()
    if region == "waterloo-kitchener":
        return list(REGION_WATERLOO_KITCHENER_SLUGS)
    raw_multi = (request.args.get("municipalities") or "").strip()
    if raw_multi:
        parts = [p.strip().lower() for p in raw_multi.split(",") if p.strip()][
            :_MAX_MUNICIPALITIES
        ]
        if parts:
            return parts
    municipality = (request.args.get("municipality") or "").strip()
    if municipality:
        return [municipality.lower()]
    return list(REGION_WATERLOO_KITCHENER_SLUGS)


@bp.get("")
def list_zones():
    municipality = request.args.get("municipality", type=str)
    zone_code = request.args.get("zoneCode", type=str)
    zone_type = request.args.get("zoneType", type=str)
    status = request.args.get("status", type=str)
    limit = request.args.get("limit", default=100, type=int)
    offset = request.args.get("offset", default=0, type=int)

    if limit < 1 or limit > 500:
        return jsonify({"error": "`limit` must be between 1 and 500"}), 400
    if offset < 0:
        return jsonify({"error": "`offset` must be a non-negative integer"}), 400

    query = ZoningRecord.query
    if municipality:
        query = query.filter(ZoningRecord.municipality == municipality.strip().lower())
    if zone_code:
        query = query.filter(ZoningRecord.zone_code == zone_code.strip())
    if zone_type:
        query = query.filter(ZoningRecord.zone_type == zone_type.strip())
    if status:
        query = query.filter(ZoningRecord.status == status.strip())

    total = query.count()
    records = (
        query.order_by(ZoningRecord.municipality.asc(), ZoningRecord.source_object_id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return jsonify(
        {
            "total": total,
            "limit": limit,
            "offset": offset,
            "records": [_serialize_zone(r) for r in records],
        }
    )


@bp.get("/geojson")
def zones_geojson():
    slugs = _slugs_for_geojson()
    if not slugs:
        return jsonify(
            {
                "error": "missing_scope",
                "message": (
                    "Provide `municipality`, `municipalities` (comma-separated), "
                    "or `region=waterloo-kitchener`."
                ),
            }
        ), 400
    limit = request.args.get("limit", default=5000, type=int)
    limit = max(1, min(limit, 10000))
    records = (
        ZoningRecord.query.filter(ZoningRecord.municipality.in_(slugs))
        .order_by(ZoningRecord.municipality.asc(), ZoningRecord.id.asc())
        .limit(limit)
        .all()
    )
    features: list[dict] = []
    for r in records:
        geom = parse_geometry_dict(r.geometry_json)
        if not geom:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "id": r.id,
                    "municipality": r.municipality,
                    "zoneCode": r.zone_code,
                    "zoneName": r.zone_name,
                    "zoneType": r.zone_type,
                    "sourceObjectId": r.source_object_id,
                },
            }
        )
    return jsonify({"type": "FeatureCollection", "features": features})


@bp.get("/region-summary")
def zones_region_summary():
    """Zone counts per municipality for the same scope as ``/geojson`` (dashboard / UI)."""
    slugs = _slugs_for_geojson()
    if not slugs:
        return jsonify(
            {
                "error": "missing_scope",
                "message": (
                    "Provide `municipality`, `municipalities`, or `region=waterloo-kitchener`."
                ),
            }
        ), 400
    count_by_municipality = {
        slug: ZoningRecord.query.filter_by(municipality=slug).count() for slug in slugs
    }
    total_zones = sum(count_by_municipality.values())
    region_key = (request.args.get("region") or "").strip() or (
        "multi" if len(slugs) > 1 else slugs[0]
    )
    return jsonify(
        {
            "region": region_key,
            "municipalities": slugs,
            "totalZones": total_zones,
            "countByMunicipality": count_by_municipality,
        }
    )


@bp.get("/at-point")
def zone_at_point():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    if lat is None or lng is None:
        return jsonify(
            {"error": "missing_coordinates", "message": "Provide `lat` and `lng` query parameters."}
        ), 400
    slugs = _slugs_for_at_point()
    records = ZoningRecord.query.filter(ZoningRecord.municipality.in_(slugs)).all()
    matches: list[ZoningRecord] = []
    for r in records:
        geom = parse_geometry_dict(r.geometry_json)
        if geom and point_in_geometry(lng, lat, geom):
            matches.append(r)
    return jsonify(
        {
            "lat": lat,
            "lng": lng,
            "municipalitiesSearched": slugs,
            "matchCount": len(matches),
            "matches": [_serialize_zone_detail(r) for r in matches],
        }
    )


@bp.get("/<int:zone_id>")
def get_zone(zone_id: int):
    r = ZoningRecord.query.get(zone_id)
    if r is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"record": _serialize_zone_detail(r)})


@bp.post("/<int:zone_id>/ingest-documents")
def ingest_zone_documents(zone_id: int):
    r = ZoningRecord.query.get(zone_id)
    if r is None:
        return jsonify({"error": "not_found"}), 404
    app = current_app._get_current_object()
    try:
        results = ingest_documents_for_zone(app, r)
    except Exception as exc:
        return jsonify({"error": "ingest_failed", "message": str(exc)}), 502
    return jsonify({"zoneId": zone_id, "results": results}), 200


DEFAULT_ZONE_ANALYZE_QUERY = (
    "Answer ONLY for the zoning polygon described in the zone context (official open data).\n"
    "Using ONLY the bylaw excerpts, explain what may realistically be built or operated on this polygon:\n"
    "(1) Uses or building types that appear PERMITTED, PROHIBITED, or CONDITIONAL — cite passages; "
    "do not guess uses that are not stated.\n"
    "(2) Physical limits in the excerpts: height, storeys, setbacks, density, lot coverage, "
    "parking, lot size, or façades.\n"
    "(3) Gaps: schedules, maps, amendments, or other bylaw parts a builder or planner must still verify.\n"
    "If permitted uses or other topics are not in the excerpts, say clearly NOT IN THE PROVIDED TEXT."
)


@bp.post("/<int:zone_id>/analyze")
def zone_analyze(zone_id: int):
    """
    Ingest linked PDFs for the zone into Qdrant, then run RAG with a default or custom question.
    Returns structured record + ingest results + RAG payload (or RAG error if Groq is not configured).
    """
    from app.services.rag import run_rag
    from app.services.zone_context import format_zone_context_for_rag

    body = request.get_json(silent=True) or {}
    raw_q = body.get("q")
    if isinstance(raw_q, str) and raw_q.strip():
        question = raw_q.strip()
    else:
        question = DEFAULT_ZONE_ANALYZE_QUERY

    r = ZoningRecord.query.get(zone_id)
    if r is None:
        return jsonify({"error": "not_found"}), 404

    app = current_app._get_current_object()
    try:
        ingest_results = ingest_documents_for_zone(app, r)
    except Exception as exc:
        return jsonify({"error": "ingest_failed", "message": str(exc)}), 502

    record_detail = _serialize_zone_detail(r)
    zone_context_text = format_zone_context_for_rag(record_detail)
    rag_out: dict[str, object] = {
        "query": question,
        "answer": None,
        "sources": [],
        "model": None,
        "error": None,
        "message": None,
    }

    if not app.config.get("GROQ_API_KEY"):
        rag_out["error"] = "groq_not_configured"
        rag_out["message"] = (
            "AI summaries need GROQ_API_KEY on the server. "
            "You can still use official city links and open data below."
        )
    else:
        try:
            result = run_rag(
                app,
                question,
                limit=12,
                municipality=r.municipality,
                zone_code=r.zone_code,
                source_object_id=r.source_object_id,
                zone_type=r.zone_type,
                zone_name=r.zone_name,
                zone_context=zone_context_text,
            )
            rag_out["answer"] = result.get("answer")
            rag_out["sources"] = result.get("sources") or []
            rag_out["model"] = result.get("model")
        except ValueError as exc:
            rag_out["error"] = "configuration_error"
            rag_out["message"] = str(exc)
        except Exception as exc:
            rag_out["error"] = "rag_failed"
            rag_out["message"] = str(exc)

    by_status: dict[str, int] = {}
    for row in ingest_results:
        st = str(row.get("status") or "unknown")
        by_status[st] = by_status.get(st, 0) + 1
    linked_pdf_count = len(record_detail.get("sourceDocuments") or [])

    return jsonify(
        {
            "zoneId": zone_id,
            "record": record_detail,
            "ingest": {
                "results": ingest_results,
                "summary": {
                    "linkedPdfUrlsInOpenData": linked_pdf_count,
                    "rows": len(ingest_results),
                    "byStatus": by_status,
                },
            },
            "rag": rag_out,
        }
    ), 200


def _serialize_zone(record: ZoningRecord) -> dict[str, object]:
    return {
        "id": record.id,
        "municipality": record.municipality,
        "sourceObjectId": record.source_object_id,
        "zoneCode": record.zone_code,
        "zoneType": record.zone_type,
        "zoneName": record.zone_name,
        "status": record.status,
        "bylawNumber": record.bylaw_number,
        "effectiveDate": record.effective_date.isoformat()
        if record.effective_date
        else None,
        "sourceUrl": record.source_url,
        "geojsonUrl": record.geojson_url,
        "lastRunId": record.last_run_id,
    }


def _serialize_zone_detail(record: ZoningRecord) -> dict[str, object]:
    base = _serialize_zone(record)
    geom = parse_geometry_dict(record.geometry_json)
    docs: list[str] = []
    if record.source_documents_json:
        try:
            parsed = json.loads(record.source_documents_json)
            if isinstance(parsed, list):
                docs = [str(x) for x in parsed if x]
        except json.JSONDecodeError:
            pass
    base["geometry"] = geom
    base["sourceDocuments"] = docs
    slug = (record.municipality or "").strip().lower()
    base["publicResources"] = list(MUNICIPALITY_PUBLIC_RESOURCES.get(slug, []))
    return base
