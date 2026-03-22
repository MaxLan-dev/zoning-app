from __future__ import annotations

from flask import Blueprint, jsonify, request

from app.models import ZoningRecord

bp = Blueprint("zones", __name__, url_prefix="/api/v1/zones")


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
            "records": [_serialize_zone(record) for record in records],
        }
    )


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
