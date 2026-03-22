import json

from app.extensions import db
from app.models import ZoningRecord


def _add_zone_square(
    municipality: str = "demo",
    zone_code: str = "R1",
    *,
    source_object_id: str = "s1",
) -> int:
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [-67.6, 45.4],
                [-67.4, 45.4],
                [-67.4, 45.6],
                [-67.6, 45.6],
                [-67.6, 45.4],
            ]
        ],
    }
    r = ZoningRecord(
        municipality=municipality,
        source_object_id=source_object_id,
        zone_code=zone_code,
        zone_type="residential",
        zone_name="Demo",
        status="active",
        bylaw_number=None,
        effective_date=None,
        source_documents_json=json.dumps(["https://example.com/bylaw.pdf"]),
        geometry_json=json.dumps(poly),
        source_url="https://example.com",
        geojson_url="https://example.com/data.geojson",
        content_hash="x" * 64,
    )
    db.session.add(r)
    db.session.commit()
    return r.id


def test_geojson_requires_scope(client):
    res = client.get("/api/v1/zones/geojson")
    assert res.status_code == 400
    assert res.get_json()["error"] == "missing_scope"


def test_geojson_returns_features(client, app):
    with app.app_context():
        _add_zone_square()
    res = client.get("/api/v1/zones/geojson?municipality=demo")
    assert res.status_code == 200
    data = res.get_json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
    assert data["features"][0]["properties"]["zoneCode"] == "R1"


def test_at_point_finds_zone(client, app):
    with app.app_context():
        _add_zone_square()
    res = client.get(
        "/api/v1/zones/at-point?lat=45.5&lng=-67.5&municipality=demo",
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["matchCount"] == 1
    assert data["matches"][0]["zoneCode"] == "R1"
    assert "https://example.com/bylaw.pdf" in data["matches"][0]["sourceDocuments"]
    assert data["matches"][0]["publicResources"] == []
    assert data["municipalitiesSearched"] == ["demo"]


def test_at_point_includes_public_resources_for_waterloo(client, app):
    with app.app_context():
        _add_zone_square(municipality="waterloo", zone_code="Z1", source_object_id="w99")
    res = client.get(
        "/api/v1/zones/at-point?lat=45.5&lng=-67.5&municipality=waterloo",
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["matchCount"] == 1
    pr = data["matches"][0]["publicResources"]
    assert len(pr) >= 1
    assert any("waterloo.ca" in item["url"] for item in pr)


def test_geojson_region_waterloo_kitchener_merges(client, app):
    with app.app_context():
        _add_zone_square(municipality="waterloo", zone_code="W1", source_object_id="w1")
        _add_zone_square(municipality="kitchener", zone_code="K1", source_object_id="k1")
    res = client.get("/api/v1/zones/geojson?region=waterloo-kitchener")
    assert res.status_code == 200
    data = res.get_json()
    codes = {f["properties"]["zoneCode"] for f in data["features"]}
    assert codes == {"W1", "K1"}


def test_at_point_defaults_to_waterloo_kitchener_slugs(client, app):
    """No municipality param → search waterloo + kitchener only (not other slugs)."""
    with app.app_context():
        _add_zone_square(municipality="waterloo", zone_code="WZ", source_object_id="w1")
        _add_zone_square(municipality="demo", zone_code="DZ", source_object_id="d1")
    res = client.get("/api/v1/zones/at-point?lat=45.5&lng=-67.5")
    assert res.status_code == 200
    data = res.get_json()
    assert data["municipalitiesSearched"] == ["waterloo", "kitchener"]
    assert data["matchCount"] == 1
    assert data["matches"][0]["zoneCode"] == "WZ"


def test_documents_ingest_url_validation(client):
    res = client.post("/api/v1/documents/ingest-url", json={})
    assert res.status_code == 400


def test_region_summary_requires_scope(client):
    res = client.get("/api/v1/zones/region-summary")
    assert res.status_code == 400


def test_zone_analyze_not_found(client):
    res = client.post("/api/v1/zones/999999/analyze", json={})
    assert res.status_code == 404


def test_zone_analyze_returns_record_and_ingest(client, app, monkeypatch):
    with app.app_context():
        zid = _add_zone_square(
            municipality="waterloo",
            zone_code="Z9",
            source_object_id="z9",
        )

    monkeypatch.setattr(
        "app.api.zones.ingest_documents_for_zone",
        lambda _app, _rec: [{"status": "skipped", "source_url": "https://x/y.pdf"}],
    )
    monkeypatch.setattr(
        "app.services.rag.run_rag",
        lambda *_a, **_kw: {
            "answer": "Test answer.",
            "sources": [],
            "model": "test-model",
        },
    )

    app.config["GROQ_API_KEY"] = "test-key"

    res = client.post(f"/api/v1/zones/{zid}/analyze", json={})
    assert res.status_code == 200
    data = res.get_json()
    assert data["zoneId"] == zid
    assert data["record"]["zoneCode"] == "Z9"
    assert data["ingest"]["results"][0]["status"] == "skipped"
    assert data["ingest"]["summary"]["linkedPdfUrlsInOpenData"] == 1
    assert data["rag"]["answer"] == "Test answer."


def test_region_summary_counts(client, app):
    with app.app_context():
        _add_zone_square(municipality="waterloo", zone_code="W1", source_object_id="w1")
        _add_zone_square(municipality="kitchener", zone_code="K1", source_object_id="k1")
    res = client.get("/api/v1/zones/region-summary?region=waterloo-kitchener")
    assert res.status_code == 200
    data = res.get_json()
    assert data["totalZones"] == 2
    assert data["countByMunicipality"]["waterloo"] == 1
    assert data["countByMunicipality"]["kitchener"] == 1
