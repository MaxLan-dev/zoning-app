import L from 'leaflet'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'
import {
  AlertCircle,
  Building2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Upload,
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

  const [ingestLoading, setIngestLoading] = useState(false)
  const [ingestRows, setIngestRows] = useState<IngestResultRow[] | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)

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
    setIngestRows(null)
    setIngestError(null)
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

  const runIngest = useCallback(async () => {
    if (!selected) return
    setIngestLoading(true)
    setIngestError(null)
    setIngestRows(null)
    try {
      const res = await fetch(API.zoneIngestDocs(selected.id), { method: 'POST' })
      const data = (await res.json()) as {
        results?: IngestResultRow[]
        error?: string
        message?: string
      }
      if (!res.ok) {
        setIngestError(data.message ?? data.error ?? `HTTP ${res.status}`)
        return
      }
      setIngestRows(data.results ?? [])
    } catch {
      setIngestError('Ingest request failed.')
    } finally {
      setIngestLoading(false)
    }
  }, [selected])

  const runRag = useCallback(async () => {
    const q = ragQuestion.trim()
    if (!q) return
    setRagLoading(true)
    setRagError(null)
    setRagData(null)
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
              <button
                type="button"
                className="btn btn--primary"
                disabled={ingestLoading}
                onClick={() => void runIngest()}
              >
                {ingestLoading ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Upload size={16} />
                )}
                POST {API.zoneIngestDocs(selected.id).replace(/^https?:\/\/[^/]+/, '')}
              </button>
              {ingestError && <p className="err">{ingestError}</p>}
              {ingestRows && (
                <ul className="ingest-list">
                  {ingestRows.map((row, i) => (
                    <li key={i}>
                      <span className={`tag tag--${row.status ?? 'unknown'}`}>
                        {row.status ?? '?'}
                      </span>{' '}
                      {row.source_url && (
                        <span className="muted small">{row.source_url.slice(0, 48)}…</span>
                      )}
                      {row.document_id && (
                        <div>
                          <code className="inline-code">{row.document_id}</code>
                        </div>
                      )}
                      {row.message && <div className="small">{row.message}</div>}
                      {row.error && <div className="err small">{row.error}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <hr className="sep" />

          <h2 className="h2">RAG</h2>
          <p className="muted small">
            <code>POST {API.rag}</code>
            {selected
              ? ` — filtered by municipality, zone_code, source_object_id`
              : ' — no zone filter until you click the map'}
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
    </div>
  )
}
