from app.extensions import db
from app.models import IngestionRun
from app.models import ZoningRecord


def test_ingest_zoning_requires_municipality(client):
    res = client.post("/api/v1/jobs/ingest-zoning", json={})
    assert res.status_code == 400
    assert "municipality" in res.get_json()["error"]


def test_ingest_zoning_creates_run_and_records(client, monkeypatch):
    def fake_scrape_geojson_data(
        *,
        source_url,
        geojson_url,
        allowed_domains,
        paginate,
        page_size,
        max_pages,
    ):
        assert "utility.arcgis.com" in allowed_domains
        assert paginate is True
        assert page_size == 1000
        assert max_pages == 5
        return type(
            "Scraped",
            (),
            {
                "source_url": source_url,
                "geojson_url": geojson_url,
                "feature_collection": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {
                                "OBJECTID": 1,
                                "ZONE_CLASS": "RES-2",
                                "ZONE_TYPE": "RES",
                                "BYLAW_NO": "2019-051",
                            },
                            "geometry": {"type": "Polygon", "coordinates": []},
                        }
                    ],
                },
            },
        )()

    monkeypatch.setattr(
        "app.services.ingestion_service.scrape_geojson_data",
        fake_scrape_geojson_data,
    )

    res = client.post(
        "/api/v1/jobs/ingest-zoning",
        json={
            "municipality": "kitchener",
            "pageSize": 1000,
            "maxPages": 5,
        },
    )

    assert res.status_code == 201
    run = res.get_json()["run"]
    assert run["status"] == "completed"
    assert run["insertedCount"] == 1
    assert run["updatedCount"] == 0
    assert run["addedCount"] == 1
    assert run["unchangedCount"] == 0
    assert run["removedCount"] == 0
    assert run["normalizedCount"] == 1
    assert run["totalFeatures"] == 1

    with client.application.app_context():
        records = ZoningRecord.query.all()
    assert len(records) == 1
    assert records[0].zone_code == "RES-2"


def test_ingest_zoning_updates_existing_records(client, monkeypatch):
    responses = [
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 1, "ZONE_CLASS": "RES-2"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 1, "ZONE_CLASS": "RES-3"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    ]

    def fake_scrape_geojson_data(
        *,
        source_url,
        geojson_url,
        allowed_domains,
        paginate,
        page_size,
        max_pages,
    ):
        return type(
            "Scraped",
            (),
            {
                "source_url": source_url,
                "geojson_url": geojson_url,
                "feature_collection": responses.pop(0),
            },
        )()

    monkeypatch.setattr(
        "app.services.ingestion_service.scrape_geojson_data",
        fake_scrape_geojson_data,
    )

    first = client.post("/api/v1/jobs/ingest-zoning", json={"municipality": "kitchener"})
    second = client.post("/api/v1/jobs/ingest-zoning", json={"municipality": "kitchener"})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json()["run"]["insertedCount"] == 1
    assert first.get_json()["run"]["addedCount"] == 1
    assert second.get_json()["run"]["updatedCount"] == 1
    assert second.get_json()["run"]["addedCount"] == 0
    assert second.get_json()["run"]["unchangedCount"] == 0
    assert second.get_json()["run"]["removedCount"] == 0

    with client.application.app_context():
        records = ZoningRecord.query.all()
    assert len(records) == 1
    assert records[0].zone_code == "RES-3"


def test_ingest_zoning_counts_removed_and_unchanged(client, monkeypatch):
    responses = [
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 1, "ZONE_CLASS": "RES-2"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                },
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 2, "ZONE_CLASS": "RES-3"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                },
            ],
        },
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 1, "ZONE_CLASS": "RES-2"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    ]

    def fake_scrape_geojson_data(
        *,
        source_url,
        geojson_url,
        allowed_domains,
        paginate,
        page_size,
        max_pages,
    ):
        return type(
            "Scraped",
            (),
            {
                "source_url": source_url,
                "geojson_url": geojson_url,
                "feature_collection": responses.pop(0),
            },
        )()

    monkeypatch.setattr(
        "app.services.ingestion_service.scrape_geojson_data",
        fake_scrape_geojson_data,
    )

    first = client.post("/api/v1/jobs/ingest-zoning", json={"municipality": "kitchener"})
    second = client.post("/api/v1/jobs/ingest-zoning", json={"municipality": "kitchener"})
    assert first.status_code == 201
    assert second.status_code == 201
    second_run = second.get_json()["run"]
    assert second_run["addedCount"] == 0
    assert second_run["unchangedCount"] == 1
    assert second_run["removedCount"] == 1


def test_list_supported_municipalities(client):
    res = client.get("/api/v1/jobs/ingest-zoning/municipalities")
    assert res.status_code == 200
    data = res.get_json()
    slugs = {item["slug"] for item in data["municipalities"]}
    assert {"waterloo", "kitchener"}.issubset(slugs)


def test_list_ingestion_runs_returns_latest_by_municipality(client, app):
    with app.app_context():
        first = IngestionRun(
            municipality="waterloo",
            status="completed",
            source_url="https://example.com/w1",
            geojson_url="https://example.com/w1.geojson",
            total_features=10,
            normalized_count=8,
            inserted_count=8,
            updated_count=1,
            added_count=2,
            unchanged_count=5,
            removed_count=1,
            skipped_count=2,
            error_count=0,
        )
        second = IngestionRun(
            municipality="kitchener",
            status="failed",
            source_url="https://example.com/k1",
            geojson_url="https://example.com/k1.geojson",
            total_features=12,
            normalized_count=12,
            inserted_count=12,
            updated_count=0,
            added_count=0,
            unchanged_count=12,
            removed_count=0,
            skipped_count=0,
            error_count=1,
            error_message="boom",
        )
        db.session.add(first)
        db.session.add(second)
        db.session.commit()

    res = client.get("/api/v1/jobs/ingest-zoning/runs?limit=5")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data["runs"]) == 2
    assert data["latestByMunicipality"]["waterloo"]["coverageRate"] == 80.0
    assert "partial_normalization" in data["latestByMunicipality"]["waterloo"]["reviewFlags"]
    assert "changes_detected" in data["latestByMunicipality"]["waterloo"]["reviewFlags"]
    assert "errors_present" in data["latestByMunicipality"]["kitchener"]["reviewFlags"]


def test_list_ingestion_runs_validates_limit(client):
    res = client.get("/api/v1/jobs/ingest-zoning/runs?limit=0")
    assert res.status_code == 400
    assert "limit" in res.get_json()["error"]
