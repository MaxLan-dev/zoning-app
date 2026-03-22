"""PDF text extraction with optional OCR for scanned or hybrid pages (PyMuPDF + Tesseract)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List

import fitz

DEFAULT_MIN_NATIVE_CHARS = 50
DEFAULT_OCR_DPI = 150


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip(), 10)
    except ValueError:
        return default


@dataclass
class PdfPageExtract:
    page_number: int
    text: str
    used_ocr: bool = False


@dataclass
class PdfExtractionResult:
    pages: List[PdfPageExtract] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages if p.text)

    @property
    def used_ocr_any(self) -> bool:
        return any(p.used_ocr for p in self.pages)


def extract_pdf_with_ocr(
    pdf_bytes: bytes,
    *,
    min_native_chars: int | None = None,
    ocr_dpi: int | None = None,
    language: str | None = None,
    ocr_enabled: bool | None = None,
    try_partial_ocr: bool | None = None,
) -> PdfExtractionResult:
    """
    Open a PDF from bytes, extract text per page, and run Tesseract OCR when native text is sparse.

    Requires Tesseract installed and discoverable by PyMuPDF for OCR paths. If OCR fails
    (missing binary, tessdata), native text is still returned and warnings are recorded.

    Environment (optional overrides):
        PDF_OCR_ENABLED: default true
        PDF_OCR_MIN_NATIVE_CHARS: below this (per page), attempt full-page OCR
        PDF_OCR_DPI: render resolution for OCR
        PDF_OCR_LANGUAGE: Tesseract language string (e.g. eng, eng+fra)
        PDF_OCR_PARTIAL: if true, run partial OCR on every page to fill image-only regions
    """
    if min_native_chars is None:
        min_native_chars = _env_int("PDF_OCR_MIN_NATIVE_CHARS", DEFAULT_MIN_NATIVE_CHARS)
    if ocr_dpi is None:
        ocr_dpi = _env_int("PDF_OCR_DPI", DEFAULT_OCR_DPI)
    if language is None:
        language = os.environ.get("PDF_OCR_LANGUAGE", "eng").strip() or "eng"
    if ocr_enabled is None:
        ocr_enabled = _env_bool("PDF_OCR_ENABLED", True)
    if try_partial_ocr is None:
        try_partial_ocr = _env_bool("PDF_OCR_PARTIAL", False)

    warnings: List[str] = []
    pages_out: List[PdfPageExtract] = []

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        warnings.append(f"failed to open PDF: {e}")
        return PdfExtractionResult(pages=[], warnings=warnings)

    try:
        for i in range(len(doc)):
            page = doc.load_page(i)
            page_num = i + 1
            native = page.get_text() or ""
            native_stripped = native.strip()
            text = native_stripped
            used_ocr = False

            if ocr_enabled:
                if try_partial_ocr and native_stripped:
                    try:
                        tp = page.get_textpage_ocr(
                            dpi=ocr_dpi, full=False, language=language
                        )
                        partial = (page.get_text(textpage=tp) or "").strip()
                        if len(partial) > len(text):
                            text = partial
                            used_ocr = True
                    except Exception as e:
                        warnings.append(f"page {page_num}: partial OCR failed: {e}")

                if len(text) < min_native_chars:
                    try:
                        tp = page.get_textpage_ocr(
                            dpi=ocr_dpi, full=True, language=language
                        )
                        ocr_text = (page.get_text(textpage=tp) or "").strip()
                        if len(ocr_text) >= len(text):
                            text = ocr_text
                            used_ocr = True
                    except Exception as e:
                        warnings.append(f"page {page_num}: full OCR failed: {e}")
            elif len(native_stripped) < min_native_chars:
                warnings.append(
                    f"page {page_num}: sparse native text ({len(native_stripped)} chars) "
                    "and PDF_OCR_ENABLED is false; OCR skipped"
                )

            pages_out.append(
                PdfPageExtract(page_number=page_num, text=text, used_ocr=used_ocr)
            )
    finally:
        doc.close()

    return PdfExtractionResult(pages=pages_out, warnings=warnings)
