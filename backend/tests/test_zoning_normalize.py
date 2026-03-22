from app.ingestion.normalize import normalize_zoning_feature_collection
from app.ingestion.scrapers.templates import get_municipality_template


def test_normalize_kitchener_feature_collection():
    template = get_municipality_template("kitchener")
    result = normalize_zoning_feature_collection(
        municipality=template,
        source_url="https://example.org/source",
        geojson_url="https://example.org/geojson",
        feature_collection={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "OBJECTID": 10,
                        "ZONE_CLASS": "RES-2",
                        "ZONE_TYPE": "RES",
                        "STATUS": "APPROVED",
                        "BYLAW_NO": "2022-040",
                        "EFFECTIVE_DATE": 1647856800000,
                        "GENERALDOCUMENT1": "https://example.org/bylaw.pdf",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    )

    assert result.total_features == 1
    assert result.normalized_count == 1
    assert result.skipped_count == 0
    record = result.records[0]
    assert record["zoneCode"] == "RES-2"
    assert record["zoneType"] == "RES"
    assert record["status"] == "APPROVED"
    assert record["bylawNumber"] == "2022-040"
    assert record["effectiveDate"] == "2022-03-21"
    assert record["sourceObjectId"] == "10"
    assert record["sourceDocuments"] == ["https://example.org/bylaw.pdf"]


def test_normalize_skips_missing_zone_code():
    template = get_municipality_template("kitchener")
    result = normalize_zoning_feature_collection(
        municipality=template,
        source_url="https://example.org/source",
        geojson_url="https://example.org/geojson",
        feature_collection={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": 1},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    )
    assert result.total_features == 1
    assert result.normalized_count == 0
    assert result.skipped_count == 1
