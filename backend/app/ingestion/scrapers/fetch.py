"""HTTP fetch for ingestion; PDFs are passed through the OCR-aware text extractor."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlparse

import httpx

from ..pdf import PdfExtractionResult, extract_pdf_with_ocr

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 120.0
DEFAULT_UA = (
    "ZoningAppIngest/1.0 (+https://github.com/; municipal open data; contact: admin)"
)


@dataclass
class FetchedDocument:
    """Raw HTTP response metadata plus body."""

    url: str
    content: bytes
    content_type: str
    status_code: int
    headers: Mapping[str, str] = field(default_factory=dict)


@dataclass
class PdfIngestResult:
    """Fetched PDF plus structured text extraction (for DB / NLP downstream)."""

    fetch: FetchedDocument
    extraction: PdfExtractionResult


def _is_probably_pdf(content_type: str, url: str) -> bool:
    ct = (content_type or "").lower()
    if "application/pdf" in ct or ct.endswith("/pdf"):
        return True
    path = urlparse(url).path.lower()
    return path.endswith(".pdf")


def fetch_url(
    url: str,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    headers: Optional[Dict[str, str]] = None,
    follow_redirects: bool = True,
) -> FetchedDocument:
    """GET a URL and return bytes + basic metadata (used by scrapers and workers)."""
    req_headers = {"User-Agent": DEFAULT_UA}
    if headers:
        req_headers.update(headers)

    with httpx.Client(timeout=timeout_s, follow_redirects=follow_redirects) as client:
        response = client.get(url, headers=req_headers)
        response.raise_for_status()
        ct = response.headers.get("content-type", "").split(";")[0].strip()
        return FetchedDocument(
            url=str(response.url),
            content=response.content,
            content_type=ct,
            status_code=response.status_code,
            headers=dict(response.headers),
        )


def fetch_and_extract_pdf(
    url: str,
    *,
    ingest_metadata: Optional[Dict[str, Any]] = None,
    **httpx_kwargs: Any,
) -> PdfIngestResult:
    """
    Download a PDF from ``url`` and run :func:`extract_pdf_with_ocr` on the body.

    ``ingest_metadata`` is reserved for caller context (municipality id, source type);
    it is not modified here but can be merged by the orchestration layer.
    """
    _ = ingest_metadata  # orchestration may log or persist alongside result
    fetched = fetch_url(url, **httpx_kwargs)
    if not _is_probably_pdf(fetched.content_type, fetched.url):
        logger.warning(
            "URL may not be a PDF (content-type=%s): %s",
            fetched.content_type,
            fetched.url,
        )
    extraction = extract_pdf_with_ocr(fetched.content)
    return PdfIngestResult(fetch=fetched, extraction=extraction)


def process_pdf_bytes(
    content: bytes,
    *,
    source_url: str,
    content_type: str = "application/pdf",
    status_code: int = 200,
    headers: Optional[Mapping[str, str]] = None,
) -> PdfIngestResult:
    """Run OCR-aware extraction on already-downloaded PDF bytes (e.g. from S3 or a crawl queue)."""
    fetch = FetchedDocument(
        url=source_url,
        content=content,
        content_type=content_type,
        status_code=status_code,
        headers=dict(headers or {}),
    )
    extraction = extract_pdf_with_ocr(content)
    return PdfIngestResult(fetch=fetch, extraction=extraction)
