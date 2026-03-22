from unittest.mock import patch


def test_search_missing_query(client):
    res = client.post("/api/v1/search", json={})
    assert res.status_code == 400
    assert res.get_json()["error"] == "missing_query"


def test_search_invalid_limit(client):
    res = client.post("/api/v1/search", json={"q": "hello", "limit": "x"})
    assert res.status_code == 400


@patch("app.services.vector_search.semantic_search")
def test_search_ok(mock_search, client):
    mock_search.return_value = [
        {"score": 0.9, "payload": {"text": "snippet", "page": 1}},
    ]
    res = client.post("/api/v1/search", json={"q": "zoning", "limit": 3})
    assert res.status_code == 200
    data = res.get_json()
    assert data["query"] == "zoning"
    assert data["limit"] == 3
    assert len(data["results"]) == 1
    mock_search.assert_called_once()
