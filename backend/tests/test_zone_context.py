from app.services.zone_context import format_zone_context_for_rag, summarize_geometry_for_rag


def test_summarize_geometry_polygon_centroid_and_area():
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [-80.5, 43.45],
                [-80.49, 43.45],
                [-80.49, 43.46],
                [-80.5, 43.46],
                [-80.5, 43.45],
            ]
        ],
    }
    s = summarize_geometry_for_rag(geom)
    assert s["geojsonType"] == "Polygon"
    assert s["centroidLat"] is not None and s["centroidLng"] is not None
    assert s["approxAreaM2"] is not None
    assert s["approxAreaM2"] > 0
    assert s["bboxMinLng"] == -80.5


def test_format_zone_context_includes_zone_code_and_geometry():
    detail = {
        "id": 42,
        "municipality": "kitchener",
        "zoneCode": "SGA-2",
        "zoneName": "Sample zone",
        "zoneType": "SGA",
        "status": "APPROVED",
        "bylawNumber": "2024-001",
        "effectiveDate": "2024-01-01",
        "sourceObjectId": "99",
        "sourceDocuments": ["https://example.com/a.pdf"],
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [-80.5, 43.45],
                    [-80.49, 43.45],
                    [-80.49, 43.46],
                    [-80.5, 43.46],
                    [-80.5, 43.45],
                ]
            ],
        },
    }
    text = format_zone_context_for_rag(detail)
    assert "SGA-2" in text
    assert "kitchener" in text
    assert "Sample zone" in text
    assert "Zone record id: 42" in text
    assert "Linked bylaw PDF URLs in open data: 1" in text
    assert "Approx. polygon area" in text
