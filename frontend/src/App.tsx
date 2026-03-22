import L from 'leaflet'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'
import {
  ArrowUpRight,
  Braces,
  Building2,
  CircleHelp,
  Download,
  FileText,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  UserCircle2,
} from 'lucide-react'
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

type PublicResource = { label: string; url: string }

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
  publicResources?: PublicResource[]
  sourceUrl?: string
  geojsonUrl?: string
  lastRunId?: string | null
}

type LayerVisibility = {
  zoning: boolean
  neighborhoods: boolean
  districtPlans: boolean
  floodplain: boolean
}

type AiSource = {
  id: string
  label: string
  excerpt: string
  citation: string
  url?: string
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
  ingest: {
    results: IngestResultRow[]
    summary?: {
      linkedPdfUrlsInOpenData: number
      rows: number
      byStatus: Record<string, number>
    }
  }
  rag: RagRes & { query?: string }
}

function featureBounds(geojson: Feature<Polygon>): BoundsTuple {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      west = Math.min(west, value[0])
      east = Math.max(east, value[0])
      south = Math.min(south, value[1])
      north = Math.max(north, value[1])
      return
    }
    value.forEach(visit)
  }

  visit(geojson.geometry.coordinates)

  return [
    [south, west],
    [north, east],
  ]
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

function titleCaseMunicipality(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatRagError(message: string) {
  if (message.includes('Index required but not found')) {
    return 'Zone-scoped evidence filters were not ready in the vector index yet. Retry now that the backend has created the needed indexes, or ingest linked PDFs for this zone first.'
  }
  if (message.includes('groq_not_configured')) {
    return 'RAG is not configured yet. Add `GROQ_API_KEY` in the repo-root `.env` file and restart the backend.'
  }
  return message
}

function FormattedRagAnswer({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  return (
    <div className="rag-prose">
      {paragraphs.map((para, i) => {
        const lines = para.split('\n')
        const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
        const allBullets =
          nonEmpty.length > 1 &&
          nonEmpty.every((l) => /^(\d+[\).]|[•\-*])\s/.test(l))
        if (allBullets) {
          return (
            <ul key={i} className="rag-list">
              {nonEmpty.map((l, j) => (
                <li key={j}>{l.replace(/^(\d+[\).]|[•\-*])\s+/, '')}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {line}
                {j < lines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function geoJsonStyle(feature?: Feature): L.PathOptions {
  const m = (feature?.properties as { municipality?: string } | undefined)?.municipality
  const kitchener = m === 'kitchener'
  return {
    mode: 'mock',
    question,
    answer,
    sources: zone.evidence.map((item) => ({
      id: item.id,
      label: item.title,
      excerpt: item.excerpt,
      citation: item.citation,
      url: item.url,
    })),
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function MapViewport({
  bounds,
}: {
  bounds: BoundsTuple | null
}) {
  const map = useMap()

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [36, 36], animate: true, duration: 0.7 })
    }
  }, [bounds, map])

  return null
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function MetricBar({
  label,
  value,
  max,
  unit,
  color,
}: {
  label: string
  value: number
  max: number
  unit: string
  color: string
}) {
  const width = `${Math.max(12, (value / max) * 100)}%`

  return (
    <div className="metric-bar">
      <div className="metric-bar__header">
        <span>{label}</span>
        <strong>
          {value}
          {unit}
        </strong>
      </div>
      <div className="metric-bar__track">
        <div className="metric-bar__fill" style={{ width, background: color }} />
      </div>
    </div>
  )
}

function overlayStyle(feature: OverlayFeature) {
  return {
    color: feature.color,
    weight: 1.4,
    fillColor: feature.color,
    fillOpacity: feature.fillOpacity,
    dashArray: feature.label === 'District plan' ? '8 6' : undefined,
  }
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [appError, setAppError] = useState<string | null>(null)
  const [indexedZoneTotal, setIndexedZoneTotal] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('Waterloo')
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters, municipality: 'Waterloo' })
  const [layers, setLayers] = useState<LayerVisibility>(defaultLayerVisibility)
  const [selectedZoneId, setSelectedZoneId] = useState('waterloo-uptown-rmu-20')
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)
  const [compareZoneIds, setCompareZoneIds] = useState<string[]>([
    'waterloo-uptown-rmu-20',
    'kitchener-downtown-d6',
  ])
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true)
  const [bottomTab, setBottomTab] = useState<'comparison' | 'analytics' | 'evidence'>(
    'comparison',
  )
  const [askInput, setAskInput] = useState('How restrictive is this zone for multifamily housing?')
  const [aiResponse, setAiResponse] = useState<AiResponse | null>(null)
  const [asking, setAsking] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [mapBounds, setMapBounds] = useState<BoundsTuple | null>(
    mergeZoneBounds(mockZones),
  )
  const [recentQueries, setRecentQueries] = useState<string[]>([
    'Waterloo RMU-20',
    'Parking-heavy neighbourhoods',
    'Floodplain overlays in Cambridge',
  ])
  const [showHelp, setShowHelp] = useState(true)
  const [activePopupZoneId, setActivePopupZoneId] = useState<string | null>(
    'waterloo-uptown-rmu-20',
  )

  useEffect(() => {
    async function loadApiState() {
      setHealthLoading(true)

      const [healthResult, zonesResult] = await Promise.allSettled([
        fetch('/api/v1/health'),
        fetch('/api/v1/zones?limit=1'),
      ])

      if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
        const data = (await healthResult.value.json()) as Health
        setHealth(data)
        setAppError(null)
      } else {
        setHealth(null)
        setAppError(
          'Live backend services are offline. The interface is running with realistic demo data, and upload/RAG features will reconnect automatically when the Flask API is available.',
        )
      }

      if (zonesResult.status === 'fulfilled' && zonesResult.value.ok) {
        const data = (await zonesResult.value.json()) as ZoneApiSummary
        setIndexedZoneTotal(data.total)
      }

      setHealthLoading(false)
    }

    void loadApiState()
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
    setAnalyzeData(null)
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

    applySavedView(result.savedViewId)
  }

  function toggleCompare(zoneId: string) {
    setCompareZoneIds((previous) => {
      const next = previous.includes(zoneId)
        ? previous.filter((item) => item !== zoneId)
        : [...previous, zoneId].slice(-4)
      if (next.length >= 2) {
        setBottomPanelOpen(true)
        setBottomTab('comparison')
      }
      return next
    })
  }

  async function onUploadFile(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return

    setUploadStatus('Indexing PDF into the evidence workspace...')
    setUploadResult(null)

    const body = new FormData()
    body.append('file', file)

    try {
      const res = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body,
      })
      const data = (await res.json().catch(() => ({}))) as Partial<UploadResult> & {
        message?: string
      }

      if (!res.ok) {
        setUploadStatus(null)
        setAppError(data.message ?? `Upload failed (${res.status}).`)
        return
      }

      setUploadStatus(null)
      setUploadResult(data as UploadResult)
      setAppError(null)
      setBottomPanelOpen(true)
      setBottomTab('evidence')
    } catch {
      setUploadStatus(null)
      setAppError('Upload failed because the backend API is currently unreachable.')
    }
  }

  async function askQuestion() {
    if (!selectedZone || !askInput.trim()) return

    setAsking(true)
    const question = askInput.trim()
    pushRecentQuery(question)

    try {
      const res = await fetch('/api/v1/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: `${selectedZone.areaName} (${selectedZone.zoneCode}, ${selectedZone.municipality}): ${question}`,
          limit: 6,
          ...(uploadResult?.document_id
            ? { document_id: uploadResult.document_id }
            : {}),
        }),
      })

      if (!res.ok) {
        throw new Error('live_rag_unavailable')
      }

      const data = (await res.json()) as {
        answer?: string
        sources?: Array<{
          human_label?: string
          page?: number
          score?: number
          chunk_index?: number
        }>
      }

      setAiResponse({
        mode: 'live',
        question,
        answer: data.answer ?? 'No answer returned.',
        sources:
          data.sources?.map((source, index) => ({
            id: `${source.human_label ?? 'source'}-${index}`,
            label: source.human_label ?? `Source ${index + 1}`,
            excerpt: `Indexed evidence chunk ${source.chunk_index ?? index + 1} from the live vector search pipeline.`,
            citation: `Page ${source.page ?? 'n/a'} · score ${
              source.score ? source.score.toFixed(2) : 'n/a'
            }`,
          })) ?? [],
      })
      setAppError(null)
    } catch {
      setAiResponse(buildMockAnswer(selectedZone, question))
    } finally {
      setAsking(false)
    }
  }

  function exportSelection() {
    downloadJson('zoning-platform-export.json', {
      exportedAt: new Date().toISOString(),
      selectedArea: selectedZone,
      comparedAreas: comparedZones,
      appliedFilters: filters,
      searchQuery,
    })
  }

  const popupZone = mockZones.find((zone) => zone.id === activePopupZoneId) ?? null
  const comparisonRows: Array<{ label: string; values: string[] }> = [
    { label: 'Municipality', values: comparedZones.map((zone) => zone.municipality) },
    {
      label: 'Permitted housing',
      values: comparedZones.map((zone) => zone.permittedHousing.join(', ')),
    },
    { label: 'Height', values: comparedZones.map((zone) => `${zone.maxHeightM}m`) },
    { label: 'Parking', values: comparedZones.map((zone) => zone.parkingRequirement) },
    {
      label: 'Setbacks',
      values: comparedZones.map(
        (zone) => `${zone.setbacks.front}/${zone.setbacks.side}/${zone.setbacks.rear}m`,
      ),
    },
    { label: 'Density', values: comparedZones.map((zone) => zone.density) },
    {
      label: 'Additional units',
      values: comparedZones.map((zone) =>
        zone.additionalUnitAllowed ? 'Permitted' : 'More limited',
      ),
    },
  ]

  return (
    <div className="platform-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand__mark">
            <Building2 size={18} />
          </div>
          <div>
            <h1>National Zoning &amp; Land Use Data Platform</h1>
            <p>Explore zoning, land use, and housing constraints</p>
          </div>
        </div>

        <div className="topbar__search">
          <Search size={16} />
          <input
            type="search"
            value={searchQuery}
            placeholder="Search municipality, address, neighborhood, or zone"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (!compareZoneIds.includes(selectedZone.id)) {
                toggleCompare(selectedZone.id)
              }
              setBottomPanelOpen(true)
              setBottomTab('comparison')
            }}
          >
            <GitCompareArrows size={16} />
            Compare
          </button>
          <button type="button" className="ghost-button" onClick={exportSelection}>
            <Download size={16} />
            Export
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => window.open('/api/v1/health', '_blank', 'noopener,noreferrer')}
          >
            <Braces size={16} />
            API
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowHelp((previous) => !previous)}
          >
            <CircleHelp size={16} />
            Help
          </button>
          <div className="profile-pill">
            <UserCircle2 size={18} />
            <span>Research Workspace</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar panel-surface">
          <div className="sidebar__top">
            <div className="section-heading">
              <span>National view</span>
              <strong>Canada zoning explorer</strong>
            </div>
            <div className="stat-grid">
              <StatCard
                label="Visible zones"
                value={formatNumber(summaryMatchesCount)}
                tone="positive"
              />
              <StatCard
                label="Multi-family enabled"
                value={`${multiFamilyCount}/${summaryMatchesCount || 1}`}
              />
              <StatCard
                label="Avg. restriction score"
                value={`${averageRestriction}/100`}
                tone="warning"
              />
              <StatCard
                label="Indexed zones"
                value={formatNumber(indexedZoneTotal ?? mockZones.length)}
              />
            </div>
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
          <section className="info-card">
            <h2 className="h2">How to use this</h2>
            <ol className="steps">
              <li>Click a zoning polygon on the map to load the selected zone.</li>
              <li>Ingest linked PDFs for that zone, or upload your own PDF.</li>
              <li>Ask a zoning question and review the cited sources.</li>
            </ol>
          </section>

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
              <div className="zone-hero">
                <div className="zone-hero__row">
                  <span className="zone-hero__code">{selected.zoneCode}</span>
                  <span className="badge badge--mun">{titleCaseMunicipality(selected.municipality)}</span>
                </div>
                {selected.zoneName && (
                  <p className="zone-hero__name">{selected.zoneName}</p>
                )}
                <div className="zone-meta-row">
                  <span className="mini-pill">Zone id {selected.id}</span>
                  {selected.zoneType && <span className="mini-pill">{selected.zoneType}</span>}
                  {selected.status && <span className="mini-pill">{selected.status}</span>}
                </div>
              </div>

              <section className="zone-section">
                <h3 className="h3">Open data · this polygon</h3>
                <dl className="dl dl--compact">
                  {selected.zoneType && (
                    <>
                      <dt>Category</dt>
                      <dd>{selected.zoneType}</dd>
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
                      <dt>Bylaw ref.</dt>
                      <dd>{selected.bylawNumber}</dd>
                    </>
                  )}
                  {selected.effectiveDate && (
                    <>
                      <dt>Effective</dt>
                      <dd>{selected.effectiveDate}</dd>
                    </>
                  )}
                  <dt>Feature ID</dt>
                  <dd>
                    <code className="inline-code">{selected.sourceObjectId}</code>
                  </dd>
                </dl>
              </section>

              <section className="zone-section">
                <h3 className="h3">Data feeds</h3>
                <ul className="resource-links">
                  {selected.geojsonUrl && (
                    <li>
                      <a href={selected.geojsonUrl} target="_blank" rel="noreferrer">
                        Zoning GeoJSON layer <ExternalLink size={12} />
                      </a>
                    </li>
                  )}
                  {selected.sourceUrl && (
                    <li>
                      <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                        Map service (ArcGIS) <ExternalLink size={12} />
                      </a>
                    </li>
                  )}
                </ul>
              </section>

              <section className="zone-section zone-section--insights">
                <h3 className="h3 h3--insights">
                  <Sparkles size={17} strokeWidth={2} /> AI insights
                </h3>
                <p className="muted small zone-lede">
                  We run <code className="inline-code">POST …/analyze</code> when you pick a zone:
                  ingest any PDF URLs stored in open data, then ask the model using retrieved text only.
                </p>
                {analyzeLoading && (
                  <div className="callout callout--wait">
                    <Loader2 size={18} className="spin" />
                    <span>Indexing linked PDFs (if any) and generating an answer…</span>
                  </div>
                )}
                {analyzeError && <p className="err">{analyzeError}</p>}
                {!analyzeLoading && analyzeData && (
                  <>
                    {analyzeData.ingest.summary && (
                      <p className="ingest-pill muted small">
                        <strong>Open data PDF links:</strong>{' '}
                        {analyzeData.ingest.summary.linkedPdfUrlsInOpenData} ·{' '}
                        <strong>Ingest rows:</strong> {analyzeData.ingest.summary.rows}
                        {Object.keys(analyzeData.ingest.summary.byStatus).length > 0 && (
                          <>
                            {' '}
                            (
                            {Object.entries(analyzeData.ingest.summary.byStatus)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')}
                            )
                          </>
                        )}
                      </p>
                    )}
                    {analyzeData.rag.error && (
                      <div className="callout callout--warn">
                        <strong>AI unavailable or limited.</strong>{' '}
                        {analyzeData.rag.message ?? analyzeData.rag.error}
                      </div>
                    )}
                    {analyzeData.rag.answer && (
                      <div className="rag-answer rag-answer--hero">
                        <FormattedRagAnswer text={analyzeData.rag.answer} />
                        {analyzeData.rag.model && (
                          <p className="muted small rag-model">Model: {analyzeData.rag.model}</p>
                        )}
                      </div>
                    )}
                    {analyzeData.rag.sources && analyzeData.rag.sources.length > 0 && (
                      <div className="sources-block">
                        <h4 className="h4">Sources used</h4>
                        <ol className="sources">
                          {analyzeData.rag.sources.map((s, i) => (
                            <li key={i}>
                              <strong>{s.human_label ?? `Passage ${i + 1}`}</strong>
                              {s.page != null && <> · p.{s.page}</>}
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
                  </>
                )}
                {!analyzeLoading && !analyzeData && !analyzeError && (
                  <p className="muted small">Waiting for zone analysis…</p>
                )}
              </section>

              <section className="zone-section">
                <h3 className="h3">Official city websites</h3>
                {(selected.publicResources?.length ?? 0) > 0 ? (
                  <ul className="resource-links">
                    {selected.publicResources!.map((r) => (
                      <li key={r.url}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.label} <ExternalLink size={12} />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No curated links for this municipality slug.</p>
                )}
              </section>

              <section className="zone-section">
                <h3 className="h3">Bylaw PDFs from GIS metadata</h3>
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
                  <div className="callout callout--info">
                    <p>
                      <strong>No PDF URLs on this record.</strong> Waterloo and Kitchener zoning
                      layers usually store zone codes and labels, not direct bylaw PDF links, so there
                      is nothing to auto-ingest until we add municipal PDFs to the index (or you
                      upload a file below).
                    </p>
                  </div>
                )}
              </section>

              <details className="zone-details">
                <summary>Technical · API &amp; ingest detail</summary>
                <p className="muted small">
                  <a href={API.zone(selected.id)} target="_blank" rel="noreferrer">
                    GET {API.zone(selected.id)} <ExternalLink size={12} />
                  </a>
                </p>
                {analyzeData?.ingest?.results && analyzeData.ingest.results.length > 0 && (
                  <ul className="ingest-list ingest-list--compact">
                    {analyzeData.ingest.results.map((row, i) => (
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
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
          )}

          <hr className="sep" />

          <h2 className="h2">Follow-up (RAG)</h2>
          <p className="muted small">
            Default insights come from <code>POST …/analyze</code>. Ask another question with{' '}
            <code>POST {API.rag}</code>
            {selected
              ? ` — zone context: ${selected.zoneCode} (${titleCaseMunicipality(selected.municipality)})`
              : ' — click a polygon first for zone-aware answers'}
            .
          </p>
          <div className="prompt-row">
            {promptChips.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="prompt-chip"
                onClick={() => setRagQuestion(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <textarea
            className="textarea"
            rows={3}
            value={ragQuestion}
            onChange={(e) => setRagQuestion(e.target.value)}
            placeholder="Ask about permitted uses, setbacks, parking, density, or what bylaw sections to read first."
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
          {!selected && (
            <p className="muted small">
              Tip: select a zone first so the answer can use zone-specific evidence and linked documents.
            </p>
          )}
          {ragError && <p className="err">{ragError}</p>}
          {ragData?.answer && (
            <div className="rag-answer">
              <FormattedRagAnswer text={ragData.answer} />
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

            <div className="floating-card floating-card--layers">
              <div className="floating-card__title">
                <MapPin size={15} />
                <span>Live layers</span>
              </div>
              {[
                ['zoning', 'Zoning'],
                ['neighborhoods', 'Communities'],
                ['districtPlans', 'District plans'],
                ['floodplain', 'Floodplain'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`mini-toggle ${layers[key as keyof LayerVisibility] ? 'mini-toggle--active' : ''}`}
                  onClick={() =>
                    setLayers((previous) => ({
                      ...previous,
                      [key]: !previous[key as keyof LayerVisibility],
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <MapContainer
              center={[43.451, -80.494]}
              zoom={11}
              zoomControl={false}
              className="leaflet-shell"
            >
              <MapViewport bounds={mapBounds} />
              <ZoomControl position="bottomright" />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {layers.neighborhoods &&
                neighborhoodOverlays.map((feature) => (
                  <GeoJSON
                    key={feature.id}
                    data={feature.geometry as GeoJsonObject}
                    style={overlayStyle(feature)}
                  />
                ))}

              {layers.districtPlans &&
                districtPlanOverlays.map((feature) => (
                  <GeoJSON
                    key={feature.id}
                    data={feature.geometry as GeoJsonObject}
                    style={overlayStyle(feature)}
                  />
                ))}

              {layers.floodplain &&
                floodplainOverlays.map((feature) => (
                  <GeoJSON
                    key={feature.id}
                    data={feature.geometry as GeoJsonObject}
                    style={overlayStyle(feature)}
                  />
                ))}

              {layers.zoning &&
                visibleZones.map((zone) => {
                  const isSelected = zone.id === selectedZoneId
                  const isHovered = zone.id === hoveredZoneId

                  return (
                    <GeoJSON
                      key={zone.id}
                      data={zone.geometry as GeoJsonObject}
                      style={{
                        color: isSelected ? '#16377b' : isHovered ? '#284eaa' : '#ffffff',
                        weight: isSelected ? 3.2 : isHovered ? 2.5 : 1.3,
                        fillColor: zoneFill(zone),
                        fillOpacity: isSelected ? 0.64 : 0.48,
                      }}
                      eventHandlers={{
                        click: () => {
                          selectZone(zone)
                        },
                        mouseover: () => setHoveredZoneId(zone.id),
                        mouseout: () => setHoveredZoneId((current) => (current === zone.id ? null : current)),
                      }}
                    />
                  )
                })}

              {popupZone && (
                <Popup
                  position={popupZone.centroid}
                  eventHandlers={{ remove: () => setActivePopupZoneId(null) }}
                >
                  <div className="map-popup">
                    <div className="map-popup__eyebrow">{popupZone.municipality}</div>
                    <h3>{popupZone.areaName}</h3>
                    <p>
                      <strong>{popupZone.zoneCode}</strong> · {popupZone.zoneCategory}
                    </p>
                    <div className="map-popup__stats">
                      <span>{popupZone.maxHeightM}m height</span>
                      <span>{popupZone.parkingSpacesPerUnit} spaces/unit</span>
                    </div>
                    <div className="map-popup__actions">
                      <button type="button" onClick={() => selectZone(popupZone)}>
                        View details
                      </button>
                      <button type="button" onClick={() => toggleCompare(popupZone.id)}>
                        {compareZoneIds.includes(popupZone.id) ? 'Remove compare' : 'Add compare'}
                      </button>
                    </div>
                  </div>
                </Popup>
              )}
            </MapContainer>
          </div>
        </section>

        <aside className="details-panel panel-surface">
          <div className="details-panel__header">
            <div>
              <span className="eyebrow">Selected area</span>
              <h2>{selectedZone.areaName}</h2>
              <p>
                {selectedZone.neighborhood}, {selectedZone.municipality}
              </p>
            </div>
            <button
              type="button"
              className={`chip-button ${compareZoneIds.includes(selectedZone.id) ? 'chip-button--active' : ''}`}
              onClick={() => toggleCompare(selectedZone.id)}
            >
              <GitCompareArrows size={14} />
              {compareZoneIds.includes(selectedZone.id) ? 'In compare set' : 'Add to compare'}
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
                    <dt>GIS-linked PDFs</dt>
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
                        <span className="muted">None on this record</span>
                      )}
                    </dd>
                    <dt>Official websites</dt>
                    <dd>
                      {analyzeData.record.publicResources?.length ? (
                        <ul className="link-list">
                          {analyzeData.record.publicResources.map((r) => (
                            <li key={r.url}>
                              <a href={r.url} target="_blank" rel="noreferrer">
                                {r.label}
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

          <section className="content-card">
            <div className="card-title">
              <FileText size={16} />
              <span>Source evidence</span>
            </div>
            <div className="evidence-list">
              {selectedZone.evidence.map((item: EvidenceItem) => (
                <a
                  className="evidence-item"
                  href={item.url}
                  key={item.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.excerpt}</p>
                    <small>{item.citation}</small>
                  </div>
                  <ArrowUpRight size={15} />
                </a>
              ))}
            </div>
          </section>

                <section className="api-section">
                  <h3 className="h3">RAG insights</h3>
                  {analyzeData.rag.query && (
                    <p className="muted small">
                      <strong>Question:</strong> {analyzeData.rag.query}
                    </p>
                  )}
                  {analyzeData.rag.error && (
                    <div className="callout callout--warn">
                      {analyzeData.rag.message ?? analyzeData.rag.error}
                    </div>
                  )}
                  {analyzeData.rag.answer && (
                    <div className="rag-answer rag-answer--panel">
                      <FormattedRagAnswer text={analyzeData.rag.answer} />
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

export default App
