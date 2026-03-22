from __future__ import annotations

import io
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask
from pypdf import PdfReader
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from app.ingestion.pdf import extract_pdf_with_ocr


def human_label(filename: str, uploaded_at: datetime, page: int, total_pages: int) -> str:
    ts = uploaded_at.strftime("%d.%m.%Y at %H:%M:%S")
    return f"{filename} {ts} page {page} out of {total_pages}"


def _chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    if not text.strip():
        return []
    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


_model_cache: dict[str, Any] = {}
_KEYWORD_PAYLOAD_INDEX_FIELDS: tuple[str, ...] = (
    "document_id",
    "municipality",
    "zone_code",
    "source_object_id",
)


def _get_sentence_model(model_name: str):
    if model_name not in _model_cache:
        from sentence_transformers import SentenceTransformer

        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def ensure_qdrant_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    """
    Ensure keyword payload indexes exist for the fields we filter on in Qdrant.

    Older/local collections may have points with these payload keys but no index yet,
    which causes filtered queries to fail with "Index required but not found".
    """
    if not client.collection_exists(collection_name=collection_name):
        return

    for field_name in _KEYWORD_PAYLOAD_INDEX_FIELDS:
        client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=PayloadSchemaType.KEYWORD,
            wait=True,
        )


def _page_texts_from_pdf_bytes(pdf_bytes: bytes) -> tuple[list[tuple[int, str]], int, list[str]]:
    """
    Extract (page_number, text) pairs. Prefer OCR-aware PyMuPDF path; fall back to pypdf
    when no text is found (e.g. some digital PDFs).
    """
    warnings: list[str] = []
    extraction = extract_pdf_with_ocr(pdf_bytes)
    warnings.extend(extraction.warnings)
    total_from_fitz = len(extraction.pages)
    pairs: list[tuple[int, str]] = []
    for p in extraction.pages:
        t = (p.text or "").strip()
        if t:
            pairs.append((p.page_number, t))
    if not pairs and pdf_bytes:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        total_pages = len(reader.pages)
        for i in range(total_pages):
            raw = (reader.pages[i].extract_text() or "").strip()
            if raw:
                pairs.append((i + 1, raw))
        return pairs, total_pages, warnings
    total_pages = total_from_fitz or max((p.page_number for p in extraction.pages), default=0)
    return pairs, total_pages, warnings


def delete_qdrant_points_for_document(app: Flask, document_id: str) -> None:
    if not document_id:
        return
    client = QdrantClient(
        url=app.config["QDRANT_URL"],
        api_key=app.config["QDRANT_API_KEY"],
        prefer_grpc=False,
    )
    collection = app.config["QDRANT_COLLECTION"]
    if not client.collection_exists(collection_name=collection):
        return
    client.delete(
        collection_name=collection,
        points_selector=FilterSelector(
            filter=Filter(
                must=[
                    FieldCondition(
                        key="document_id",
                        match=MatchValue(value=document_id),
                    )
                ]
            )
        ),
    )


def ingest_pdf_bytes_to_qdrant(
    app: Flask,
    pdf_bytes: bytes,
    original_filename: str,
    uploaded_at: datetime,
    *,
    document_id: str | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Chunk embedded text, upsert into Qdrant. ``extra_payload`` is merged into each point
    (e.g. municipality, zone_code, source_url).
    """
    page_texts, total_pages, extract_warnings = _page_texts_from_pdf_bytes(pdf_bytes)
    doc_id = document_id or str(uuid.uuid4())
    extra = dict(extra_payload or {})

    if total_pages == 0 and not page_texts:
        return {
            "error": "no_extractable_text",
            "message": "PDF has no pages or could not be opened.",
            "document_id": doc_id,
            "chunks_indexed": 0,
            "total_pages": 0,
            "warnings": extract_warnings,
        }

    chunk_size = 1200
    overlap = 200
    texts: list[str] = []
    payloads: list[dict[str, Any]] = []
    chunk_index = 0

    for page_num, raw in page_texts:
        for part in _chunk_text(raw, chunk_size, overlap):
            label = human_label(original_filename, uploaded_at, page_num, total_pages or page_num)
            base: dict[str, Any] = {
                "text": part,
                "original_filename": original_filename,
                "uploaded_at": uploaded_at.isoformat(),
                "page": page_num,
                "total_pages": total_pages or page_num,
                "document_id": doc_id,
                "human_label": label,
                "chunk_index": chunk_index,
            }
            base.update(extra)
            texts.append(part)
            payloads.append(base)
            chunk_index += 1

    if not texts:
        return {
            "error": "no_extractable_text",
            "message": "No text could be extracted (empty or image-only PDF).",
            "document_id": doc_id,
            "chunks_indexed": 0,
            "total_pages": total_pages,
            "warnings": extract_warnings,
        }

    model = _get_sentence_model(app.config["EMBEDDING_MODEL"])
    vectors = model.encode(texts, show_progress_bar=False)
    if hasattr(vectors, "tolist"):
        vectors = vectors.tolist()

    dim = len(vectors[0])

    client = QdrantClient(
        url=app.config["QDRANT_URL"],
        api_key=app.config["QDRANT_API_KEY"],
        prefer_grpc=False,
    )
    collection = app.config["QDRANT_COLLECTION"]

    if not client.collection_exists(collection_name=collection):
        client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
    ensure_qdrant_payload_indexes(client, collection)

    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=list(vec),
            payload=payload,
        )
        for vec, payload in zip(vectors, payloads, strict=True)
    ]
    client.upsert(collection_name=collection, points=points)

    out: dict[str, Any] = {
        "document_id": doc_id,
        "chunks_indexed": len(points),
        "total_pages": total_pages,
        "original_filename": original_filename,
        "uploaded_at": uploaded_at.isoformat(),
        "collection": collection,
    }
    if extract_warnings:
        out["warnings"] = extract_warnings
    return out


def ingest_pdf_to_qdrant(
    app: Flask,
    pdf_path: Path,
    original_filename: str,
    uploaded_at: datetime,
    *,
    extra_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pdf_bytes = pdf_path.read_bytes()
    return ingest_pdf_bytes_to_qdrant(
        app,
        pdf_bytes,
        original_filename,
        uploaded_at,
        extra_payload=extra_payload,
    )
