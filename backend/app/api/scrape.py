from __future__ import annotations

from collections.abc import Iterable

import httpx
from flask import Blueprint, jsonify, request

from app.ingestion.scrapers import scrape_geojson_data, scrape_municipal_page

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
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    allowed_domains = _coerce_set(payload.get("allowedDomains"))
    property_keys = _coerce_patterns(payload.get("propertyKeys"))

    try:
        result = scrape_geojson_data(
            source_url=url.strip(),
            geojson_url=geojson_url.strip() if isinstance(geojson_url, str) else None,
            allowed_domains=allowed_domains,
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
