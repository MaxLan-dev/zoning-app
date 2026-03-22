# Data model (conceptual)

Evolve this document as tables and fields are implemented.

## Core entities

### Jurisdiction

- Province or territory
- Municipality (name, official id, website base URL)
- Hierarchy links for regional governments where relevant

### Document

- Source URL, HTTP metadata (ETag, last-modified)
- Type: zoning bylaw, official plan, map schedule, amendment, other
- Format: HTML, PDF, GIS, other
- Content hash for deduplication and change detection
- Fetched-at timestamp

### DocumentVersion

- Immutable snapshot of a document at a point in time
- Links to raw artifact in object storage
- Optional diff summary vs previous version

### ZoneType

- Local code as published by the municipality (e.g. `R2`, `Residential Second Density`)
- Normalized category (controlled vocabulary for cross-municipality comparison)
- Optional geometry reference (PostGIS) when maps are aligned

### Regulation (or normalized fact rows)

Structured fields such as:

- Permitted / discretionary uses
- Minimum lot area / width / depth
- Maximum height, storeys, lot coverage, FAR
- Setbacks (front, side, rear)
- Parking requirements (stalls per unit, visitor, bicycle)
- Dwelling unit limits, ADU rules
- Density (units per hectare) where stated

Attach provenance: document version id, page or section pointer, extraction confidence.

### Extraction

- Structured output from parsers or LLM pipelines
- Model and prompt version, optional LangSmith run id
- Confidence scores and raw spans for audit

### ReviewTask

- Queue for human validation when confidence is low or validators flag anomalies
- Resolution status and corrected fields

## Vector index (Qdrant)

Chunks of text with payload metadata, for example:

- `municipality_id`, `document_id`, `document_version_id`
- `zone_code` (if section-specific)
- `source_url`, `page` or `chunk_index`

Relational tables remain the source of truth for structured metrics; Qdrant supports semantic search and RAG.
