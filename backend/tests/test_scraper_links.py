from bs4 import BeautifulSoup

from app.ingestion.scrapers.municipal import MunicipalWebScraper


def test_extract_links_normalizes_and_filters():
    html = """
    <html>
      <body>
        <a href="/bylaws/current#section-1"> Current Bylaw </a>
        <a href="https://example.org/docs/plan"> Official Plan </a>
        <a href="mailto:city@example.org"> Contact </a>
        <a href="https://other.org/bylaw"> External </a>
        <a href="/bylaws/current#section-2"> Duplicate URL Different Fragment </a>
      </body>
    </html>
    """
    soup = BeautifulSoup(html, "html.parser")

    links = MunicipalWebScraper._extract_links(
        soup=soup,
        base_url="https://example.org/zoning",
        allowed_domains={"example.org"},
        include_patterns=("bylaw", "plan"),
        exclude_patterns=("draft",),
    )

    assert [link.url for link in links] == [
        "https://example.org/bylaws/current",
        "https://example.org/docs/plan",
    ]
    assert [link.text for link in links] == ["Current Bylaw", "Official Plan"]


def test_extract_geojson_candidates_from_anchors_and_scripts():
    html = """
    <html>
      <body>
        <a href="/data/zones.geojson">Zones</a>
        <a href="https://example.org/data/ignore.csv">CSV</a>
        <script>
          const source = "https://example.org/data/neighborhoods.json";
          const external = "https://other.org/areas.geojson";
        </script>
      </body>
    </html>
    """
    soup = BeautifulSoup(html, "html.parser")

    urls = MunicipalWebScraper._extract_geojson_candidates(
        soup=soup,
        base_url="https://example.org/maps",
        allowed_domains={"example.org"},
    )

    assert urls == [
        "https://example.org/data/zones.geojson",
        "https://example.org/data/neighborhoods.json",
    ]


def test_fetch_geojson_payload_paginates_arcgis_query(monkeypatch):
    with MunicipalWebScraper() as scraper:
        calls: list[str] = []

        def fake_fetch(url: str):
            calls.append(url)
            if "resultOffset=0" in url:
                return {
                    "type": "FeatureCollection",
                    "features": [
                        {"type": "Feature", "properties": {"OBJECTID": 1}},
                        {"type": "Feature", "properties": {"OBJECTID": 2}},
                    ],
                }
            if "resultOffset=2" in url:
                return {
                    "type": "FeatureCollection",
                    "features": [{"type": "Feature", "properties": {"OBJECTID": 3}}],
                }
            return {"type": "FeatureCollection", "features": []}

        monkeypatch.setattr(scraper, "_fetch_json", fake_fetch)

        payload = scraper._fetch_geojson_payload(
            "https://example.org/MapServer/12/query?where=1%3D1&outFields=*&f=geojson",
            paginate=True,
            page_size=2,
            max_pages=10,
        )

    assert len(payload["features"]) == 3
    assert len(calls) == 2


def test_derive_arcgis_query_urls_from_mapserver_metadata():
    urls = MunicipalWebScraper._derive_arcgis_query_urls(
        service_url="https://example.org/ArcGIS/rest/services/Zoning/MapServer?f=json",
        payload={
            "layers": [
                {
                    "id": 6,
                    "name": "Zoning By-law 85-1 and 2019-051 (In Force and Effect)",
                    "type": "Feature Layer",
                    "geometryType": "esriGeometryPolygon",
                },
                {
                    "id": 15,
                    "name": "Proposed Zoning (Not in Effect)",
                    "type": "Feature Layer",
                    "geometryType": "esriGeometryPolygon",
                },
            ]
        },
        allowed_domains={"example.org"},
    )

    assert urls[0].startswith(
        "https://example.org/ArcGIS/rest/services/Zoning/MapServer/6/query"
    )
    assert any("/15/query" in url for url in urls)


def test_expand_geojson_candidates_from_arcgis_metadata(monkeypatch):
    with MunicipalWebScraper() as scraper:
        monkeypatch.setattr(
            scraper,
            "_fetch_json",
            lambda url: {
                "layers": [
                    {
                        "id": 12,
                        "name": "Zoning By-law 85-1 and 2019-051",
                        "type": "Feature Layer",
                        "geometryType": "esriGeometryPolygon",
                    }
                ]
            },
        )

        expanded = scraper._expand_geojson_candidates(
            "https://example.org/rest/services/Zoning/MapServer?f=json",
            allowed_domains={"example.org"},
        )

    assert expanded == [
        "https://example.org/rest/services/Zoning/MapServer/12/query"
        "?where=1%3D1&outFields=*&f=geojson&outSR=4326"
    ]
