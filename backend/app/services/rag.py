from __future__ import annotations

from typing import Any

from flask import Flask
from groq import Groq

from app.services.vector_search import semantic_search

SYSTEM_PROMPT = """You are an assistant for municipal zoning and land-use documents.
Answer the user's question using ONLY the context passages below.
If the context does not contain enough information, say so clearly and do not invent rules or numbers.
When you cite rules, mention which passage number ([1], [2], …) supports your answer."""


def run_rag(
    app: Flask,
    question: str,
    *,
    limit: int = 8,
    document_id: str | None = None,
) -> dict[str, Any]:
    api_key = app.config.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured")

    hits = semantic_search(app, question, limit=limit, document_id=document_id)
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
            }
        )

    context = "\n\n---\n\n".join(context_blocks)
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
