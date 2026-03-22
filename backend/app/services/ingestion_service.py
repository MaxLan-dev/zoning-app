from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, date
import hashlib
import json
from typing import Any

from app.extensions import db
from app.ingestion.normalize import normalize_zoning_feature_collection
from app.ingestion.scrapers import scrape_geojson_data
from app.ingestion.scrapers.templates import MunicipalityTemplate
from app.models import IngestionRun, ZoningRecord


@dataclass(frozen=True)
class IngestZoningRequest:
    template: MunicipalityTemplate
    source_url: str
    geojson_url: str
    allowed_domains: set[str] | None
    paginate: bool
    page_size: int | None
    max_pages: int


def ingest_zoning_records(request: IngestZoningRequest) -> IngestionRun:
    run = IngestionRun(
        municipality=request.template.slug,
        status="running",
        source_url=request.source_url,
        geojson_url=request.geojson_url,
    )
    db.session.add(run)
    db.session.flush()

    try:
        scraped = scrape_geojson_data(
            source_url=request.source_url,
            geojson_url=request.geojson_url,
            allowed_domains=request.allowed_domains,
            paginate=request.paginate,
            page_size=request.page_size,
            max_pages=request.max_pages,
        )
        normalized = normalize_zoning_feature_collection(
            municipality=request.template,
            source_url=scraped.source_url,
            geojson_url=scraped.geojson_url,
            feature_collection=scraped.feature_collection,
        )

        inserted_count = 0
        updated_count = 0

        for record in normalized.records:
            source_object_id = record.get("sourceObjectId")
            if not isinstance(source_object_id, str) or not source_object_id:
                continue

            content_hash = _compute_record_hash(record)
            existing = ZoningRecord.query.filter_by(
                municipality=request.template.slug,
                source_object_id=source_object_id,
            ).one_or_none()
            if existing is None:
                db.session.add(
                    ZoningRecord(
                        municipality=request.template.slug,
                        source_object_id=source_object_id,
                        zone_code=record.get("zoneCode") or "",
                        zone_type=record.get("zoneType"),
                        zone_name=record.get("zoneName"),
                        status=record.get("status"),
                        bylaw_number=record.get("bylawNumber"),
                        effective_date=_coerce_effective_date(record.get("effectiveDate")),
                        source_documents_json=json.dumps(
                            record.get("sourceDocuments") or [],
                            sort_keys=True,
                        ),
                        geometry_json=json.dumps(record.get("geometry"), sort_keys=True),
                        source_url=request.source_url,
                        geojson_url=request.geojson_url,
                        content_hash=content_hash,
                        last_run_id=run.id,
                    )
                )
                inserted_count += 1
            else:
                if existing.content_hash != content_hash:
                    existing.zone_code = record.get("zoneCode") or existing.zone_code
                    existing.zone_type = record.get("zoneType")
                    existing.zone_name = record.get("zoneName")
                    existing.status = record.get("status")
                    existing.bylaw_number = record.get("bylawNumber")
                    existing.effective_date = _coerce_effective_date(
                        record.get("effectiveDate")
                    )
                    existing.source_documents_json = json.dumps(
                        record.get("sourceDocuments") or [],
                        sort_keys=True,
                    )
                    existing.geometry_json = json.dumps(
                        record.get("geometry"),
                        sort_keys=True,
                    )
                    existing.source_url = request.source_url
                    existing.geojson_url = request.geojson_url
                    existing.content_hash = content_hash
                    updated_count += 1
                existing.last_run_id = run.id

        run.status = "completed"
        run.total_features = normalized.total_features
        run.normalized_count = normalized.normalized_count
        run.inserted_count = inserted_count
        run.updated_count = updated_count
        run.skipped_count = normalized.skipped_count
        run.error_count = 0
        run.error_message = None
        run.finished_at = datetime.now(tz=UTC)
        db.session.commit()
        return run
    except Exception as exc:
        run.status = "failed"
        run.error_count = 1
        run.error_message = str(exc)
        run.finished_at = datetime.now(tz=UTC)
        db.session.commit()
        raise


def serialize_ingestion_run(run: IngestionRun) -> dict[str, object]:
    return {
        "id": run.id,
        "municipality": run.municipality,
        "status": run.status,
        "sourceUrl": run.source_url,
        "geojsonUrl": run.geojson_url,
        "totalFeatures": run.total_features,
        "normalizedCount": run.normalized_count,
        "insertedCount": run.inserted_count,
        "updatedCount": run.updated_count,
        "skippedCount": run.skipped_count,
        "errorCount": run.error_count,
        "errorMessage": run.error_message,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
    }


def _coerce_effective_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _compute_record_hash(record: dict[str, Any]) -> str:
    payload = {
        "zoneCode": record.get("zoneCode"),
        "zoneType": record.get("zoneType"),
        "zoneName": record.get("zoneName"),
        "status": record.get("status"),
        "bylawNumber": record.get("bylawNumber"),
        "effectiveDate": record.get("effectiveDate"),
        "sourceDocuments": record.get("sourceDocuments"),
        "geometry": record.get("geometry"),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
