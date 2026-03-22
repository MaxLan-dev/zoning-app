from unittest.mock import MagicMock, patch

from app import create_app


def _hit(doc: str, idx: int, score: float, text: str = "x") -> dict:
    return {
        "score": score,
        "payload": {"document_id": doc, "chunk_index": idx, "text": text},
    }


@patch("app.services.vector_search.semantic_search")
def test_tiered_stops_after_strict_when_enough_hits(mock_ss, app):
    app = create_app("testing")
    many = [_hit("a", i, 0.5 - i * 0.01) for i in range(5)]
    mock_ss.return_value = many
    with app.app_context():
        from app.services.vector_search import semantic_search_tiered_for_zone

        out = semantic_search_tiered_for_zone(
            app,
            "permits?",
            limit=10,
            municipality="kitchener",
            zone_code="M-2",
            source_object_id="638",
        )
    assert len(out) == 5
    assert mock_ss.call_count == 1


@patch("app.services.vector_search.semantic_search")
def test_tiered_adds_zone_wide_then_municipality(mock_ss, app):
    app = create_create = create_app("testing")
    mock_ss.side_effect = [
        [_hit("a", 0, 0.1)],
        [_hit("b", 1, 0.2)],
        [_hit("c", 2, 0.3)],
    ]
    with app.app_context():
        from app.services.vector_search import semantic_search_tiered_for_zone

        out = semantic_search_tiered_for_zone(
            app,
            "setbacks?",
            limit=10,
            municipality="kitchener",
            zone_code="M-2",
            source_object_id="638",
            zone_type="M",
            zone_name="Industrial",
        )
    assert len(out) == 3
    assert mock_ss.call_count == 3
    assert mock_ss.call_args_list[0][1]["source_object_id"] == "638"
    assert mock_ss.call_args_list[1][1]["source_object_id"] is None
    assert mock_ss.call_args_list[1][1]["zone_code"] == "M-2"
    assert mock_ss.call_args_list[2][1]["zone_code"] is None
    wide_q = mock_ss.call_args_list[2][0][1]
    assert "M-2" in wide_q
    assert "Industrial" in wide_q


@patch("app.services.rag.semantic_search_tiered_for_zone")
@patch("app.services.rag.Groq")
def test_run_rag_delegates_to_tiered_when_zone_scoped(mock_groq, mock_tiered):
    app = create_app("testing")
    app.config["GROQ_API_KEY"] = "k"
    app.config["GROQ_MODEL"] = "llama-3.1-8b-instant"
    mock_tiered.return_value = [
        _hit("d", 0, 0.9, "Rule text"),
    ]
    mock_chat = MagicMock()
    mock_chat.choices = [MagicMock(message=MagicMock(content="Answer [1]."))]
    mock_groq.return_value.chat.completions.create.return_value = mock_chat

    with app.app_context():
        from app.services.rag import run_rag

        out = run_rag(
            app,
            "q?",
            municipality="waterloo",
            zone_code="R1",
            source_object_id="9",
            zone_type="Residential",
        )
    assert "Answer" in out["answer"]
    mock_tiered.assert_called_once()


@patch("app.services.rag.Groq")
@patch("app.services.rag.semantic_search")
def test_run_rag_uses_plain_search_when_document_id_set(mock_ss, mock_groq):
    app = create_app("testing")
    app.config["GROQ_API_KEY"] = "k"
    app.config["GROQ_MODEL"] = "llama-3.1-8b-instant"
    mock_ss.return_value = [_hit("d", 0, 0.9)]
    mock_chat = MagicMock()
    mock_chat.choices = [MagicMock(message=MagicMock(content="Ok."))]
    mock_groq.return_value.chat.completions.create.return_value = mock_chat
    with app.app_context():
        from app.services.rag import run_rag

        run_rag(
            app,
            "q?",
            document_id="doc-1",
            municipality="kitchener",
            zone_code="M-2",
            source_object_id="638",
        )
    mock_ss.assert_called_once()
    assert mock_ss.call_args[1].get("document_id") == "doc-1"
