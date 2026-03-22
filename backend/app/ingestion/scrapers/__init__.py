# Municipal HTML fetch + Beautiful Soup parsers per template
from .fetch import (
    FetchedDocument,
    PdfIngestResult,
    fetch_and_extract_pdf,
    fetch_url,
    process_pdf_bytes,
)
from .municipal import (
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
    "FetchedDocument",
    "PdfIngestResult",
    "fetch_and_extract_pdf",
    "fetch_url",
    "process_pdf_bytes",
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
