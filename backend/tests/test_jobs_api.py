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
    assert second.get_json()["run"]["updatedCount"] == 1

    with client.application.app_context():
        records = ZoningRecord.query.all()
    assert len(records) == 1
    assert records[0].zone_code == "RES-3"
