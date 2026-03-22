from __future__ import annotations

import json
from typing import Any

from shapely.geometry import Point, shape


def parse_geometry_dict(geometry_json: str) -> dict[str, Any] | None:
    try:
        data = json.loads(geometry_json)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def point_in_geometry(lng: float, lat: float, geometry: dict[str, Any]) -> bool:
    """True if (lng, lat) lies inside or on the boundary of a GeoJSON geometry."""
    try:
        geom = shape(geometry)
    except Exception:
        return False
    pt = Point(lng, lat)
    return bool(geom.covers(pt) or geom.touches(pt))
