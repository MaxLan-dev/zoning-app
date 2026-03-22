"""add change detection counts to ingestion runs

Revision ID: 69ebf8eb6b18
Revises: cb6c225ad69b
Create Date: 2026-03-22 12:36:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "69ebf8eb6b18"
down_revision = "cb6c225ad69b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ingestion_runs",
        sa.Column(
            "added_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "ingestion_runs",
        sa.Column(
            "unchanged_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "ingestion_runs",
        sa.Column(
            "removed_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

def downgrade():
    op.drop_column("ingestion_runs", "removed_count")
    op.drop_column("ingestion_runs", "unchanged_count")
    op.drop_column("ingestion_runs", "added_count")
