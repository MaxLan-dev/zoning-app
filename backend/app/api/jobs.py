from __future__ import annotations

from collections.abc import Iterable

from flask import Blueprint, jsonify, request

from app.ingestion.scrapers.templates import (
    get_municipality_template,
    list_municipality_templates,
)
from app.models import IngestionRun
from app.services import IngestZoningRequest, ingest_zoning_records, serialize_ingestion_run

bp = Blueprint("jobs", __name__, url_prefix="/api/v1/jobs")


@bp.get("/ingest-zoning/municipalities")
def list_supported_municipalities():
    templates = list_municipality_templates()
    return jsonify(
        {
            "municipalities": [
                {
                    "slug": template.slug,
                    "displayName": template.display_name,
                    "sourceUrl": template.source_url,
                    "geojsonUrl": template.default_geojson_url,
                    "allowedDomains": list(template.allowed_domains),
                }
                for template in templates
            ]
        }
    )


@bp.get("/ingest-zoning/runs")
def list_ingestion_runs():
    municipality = (request.args.get("municipality") or "").strip().lower() or None
    limit = request.args.get("limit", default=20, type=int)
    if limit < 1 or limit > 100:
        return jsonify({"error": "`limit` must be between 1 and 100"}), 400

    query = IngestionRun.query
    if municipality:
        query = query.filter(IngestionRun.municipality == municipality)

    runs = query.order_by(IngestionRun.started_at.desc()).limit(limit).all()

    latest_by_municipality: dict[str, dict[str, object]] = {}
    latest_runs = (
        IngestionRun.query.order_by(IngestionRun.municipality.asc(), IngestionRun.started_at.desc()).all()
    )
    for run in latest_runs:
        if run.municipality not in latest_by_municipality:
            latest_by_municipality[run.municipality] = serialize_ingestion_run(run)

    return jsonify(
        {
            "runs": [serialize_ingestion_run(run) for run in runs],
            "latestByMunicipality": latest_by_municipality,
        }
    )


@bp.post("/ingest-zoning")
def ingest_zoning():
    payload = request.get_json(silent=True) or {}

    municipality_slug = payload.get("municipality")
    if not isinstance(municipality_slug, str) or not municipality_slug.strip():
        return jsonify({"error": "`municipality` is required and must be a string"}), 400

    try:
        template = get_municipality_template(municipality_slug)
        paginate = _coerce_bool(payload.get("paginate"), default=True)
        page_size = _coerce_page_size(payload.get("pageSize"))
        max_pages = _coerce_max_pages(payload.get("maxPages"))
        requested_domains = _coerce_set(payload.get("allowedDomains"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    source_url = payload.get("url")
    if source_url is None:
        source_url = template.source_url
    if not isinstance(source_url, str) or not source_url.strip():
        return jsonify({"error": "`url` must be a non-empty string when provided"}), 400

    geojson_url = payload.get("geojsonUrl")
    if geojson_url is None:
        geojson_url = template.default_geojson_url
    if not isinstance(geojson_url, str) or not geojson_url.strip():
        return jsonify(
            {"error": "No default GeoJSON URL exists for this municipality; provide `geojsonUrl`"}
        ), 400

    allowed_domains = set(template.allowed_domains)
    if requested_domains:
        allowed_domains.update(requested_domains)

    request_data = IngestZoningRequest(
        template=template,
        source_url=source_url.strip(),
        geojson_url=geojson_url.strip(),
        allowed_domains=allowed_domains,
        paginate=paginate,
        page_size=page_size,
        max_pages=max_pages,
    )
    try:
        run = ingest_zoning_records(request_data)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 422
    return jsonify({"run": serialize_ingestion_run(run)}), 201


def _coerce_bool(raw: object, *, default: bool) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    raise ValueError("Boolean options must be true or false")


def _coerce_page_size(raw: object) -> int | None:
    if raw is None:
        return None
    if not isinstance(raw, int):
        raise ValueError("`pageSize` must be an integer")
    if raw < 1 or raw > 5000:
        raise ValueError("`pageSize` must be between 1 and 5000")
    return raw


def _coerce_max_pages(raw: object) -> int:
    if raw is None:
        return 25
    if not isinstance(raw, int):
        raise ValueError("`maxPages` must be an integer")
    if raw < 1 or raw > 1000:
        raise ValueError("`maxPages` must be between 1 and 1000")
    return raw


def _coerce_set(raw: object) -> set[str] | None:
    if raw is None:
        return None
    if not isinstance(raw, Iterable) or isinstance(raw, (str, bytes, dict)):
        raise ValueError("`allowedDomains` must be an array of strings")

    values: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("`allowedDomains` must be an array of strings")
        cleaned = item.strip().lower()
        if cleaned:
            values.add(cleaned)

    return values or None
