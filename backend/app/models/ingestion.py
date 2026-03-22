from __future__ import annotations

from datetime import date, datetime
import uuid

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db


class IngestionRun(db.Model):
    __tablename__ = "ingestion_runs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    municipality: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    geojson_url: Mapped[str] = mapped_column(Text, nullable=False)

    total_features: Mapped[int] = mapped_column(nullable=False, default=0)
    normalized_count: Mapped[int] = mapped_column(nullable=False, default=0)
    inserted_count: Mapped[int] = mapped_column(nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(nullable=False, default=0)
    added_count: Mapped[int] = mapped_column(nullable=False, default=0)
    unchanged_count: Mapped[int] = mapped_column(nullable=False, default=0)
    removed_count: Mapped[int] = mapped_column(nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    records: Mapped[list[ZoningRecord]] = relationship(back_populates="last_run")


class ZoningRecord(db.Model):
    __tablename__ = "zoning_records"
    __table_args__ = (
        UniqueConstraint(
            "municipality",
            "source_object_id",
            name="uq_zoning_records_municipality_source_object",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    municipality: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_object_id: Mapped[str] = mapped_column(String(128), nullable=False)

    zone_code: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    zone_type: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    zone_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    bylaw_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    source_documents_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    geometry_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    geojson_url: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    last_run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ingestion_runs.id"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    last_run: Mapped[IngestionRun | None] = relationship(back_populates="records")
