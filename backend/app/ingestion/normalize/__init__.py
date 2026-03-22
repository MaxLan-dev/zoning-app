# Map local codes and fields to canonical schema
from app.ingestion.normalize.zoning import (
    NormalizedZoningResult,
    normalize_zoning_feature_collection,
)

__all__ = ["NormalizedZoningResult", "normalize_zoning_feature_collection"]
