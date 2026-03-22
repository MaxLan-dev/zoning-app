from unittest.mock import MagicMock, patch


def test_rag_requires_groq(client):
    res = client.post("/api/v1/rag", json={"q": "hello"})
    assert res.status_code == 503
    assert res.get_json()["error"] == "groq_not_configured"


def test_rag_missing_query():
    from app import create_app

    app = create_app("testing")
    app.config["GROQ_API_KEY"] = "test-key"
    with app.test_client() as c:
        res = c.post("/api/v1/rag", json={})
    assert res.status_code == 400


@patch("app.services.rag.semantic_search")
@patch("app.services.rag.Groq")
def test_rag_success(mock_groq, mock_search):
    from app import create_app

    app = create_app("testing")
    app.config["GROQ_API_KEY"] = "test-key"
    app.config["GROQ_MODEL"] = "llama-3.3-70b-versatile"

    mock_search.return_value = [
        {
            "score": 0.9,
            "payload": {
                "text": "Setbacks shall be 6m.",
                "human_label": "test.pdf page 1",
                "page": 1,
                "document_id": "d1",
                "chunk_index": 0,
            },
        }
    ]
    mock_chat = MagicMock()
    mock_chat.choices = [MagicMock(message=MagicMock(content=" Minimum setback is 6m per [1]."))]
    mock_groq.return_value.chat.completions.create.return_value = mock_chat

    with app.test_client() as c:
        res = c.post("/api/v1/rag", json={"q": "setback?"})
    assert res.status_code == 200
    data = res.get_json()
    assert "answer" in data
    assert len(data["sources"]) == 1
    mock_groq.return_value.chat.completions.create.assert_called_once()
