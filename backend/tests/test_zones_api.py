from app.extensions import db
from app.models import ZoningRecord


def test_list_zones_returns_records(client):
    with client.application.app_context():
        record = ZoningRecord(
            municipality="kitchener",
            source_object_id="1",
            zone_code="RES-2",
            zone_type="RES",
            zone_name="Residential",
            status="APPROVED",
            bylaw_number="2019-051",
            geometry_json='{"type":"Polygon","coordinates":[]}',
            source_documents_json="[]",
            source_url="https://example.org/source",
            geojson_url="https://example.org/geojson",
            content_hash="abc123",
            last_run_id=None,
        )
        db.session.add(record)
        db.session.commit()

    res = client.get("/api/v1/zones?municipality=kitchener")
    assert res.status_code == 200
    data = res.get_json()
    assert data["total"] == 1
    assert len(data["records"]) == 1
    assert data["records"][0]["zoneCode"] == "RES-2"


def test_list_zones_validates_limit_and_offset(client):
    res_limit = client.get("/api/v1/zones?limit=0")
    assert res_limit.status_code == 400
    assert "limit" in res_limit.get_json()["error"]

    res_offset = client.get("/api/v1/zones?offset=-1")
    assert res_offset.status_code == 400
    assert "offset" in res_offset.get_json()["error"]
