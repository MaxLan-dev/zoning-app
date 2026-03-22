from app.services.zone_spatial import point_in_geometry


def test_point_inside_polygon():
    geom = {
        "type": "Polygon",
        "coordinates": [
            [
                [0.0, 0.0],
                [10.0, 0.0],
                [10.0, 10.0],
                [0.0, 10.0],
                [0.0, 0.0],
            ]
        ],
    }
    assert point_in_geometry(5.0, 5.0, geom) is True
    assert point_in_geometry(50.0, 50.0, geom) is False
