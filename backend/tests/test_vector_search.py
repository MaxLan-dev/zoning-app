from unittest.mock import MagicMock, patch

from app import create_app
from app.services.vector_search import semantic_search


@patch("app.services.vector_search.ensure_qdrant_payload_indexes")
@patch("app.services.vector_search.QdrantClient")
@patch("app.services.vector_search._get_sentence_model")
def test_semantic_search_ensures_payload_indexes(mock_model, mock_client_cls, mock_ensure_indexes):
    app = create_app("testing")
    app.config["QDRANT_COLLECTION"] = "zoning_chunks"
    mock_model.return_value.encode.return_value = [0.1, 0.2, 0.3]

    mock_response = MagicMock()
    mock_response.points = []
    mock_client = MagicMock()
    mock_client.query_points.return_value = mock_response
    mock_client_cls.return_value = mock_client

    with app.app_context():
        semantic_search(
            app,
            "What uses are permitted?",
            municipality="waterloo",
            zone_code="RMU-20",
            source_object_id="123",
        )

    mock_ensure_indexes.assert_called_once_with(mock_client, "zoning_chunks")
    mock_client.query_points.assert_called_once()
