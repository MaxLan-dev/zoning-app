from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MunicipalityTemplate:
    slug: str
    display_name: str
    source_url: str
    allowed_domains: tuple[str, ...]
    default_geojson_url: str | None = None
    zone_code_fields: tuple[str, ...] = ()
    zone_type_fields: tuple[str, ...] = ()
    zone_name_fields: tuple[str, ...] = ()
    status_fields: tuple[str, ...] = ()
    bylaw_number_fields: tuple[str, ...] = ()
    effective_date_fields: tuple[str, ...] = ()
    source_id_fields: tuple[str, ...] = ()


_TEMPLATES: dict[str, MunicipalityTemplate] = {
    "kitchener": MunicipalityTemplate(
        slug="kitchener",
        display_name="City of Kitchener",
        source_url=(
            "https://utility.arcgis.com/usrsvcs/servers/"
            "771332f76961485098ac5b24d6ec9a5b/rest/services/"
            "OnPoint_Int_Ext/Zoning/MapServer?f=json"
        ),
        allowed_domains=("utility.arcgis.com", "kitchener.ca", "app2.kitchener.ca"),
        default_geojson_url=(
            "https://utility.arcgis.com/usrsvcs/servers/"
            "771332f76961485098ac5b24d6ec9a5b/rest/services/"
            "OnPoint_Int_Ext/Zoning/MapServer/12/query"
            "?where=1%3D1&outFields=*&f=geojson&outSR=4326"
        ),
        zone_code_fields=("ZONE_CLASS", "ZONE_CODE", "ZONE"),
        zone_type_fields=("ZONE_TYPE",),
        zone_name_fields=("MAP_LABEL", "ZONE_NAME"),
        status_fields=("STATUS",),
        bylaw_number_fields=("BYLAW_NO", "BYLAW"),
        effective_date_fields=("EFFECTIVE_DATE", "DATE_APPROVED"),
        source_id_fields=("OBJECTID", "ZONEID", "id"),
    ),
    "waterloo": MunicipalityTemplate(
        slug="waterloo",
        display_name="City of Waterloo",
        source_url=(
            "https://gis.waterloo.ca/maps/rest/services/Public/"
            "Public_Operations/MapServer?f=json"
        ),
        allowed_domains=("gis.waterloo.ca", "maps.waterloo.ca", "waterloo.ca"),
        default_geojson_url=(
            "https://gis.waterloo.ca/maps/rest/services/Public/Public_Operations/"
            "MapServer/48/query?where=1%3D1&outFields=*&f=geojson&outSR=4326"
        ),
        zone_code_fields=("ZONE", "ZONE_CODE", "ZONE_CLASS"),
        zone_type_fields=("ZONE_TYPE",),
        zone_name_fields=("ZONE_LABEL", "ZONE_NAME", "LABEL"),
        status_fields=("STATUS",),
        bylaw_number_fields=("BYLAW_NO", "BYLAW"),
        effective_date_fields=("EFFECTIVE_DATE",),
        source_id_fields=("ZONING_ID", "OBJECTID", "id"),
    ),
}


def get_municipality_template(slug: str) -> MunicipalityTemplate:
    key = slug.strip().lower()
    template = _TEMPLATES.get(key)
    if template is None:
        raise ValueError(f"Unsupported municipality template: {slug}")
    return template


def list_municipality_templates() -> list[MunicipalityTemplate]:
    return list(_TEMPLATES.values())
