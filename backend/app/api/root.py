from flask import Blueprint, jsonify

bp = Blueprint("root", __name__)


@bp.get("/")
def index():
    return jsonify(
        {
            "service": "zoning-api",
            "message": "API is running. The web UI is served separately (e.g. Vite on port 5173).",
            "endpoints": {
                "health": "/api/v1/health",
                "upload_pdf": "POST /api/v1/documents/upload",
                "ingest_pdf_url": "POST /api/v1/documents/ingest-url",
                "supported_municipalities": "GET /api/v1/jobs/ingest-zoning/municipalities",
                "ingestion_runs": "GET /api/v1/jobs/ingest-zoning/runs?municipality=&limit=",
                "ingest_zoning": "POST /api/v1/jobs/ingest-zoning",
                "zones_geojson": "GET /api/v1/zones/geojson?region=waterloo-kitchener",
                "zones_region_summary": "GET /api/v1/zones/region-summary?region=waterloo-kitchener",
                "zones_at_point": "GET /api/v1/zones/at-point?lat=&lng= (defaults region waterloo+kitchener)",
                "zone_ingest_docs": "POST /api/v1/zones/<id>/ingest-documents",
                "zone_analyze": "POST /api/v1/zones/<id>/analyze",
                "rag": "POST /api/v1/rag",
            },
        }
    )
