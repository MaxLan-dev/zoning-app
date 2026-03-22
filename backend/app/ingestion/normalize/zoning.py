from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.ingestion.scrapers.templates import MunicipalityTemplate


@dataclass(frozen=True)
class NormalizedZoningResult:
    municipality: str
    source_url: str
    geojson_url: str
    records: list[dict[str, Any]]
    total_features: int
    normalized_count: int
    skipped_count: int

    def as_json(self, *, max_records: int | None = None) -> dict[str, object]:
        records = self.records if max_records is None else self.records[:max_records]
        return {
            "municipality": self.municipality,
            "sourceUrl": self.source_url,
            "geojsonUrl": self.geojson_url,
            "totalFeatures": self.total_features,
            "normalizedCount": self.normalized_count,
            "skippedCount": self.skipped_count,
            "records": records,
        }


def normalize_zoning_feature_collection(
    *,
    municipality: MunicipalityTemplate,
    source_url: str,
    geojson_url: str,
    feature_collection: dict[str, Any],
) -> NormalizedZoningResult:
    features_raw = feature_collection.get("features", [])
    features: list[dict[str, Any]] = [
        item for item in features_raw if isinstance(item, dict)
    ]
    records: list[dict[str, Any]] = []
    skipped_count = 0

    for feature in features:
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            skipped_count += 1
            continue

        zone_code = _pick_first_non_empty(properties, municipality.zone_code_fields)
        if zone_code is None:
            skipped_count += 1
            continue

        zone_type = _pick_first_non_empty(properties, municipality.zone_type_fields)
        if zone_type is None:
            zone_type = _derive_zone_type_from_code(
                municipality_slug=municipality.slug,
                zone_code=zone_code,
            )
        zone_name = _pick_first_non_empty(properties, municipality.zone_name_fields)
        status = _pick_first_non_empty(properties, municipality.status_fields)
        bylaw_number = _pick_first_non_empty(
            properties,
            municipality.bylaw_number_fields,
        )
        effective_date = _parse_effective_date(
            _pick_first_non_empty(properties, municipality.effective_date_fields)
        )
        source_object_id = _pick_first_non_empty(
            properties,
            municipality.source_id_fields,
        )
        if municipality.required_source_object_id and (
            source_object_id is None or not source_object_id.strip()
        ):
            skipped_count += 1
            continue
        if not _is_allowed_geometry_type(
            geometry=geometry,
            allowed_geometry_types=municipality.allowed_geometry_types,
        ):
            skipped_count += 1
            continue
        source_documents = _extract_source_documents(properties)
        records.append(
            {
                "municipality": municipality.slug,
                "sourceObjectId": source_object_id,
                "zoneCode": zone_code,
                "zoneType": zone_type,
                "zoneName": zone_name,
                "status": status,
                "bylawNumber": bylaw_number,
                "effectiveDate": effective_date,
                "sourceDocuments": source_documents,
                "geometry": geometry,
            }
        )

    return NormalizedZoningResult(
        municipality=municipality.slug,
        source_url=source_url,
        geojson_url=geojson_url,
        records=records,
        total_features=len(features),
        normalized_count=len(records),
        skipped_count=skipped_count,
    )


def _pick_first_non_empty(
    properties: dict[str, Any],
    keys: tuple[str, ...],
) -> str | None:
    for key in keys:
        value = properties.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
            continue
        return str(value)
    return None


def _parse_effective_date(value: str | None) -> str | None:
    if value is None:
        return None
    if value.isdigit():
        timestamp_millis = int(value)
        dt = datetime.fromtimestamp(timestamp_millis / 1000, tz=UTC)
        return dt.date().isoformat()
    return value


def _extract_source_documents(properties: dict[str, Any]) -> list[str]:
    documents: list[str] = []
    for key, value in properties.items():
        if not isinstance(value, str):
            continue
        if not value.strip():
            continue
        normalized_key = key.lower()
        if normalized_key.startswith("generaldocument") or normalized_key.endswith(
            "_document"
        ):
            documents.append(value.strip())
    return documents


def _is_allowed_geometry_type(
    *, geometry: dict[str, Any], allowed_geometry_types: tuple[str, ...]
) -> bool:
    if not allowed_geometry_types:
        return True
    geometry_type = geometry.get("type")
    if not isinstance(geometry_type, str):
        return False
    return geometry_type in allowed_geometry_types


def _derive_zone_type_from_code(*, municipality_slug: str, zone_code: str) -> str | None:
    if municipality_slug != "waterloo":
        return None

    code = zone_code.strip().upper()
    if not code:
        return None

    prefix_chars: list[str] = []
    for char in code:
        if char.isalpha():
            prefix_chars.append(char)
            continue
        break
    prefix = "".join(prefix_chars)
    if not prefix:
        return None

    type_by_prefix = {
        "A": "Agricultural",
        "C": "Commercial",
        "ER": "Environmental",
        "I": "Industrial",
        "INST": "Institutional",
        "MR": "Mixed Residential",
        "OS": "Open Space",
        "R": "Residential",
    }
    return type_by_prefix.get(prefix)
