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

__all__ = [
    "FetchedDocument",
    "PdfIngestResult",
    "fetch_and_extract_pdf",
    "fetch_url",
    "process_pdf_bytes",
    "GeoJSONResult",
    "MunicipalWebScraper",
    "ScrapedLink",
    "ScrapePageResult",
    "scrape_geojson_data",
    "scrape_municipal_page",
]
