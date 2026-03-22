"""
Load environment variables from the repository root before other code reads os.environ.

Imported by app entry points (wsgi, run_dev, tests, Alembic) and as the first import of
the app package. Safe to import multiple times.
"""

from pathlib import Path

from dotenv import load_dotenv

# backend/app/load_env.py -> parents[2] == monorepo root (zoning-app)
REPO_ROOT = Path(__file__).resolve().parents[2]


def load_application_dotenv() -> None:
    load_dotenv(REPO_ROOT / ".env")
    # Optional local overrides (not committed); later entries win
    load_dotenv(REPO_ROOT / ".env.local", override=True)


load_application_dotenv()
