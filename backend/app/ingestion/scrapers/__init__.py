# Municipal HTML fetch + Beautiful Soup parsers per template
from app.ingestion.scrapers.municipal import (
    GeoJSONResult,
    MunicipalWebScraper,
    ScrapedLink,
    ScrapePageResult,
    scrape_geojson_data,
    scrape_municipal_page,
)
from app.ingestion.scrapers.templates import (
    MunicipalityTemplate,
    get_municipality_template,
    list_municipality_templates,
)

__all__ = [
    "GeoJSONResult",
    "MunicipalityTemplate",
    "MunicipalWebScraper",
    "ScrapedLink",
    "ScrapePageResult",
    "get_municipality_template",
    "list_municipality_templates",
    "scrape_geojson_data",
    "scrape_municipal_page",
]
