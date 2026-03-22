"""create ingestion tables

Revision ID: cb6c225ad69b
Revises: 
Create Date: 2026-03-22 12:21:54.261071

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cb6c225ad69b'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ingestion_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("municipality", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("geojson_url", sa.Text(), nullable=False),
        sa.Column("total_features", sa.Integer(), nullable=False),
        sa.Column("normalized_count", sa.Integer(), nullable=False),
        sa.Column("inserted_count", sa.Integer(), nullable=False),
        sa.Column("updated_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ingestion_runs_municipality"), "ingestion_runs", ["municipality"], unique=False)
    op.create_index(op.f("ix_ingestion_runs_status"), "ingestion_runs", ["status"], unique=False)

    op.create_table(
        "zoning_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("municipality", sa.String(length=64), nullable=False),
        sa.Column("source_object_id", sa.String(length=128), nullable=False),
        sa.Column("zone_code", sa.String(length=128), nullable=False),
        sa.Column("zone_type", sa.String(length=128), nullable=True),
        sa.Column("zone_name", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("bylaw_number", sa.String(length=128), nullable=True),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("source_documents_json", sa.Text(), nullable=True),
        sa.Column("geometry_json", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("geojson_url", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("last_run_id", sa.String(length=36), nullable=True),
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
        sa.ForeignKeyConstraint(["last_run_id"], ["ingestion_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "municipality",
            "source_object_id",
            name="uq_zoning_records_municipality_source_object",
        ),
    )
    op.create_index(op.f("ix_zoning_records_content_hash"), "zoning_records", ["content_hash"], unique=False)
    op.create_index(op.f("ix_zoning_records_last_run_id"), "zoning_records", ["last_run_id"], unique=False)
    op.create_index(op.f("ix_zoning_records_municipality"), "zoning_records", ["municipality"], unique=False)
    op.create_index(op.f("ix_zoning_records_status"), "zoning_records", ["status"], unique=False)
    op.create_index(op.f("ix_zoning_records_zone_code"), "zoning_records", ["zone_code"], unique=False)
    op.create_index(op.f("ix_zoning_records_zone_type"), "zoning_records", ["zone_type"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_zoning_records_zone_type"), table_name="zoning_records")
    op.drop_index(op.f("ix_zoning_records_zone_code"), table_name="zoning_records")
    op.drop_index(op.f("ix_zoning_records_status"), table_name="zoning_records")
    op.drop_index(op.f("ix_zoning_records_municipality"), table_name="zoning_records")
    op.drop_index(op.f("ix_zoning_records_last_run_id"), table_name="zoning_records")
    op.drop_index(op.f("ix_zoning_records_content_hash"), table_name="zoning_records")
    op.drop_table("zoning_records")
    op.drop_index(op.f("ix_ingestion_runs_status"), table_name="ingestion_runs")
    op.drop_index(op.f("ix_ingestion_runs_municipality"), table_name="ingestion_runs")
    op.drop_table("ingestion_runs")
