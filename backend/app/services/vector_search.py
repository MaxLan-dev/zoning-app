from __future__ import annotations

from typing import Any

from flask import Flask
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue

from app.services.pdf_vector_ingest import _get_sentence_model, ensure_qdrant_payload_indexes


def semantic_search(
    app: Flask,
    query: str,
    *,
    limit: int = 5,
    document_id: str | None = None,
    municipality: str | None = None,
    zone_code: str | None = None,
    source_object_id: str | None = None,
) -> list[dict[str, Any]]:
    model = _get_sentence_model(app.config["EMBEDDING_MODEL"])
    encoded = model.encode(query, show_progress_bar=False)
    if hasattr(encoded, "tolist"):
        encoded = encoded.tolist()
    if encoded and isinstance(encoded[0], (int, float)):
        query_vector = encoded
    else:
        query_vector = encoded[0]

    client = QdrantClient(
        url=app.config["QDRANT_URL"],
        api_key=app.config["QDRANT_API_KEY"],
        prefer_grpc=False,
    )
    collection = app.config["QDRANT_COLLECTION"]
    ensure_qdrant_payload_indexes(client, collection)

    must: list[FieldCondition] = []
    if document_id:
        must.append(
            FieldCondition(
                key="document_id",
                match=MatchValue(value=document_id),
            )
        )
    if municipality:
        must.append(
            FieldCondition(
                key="municipality",
                match=MatchValue(value=municipality.strip().lower()),
            )
        )
    if zone_code:
        must.append(
            FieldCondition(
                key="zone_code",
                match=MatchValue(value=zone_code.strip()),
            )
        )
    if source_object_id:
        must.append(
            FieldCondition(
                key="source_object_id",
                match=MatchValue(value=source_object_id.strip()),
            )
        )

    query_filter = Filter(must=must) if must else None

    response = client.query_points(
        collection_name=collection,
        query=query_vector,
        limit=limit,
        with_payload=True,
        query_filter=query_filter,
    )

    return [
        {
            "score": point.score,
            "payload": point.payload or {},
        }
        for point in response.points
    ]
