from io import BytesIO
from unittest.mock import patch


def test_upload_missing_file(client):
    res = client.post("/api/v1/documents/upload")
    assert res.status_code == 400
    assert res.get_json()["error"] == "missing_file"


def test_upload_rejects_non_pdf(client):
    data = {"file": (BytesIO(b"hello"), "note.txt")}
    res = client.post(
        "/api/v1/documents/upload",
        data=data,
        content_type="multipart/form-data",
    )
    assert res.status_code == 400
    assert res.get_json()["error"] == "pdf_only"


@patch("app.services.pdf_vector_ingest.ingest_pdf_to_qdrant")
def test_upload_pdf_success(mock_ingest, client):
    mock_ingest.return_value = {
        "document_id": "doc-1",
        "chunks_indexed": 3,
        "total_pages": 2,
        "original_filename": "test.pdf",
        "uploaded_at": "2026-03-22T12:00:00+00:00",
        "collection": "zoning_chunks",
    }
    data = {"file": (BytesIO(b"%PDF-1.4"), "test.pdf")}
    res = client.post(
        "/api/v1/documents/upload",
        data=data,
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    body = res.get_json()
    assert body["chunks_indexed"] == 3
    mock_ingest.assert_called_once()
