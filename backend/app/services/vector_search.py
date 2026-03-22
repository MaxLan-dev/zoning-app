from __future__ import annotations

from typing import Any

from flask import Flask
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue

from app.services.pdf_vector_ingest import _get_sentence_model


def semantic_search(
    app: Flask,
    query: str,
    *,
    limit: int = 5,
    document_id: str | None = None,
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

    query_filter = None
    if document_id:
        query_filter = Filter(
            must=[
                FieldCondition(
                    key="document_id",
                    match=MatchValue(value=document_id),
                )
            ]
        )

    # qdrant-client >=1.16 removed .search(); use query_points (dense vector query).
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
