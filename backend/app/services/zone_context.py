from __future__ import annotations

import math
from typing import Any

from shapely.geometry import MultiPolygon, Polygon, shape


def _ring_area_m2(coords: list[tuple[float, float]], kx: float, ky: float) -> float:
    """Shoelace area in m² after scaling lon/lat to meters at approximate latitude."""
    if len(coords) < 3:
        return 0.0
    xs = [p[0] * kx for p in coords]
    ys = [p[1] * ky for p in coords]
    n = len(xs)
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(s) / 2.0


def _polygon_area_m2(poly: Polygon, kx: float, ky: float) -> float:
    ext = _ring_area_m2(list(poly.exterior.coords), kx, ky)
    holes = sum(_ring_area_m2(list(ring.coords), kx, ky) for ring in poly.interiors)
    return ext - holes


def summarize_geometry_for_rag(geometry: dict[str, Any] | None) -> dict[str, Any]:
    """
    Centroid, bbox (WGS84), and rough area in m² using planar scaling at centroid latitude.
    Suitable for prompt grounding, not legal surveys.
    """
    out: dict[str, Any] = {
        "geojsonType": None,
        "centroidLng": None,
        "centroidLat": None,
        "bboxMinLng": None,
        "bboxMinLat": None,
        "bboxMaxLng": None,
        "bboxMaxLat": None,
        "approxAreaM2": None,
    }
    if not geometry or not isinstance(geometry, dict):
        return out
    try:
        g = shape(geometry)
    except Exception:
        return out
    if g.is_empty:
        return out
    out["geojsonType"] = geometry.get("type")
    c = g.centroid
    out["centroidLng"], out["centroidLat"] = float(c.x), float(c.y)
    minx, miny, maxx, maxy = g.bounds
    out["bboxMinLng"], out["bboxMinLat"], out["bboxMaxLng"], out["bboxMaxLat"] = (
        float(minx),
        float(miny),
        float(maxx),
        float(maxy),
    )
    lat0 = math.radians(c.y)
    kx = 111_320.0 * math.cos(lat0)
    ky = 111_320.0
    try:
        if isinstance(g, Polygon):
            out["approxAreaM2"] = round(_polygon_area_m2(g, kx, ky), 1)
        elif isinstance(g, MultiPolygon):
            total = 0.0
            for p in g.geoms:
                if isinstance(p, Polygon):
                    total += _polygon_area_m2(p, kx, ky)
            out["approxAreaM2"] = round(total, 1)
    except Exception:
        out["approxAreaM2"] = None
    return out


def format_zone_context_for_rag(record_detail: dict[str, Any]) -> str:
    """Human-readable block for LLM: open-data identity + geometry summary (not bylaw text)."""
    geom = record_detail.get("geometry")
    stats = summarize_geometry_for_rag(geom) if isinstance(geom, dict) else summarize_geometry_for_rag(None)

    lines: list[str] = [
        f"- Zone record id: {record_detail.get('id')}",
        f"- Municipality: {record_detail.get('municipality')}",
        f"- Zone code: {record_detail.get('zoneCode')}",
    ]
    zn = record_detail.get("zoneName")
    if zn:
        lines.append(f"- Zone name (open data): {zn}")
    zt = record_detail.get("zoneType")
    if zt:
        lines.append(f"- Zone category / type: {zt}")
    st = record_detail.get("status")
    if st:
        lines.append(f"- Status: {st}")
    bylaw = record_detail.get("bylawNumber")
    if bylaw:
        lines.append(f"- Bylaw reference (open data): {bylaw}")
    eff = record_detail.get("effectiveDate")
    if eff:
        lines.append(f"- Effective date (open data): {eff}")
    lines.append(f"- Source feature id: {record_detail.get('sourceObjectId')}")

    if stats.get("geojsonType"):
        lines.append(f"- Polygon geometry type: {stats['geojsonType']}")
    if stats.get("approxAreaM2") is not None:
        lines.append(
            f"- Approx. polygon area (planar estimate at centroid lat): {stats['approxAreaM2']:,.0f} m²"
        )
    if stats.get("centroidLat") is not None and stats.get("centroidLng") is not None:
        lines.append(
            f"- Approx. centroid (WGS84): lat {stats['centroidLat']:.6f}, lng {stats['centroidLng']:.6f}"
        )
    if all(
        stats.get(k) is not None
        for k in ("bboxMinLng", "bboxMinLat", "bboxMaxLng", "bboxMaxLat")
    ):
        lines.append(
            f"- Bounding box (WGS84): "
            f"({stats['bboxMinLng']:.6f}, {stats['bboxMinLat']:.6f}) — "
            f"({stats['bboxMaxLng']:.6f}, {stats['bboxMaxLat']:.6f})"
        )

    n_docs = len(record_detail.get("sourceDocuments") or [])
    lines.append(f"- Linked bylaw PDF URLs in open data: {n_docs}")

    return "\n".join(lines)
