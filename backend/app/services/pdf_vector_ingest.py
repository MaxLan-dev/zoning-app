from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask
from pypdf import PdfReader
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams


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


def _get_sentence_model(model_name: str):
    if model_name not in _model_cache:
        from sentence_transformers import SentenceTransformer

        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def ingest_pdf_to_qdrant(
    app: Flask,
    pdf_path: Path,
    original_filename: str,
    uploaded_at: datetime,
) -> dict[str, Any]:
    reader = PdfReader(str(pdf_path))
    total_pages = len(reader.pages)
    document_id = str(uuid.uuid4())

    if total_pages == 0:
        return {
            "error": "no_extractable_text",
            "message": "PDF has no pages.",
            "document_id": document_id,
            "chunks_indexed": 0,
            "total_pages": 0,
        }

    chunk_size = 1200
    overlap = 200
    texts: list[str] = []
    payloads: list[dict[str, Any]] = []
    chunk_index = 0

    for i in range(total_pages):
        page = reader.pages[i]
        raw = (page.extract_text() or "").strip()
        if not raw:
            continue
        page_num = i + 1
        for part in _chunk_text(raw, chunk_size, overlap):
            label = human_label(original_filename, uploaded_at, page_num, total_pages)
            texts.append(part)
            payloads.append(
                {
                    "text": part,
                    "original_filename": original_filename,
                    "uploaded_at": uploaded_at.isoformat(),
                    "page": page_num,
                    "total_pages": total_pages,
                    "document_id": document_id,
                    "human_label": label,
                    "chunk_index": chunk_index,
                }
            )
            chunk_index += 1

    if not texts:
        return {
            "error": "no_extractable_text",
            "message": "No text could be extracted (empty or image-only PDF).",
            "document_id": document_id,
            "chunks_indexed": 0,
            "total_pages": total_pages,
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

    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=list(vec),
            payload=payload,
        )
        for vec, payload in zip(vectors, payloads, strict=True)
    ]
    client.upsert(collection_name=collection, points=points)

    return {
        "document_id": document_id,
        "chunks_indexed": len(points),
        "total_pages": total_pages,
        "original_filename": original_filename,
        "uploaded_at": uploaded_at.isoformat(),
        "collection": collection,
    }
