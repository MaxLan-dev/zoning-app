# Municipal HTML fetch + Beautiful Soup parsers per template
from app.ingestion.scrapers.municipal import (
    GeoJSONResult,
    MunicipalWebScraper,
    ScrapedLink,
    ScrapePageResult,
    scrape_geojson_data,
    scrape_municipal_page,
)

__all__ = [
    "GeoJSONResult",
    "MunicipalWebScraper",
    "ScrapedLink",
    "ScrapePageResult",
    "scrape_geojson_data",
    "scrape_municipal_page",
]
