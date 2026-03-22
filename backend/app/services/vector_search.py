from __future__ import annotations

from typing import Any

from flask import Flask
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

from app.services.pdf_vector_ingest import _get_sentence_model, ensure_qdrant_payload_indexes


def semantic_search(
    app: Flask,
    query: str,
    *,
    limit: int = 5,
    document_id: str | None = None,
    document_ids: list[str] | None = None,
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
    doc_scope = False
    if document_ids:
        ids = [d.strip() for d in document_ids if d.strip()]
        if ids:
            must.append(
                FieldCondition(
                    key="document_id",
                    match=MatchAny(any=ids),
                )
            )
            doc_scope = True
    elif document_id:
        must.append(
            FieldCondition(
                key="document_id",
                match=MatchValue(value=document_id),
            )
        )
        doc_scope = True

    if not doc_scope:
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


def _hit_identity(hit: dict[str, Any]) -> tuple[Any, ...]:
    p = hit.get("payload") or {}
    doc, ci = p.get("document_id"), p.get("chunk_index")
    if doc is not None and ci is not None:
        return ("dc", str(doc), int(ci))
    return (
        "fb",
        p.get("source_url"),
        p.get("page"),
        (p.get("text") or "")[:160],
    )


def _absorb_hits(merged: dict[tuple[Any, ...], dict[str, Any]], hits: list[dict[str, Any]]) -> None:
    for h in hits:
        k = _hit_identity(h)
        sc = float(h.get("score") or 0.0)
        prev = merged.get(k)
        if prev is None or sc > float(prev.get("score") or 0.0):
            merged[k] = h


def _augment_query_municipality_scope(
    question: str,
    *,
    zone_code: str | None,
    zone_type: str | None,
    zone_name: str | None,
) -> str:
    parts = [question.strip(), "", "Context for retrieval:"]
    if zone_code:
        parts.append(f"Zoning zone code: {zone_code}.")
    if zone_type:
        parts.append(f"Zone category: {zone_type}.")
    if zone_name:
        parts.append(f"Zone name: {zone_name}.")
    parts.append(
        "Municipal zoning bylaw: general regulations, permitted and prohibited uses, "
        "definitions, setbacks, building height, density, lot standards, parking."
    )
    return "\n".join(parts)


# Widen retrieval when strict polygon-scoped hits are sparse (missing shared / general PDFs).
_TIERED_MIN_HITS = 4


def semantic_search_tiered_for_zone(
    app: Flask,
    question: str,
    *,
    limit: int = 14,
    municipality: str,
    zone_code: str,
    source_object_id: str,
    zone_type: str | None = None,
    zone_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Tier 1: municipality + zone_code + source_object_id (parcel-linked vectors).
    Tier 2 (if < min hits): drop source_object_id — same zone code, any ingested parcel.
    Tier 3 (if still < min hits): municipality only + augmented query for general bylaw text.
    """
    m = municipality.strip().lower()
    zc = zone_code.strip()
    soid = source_object_id.strip()
    per = max(8, min(limit, 12))
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}

    _absorb_hits(
        merged,
        semantic_search(
            app,
            question,
            limit=per,
            municipality=m,
            zone_code=zc,
            source_object_id=soid,
        ),
    )

    if len(merged) < _TIERED_MIN_HITS:
        _absorb_hits(
            merged,
            semantic_search(
                app,
                question,
                limit=per,
                municipality=m,
                zone_code=zc,
                source_object_id=None,
            ),
        )

    if len(merged) < _TIERED_MIN_HITS:
        zt = zone_type.strip() if isinstance(zone_type, str) and zone_type.strip() else None
        zn = zone_name.strip() if isinstance(zone_name, str) and zone_name.strip() else None
        wide_q = _augment_query_municipality_scope(
            question,
            zone_code=zc,
            zone_type=zt,
            zone_name=zn,
        )
        _absorb_hits(
            merged,
            semantic_search(
                app,
                wide_q,
                limit=per,
                municipality=m,
                zone_code=None,
                source_object_id=None,
            ),
        )

    ranked = sorted(merged.values(), key=lambda x: float(x.get("score") or 0.0), reverse=True)
    return ranked[:limit]
