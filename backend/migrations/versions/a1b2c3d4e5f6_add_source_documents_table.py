"""add source_documents table

Revision ID: a1b2c3d4e5f6
Revises: 69ebf8eb6b18
Create Date: 2026-03-22 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f6"
down_revision = "69ebf8eb6b18"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "source_documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("qdrant_document_id", sa.String(length=36), nullable=True),
        sa.Column("original_filename", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_source_documents_source_url", "source_documents", ["source_url"], unique=True)
    op.create_index("ix_source_documents_content_hash", "source_documents", ["content_hash"])
    op.create_index(
        "ix_source_documents_qdrant_document_id",
        "source_documents",
        ["qdrant_document_id"],
    )
    op.create_index("ix_source_documents_status", "source_documents", ["status"])


def downgrade():
    op.drop_index("ix_source_documents_status", table_name="source_documents")
    op.drop_index("ix_source_documents_qdrant_document_id", table_name="source_documents")
    op.drop_index("ix_source_documents_content_hash", table_name="source_documents")
    op.drop_index("ix_source_documents_source_url", table_name="source_documents")
    op.drop_table("source_documents")
