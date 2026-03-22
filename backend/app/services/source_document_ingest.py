from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, unquote, urlparse, urlunparse

from flask import Flask
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.ingestion.scrapers.fetch import fetch_url, _is_probably_pdf
from app.models import SourceDocument, ZoningRecord
from app.services.pdf_vector_ingest import (
    delete_qdrant_points_for_document,
    ingest_pdf_bytes_to_qdrant,
)


def _filename_from_url(url: str) -> str:
    path = urlparse(url).path
    name = path.rsplit("/", 1)[-1].strip() or "document.pdf"
    return name if name.lower().endswith(".pdf") else f"{name}.pdf"


def looks_like_pdf_url(url: str) -> bool:
    u = url.strip().lower()
    if u.endswith(".pdf"):
        return True
    if "format=pdf" in u or "/pdf" in u:
        return True
    return False


def canonical_source_url(url: str) -> str:
    """
    Stable form for DB unique key: lower scheme/host, path normalized
    (e.g. literal spaces vs %20) so the same PDF URL is not inserted twice.
    """
    s = (url or "").strip()
    if not s:
        return s
    p = urlparse(s)
    scheme = (p.scheme or "https").lower()
    netloc = p.netloc.lower()
    path = quote(unquote(p.path), safe="/:@%._-+!$&'()*+,;=[]~")
    return urlunparse((scheme, netloc, path, "", p.query, p.fragment))


def _find_source_document_row(url: str, *, content_hash: str | None = None) -> SourceDocument | None:
    url_fetch = url.strip()
    url_key = canonical_source_url(url_fetch)
    for candidate in (url_key, url_fetch):
        if not candidate:
            continue
        row = SourceDocument.query.filter_by(source_url=candidate).one_or_none()
        if row is not None:
            return row
    if content_hash:
        return SourceDocument.query.filter_by(content_hash=content_hash).one_or_none()
    return None


def ingest_pdf_url_to_qdrant(
    app: Flask,
    url: str,
    *,
    municipality: str | None = None,
    zone_code: str | None = None,
    source_object_id: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """
    Download a PDF from ``url``, dedupe by SHA-256 of bytes, upsert into Qdrant.
    Persists :class:`SourceDocument` for idempotent by URL (canonical) + content hash.
    """
    url_fetch = url.strip()
    if not url_fetch:
        return {"error": "invalid_url", "message": "URL is empty."}

    fetched = fetch_url(url_fetch)
    body = fetched.content
    if not body:
        return {"error": "empty_body", "message": "Downloaded empty response.", "source_url": url_fetch}

    if not _is_probably_pdf(fetched.content_type, fetched.url) and not looks_like_pdf_url(url_fetch):
        return {
            "error": "not_pdf",
            "message": "URL does not look like a PDF (check content-type or path).",
            "content_type": fetched.content_type,
            "source_url": url_fetch,
        }

    h = hashlib.sha256(body).hexdigest()
    row = _find_source_document_row(url_fetch)
    if row is None:
        row = _find_source_document_row(url_fetch, content_hash=h)

    if row and row.content_hash == h and row.status == "completed" and not force:
        return {
            "status": "unchanged",
            "source_url": url_fetch,
            "content_hash": h,
            "document_id": row.qdrant_document_id,
            "message": "Same content hash as last ingest; skipped.",
        }

    if row and row.qdrant_document_id and (force or row.content_hash != h):
        delete_qdrant_points_for_document(app, row.qdrant_document_id)

    uploaded_at = datetime.now(timezone.utc)
    filename = _filename_from_url(str(fetched.url))
    url_key = canonical_source_url(url_fetch)
    extra: dict[str, Any] = {"source_url": url_fetch}
    if municipality:
        extra["municipality"] = municipality.strip().lower()
    if zone_code:
        extra["zone_code"] = zone_code.strip()
    if source_object_id:
        extra["source_object_id"] = source_object_id.strip()

    doc_id = row.qdrant_document_id if row and row.qdrant_document_id else None
    result = ingest_pdf_bytes_to_qdrant(
        app,
        body,
        filename,
        uploaded_at,
        document_id=doc_id,
        extra_payload=extra,
    )

    if result.get("error"):
        row = row or _find_source_document_row(url_fetch) or _find_source_document_row(
            url_fetch, content_hash=h
        )
        if row is None:
            row = SourceDocument(source_url=url_key, status="failed")
            db.session.add(row)
        else:
            row.status = "failed"
        row.last_error = result.get("message") or result.get("error")
        row.updated_at = datetime.now(timezone.utc)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            row = _find_source_document_row(url_fetch, content_hash=h) or _find_source_document_row(
                url_fetch
            )
            if row is not None:
                row.status = "failed"
                row.last_error = result.get("message") or result.get("error")
                row.updated_at = datetime.now(timezone.utc)
                db.session.commit()
        return {**result, "source_url": url_fetch}

    new_doc_id = result["document_id"]
    if row is None:
        row = SourceDocument(source_url=url_key)
        db.session.add(row)
    row.content_hash = h
    row.qdrant_document_id = new_doc_id
    row.original_filename = filename
    row.status = "completed"
    row.last_error = None
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        row = _find_source_document_row(url_fetch) or _find_source_document_row(
            url_fetch, content_hash=h
        )
        if row is None:
            raise
        row.content_hash = h
        row.qdrant_document_id = new_doc_id
        row.original_filename = filename
        row.status = "completed"
        row.last_error = None
        db.session.commit()

    out = {
        "status": "ingested",
        "source_url": url_fetch,
        "content_hash": h,
        "document_id": new_doc_id,
        "chunks_indexed": result.get("chunks_indexed"),
        "total_pages": result.get("total_pages"),
        "collection": result.get("collection"),
    }
    if result.get("warnings"):
        out["warnings"] = result["warnings"]
    return out


def ingest_documents_for_zone(app: Flask, record: ZoningRecord) -> list[dict[str, Any]]:
    """Ingest all PDF-looking URLs from a :class:`~app.models.ZoningRecord`."""
    urls: list[str] = []
    raw = record.source_documents_json
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                urls.extend(str(u).strip() for u in parsed if str(u).strip())
        except json.JSONDecodeError:
            pass
    seen_keys: set[str] = set()
    deduped: list[str] = []
    for u in urls:
        key = canonical_source_url(u)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(u)
    municipality = record.municipality
    zone_code = record.zone_code
    source_object_id = record.source_object_id
    results: list[dict[str, Any]] = []
    for u in deduped:
        if looks_like_pdf_url(u) or u.lower().endswith(".pdf"):
            results.append(
                ingest_pdf_url_to_qdrant(
                    app,
                    u,
                    municipality=municipality,
                    zone_code=zone_code,
                    source_object_id=source_object_id,
                )
            )
        else:
            results.append(
                {
                    "status": "skipped",
                    "source_url": u,
                    "message": "Not treated as PDF URL; extend looks_like_pdf_url if needed.",
                }
            )
    return results
