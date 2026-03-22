"""Tests for PDF text extraction and scraper-side PDF ingest helpers."""

import fitz

from app.ingestion.pdf import extract_pdf_with_ocr
from app.ingestion.scrapers import process_pdf_bytes


def _pdf_with_text(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), text)
    out = doc.tobytes()
    doc.close()
    return out


def test_extract_native_text_no_ocr_needed():
    pdf_bytes = _pdf_with_text("Minimum front yard setback shall be 6.0m.")
    result = extract_pdf_with_ocr(
        pdf_bytes,
        min_native_chars=10,
        ocr_enabled=False,
    )
    assert len(result.pages) == 1
    assert "6.0m" in result.pages[0].text
    assert result.pages[0].used_ocr is False
    assert "6.0m" in result.full_text


def test_process_pdf_bytes_wires_extractor():
    pdf_bytes = _pdf_with_text("duplex permitted")
    ingested = process_pdf_bytes(
        pdf_bytes,
        source_url="https://example.org/bylaw.pdf",
    )
    assert ingested.fetch.url.endswith("bylaw.pdf")
    assert "duplex" in ingested.extraction.full_text


def test_corrupt_pdf_returns_warning():
    result = extract_pdf_with_ocr(b"not a pdf", ocr_enabled=False)
    assert result.pages == []
    assert any("failed to open" in w.lower() for w in result.warnings)
