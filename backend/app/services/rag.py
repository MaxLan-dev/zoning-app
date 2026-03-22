from __future__ import annotations

from typing import Any

from flask import Flask
from groq import Groq

from app.services.vector_search import semantic_search, semantic_search_tiered_for_zone

SYSTEM_PROMPT = """You are an assistant for municipal zoning and land-use documents.

The user message may start with a "Zone context" block from GIS/open data. Use it ONLY to know
which official zoning polygon is being discussed (zone code, name, dates, geometry summary).
Do not treat the zone context as legal rules.

Excerpts may include both polygon-specific bylaws and broader municipal zoning text (e.g. general
regulations, use tables) retrieved for the same municipality and zone. Cite passage numbers
([1], [2], …). If it is clear from wording whether a rule is site-specific vs city-wide, say so
briefly; otherwise do not guess.

For any rule, use, height, setback, or number, cite the passage. If the excerpts do not say
something, state that it is NOT IN THE PROVIDED TEXT — do not infer beyond the text."""


def run_rag(
    app: Flask,
    question: str,
    *,
    limit: int = 8,
    document_id: str | None = None,
    document_ids: list[str] | None = None,
    municipality: str | None = None,
    zone_code: str | None = None,
    source_object_id: str | None = None,
    zone_type: str | None = None,
    zone_name: str | None = None,
    zone_context: str | None = None,
) -> dict[str, Any]:
    api_key = app.config.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured")

    doc_scope = bool(document_id) or bool(document_ids)
    use_tiered = (
        not doc_scope
        and municipality
        and zone_code
        and source_object_id
        and municipality.strip()
        and zone_code.strip()
        and source_object_id.strip()
    )

    if use_tiered:
        hits = semantic_search_tiered_for_zone(
            app,
            question,
            limit=max(limit, 12),
            municipality=municipality,
            zone_code=zone_code,
            source_object_id=source_object_id,
            zone_type=zone_type,
            zone_name=zone_name,
        )
    else:
        hits = semantic_search(
            app,
            question,
            limit=limit,
            document_id=document_id,
            document_ids=document_ids,
            municipality=municipality,
            zone_code=zone_code,
            source_object_id=source_object_id,
        )
    if not hits:
        return {
            "answer": "No matching passages were found in the vector index for this query.",
            "sources": [],
            "model": app.config["GROQ_MODEL"],
        }

    context_blocks: list[str] = []
    sources: list[dict[str, Any]] = []
    for i, hit in enumerate(hits):
        payload = hit.get("payload") or {}
        text = (payload.get("text") or "").strip()
        label = payload.get("human_label") or payload.get("original_filename") or "unknown"
        context_blocks.append(f"[{i + 1}] ({label})\n{text}")
        sources.append(
            {
                "score": hit.get("score"),
                "human_label": label,
                "page": payload.get("page"),
                "document_id": payload.get("document_id"),
                "chunk_index": payload.get("chunk_index"),
                "source_url": payload.get("source_url"),
            }
        )

    context = "\n\n---\n\n".join(context_blocks)
    if zone_context and zone_context.strip():
        user_content = (
            "Zone context (GIS / open data — identifies this polygon only; not a substitute for "
            "bylaw text):\n"
            f"{zone_context.strip()}\n\n"
            f"Bylaw / policy excerpts:\n{context}\n\n"
            f"Question:\n{question}"
        )
    else:
        user_content = f"Context:\n{context}\n\nQuestion:\n{question}"

    groq = Groq(api_key=api_key)
    completion = groq.chat.completions.create(
        model=app.config["GROQ_MODEL"],
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
        max_tokens=1024,
    )
    answer = completion.choices[0].message.content or ""

    return {
        "answer": answer.strip(),
        "sources": sources,
        "model": app.config["GROQ_MODEL"],
    }
