"""Tests for URL canonicalization and SourceDocument uniqueness handling."""

from app.extensions import db
from app.models import SourceDocument
from app.services.source_document_ingest import (
    _find_source_document_row,
    canonical_source_url,
)


def test_canonical_source_url_unifies_space_and_percent_encoding():
    a = canonical_source_url("HTTPS://Example.COM/foo/Section 14 - x/file.pdf")
    b = canonical_source_url("https://example.com/foo/Section%2014%20-%20x/file.pdf")
    assert a == b
    assert "example.com" in a


def test_find_source_document_row_matches_alternate_url_spelling(app):
    with app.app_context():
        key = canonical_source_url("https://app2.kitchener.ca/path/Section 14.pdf")
        db.session.add(
            SourceDocument(
                source_url=key,
                content_hash="deadbeef",
                qdrant_document_id="doc-1",
                status="completed",
            )
        )
        db.session.commit()

        found = _find_source_document_row(
            "https://app2.kitchener.ca/path/Section%2014.pdf",
        )
        assert found is not None
        assert found.qdrant_document_id == "doc-1"


def test_find_source_document_row_by_content_hash(app):
    with app.app_context():
        h = "a" * 64
        db.session.add(
            SourceDocument(
                source_url="https://x.example/only-one-form.pdf",
                content_hash=h,
                qdrant_document_id="doc-2",
                status="completed",
            )
        )
        db.session.commit()

        found = _find_source_document_row(
            "https://x.example/different-spelling-but-same-bytes.pdf",
            content_hash=h,
        )
        assert found is not None
        assert found.source_url.endswith("only-one-form.pdf")
