from __future__ import annotations

from collections.abc import Iterable

import httpx
from flask import Blueprint, jsonify, request

from app.ingestion.normalize import normalize_zoning_feature_collection
from app.ingestion.scrapers import scrape_geojson_data, scrape_municipal_page
from app.ingestion.scrapers.templates import (
    get_municipality_template,
    list_municipality_templates,
)

bp = Blueprint("scrape", __name__, url_prefix="/api/v1/scrape")


@bp.post("/links")
def scrape_links():
    payload = request.get_json(silent=True) or {}

    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        return jsonify({"error": "`url` is required and must be a non-empty string"}), 400

    try:
        max_links = _coerce_max_links(payload.get("maxLinks"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    allowed_domains = _coerce_set(payload.get("allowedDomains"))
    include_patterns = _coerce_patterns(payload.get("includePatterns"))
    exclude_patterns = _coerce_patterns(payload.get("excludePatterns"))

    try:
        result = scrape_municipal_page(
            url=url.strip(),
            allowed_domains=allowed_domains,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )
        return jsonify(result.as_json(max_links=max_links))
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        return (
            jsonify({"error": "Upstream request failed", "statusCode": status_code}),
            502,
        )
    except httpx.HTTPError:
        return jsonify({"error": "Unable to fetch source URL"}), 502


@bp.post("/geojson")
def scrape_geojson():
    payload = request.get_json(silent=True) or {}

    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        return jsonify({"error": "`url` is required and must be a non-empty string"}), 400

    geojson_url = payload.get("geojsonUrl")
    if geojson_url is not None and (
        not isinstance(geojson_url, str) or not geojson_url.strip()
    ):
        return jsonify({"error": "`geojsonUrl` must be a non-empty string when provided"}), 400

    try:
        max_features = _coerce_max_features(payload.get("maxFeatures"))
        allowed_domains = _coerce_set(payload.get("allowedDomains"))
        property_keys = _coerce_patterns(payload.get("propertyKeys"))
        paginate = _coerce_bool(payload.get("paginate"), default=True)
        page_size = _coerce_page_size(payload.get("pageSize"))
        max_pages = _coerce_max_pages(payload.get("maxPages"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        result = scrape_geojson_data(
            source_url=url.strip(),
            geojson_url=geojson_url.strip() if isinstance(geojson_url, str) else None,
            allowed_domains=allowed_domains,
            paginate=paginate,
            page_size=page_size,
            max_pages=max_pages,
        )
        return jsonify(result.as_json(max_features=max_features, property_keys=property_keys))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 422
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        return (
            jsonify({"error": "Upstream request failed", "statusCode": status_code}),
            502,
        )
    except httpx.HTTPError:
        return jsonify({"error": "Unable to fetch source URL"}), 502


@bp.get("/templates")
def scrape_templates():
    templates = list_municipality_templates()
    return jsonify(
        {
            "municipalities": [
                {
                    "slug": template.slug,
                    "displayName": template.display_name,
                    "sourceUrl": template.source_url,
                    "defaultGeojsonUrl": template.default_geojson_url,
                    "allowedDomains": list(template.allowed_domains),
                }
                for template in templates
            ]
        }
    )


@bp.post("/geojson/normalized")
def scrape_geojson_normalized():
    payload = request.get_json(silent=True) or {}

    municipality_slug = payload.get("municipality")
    if not isinstance(municipality_slug, str) or not municipality_slug.strip():
        return jsonify({"error": "`municipality` is required and must be a string"}), 400

    try:
        template = get_municipality_template(municipality_slug)
        max_features = _coerce_max_features(payload.get("maxFeatures"))
        max_records = _coerce_max_records(payload.get("maxRecords"))
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

    try:
        scraped = scrape_geojson_data(
            source_url=source_url.strip(),
            geojson_url=geojson_url.strip(),
            allowed_domains=allowed_domains,
            paginate=paginate,
            page_size=page_size,
            max_pages=max_pages,
        )
        normalized = normalize_zoning_feature_collection(
            municipality=template,
            source_url=scraped.source_url,
            geojson_url=scraped.geojson_url,
            feature_collection=scraped.feature_collection,
        )
        return jsonify(normalized.as_json(max_records=max_records or max_features))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 422
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        return (
            jsonify({"error": "Upstream request failed", "statusCode": status_code}),
            502,
        )
    except httpx.HTTPError:
        return jsonify({"error": "Unable to fetch source URL"}), 502


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


def _coerce_patterns(raw: object) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, Iterable) or isinstance(raw, (str, bytes, dict)):
        raise ValueError("Pattern filters must be arrays of strings")

    values: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("Pattern filters must be arrays of strings")
        cleaned = item.strip().lower()
        if cleaned:
            values.append(cleaned)

    return tuple(values)


def _coerce_max_links(raw: object) -> int | None:
    if raw is None:
        return None
    if not isinstance(raw, int):
        raise ValueError("`maxLinks` must be an integer")
    if raw < 1 or raw > 500:
        raise ValueError("`maxLinks` must be between 1 and 500")
    return raw


def _coerce_max_features(raw: object) -> int | None:
    if raw is None:
        return None
    if not isinstance(raw, int):
        raise ValueError("`maxFeatures` must be an integer")
    if raw < 1 or raw > 10_000:
        raise ValueError("`maxFeatures` must be between 1 and 10000")
    return raw


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


def _coerce_max_records(raw: object) -> int | None:
    if raw is None:
        return None
    if not isinstance(raw, int):
        raise ValueError("`maxRecords` must be an integer")
    if raw < 1 or raw > 10_000:
        raise ValueError("`maxRecords` must be between 1 and 10000")
    return raw
