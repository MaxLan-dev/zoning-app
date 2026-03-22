import L from 'leaflet'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'
import {
  AlertCircle,
  Braces,
  Building2,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

/** Query string for Waterloo + Kitchener (matches backend `REGION_WATERLOO_KITCHENER_SLUGS`). */
const REGION_QS = 'region=waterloo-kitchener'

/** Map pan limit — Kitchener + Waterloo (WGS84). */
const WK_MAX_BOUNDS = L.latLngBounds([43.37, -80.65], [43.58, -80.32])
const WK_CENTER: L.LatLngTuple = [43.475, -80.485]

const API = {
  health: '/api/v1/health',
  zonesRegionSummary: `/api/v1/zones/region-summary?${REGION_QS}`,
  zonesGeojson: `/api/v1/zones/geojson?${REGION_QS}`,
  zonesAtPoint: (lat: number, lng: number) =>
    `/api/v1/zones/at-point?lat=${lat}&lng=${lng}&${REGION_QS}`,
  zone: (id: number) => `/api/v1/zones/${id}`,
  zoneIngestDocs: (id: number) => `/api/v1/zones/${id}/ingest-documents`,
  zoneAnalyze: (id: number) => `/api/v1/zones/${id}/analyze`,
  rag: '/api/v1/rag',
  documentsUpload: '/api/v1/documents/upload',
} as const

type HealthRes = { status: string; service: string }

type RegionSummaryRes = {
  region: string
  municipalities: string[]
  totalZones: number
  countByMunicipality: Record<string, number>
}

type ZoneMatch = {
  id: number
  municipality: string
  zoneCode: string
  zoneType?: string | null
  zoneName?: string | null
  status?: string | null
  bylawNumber?: string | null
  effectiveDate?: string | null
  sourceObjectId: string
  sourceDocuments: string[]
  sourceUrl?: string
  geojsonUrl?: string
  lastRunId?: string | null
}

type AtPointRes = {
  lat: number
  lng: number
  municipalitiesSearched: string[]
  matchCount: number
  matches: ZoneMatch[]
}

type RagSource = {
  score?: number
  human_label?: string
  page?: number
  document_id?: string
  chunk_index?: number
  source_url?: string
}

type RagRes = {
  query?: string
  answer?: string
  sources?: RagSource[]
  model?: string
  error?: string
  message?: string
}

type UploadResult = {
  document_id: string
  chunks_indexed: number
  total_pages: number
  original_filename: string
  uploaded_at: string
  collection: string
}

type IngestResultRow = {
  status?: string
  source_url?: string
  document_id?: string
  message?: string
  error?: string
  chunks_indexed?: number
}

type ZoneRecordDetail = ZoneMatch & {
  geometry?: unknown
}

type AnalyzeResponse = {
  zoneId: number
  record: ZoneRecordDetail
  ingest: { results: IngestResultRow[] }
  rag: RagRes & { query?: string }
}

function geometrySummary(geometry: unknown): string {
  if (geometry == null) return '—'
  if (typeof geometry !== 'object' || geometry === null) return 'present'
  const t = (geometry as { type?: string }).type
  return t ?? 'GeoJSON'
}

function redactAnalyzeForClipboard(data: AnalyzeResponse): AnalyzeResponse {
  const record = { ...data.record }
  if (record.geometry != null) {
    record.geometry = {
      _redacted: true,
      geojsonType: geometrySummary(record.geometry),
    }
  }
  return { ...data, record }
}

function geoJsonStyle(feature?: Feature): L.PathOptions {
  const m = (feature?.properties as { municipality?: string } | undefined)?.municipality
  const kitchener = m === 'kitchener'
  return {
    color: kitchener ? '#c45c3e' : '#2563eb',
    weight: 1,
    fillOpacity: 0.14,
  }
}

function FitBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [22, 22], maxZoom: 14, animate: true })
    }
  }, [bounds, map])
  return null
}

export default function App() {
  const [health, setHealth] = useState<HealthRes | null>(null)
  const [summary, setSummary] = useState<RegionSummaryRes | null>(null)
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState<string | null>(null)

  const [atPointLoading, setAtPointLoading] = useState(false)
  const [atPointError, setAtPointError] = useState<string | null>(null)
  const [matches, setMatches] = useState<ZoneMatch[]>([])
  const [matchPick, setMatchPick] = useState(0)
  const [clickLabel, setClickLabel] = useState<string | null>(null)

  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null)
  const [showApiPanel, setShowApiPanel] = useState(false)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  const [ragQuestion, setRagQuestion] = useState(
    'What uses are permitted in this zone, and what should I read first?',
  )
  const [ragLoading, setRagLoading] = useState(false)
  const [ragData, setRagData] = useState<RagRes | null>(null)
  const [ragError, setRagError] = useState<string | null>(null)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const selected = matches[matchPick] ?? null

  const geoBounds = useMemo(() => {
    if (!geojson?.features?.length) return null
    const layer = L.geoJSON(geojson as GeoJsonObject)
    const b = layer.getBounds()
    layer.remove()
    return b.isValid() ? b : null
  }, [geojson])

  const loadDashboard = useCallback(async () => {
    const [h, s] = await Promise.allSettled([
      fetch(API.health),
      fetch(API.zonesRegionSummary),
    ])
    if (h.status === 'fulfilled' && h.value.ok) {
      setHealth((await h.value.json()) as HealthRes)
    } else {
      setHealth(null)
    }
    if (s.status === 'fulfilled' && s.value.ok) {
      setSummary((await s.value.json()) as RegionSummaryRes)
    } else {
      setSummary(null)
    }
  }, [])

  const loadGeojson = useCallback(async () => {
    setGeoLoading(true)
    setGeoError(null)
    try {
      const res = await fetch(API.zonesGeojson)
      const data = (await res.json()) as FeatureCollection & { error?: string; message?: string }
      if (!res.ok) {
        setGeoError(data.message ?? data.error ?? `HTTP ${res.status}`)
        setGeojson(null)
        return
      }
      setGeojson({
        type: 'FeatureCollection',
        features: Array.isArray(data.features) ? data.features : [],
      })
    } catch {
      setGeoError('Network error loading GeoJSON.')
      setGeojson(null)
    } finally {
      setGeoLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
    void loadGeojson()
  }, [loadDashboard, loadGeojson])

  const runAtPoint = useCallback(async (lat: number, lng: number) => {
    setAtPointLoading(true)
    setAtPointError(null)
    setClickLabel(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    try {
      const res = await fetch(API.zonesAtPoint(lat, lng))
      const data = (await res.json()) as AtPointRes & { error?: string; message?: string }
      if (!res.ok) {
        setAtPointError(data.message ?? data.error ?? `HTTP ${res.status}`)
        setMatches([])
        setMatchPick(0)
        return
      }
      setMatches(data.matches ?? [])
      setMatchPick(0)
    } catch {
      setAtPointError('Could not reach at-point API.')
      setMatches([])
      setMatchPick(0)
    } finally {
      setAtPointLoading(false)
    }
  }, [])

  const runAnalyze = useCallback(async (zoneId: number, customQ?: string) => {
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    try {
      const res = await fetch(API.zoneAnalyze(zoneId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          customQ !== undefined && customQ.trim() ? { q: customQ.trim() } : {},
        ),
      })
      const data = (await res.json()) as AnalyzeResponse & {
        error?: string
        message?: string
      }
      if (!res.ok) {
        setAnalyzeError(data.message ?? data.error ?? `HTTP ${res.status}`)
        setAnalyzeData(null)
        return
      }
      setAnalyzeData(data)
      const rag = data.rag
      setRagError(null)
      if (rag.error) {
        setRagData(null)
        setRagError(rag.message ?? String(rag.error))
      } else {
        setRagData({
          query: rag.query,
          answer: rag.answer,
          sources: rag.sources,
          model: rag.model,
        })
      }
    } catch {
      setAnalyzeError('Analyze failed (network).')
      setAnalyzeData(null)
    } finally {
      setAnalyzeLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selected?.id) {
      setAnalyzeData(null)
      setAnalyzeError(null)
      setAnalyzeLoading(false)
      setRagData(null)
      setRagError(null)
      return
    }
    void runAnalyze(selected.id)
  }, [selected?.id, runAnalyze])

  useEffect(() => {
    if (!showApiPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowApiPanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showApiPanel])

  const copyAnalyzeJson = useCallback(async (redactGeometry: boolean) => {
    if (!analyzeData) return
    setCopyNote(null)
    try {
      const payload = redactGeometry ? redactAnalyzeForClipboard(analyzeData) : analyzeData
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setCopyNote(redactGeometry ? 'Copied JSON (geometry redacted).' : 'Copied full JSON.')
      window.setTimeout(() => setCopyNote(null), 2500)
    } catch {
      setCopyNote('Clipboard not available.')
      window.setTimeout(() => setCopyNote(null), 2500)
    }
  }, [analyzeData])

  const runRag = useCallback(async () => {
    const q = ragQuestion.trim()
    if (!q) return
    setRagLoading(true)
    setRagError(null)
    try {
      const body: Record<string, unknown> = { q, limit: 8 }
      if (uploadResult?.document_id) body.document_id = uploadResult.document_id
      if (selected) {
        body.municipality = selected.municipality
        body.zone_code = selected.zoneCode
        body.source_object_id = selected.sourceObjectId
      }
      const res = await fetch(API.rag, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as RagRes
      if (!res.ok) {
        setRagError(data.message ?? data.error ?? `HTTP ${res.status}`)
        return
      }
      setRagData(data)
    } catch {
      setRagError('RAG request failed (network).')
    } finally {
      setRagLoading(false)
    }
  }, [ragQuestion, selected, uploadResult?.document_id])

  async function onUpload(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setUploadBusy(true)
    setUploadError(null)
    setUploadResult(null)
    const fd = new FormData()
    fd.append('file', f)
    try {
      const res = await fetch(API.documentsUpload, { method: 'POST', body: fd })
      const data = (await res.json()) as UploadResult & { message?: string; error?: string }
      if (!res.ok) {
        setUploadError(data.message ?? data.error ?? `Upload failed (${res.status})`)
        return
      }
      setUploadResult(data as UploadResult)
    } catch {
      setUploadError('Upload failed (network).')
    } finally {
      setUploadBusy(false)
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <Building2 size={22} strokeWidth={1.75} />
          <div>
            <h1>Zoning · Waterloo &amp; Kitchener</h1>
            <p className="sub">
              Live data from{' '}
              <code className="inline-code">GET {API.zonesGeojson}</code>
            </p>
          </div>
        </div>
        <div className="top-meta">
          {health ? (
            <span className="pill pill--ok">
              {health.service}: {health.status}
            </span>
          ) : (
            <span className="pill pill--warn">
              <AlertCircle size={14} /> API offline
            </span>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => void loadGeojson()}>
            <RefreshCw size={16} className={geoLoading ? 'spin' : ''} />
            Reload map
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!selected}
            onClick={() => setShowApiPanel(true)}
            title="Formatted API record, ingest status, RAG, and raw JSON"
          >
            <Braces size={16} />
            API data
          </button>
        </div>
      </header>

      <div className="grid">
        <section className="panel map-panel">
          {geoError && (
            <div className="banner banner--err">
              <AlertCircle size={16} /> {geoError}
            </div>
          )}
          <div className="map-wrap">
            <MapContainer
              center={WK_CENTER}
              zoom={11}
              minZoom={10}
              maxZoom={18}
              maxBounds={WK_MAX_BOUNDS}
              maxBoundsViscosity={0.85}
              zoomControl={false}
              className="map-el"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
              <ZoomControl position="topright" />
              {geojson && geojson.features.length > 0 && (
                <GeoJSON
                  data={geojson}
                  style={geoJsonStyle}
                  onEachFeature={(_f, layer) => {
                    layer.on('click', (e: L.LeafletMouseEvent) => {
                      void runAtPoint(e.latlng.lat, e.latlng.lng)
                    })
                  }}
                />
              )}
              <FitBounds bounds={geoBounds} />
            </MapContainer>
            {geoLoading && (
              <div className="map-overlay">
                <Loader2 className="spin" size={28} />
              </div>
            )}
          </div>
          <p className="hint">
            <MapPin size={14} /> Click a zone polygon. Blue ≈ Waterloo, terracotta ≈ Kitchener.
            {summary && (
              <>
                {' '}
                Indexed:{' '}
                <strong>{summary.totalZones}</strong> zones (
                {summary.municipalities.map((m) => (
                  <span key={m}>
                    {m}: {summary.countByMunicipality[m] ?? 0}{' '}
                  </span>
                ))}
                ).
              </>
            )}
          </p>
        </section>

        <aside className="panel side">
          <h2 className="h2">Selected zone</h2>
          {atPointError && <p className="err">{atPointError}</p>}
          {atPointLoading && (
            <p className="muted">
              <Loader2 size={14} className="spin" /> Resolving{' '}
              {clickLabel ?? '…'}
            </p>
          )}
          {!atPointLoading && matches.length === 0 && clickLabel && (
            <p className="muted">No zone at this location ({clickLabel}).</p>
          )}
          {!atPointLoading && matches.length === 0 && !clickLabel && (
            <p className="muted">Click the map to select a zoning polygon.</p>
          )}
          {matches.length > 1 && (
            <label className="field">
              <span>Multiple overlaps — pick one</span>
              <select
                value={matchPick}
                onChange={(e) => setMatchPick(Number(e.target.value))}
              >
                {matches.map((m, i) => (
                  <option key={`${m.id}-${i}`} value={i}>
                    {m.municipality} · {m.zoneCode} (id {m.id})
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && (
            <div className="zone-card">
              <div className="zone-head">
                <strong>{selected.zoneCode}</strong>
                <span className="badge">{selected.municipality}</span>
              </div>
              <dl className="dl">
                {selected.zoneType && (
                  <>
                    <dt>Type</dt>
                    <dd>{selected.zoneType}</dd>
                  </>
                )}
                {selected.zoneName && (
                  <>
                    <dt>Name</dt>
                    <dd>{selected.zoneName}</dd>
                  </>
                )}
                {selected.status && (
                  <>
                    <dt>Status</dt>
                    <dd>{selected.status}</dd>
                  </>
                )}
                {selected.bylawNumber && (
                  <>
                    <dt>Bylaw</dt>
                    <dd>{selected.bylawNumber}</dd>
                  </>
                )}
                {selected.effectiveDate && (
                  <>
                    <dt>Effective</dt>
                    <dd>{selected.effectiveDate}</dd>
                  </>
                )}
                <dt>Source object</dt>
                <dd>
                  <code>{selected.sourceObjectId}</code>
                </dd>
                <dt>API</dt>
                <dd>
                  <a href={API.zone(selected.id)} target="_blank" rel="noreferrer">
                    GET {API.zone(selected.id)}
                    <ExternalLink size={12} />
                  </a>
                </dd>
              </dl>
              <h3 className="h3">Linked PDFs</h3>
              {selected.sourceDocuments?.length ? (
                <ul className="link-list">
                  {selected.sourceDocuments.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noreferrer">
                        {u.replace(/^https?:\/\//, '').slice(0, 72)}
                        {u.length > 72 ? '…' : ''}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No sourceDocuments on this record.</p>
              )}
              <p className="muted small">
                Linked PDFs are sent to the vector index automatically via{' '}
                <code className="inline-code">POST …/analyze</code> when you select this zone
                (no extra click).
              </p>
              {analyzeLoading && (
                <p className="muted small">
                  <Loader2 size={14} className="spin" /> Indexing PDFs and running RAG…
                </p>
              )}
              {analyzeError && <p className="err small">{analyzeError}</p>}
              {analyzeData?.ingest?.results && analyzeData.ingest.results.length > 0 && (
                <ul className="ingest-list">
                  {analyzeData.ingest.results.map((row, i) => (
                    <li key={i}>
                      <span className={`tag tag--${row.status ?? 'unknown'}`}>
                        {row.status ?? '?'}
                      </span>{' '}
                      {row.source_url && (
                        <span className="muted small">{row.source_url.slice(0, 40)}…</span>
                      )}
                      {row.document_id && (
                        <div>
                          <code className="inline-code">{row.document_id}</code>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <hr className="sep" />

          <h2 className="h2">Follow-up (RAG)</h2>
          <p className="muted small">
            Default insights come from <code>POST …/analyze</code>. Ask another question with{' '}
            <code>POST {API.rag}</code> (same zone filters).
          </p>
          <textarea
            className="textarea"
            rows={3}
            value={ragQuestion}
            onChange={(e) => setRagQuestion(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={ragLoading}
            onClick={() => void runRag()}
          >
            {ragLoading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            Ask
          </button>
          {ragError && <p className="err">{ragError}</p>}
          {ragData?.answer && (
            <div className="rag-answer">
              <p>{ragData.answer}</p>
              {ragData.model && (
                <p className="muted small">Model: {ragData.model}</p>
              )}
              {ragData.sources && ragData.sources.length > 0 && (
                <div>
                  <h3 className="h3">Sources</h3>
                  <ol className="sources">
                    {ragData.sources.map((s, i) => (
                      <li key={i}>
                        <strong>{s.human_label ?? `Passage ${i + 1}`}</strong>
                        {s.page != null && <> · p.{s.page}</>}
                        {s.score != null && (
                          <> · score {typeof s.score === 'number' ? s.score.toFixed(3) : s.score}</>
                        )}
                        {s.source_url && (
                          <div>
                            <a href={s.source_url} target="_blank" rel="noreferrer">
                              {s.source_url}
                            </a>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          <hr className="sep" />

          <h2 className="h2">Upload PDF</h2>
          <p className="muted small">
            <code>POST {API.documentsUpload}</code> — optional; adds{' '}
            <code>document_id</code> for RAG.
          </p>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploadBusy}
            onChange={(e) => void onUpload(e.target.files)}
          />
          {uploadError && <p className="err">{uploadError}</p>}
          {uploadResult && (
            <p className="ok small">
              {uploadResult.original_filename}: {uploadResult.chunks_indexed} chunks ·{' '}
              <code>{uploadResult.document_id}</code>
            </p>
          )}
        </aside>
      </div>

      {showApiPanel && selected && (
        <>
          <div
            className="api-backdrop"
            role="presentation"
            aria-hidden
            onClick={() => setShowApiPanel(false)}
          />
          <div
            className="api-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-drawer-title"
          >
            <div className="api-drawer__head">
              <h2 id="api-drawer-title" className="h2">
                API data · {selected.municipality} · {selected.zoneCode}
              </h2>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setShowApiPanel(false)}
              >
                Close
              </button>
            </div>

            <p className="muted small">
              <a href={API.zone(selected.id)} target="_blank" rel="noreferrer">
                GET {API.zone(selected.id)} <ExternalLink size={12} />
              </a>
              {' · '}
              <code className="inline-code">POST {API.zoneAnalyze(selected.id)}</code> ingests linked
              PDFs and runs RAG automatically.
            </p>

            {analyzeLoading && (
              <p className="muted">
                <Loader2 size={16} className="spin" /> Loading record, indexing PDFs, running RAG…
              </p>
            )}
            {analyzeError && <p className="err">{analyzeError}</p>}

            {analyzeData && (
              <>
                <section className="api-section">
                  <h3 className="h3">Zone record</h3>
                  <dl className="kv">
                    <dt>Municipality</dt>
                    <dd>{analyzeData.record.municipality}</dd>
                    <dt>Zone code</dt>
                    <dd>{analyzeData.record.zoneCode}</dd>
                    {analyzeData.record.zoneType != null && analyzeData.record.zoneType !== '' && (
                      <>
                        <dt>Zone type</dt>
                        <dd>{analyzeData.record.zoneType}</dd>
                      </>
                    )}
                    {analyzeData.record.zoneName != null && analyzeData.record.zoneName !== '' && (
                      <>
                        <dt>Zone name</dt>
                        <dd>{analyzeData.record.zoneName}</dd>
                      </>
                    )}
                    {analyzeData.record.status != null && analyzeData.record.status !== '' && (
                      <>
                        <dt>Status</dt>
                        <dd>{analyzeData.record.status}</dd>
                      </>
                    )}
                    {analyzeData.record.bylawNumber != null &&
                      analyzeData.record.bylawNumber !== '' && (
                        <>
                          <dt>Bylaw</dt>
                          <dd>{analyzeData.record.bylawNumber}</dd>
                        </>
                      )}
                    {analyzeData.record.effectiveDate != null &&
                      analyzeData.record.effectiveDate !== '' && (
                        <>
                          <dt>Effective</dt>
                          <dd>{analyzeData.record.effectiveDate}</dd>
                        </>
                      )}
                    <dt>Source object</dt>
                    <dd>
                      <code className="inline-code">{analyzeData.record.sourceObjectId}</code>
                    </dd>
                    <dt>Geometry</dt>
                    <dd className="muted">{geometrySummary(analyzeData.record.geometry)}</dd>
                    <dt>Source URLs</dt>
                    <dd>
                      {analyzeData.record.sourceDocuments?.length ? (
                        <ul className="link-list">
                          {analyzeData.record.sourceDocuments.map((u) => (
                            <li key={u}>
                              <a href={u} target="_blank" rel="noreferrer">
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </dd>
                  </dl>
                </section>

                <section className="api-section">
                  <h3 className="h3">PDF ingest</h3>
                  {analyzeData.ingest.results.length === 0 ? (
                    <p className="muted">No ingest rows returned.</p>
                  ) : (
                    <ul className="ingest-list ingest-list--compact">
                      {analyzeData.ingest.results.map((row, i) => (
                        <li key={i}>
                          <span className={`tag tag--${row.status ?? 'unknown'}`}>
                            {row.status ?? '?'}
                          </span>{' '}
                          {row.source_url && (
                            <a href={row.source_url} target="_blank" rel="noreferrer" className="small">
                              {row.source_url}
                            </a>
                          )}
                          {row.document_id && (
                            <div>
                              <code className="inline-code">{row.document_id}</code>
                            </div>
                          )}
                          {row.message && <div className="small muted">{row.message}</div>}
                          {row.error && <div className="err small">{row.error}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="api-section">
                  <h3 className="h3">RAG insights</h3>
                  {analyzeData.rag.query && (
                    <p className="muted small">
                      <strong>Question:</strong> {analyzeData.rag.query}
                    </p>
                  )}
                  {analyzeData.rag.error || analyzeData.rag.message ? (
                    <p className="err">
                      {analyzeData.rag.message ?? analyzeData.rag.error}
                      {!analyzeData.rag.answer && (
                        <span className="muted small">
                          {' '}
                          (Set <code className="inline-code">GROQ_API_KEY</code> on the server for
                          answers.)
                        </span>
                      )}
                    </p>
                  ) : null}
                  {analyzeData.rag.answer && (
                    <div className="rag-answer rag-answer--panel">
                      <p>{analyzeData.rag.answer}</p>
                      {analyzeData.rag.model && (
                        <p className="muted small">Model: {analyzeData.rag.model}</p>
                      )}
                    </div>
                  )}
                  {analyzeData.rag.sources && analyzeData.rag.sources.length > 0 && (
                    <ol className="sources">
                      {analyzeData.rag.sources.map((s, i) => (
                        <li key={i}>
                          <strong>{s.human_label ?? `Passage ${i + 1}`}</strong>
                          {s.page != null && <> · p.{s.page}</>}
                          {s.score != null && (
                            <> · score {typeof s.score === 'number' ? s.score.toFixed(3) : s.score}</>
                          )}
                          {s.source_url && (
                            <div>
                              <a href={s.source_url} target="_blank" rel="noreferrer">
                                {s.source_url}
                              </a>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className="api-section api-section--row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={analyzeLoading || !ragQuestion.trim()}
                    onClick={() => void runAnalyze(selected.id, ragQuestion)}
                    title="Uses the question from the sidebar RAG field"
                  >
                    {analyzeLoading ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    Re-analyze with sidebar question
                  </button>
                  <div className="api-copy-btns">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => void copyAnalyzeJson(true)}
                    >
                      <Copy size={16} /> Copy JSON (no geometry)
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => void copyAnalyzeJson(false)}
                    >
                      <Copy size={16} /> Copy full JSON
                    </button>
                  </div>
                </section>
                {copyNote && <p className="ok small">{copyNote}</p>}
              </>
            )}

            {!analyzeLoading && !analyzeData && !analyzeError && (
              <p className="muted">Select a zone on the map; analysis runs automatically.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
