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


def test_normalize_picks_url_from_bylaw_url_field():
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
                        "OBJECTID": 11,
                        "ZONE_CLASS": "C1",
                        "BYLAW_URL": "https://example.org/c1-bylaw.pdf",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    )
    assert result.normalized_count == 1
    assert result.records[0]["sourceDocuments"] == ["https://example.org/c1-bylaw.pdf"]


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


def test_normalize_waterloo_feature_collection_uses_layer_48_fields():
    template = get_municipality_template("waterloo")
    result = normalize_zoning_feature_collection(
        municipality=template,
        source_url=template.source_url,
        geojson_url=template.default_geojson_url or "https://example.org/geojson",
        feature_collection={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "ZONING_ID": 512,
                        "ZONE_CODE": "MR-25",
                        "ZONE_LABEL": "Medium Density Residential",
                        "STATUS": "In Force",
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
    assert record["sourceObjectId"] == "512"
    assert record["zoneCode"] == "MR-25"
    assert record["zoneName"] == "Medium Density Residential"
    assert record["status"] == "In Force"
    assert record["zoneType"] == "Mixed Residential"


def test_waterloo_template_points_to_arcgis_source_and_default_geojson():
    template = get_municipality_template("waterloo")
    assert template.source_url == (
        "https://gis.waterloo.ca/maps/rest/services/Public/"
        "Public_Operations/MapServer?f=json"
    )
    assert template.default_geojson_url == (
        "https://gis.waterloo.ca/maps/rest/services/Public/Public_Operations/"
        "MapServer/48/query?where=1%3D1&outFields=*&f=geojson&outSR=4326"
    )
    assert template.required_source_object_id is True
    assert template.allowed_geometry_types == ("Polygon", "MultiPolygon")


def test_normalize_waterloo_skips_non_polygon_and_missing_source_id():
    template = get_municipality_template("waterloo")
    result = normalize_zoning_feature_collection(
        municipality=template,
        source_url=template.source_url,
        geojson_url=template.default_geojson_url or "https://example.org/geojson",
        feature_collection={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "ZONING_ID": 1,
                        "ZONE_CODE": "R1",
                        "ZONE_LABEL": "Residential",
                    },
                    "geometry": {"type": "LineString", "coordinates": []},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "ZONE_CODE": "R2",
                        "ZONE_LABEL": "Residential Two",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "ZONING_ID": 3,
                        "ZONE_CODE": "R3",
                        "ZONE_LABEL": "Residential Three",
                    },
                    "geometry": {"type": "MultiPolygon", "coordinates": []},
                },
            ],
        },
    )

    assert result.total_features == 3
    assert result.normalized_count == 1
    assert result.skipped_count == 2
    assert result.records[0]["sourceObjectId"] == "3"
    assert result.records[0]["zoneCode"] == "R3"
    assert result.records[0]["zoneType"] == "Residential"


def test_normalize_waterloo_prefers_explicit_zone_type_when_present():
    template = get_municipality_template("waterloo")
    result = normalize_zoning_feature_collection(
        municipality=template,
        source_url=template.source_url,
        geojson_url=template.default_geojson_url or "https://example.org/geojson",
        feature_collection={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "ZONING_ID": 42,
                        "ZONE_CODE": "R8",
                        "ZONE_TYPE": "Custom Residential Bucket",
                        "ZONE_LABEL": "High Rise Residential",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ],
        },
    )

    assert result.normalized_count == 1
    assert result.records[0]["zoneType"] == "Custom Residential Bucket"
