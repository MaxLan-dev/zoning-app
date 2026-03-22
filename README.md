# National Zoning & Land Use Data Platform

Full-stack platform for aggregating Canadian municipal zoning and land use data into a searchable, analyzable, open dataset.

**Stack:** Flask (API + orchestration), React + TypeScript (UI), **LangChain** (RAG, extraction, agents), **LangSmith** (tracing, evaluation, prompts), **Qdrant** (vector database), **Beautiful Soup** (HTML scraping and parsing).

---

## Problem statement

Across Canada, a critical piece of the housing affordability puzzle remains hidden in fragmented, somewhat inaccessible data: local land use policies and zoning regulations. While restrictive zoning can drive up housing costs, limit density, and perpetuate exclusionary development patterns, there is no comprehensive way to analyze these policies at scale.

Each municipality maintains its own zoning bylaws, official plans, and land use regulations—often buried in PDFs, spread across multiple websites, or locked in formats that resist analysis. Researchers, policymakers, developers, and housing advocates need this data to understand how municipal policies affect housing supply, but accessing it requires manually visiting thousands of municipal websites and parsing tens of thousands of documents.

### Why manual scraping is not enough

| Challenge | Description |
|-----------|-------------|
| **Fragmentation** | Thousands of municipalities, each with its own sites, document shapes, and formats; no central repository. |
| **Inaccessibility** | Bylaws as scanned PDFs (OCR), permitted-use tables in appendices or split across documents. |
| **Inconsistency** | Different terms and codes (e.g. “R-2” vs “Residential Low Density”). |
| **Scale** | Roughly 4–5,000 municipalities in Canada; manual collection does not scale. |
| **Currency** | Bylaws change often; one-time snapshots go stale without monitoring and updates. |

This platform combines **intelligent ingestion** (scraping, PDF/OCR, normalization), **structured storage and APIs**, **quality assurance**, and **LLM workflows** (LangChain + LangSmith) with **Qdrant** for semantic search, so scattered documents become a **unified, queryable dataset** for evidence-based housing and land-use research.

---

## Goals

| Goal | Description |
|------|-------------|
| **Ingest** | Scrape and ingest zoning bylaws, official plans, permitted-use tables, density, parking, setbacks—start with one province; design for national scale. |
| **Standardize** | Parse into a flexible schema for cross-jurisdiction comparison (e.g. lot size, height, unit limits, parking, permitted housing types). |
| **Expose** | Searchable database and JSON API: query by municipality, policy type, restriction, or geography. |
| **Visualize** | Maps, dashboards, comparisons: restrictive policies, multi-family allowance, parking burden, outliers. |
| **Maintain** | Automated updates, change detection, validation, and human review for ambiguous extractions. |
| **Open** | Public dataset and documentation under an open license; documented API for researchers and journalists. |

**Optional extensions:** NLP on PDFs, geocoding zoning districts, ML for zone-type classification, version history for policies, crowdsourced corrections.

---

## High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     React + TypeScript (frontend)                │
│  Search · Maps · Dashboards · Compare · Admin review UI         │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (JSON)
┌────────────────────────────▼────────────────────────────────────┐
│                        Flask backend                               │
│  REST API · Auth (optional) · Job triggers · File uploads         │
│  Orchestrates: DB, object storage, workers                         │
└─────┬───────────────────┬───────────────────┬───────────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
┌───────────┐     ┌───────────────┐     ┌───────────────────────────┐
│ PostgreSQL│     │ Object store  │     │ Worker queue (Celery/RQ)   │
│ + PostGIS │     │ (S3/MinIO)    │     │ Scraping · OCR · ETL ·     │
│ (optional)│     │ PDFs, HTML    │     │ chunk/embed → Qdrant       │
└───────────┘     └───────────────┘     └───────────┬───────────────┘
                                                   │
                   ┌───────────────────────────────▼────────────────┐
                   │ LangChain (Python)                              │
                   │ RAG from Qdrant · tools (SQL/API) · extraction  │
                   └───────────────────────────────┬────────────────┘
                                                   │
     ┌─────────────────────────────────────────────┼─────────────────────────┐
     ▼                                             ▼                         ▼
┌─────────────┐                           ┌─────────────────┐     ┌─────────────────┐
│ Qdrant      │                           │ LangSmith        │     │ Beautiful Soup   │
│ Vector DB   │  ← embeddings + metadata  │ Tracing · evals  │     │ + requests/httpx │
└─────────────┘                           └─────────────────┘     └─────────────────┘
```

---

## LangChain and LangSmith

- **LangChain:** extraction chains/agents over PDF and HTML text (with citations); **RAG** over Qdrant; optional agents that combine semantic retrieval with structured queries; Pydantic (or similar) outputs aligned to your zoning schema.
- **LangSmith:** trace runs for debugging; evaluation datasets for extraction quality; prompt versioning; feedback loops from human review.

Flask remains the **system of record** for APIs, auth, and batch jobs; React delivers **search, maps, and review** workflows.

---

## Qdrant (vector database)

**Role:** Store **chunk embeddings** for municipal text with **metadata** (municipality id, document id, page, zone code, source URL) for RAG, similarity search, and grounded answers.

- **Local/dev:** Qdrant Docker image or [Qdrant Cloud](https://cloud.qdrant.io/).
- **Collections:** e.g. one collection per environment; use **payload indexes** on `municipality_id`, `document_id`, `jurisdiction` for filtered retrieval.
- **LangChain:** use community Qdrant integrations; workers **upsert** after chunking and embedding.

**Environment variables (example):**

| Variable | Purpose |
|----------|---------|
| `QDRANT_URL` | e.g. `http://localhost:6333` or cloud URL |
| `QDRANT_API_KEY` | If using Qdrant Cloud or a secured instance |
| `QDRANT_COLLECTION` | Default collection (e.g. `zoning_chunks`) |

---

## Web scraping with Beautiful Soup

**Role:** Parse **HTML** after HTTP fetch—listing pages, bylaw/plan pages, text and tables—often with **per-municipality** templates.

| Piece | Tool |
|-------|------|
| HTTP | `requests` or `httpx` (sessions, retries, rate limits) |
| HTML | **`beautifulsoup4`** (Beautiful Soup) — `find` / `select` (CSS selectors); `lxml` or `html.parser` |
| JS-heavy sites | Playwright or Selenium *(optional)* |

**Worker flow:** fetch → Beautiful Soup parse → extract links / text → PDF pipeline when needed → persist → chunk → embed → **Qdrant**.

---

## Repository structure (proposed)

```
zoning-app/
├── README.md
├── LICENSE
├── docker-compose.yml          # API + db + redis + minio + qdrant (optional)
├── .env.example
│
├── backend/                    # Flask
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── extensions.py
│   │   ├── api/                # municipalities, zones, search, jobs, nl query
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── ingestion/
│   │   │   ├── scrapers/       # fetch + Beautiful Soup per template
│   │   │   ├── pdf/
│   │   │   ├── normalize/
│   │   │   └── vectors/        # chunk, embed, Qdrant upsert
│   │   ├── workers/
│   │   └── brain/              # LangChain: Qdrant retrievers, agents
│   ├── migrations/
│   ├── tests/
│   ├── requirements.txt        # or pyproject.toml
│   └── wsgi.py
│
├── frontend/                   # React + TypeScript (e.g. Vite)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── api/
│   │   ├── features/
│   │   └── types/
│   ├── public/
│   └── package.json
│
├── shared/                     # optional: OpenAPI, JSON Schema
│   └── openapi.yaml
│
└── docs/                       # optional: data dictionary, ADRs
    └── DATA_MODEL.md
```

---

## Data model (conceptual)

Document in `docs/DATA_MODEL.md` as you implement:

- **Jurisdiction** — province/territory, municipality, identifiers  
- **Document** — URL, type, format, hash, fetch date  
- **DocumentVersion** — immutability and change tracking  
- **ZoneType** — local code + normalized category  
- **Regulation** — permitted uses, setbacks, height, parking, density, etc.  
- **Extraction** — structured fields, confidence, model version, optional LangSmith run id  
- **ReviewTask** — human queue for low-confidence rows  

Use **PostGIS** when you store or query geometries.

---

## API surface (illustrative)

| Area | Examples |
|------|----------|
| Catalog | `GET /api/v1/municipalities`, `GET /api/v1/municipalities/{id}/documents` |
| Structured | `GET /api/v1/zones` with filters |
| Search | `GET /api/v1/search?q=...` |
| AI / NL | `POST /api/v1/query` — natural language; LangChain + Qdrant + citations |
| Jobs | `POST /api/v1/jobs/ingest`, `GET /api/v1/jobs/{id}` |
| Admin | Review, re-run extraction, export |

---

## Ingestion and automation

1. Discover (sitemaps, curated seeds per template)  
2. Fetch (rate limits, `robots.txt`, ETag/hash caching)  
3. Parse HTML with **Beautiful Soup**; PDFs via text/OCR  
4. Normalize to canonical enums and fields where possible  
5. Validate; flag anomalies  
6. Index relational DB + **Qdrant** embeddings  
7. Re-fetch on a schedule; diff and surface changes  

---

## Configuration (`.env.example`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Queue / cache |
| `S3_*` / `MINIO_*` | Object storage for PDFs |
| `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` | Vector DB |
| LLM provider keys | e.g. OpenAI or other |
| `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` | LangSmith tracing |
| `LANGSMITH_API_KEY` | Evals / Hub (per current LangChain docs) |
| `FLASK_ENV`, `SECRET_KEY`, CORS origins | Flask |

---

## Ethical and operational scraping

Respect **robots.txt**, **terms of use**, and **rate limits**. Prefer **open data** portals when available. Record **provenance** (URL, retrieval time) for every surfaced fact. Plan for **takedown** and **correction** requests.

---

## Tech stack summary

| Layer | Choice |
|-------|--------|
| API | Flask, SQLAlchemy, Alembic, Flask-CORS |
| Jobs | Celery or RQ + Redis |
| DB | PostgreSQL (+ PostGIS, optional) |
| Vector DB | **Qdrant** |
| HTML scraping | **Beautiful Soup** + **requests** / **httpx** |
| AI | LangChain; embeddings via chosen provider |
| LLM ops | LangSmith |
| UI | React 18+, TypeScript, Vite |
| Maps | MapLibre / Leaflet (when geo is ready) |

**Python dependencies:** `backend/requirements.txt` (core stack). Optional AI stack: `backend/requirements-ai.txt` (LangChain / LangSmith; on Windows + Python 3.14 you may need [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or Python 3.12 for prebuilt wheels).

---

## Local development

1. **Clone** the repo and copy `.env.example` to `.env` at the repo root (optional; defaults work for a quick start).

2. **Infrastructure (optional):** from the repo root, run `docker compose up -d` for Postgres, Redis, Qdrant, and MinIO. If you skip Docker, the API defaults to **SQLite** (`backend/zoning_dev.db`) until you set `DATABASE_URL`.

3. **Backend** — dependencies live in **`backend/requirements.txt`** (there is no `requirements.txt` at the repo root). Install into a **virtualenv** so packages and the Flask CLI stay together.

   **Windows (PowerShell)** — if `flask` is “not recognized”, use `python -m flask` or `run_dev.py` (see below).

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   python -m flask db upgrade
   python run_dev.py
   ```

   **macOS / Linux**

   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   python -m flask db upgrade
   python run_dev.py
   ```

   Same as `flask run --debug` when the `flask` script is on your PATH: `python -m flask run --debug` (after `cd backend` and venv activate).

   On a **new** machine after clone, run `python -m flask db init` only if `backend/migrations/` is missing (already committed in this repo).

   Optional: `pip install -r requirements-ai.txt` for extra AI packages when you add them.

4. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev                         # http://localhost:5173 — proxies /api to Flask :5000
   ```

5. **LangSmith:** set the variables in `.env.example` under LangSmith / LangChain, install `requirements-ai.txt`, then run a chain and confirm traces in the LangSmith UI.

---

## Roadmap (suggested)

1. **Skeleton** — Flask API, React shell, sample data, one LangChain RAG path with LangSmith tracing.  
2. **Ingestion** — Beautiful Soup scraper template, PDF path, DB schema, basic search API.  
3. **AI extraction** — LangChain extraction + review queue + LangSmith evals.  
4. **Scale** — more municipalities, job scaling, change detection.  
5. **Open data** — documented export, license, public API policy.

---

## Impact

Enables researchers, policymakers, advocates, developers, and journalists to study zoning restrictiveness, compare municipalities, and support **evidence-based** housing and land-use policy—at a scale manual collection cannot match.

---

## License and contributing

Choose an **open license** for code and clearly license **compiled data** (legal review recommended for third-party municipal text). Add `CONTRIBUTING.md` when the codebase exists: PR guidelines, Black/ruff, ESLint/Prettier, and how to add a new **municipality scraper template** without duplicating core logic.
