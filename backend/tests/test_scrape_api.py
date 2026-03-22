from app.ingestion.scrapers import GeoJSONResult, ScrapedLink, ScrapePageResult


def test_scrape_links_requires_url(client):
    res = client.post("/api/v1/scrape/links", json={})
    assert res.status_code == 400
    assert "url" in res.get_json()["error"]


def test_scrape_links_validates_max_links(client):
    res = client.post(
        "/api/v1/scrape/links",
        json={"url": "https://example.org", "maxLinks": 0},
    )
    assert res.status_code == 400
    assert "maxLinks" in res.get_json()["error"]


def test_scrape_links_returns_result(client, monkeypatch):
    captured: dict[str, object] = {}

    def fake_scrape(url, *, allowed_domains, include_patterns, exclude_patterns):
        captured["url"] = url
        captured["allowed_domains"] = allowed_domains
        captured["include_patterns"] = include_patterns
        captured["exclude_patterns"] = exclude_patterns
        return ScrapePageResult(
            source_url=url,
            resolved_url=url,
            title="Example",
            links=[
                ScrapedLink(url="https://example.org/bylaw", text="Bylaw"),
                ScrapedLink(url="https://example.org/plan", text="Plan"),
            ],
        )

    monkeypatch.setattr("app.api.scrape.scrape_municipal_page", fake_scrape)

    res = client.post(
        "/api/v1/scrape/links",
        json={
            "url": "https://example.org",
            "maxLinks": 1,
            "allowedDomains": ["example.org"],
            "includePatterns": ["bylaw"],
            "excludePatterns": ["draft"],
        },
    )

    assert res.status_code == 200
    data = res.get_json()
    assert data["title"] == "Example"
    assert data["linkCount"] == 1
    assert len(data["links"]) == 1
    assert data["links"][0]["url"] == "https://example.org/bylaw"

    assert captured["url"] == "https://example.org"
    assert captured["allowed_domains"] == {"example.org"}
    assert captured["include_patterns"] == ("bylaw",)
    assert captured["exclude_patterns"] == ("draft",)


def test_scrape_geojson_returns_feature_collection(client, monkeypatch):
    def fake_geojson(
        *,
        source_url,
        geojson_url,
        allowed_domains,
        paginate,
        page_size,
        max_pages,
    ):
        assert source_url == "https://example.org/maps"
        assert geojson_url is None
        assert allowed_domains == {"example.org"}
        assert paginate is True
        assert page_size == 500
        assert max_pages == 10
        return GeoJSONResult(
            source_url=source_url,
            geojson_url="https://example.org/data/neighborhoods.geojson",
            feature_collection={
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"name": "Downtown", "zone": "R2"},
                        "geometry": {"type": "Point", "coordinates": [0, 0]},
                    },
                    {
                        "type": "Feature",
                        "properties": {"name": "Midtown", "zone": "R3"},
                        "geometry": {"type": "Point", "coordinates": [1, 1]},
                    },
                ],
            },
        )

    monkeypatch.setattr("app.api.scrape.scrape_geojson_data", fake_geojson)

    res = client.post(
        "/api/v1/scrape/geojson",
        json={
            "url": "https://example.org/maps",
            "allowedDomains": ["example.org"],
            "maxFeatures": 1,
            "propertyKeys": ["name"],
            "pageSize": 500,
            "maxPages": 10,
        },
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["type"] == "FeatureCollection"
    assert data["featureCount"] == 1
    assert data["geojsonUrl"] == "https://example.org/data/neighborhoods.geojson"
    assert data["features"][0]["properties"] == {"name": "Downtown"}


def test_scrape_geojson_validation_error(client, monkeypatch):
    def fake_geojson(
        *,
        source_url,
        geojson_url,
        allowed_domains,
        paginate,
        page_size,
        max_pages,
    ):
        raise ValueError("No GeoJSON URLs were discovered for the provided source URL")

    monkeypatch.setattr("app.api.scrape.scrape_geojson_data", fake_geojson)

    res = client.post("/api/v1/scrape/geojson", json={"url": "https://example.org"})
    assert res.status_code == 422
    assert "No GeoJSON URLs" in res.get_json()["error"]


def test_scrape_geojson_invalid_page_size(client):
    res = client.post(
        "/api/v1/scrape/geojson",
        json={"url": "https://example.org", "pageSize": 0},
    )
    assert res.status_code == 400
    assert "pageSize" in res.get_json()["error"]
