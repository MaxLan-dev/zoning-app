import L from 'leaflet'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import type { Feature, FeatureCollection, GeoJsonObject } from 'geojson'
import {
  AlertCircle,
  Braces,
  Building2,
  Database,
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
  ingestMunicipalities: '/api/v1/jobs/ingest-zoning/municipalities',
  ingestionRuns: '/api/v1/jobs/ingest-zoning/runs?limit=12',
  ingestZoning: '/api/v1/jobs/ingest-zoning',
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
  geometry?: unknown
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

type MunicipalityTemplate = {
  slug: string
  displayName: string
  sourceUrl: string
  geojsonUrl?: string | null
  allowedDomains: string[]
}

type IngestionRunSummary = {
  id: string
  municipality: string
  status: string
  totalFeatures: number
  normalizedCount: number
  insertedCount: number
  updatedCount: number
  addedCount: number
  unchangedCount: number
  removedCount: number
  skippedCount: number
  errorCount: number
  errorMessage?: string | null
  changeCount: number
  hasChanges: boolean
  coverageRate?: number | null
  reviewFlags: string[]
  startedAt?: string | null
  finishedAt?: string | null
}

type IngestionRunsResponse = {
  runs: IngestionRunSummary[]
  latestByMunicipality: Record<string, IngestionRunSummary>
}

type ZoneFeatureProperties = {
  id?: number
  municipality?: string
  zoneCode?: string
  zoneName?: string | null
  zoneType?: string | null
  sourceObjectId?: string
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

function formatAnalyzeError(message: string) {
  if (message.includes('ingest_failed')) {
    return 'The app could not index linked zoning PDFs for this area. You can still browse the open-data record or upload a document manually below.'
  }
  return formatRagError(message)
}

function formatFlag(flag: string) {
  return flag
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatRelativeDate(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'Updated <1 hour ago'
  if (diffHours < 24) return `Updated ${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  return `Updated ${diffDays}d ago`
}

function getFeatureProps(feature?: Feature | null): ZoneFeatureProperties {
  if (!feature || !feature.properties || typeof feature.properties !== 'object') {
    return {}
  }
  return feature.properties as ZoneFeatureProperties
}

function featureLabel(feature?: Feature | null) {
  const props = getFeatureProps(feature)
  const code = props.zoneCode || 'Unknown zone'
  const name = props.zoneName?.trim()
  const municipality = props.municipality ? titleCaseMunicipality(props.municipality) : 'Unknown municipality'
  return name ? `${code} · ${name} (${municipality})` : `${code} · ${municipality}`
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
  const [municipalityTemplates, setMunicipalityTemplates] = useState<MunicipalityTemplate[]>([])
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRunSummary[]>([])
  const [latestRunsByMunicipality, setLatestRunsByMunicipality] = useState<
    Record<string, IngestionRunSummary>
  >({})
  const [operationsLoading, setOperationsLoading] = useState(true)
  const [operationsError, setOperationsError] = useState<string | null>(null)
  const [refreshingMunicipality, setRefreshingMunicipality] = useState<string | null>(null)
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [zoneSearch, setZoneSearch] = useState('')
  const [municipalityFilter, setMunicipalityFilter] = useState<'all' | 'waterloo' | 'kitchener'>(
    'all',
  )
  const [hoveredZoneId, setHoveredZoneId] = useState<number | null>(null)

  const [atPointLoading, setAtPointLoading] = useState(false)
  const [atPointError, setAtPointError] = useState<string | null>(null)
  const [matches, setMatches] = useState<ZoneMatch[]>([])
  const [matchPick, setMatchPick] = useState(0)
  const [clickLabel, setClickLabel] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'zone' | 'operations'>('zone')

  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null)
  const [analyzeCache, setAnalyzeCache] = useState<Record<number, AnalyzeResponse>>({})
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
  const promptChips = useMemo(() => {
    if (!selected) {
      return [
        'What does this zoning area allow?',
        'What should I read first in this bylaw?',
        'Which PDFs are linked to this zone?',
      ]
    }
    return [
      `What uses are permitted in ${selected.zoneCode}?`,
      `Summarize the main constraints for ${selected.zoneCode}.`,
      `What should I read first for ${selected.zoneCode}?`,
    ]
  }, [selected])

  const featureMatches = useCallback(
    (feature?: Feature | null) => {
      const props = getFeatureProps(feature)
      const municipalityOk =
        municipalityFilter === 'all' || props.municipality === municipalityFilter
      const query = zoneSearch.trim().toLowerCase()
      const text = [
        props.zoneCode,
        props.zoneName,
        props.zoneType,
        props.sourceObjectId,
        props.municipality,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const searchOk = !query || text.includes(query)
      return municipalityOk && searchOk
    },
    [municipalityFilter, zoneSearch],
  )

  const zoneSearchResults = useMemo(() => {
    const features = geojson?.features ?? []
    return features
      .filter((feature) => featureMatches(feature))
      .slice(0, 8)
      .map((feature) => {
        const props = getFeatureProps(feature)
        return {
          id: Number(props.id),
          label: featureLabel(feature),
          municipality: props.municipality ?? '',
          zoneCode: props.zoneCode ?? '',
        }
      })
      .filter((item) => Number.isFinite(item.id))
  }, [featureMatches, geojson?.features])

  const matchedFeatureCount = useMemo(() => {
    const features = geojson?.features ?? []
    if (!zoneSearch.trim() && municipalityFilter === 'all') return features.length
    return features.filter((feature) => featureMatches(feature)).length
  }, [featureMatches, geojson?.features, municipalityFilter, zoneSearch])

  const geoBounds = useMemo(() => {
    if (!geojson?.features?.length) return null
    const layer = L.geoJSON(geojson as GeoJsonObject)
    const b = layer.getBounds()
    layer.remove()
    return b.isValid() ? b : null
  }, [geojson])

  const selectedBounds = useMemo(() => {
    if (!selected?.geometry) return null
    const layer = L.geoJSON(selected.geometry as GeoJsonObject)
    const b = layer.getBounds()
    layer.remove()
    return b.isValid() ? b : null
  }, [selected])

  const hasActiveMapFilter = municipalityFilter !== 'all' || zoneSearch.trim().length > 0
  const selectedMunicipalityRun = selected
    ? latestRunsByMunicipality[selected.municipality]
    : null

  const loadDashboard = useCallback(async () => {
    setOperationsLoading(true)
    const [h, s, templatesRes, runsRes] = await Promise.allSettled([
      fetch(API.health),
      fetch(API.zonesRegionSummary),
      fetch(API.ingestMunicipalities),
      fetch(API.ingestionRuns),
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
    if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
      const data = (await templatesRes.value.json()) as { municipalities?: MunicipalityTemplate[] }
      setMunicipalityTemplates(data.municipalities ?? [])
      setOperationsError(null)
    } else {
      setMunicipalityTemplates([])
      setOperationsError('Could not load supported municipality templates.')
    }
    if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
      const data = (await runsRes.value.json()) as IngestionRunsResponse
      setIngestionRuns(data.runs ?? [])
      setLatestRunsByMunicipality(data.latestByMunicipality ?? {})
    } else {
      setIngestionRuns([])
      setLatestRunsByMunicipality({})
    }
    setOperationsLoading(false)
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

  const triggerMunicipalityRefresh = useCallback(
    async (slug: string) => {
      setRefreshingMunicipality(slug)
      setOperationsError(null)
      try {
        const res = await fetch(API.ingestZoning, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ municipality: slug }),
        })
        const data = (await res.json()) as { error?: string; message?: string }
        if (!res.ok) {
          setOperationsError(data.message ?? data.error ?? `HTTP ${res.status}`)
          return
        }
        await Promise.all([loadDashboard(), loadGeojson()])
      } catch {
        setOperationsError('Could not start the municipality refresh job.')
      } finally {
        setRefreshingMunicipality(null)
      }
    },
    [loadDashboard, loadGeojson],
  )

  useEffect(() => {
    void loadDashboard()
    void loadGeojson()
  }, [loadDashboard, loadGeojson])

  const applyAnalyzeResponse = useCallback((data: AnalyzeResponse) => {
    setAnalyzeData(data)
    const rag = data.rag
    setRagError(null)
    if (rag.error) {
      setRagData(null)
      setRagError(formatRagError(rag.message ?? String(rag.error)))
      return
    }
    setRagData({
      query: rag.query,
      answer: rag.answer,
      sources: rag.sources,
      model: rag.model,
    })
  }, [])

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

  const loadZoneById = useCallback(async (zoneId: number) => {
    setAtPointLoading(true)
    setAtPointError(null)
    try {
      const res = await fetch(API.zone(zoneId))
      const data = (await res.json()) as { record?: ZoneMatch; error?: string; message?: string }
      if (!res.ok || !data.record) {
        setAtPointError(data.message ?? data.error ?? `HTTP ${res.status}`)
        return
      }
      setMatches([data.record])
      setMatchPick(0)
      setClickLabel(`Zone ${data.record.zoneCode}`)
    } catch {
      setAtPointError('Could not load zone record.')
    } finally {
      setAtPointLoading(false)
    }
  }, [])

  const runAnalyze = useCallback(async (zoneId: number, customQ?: string, force = false) => {
    if (!customQ && !force && analyzeCache[zoneId]) {
      applyAnalyzeResponse(analyzeCache[zoneId])
      return
    }
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    if (!customQ) {
      setAnalyzeData(null)
    }
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
        setAnalyzeError(formatAnalyzeError(data.message ?? data.error ?? `HTTP ${res.status}`))
        setAnalyzeData(null)
        return
      }
      applyAnalyzeResponse(data)
      if (!customQ) {
        setAnalyzeCache((previous) => ({ ...previous, [zoneId]: data }))
      }
    } catch {
      setAnalyzeError('Analyze failed (network).')
      setAnalyzeData(null)
    } finally {
      setAnalyzeLoading(false)
    }
  }, [analyzeCache, applyAnalyzeResponse])

  useEffect(() => {
    if (!selected?.id) {
      setAnalyzeData(null)
      setAnalyzeError(null)
      setAnalyzeLoading(false)
      setRagData(null)
      setRagError(null)
      return
    }
    setSideTab('zone')
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
        setRagError(formatRagError(data.message ?? data.error ?? `HTTP ${res.status}`))
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
          <div className="map-toolbar">
            <div className="map-toolbar__search">
              <input
                type="search"
                value={zoneSearch}
                onChange={(e) => setZoneSearch(e.target.value)}
                placeholder="Find zone code, bylaw, or municipality"
              />
            </div>
            <label className="map-toolbar__filter">
              <span>Municipality</span>
              <select
                value={municipalityFilter}
                onChange={(e) =>
                  setMunicipalityFilter(e.target.value as 'all' | 'waterloo' | 'kitchener')
                }
              >
                <option value="all">All</option>
                <option value="waterloo">Waterloo</option>
                <option value="kitchener">Kitchener</option>
              </select>
            </label>
            {(hasActiveMapFilter || selected) && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setZoneSearch('')
                  setMunicipalityFilter('all')
                  setMatches([])
                  setMatchPick(0)
                  setClickLabel(null)
                }}
              >
                Clear focus
              </button>
            )}
          </div>
          <div className="map-wrap">
            <div className="map-float map-float--legend">
              <div className="map-float__title">Map legend</div>
              <div className="legend-row">
                <span className="legend-swatch legend-swatch--waterloo" />
                Waterloo polygons
              </div>
              <div className="legend-row">
                <span className="legend-swatch legend-swatch--kitchener" />
                Kitchener polygons
              </div>
              <div className="legend-row">
                <span className="legend-swatch legend-swatch--selected" />
                Selected zone
              </div>
            </div>

            {(hasActiveMapFilter || zoneSearchResults.length > 0) && (
              <div className="map-float map-float--results">
                <div className="map-float__title">Matching zones</div>
                <p className="muted small">
                  {matchedFeatureCount} match{matchedFeatureCount === 1 ? '' : 'es'} in the current map.
                </p>
                {zoneSearchResults.length > 0 ? (
                  <div className="search-list">
                    {zoneSearchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className={`search-list__item ${selected?.id === result.id ? 'search-list__item--active' : ''}`}
                        onClick={() => void loadZoneById(result.id)}
                      >
                        <strong>{result.zoneCode}</strong>
                        <span>{titleCaseMunicipality(result.municipality)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted small">No zones match the current search.</p>
                )}
              </div>
            )}

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
                  style={(feature) => {
                    const props = getFeatureProps(feature)
                    const featureId = typeof props.id === 'number' ? props.id : null
                    const matched = featureMatches(feature)
                    const base = geoJsonStyle(feature)
                    const isSelected = featureId != null && selected?.id === featureId
                    const isHovered = featureId != null && hoveredZoneId === featureId

                    return {
                      ...base,
                      color: isSelected ? '#f8fafc' : isHovered ? '#fcd34d' : base.color,
                      weight: isSelected ? 2.8 : isHovered ? 2.2 : base.weight,
                      fillOpacity: isSelected
                        ? 0.38
                        : matched
                          ? base.fillOpacity
                          : hasActiveMapFilter
                            ? 0.03
                            : base.fillOpacity,
                      opacity: matched || !hasActiveMapFilter ? 1 : 0.3,
                    }
                  }}
                  onEachFeature={(feature, layer) => {
                    const props = getFeatureProps(feature)
                    const featureId = typeof props.id === 'number' ? props.id : null
                    layer.bindTooltip(featureLabel(feature), {
                      sticky: true,
                      direction: 'top',
                    })
                    layer.on('mouseover', () => {
                      if (featureId != null) setHoveredZoneId(featureId)
                    })
                    layer.on('mouseout', () => {
                      if (featureId != null) {
                        setHoveredZoneId((current) => (current === featureId ? null : current))
                      }
                    })
                    layer.on('click', (e: L.LeafletMouseEvent) => {
                      void runAtPoint(e.latlng.lat, e.latlng.lng)
                    })
                  }}
                />
              )}
              <FitBounds bounds={selectedBounds ?? geoBounds} />
            </MapContainer>
            {geoLoading && (
              <div className="map-overlay">
                <Loader2 className="spin" size={28} />
              </div>
            )}
            {!geoLoading && geojson && geojson.features.length === 0 && (
              <div className="map-overlay map-overlay--empty">
                <div className="empty-card">
                  <strong>No zoning polygons loaded</strong>
                  <p>Run ingestion for Waterloo and Kitchener, then reload the map.</p>
                </div>
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
          <div className="side-nav">
            <div className="side-nav__head">
              <div>
                <h2 className="h2">Workspace</h2>
                <p className="muted small">
                  Keep the research view focused while moving operations into a separate pane.
                </p>
              </div>
            </div>
            <div className="side-nav__tabs">
              <button
                type="button"
                className={`side-tab ${sideTab === 'zone' ? 'side-tab--active' : ''}`}
                onClick={() => setSideTab('zone')}
              >
                Zone view
              </button>
              <button
                type="button"
                className={`side-tab ${sideTab === 'operations' ? 'side-tab--active' : ''}`}
                onClick={() => setSideTab('operations')}
              >
                Data operations
              </button>
            </div>
          </div>

          {sideTab === 'operations' ? (
            <section className="ops-card">
              <div className="ops-card__head">
                <div>
                  <h2 className="h2">Data operations</h2>
                  <p className="muted small">
                    Refresh supported municipalities and monitor change detection.
                  </p>
                </div>
                <Database size={18} />
              </div>
              {operationsError && <p className="err">{operationsError}</p>}
              {operationsLoading && <p className="muted small">Loading municipality operations…</p>}
              <div className="ops-grid">
                {municipalityTemplates.map((template) => {
                  const latestRun = latestRunsByMunicipality[template.slug]
                  return (
                    <div className="ops-tile" key={template.slug}>
                      <div className="ops-tile__top">
                        <strong>{template.displayName}</strong>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          disabled={refreshingMunicipality === template.slug}
                          onClick={() => void triggerMunicipalityRefresh(template.slug)}
                        >
                          {refreshingMunicipality === template.slug ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          Refresh
                        </button>
                      </div>
                      {latestRun ? (
                        <>
                          <div className="ops-metrics">
                            <span className={`tag tag--${latestRun.status}`}>{latestRun.status}</span>
                            <span>{latestRun.totalFeatures} features</span>
                            <span>{latestRun.changeCount} changes</span>
                          </div>
                          <p className="muted small">{formatRelativeDate(latestRun.finishedAt)}</p>
                          {latestRun.reviewFlags.length > 0 && (
                            <div className="ops-flags">
                              {latestRun.reviewFlags.map((flag) => (
                                <span key={flag} className="mini-pill">
                                  {formatFlag(flag)}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="muted small">No ingestion run recorded yet.</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {selectedMunicipalityRun && (
                <div className="ops-selected">
                  <strong>Selected municipality freshness</strong>
                  <p className="muted small">
                    {titleCaseMunicipality(selectedMunicipalityRun.municipality)} ·{' '}
                    {formatRelativeDate(selectedMunicipalityRun.finishedAt)} · coverage{' '}
                    {selectedMunicipalityRun.coverageRate ?? 0}%
                  </p>
                </div>
              )}
              {ingestionRuns.length > 0 && (
                <details className="zone-details zone-details--ops">
                  <summary>Recent ingestion runs</summary>
                  <div className="runs-list">
                    {ingestionRuns.slice(0, 6).map((run) => (
                      <div key={run.id} className="run-row">
                        <div>
                          <strong>{titleCaseMunicipality(run.municipality)}</strong>
                          <div className="muted small">
                            {formatRelativeDate(run.finishedAt)} · {run.totalFeatures} features
                          </div>
                        </div>
                        <div className="run-row__meta">
                          <span className={`tag tag--${run.status}`}>{run.status}</span>
                          <span className="muted small">{run.changeCount} changes</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
          ) : (
            <div className="side-stack">
              <section className="info-card">
                <h2 className="h2">How to use this</h2>
                <ol className="steps">
                  <li>Click a zoning polygon on the map to load the selected zone.</li>
                  <li>Review the AI summary and core zoning metadata.</li>
                  <li>Open follow-up questions or documents only when needed.</li>
                </ol>
              </section>

              <div className="side-status">
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
              </div>

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
                  The first time you select a zone, the app runs <code className="inline-code">POST
                  …/analyze</code>: ingest any PDF URLs stored in open data, then answer using
                  retrieved text only.
                </p>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={analyzeLoading}
                    onClick={() => void runAnalyze(selected.id, undefined, true)}
                  >
                    {analyzeLoading ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Refresh AI analysis
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setShowApiPanel(true)}
                  >
                    <Braces size={16} />
                    Inspect API data
                  </button>
                </div>
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

                  <details className="side-fold" open>
                    <summary>Follow-up questions</summary>
                    <div className="side-fold__body">
                      <p className="muted small">
                        Default insights come from <code>POST …/analyze</code>. Ask another question
                        with <code>POST {API.rag}</code>
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
                      )}
                    </div>
                  </details>

                  <details className="side-fold">
                    <summary>Sources and documents</summary>
                    <div className="side-fold__body">
                      <section className="zone-section zone-section--compact">
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

                      <section className="zone-section zone-section--compact">
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
                    </div>
                  </details>

                  <details className="side-fold">
                    <summary>Upload your own PDF</summary>
                    <div className="side-fold__body">
                      <p className="muted small">
                        <code>POST {API.documentsUpload}</code> — optional; adds a dedicated{' '}
                        <code>document_id</code> filter for RAG when you want to search one uploaded document.
                      </p>
                      <label className="upload-dropzone">
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          disabled={uploadBusy}
                          onChange={(e) => void onUpload(e.target.files)}
                        />
                        <span className="upload-dropzone__title">
                          {uploadBusy ? 'Uploading and indexing PDF…' : 'Choose a PDF to index'}
                        </span>
                        <span className="upload-dropzone__meta">
                          Use this when the zone record has no linked bylaw PDF or you want to search one document directly.
                        </span>
                      </label>
                      {uploadError && <p className="err">{uploadError}</p>}
                      {uploadResult && (
                        <div className="callout callout--success">
                          <p>
                            <strong>{uploadResult.original_filename}</strong> indexed successfully.
                          </p>
                          <p className="small">
                            {uploadResult.chunks_indexed} chunks · <code>{uploadResult.document_id}</code>
                          </p>
                        </div>
                      )}
                    </div>
                  </details>

                  <details className="side-fold">
                    <summary>Technical details</summary>
                    <div className="side-fold__body">
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
                    </div>
                  </details>
                </div>
              )}
            </div>
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
