import app.load_env  # noqa: F401 — same env as dev when running tests

import pytest

from app import create_app


@pytest.fixture()
def app():
    app = create_app("testing")
    yield app


@pytest.fixture()
def client(app):
    return app.test_client()
