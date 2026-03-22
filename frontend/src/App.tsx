import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import type { Feature, GeoJsonObject, Polygon } from 'geojson'
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
import {
  districtPlanOverlays,
  floodplainOverlays,
  mockZones,
  municipalities,
  neighborhoodOverlays,
  savedViews,
  type EvidenceItem,
  type OverlayFeature,
  type ZoneRecord,
} from './mockData'

/** Map pan limit: City of Kitchener + City of Waterloo area (WGS84). */
const WK_MAX_BOUNDS = L.latLngBounds([43.37, -80.65], [43.58, -80.32])
const WK_CENTER: L.LatLngTuple = [43.475, -80.485]
const WK_INITIAL_ZOOM = 11

const GEOJSON_URL = '/api/v1/zones/geojson?region=waterloo-kitchener'
const AT_POINT_URL = (lat: number, lng: number) =>
  `/api/v1/zones/at-point?lat=${lat}&lng=${lng}&region=waterloo-kitchener`

type UploadResult = {
  document_id: string
  chunks_indexed: number
  total_pages: number
  original_filename: string
  uploaded_at: string
  collection: string
}

type ZoneApiSummary = {
  total: number
}

type SearchResult =
  | { id: string; kind: 'municipality'; label: string; municipality: string }
  | { id: string; kind: 'zone'; label: string; zoneId: string }
  | { id: string; kind: 'saved'; label: string; savedViewId: string }

type Filters = {
  municipality: string
  zoneCategory: string
  housingType: string
  heightBand: string
  parkingBand: string
  densityBand: string
  setbackBand: string
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

type AiResponse = {
  mode: 'live' | 'mock'
  question: string
  answer: string
  sources: AiSource[]
}

type BoundsTuple = [[number, number], [number, number]]

const defaultFilters: Filters = {
  municipality: '',
  zoneCategory: '',
  housingType: '',
  heightBand: '',
  parkingBand: '',
  densityBand: '',
  setbackBand: '',
}

const defaultLayerVisibility: LayerVisibility = {
  zoning: true,
  neighborhoods: true,
  districtPlans: true,
  floodplain: true,
}

const zoneCategoryPalette: Record<string, string> = {
  'Residential Mixed Use': '#3569d4',
  'Residential Medium Density': '#7891d0',
  'Downtown Mixed Use': '#1d8c76',
  'Mixed Use Corridor': '#2d9e85',
  'Mid-Rise Residential': '#5471c9',
  'Low-Rise Residential': '#c58a54',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-CA').format(value)
}

function zoneFill(zone: ZoneRecord) {
  return zoneCategoryPalette[zone.zoneCategory] ?? '#5c6bc0'
}

function getStatusChips(zone: ZoneRecord) {
  const chips: string[] = []
  if (zone.multiFamilyAllowed) chips.push('Multi-family allowed')
  if (zone.additionalUnitAllowed) chips.push('Additional unit allowed')
  if (zone.maxHeightM <= 12) chips.push('Height restrictive')
  if (zone.parkingSpacesPerUnit > 1.2) chips.push('Parking-heavy')
  if (zone.floodplain) chips.push('Floodplain overlay')
  return chips
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

function mergeZoneBounds(zones: ZoneRecord[]): BoundsTuple {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  zones.forEach((zone) => {
    const [[zoneSouth, zoneWest], [zoneNorth, zoneEast]] = featureBounds(zone.geometry)
    west = Math.min(west, zoneWest)
    south = Math.min(south, zoneSouth)
    east = Math.max(east, zoneEast)
    north = Math.max(north, zoneNorth)
  })

  return [
    [south, west],
    [north, east],
  ]
}

function matchesHeightBand(zone: ZoneRecord, value: string) {
  if (!value) return true
  if (value === 'low') return zone.maxHeightM <= 12
  if (value === 'mid') return zone.maxHeightM > 12 && zone.maxHeightM <= 20
  if (value === 'high') return zone.maxHeightM > 20
  return true
}

function matchesParkingBand(zone: ZoneRecord, value: string) {
  if (!value) return true
  if (value === 'low') return zone.parkingSpacesPerUnit <= 0.9
  if (value === 'mid') {
    return zone.parkingSpacesPerUnit > 0.9 && zone.parkingSpacesPerUnit <= 1.2
  }
  if (value === 'heavy') return zone.parkingSpacesPerUnit > 1.2
  return true
}

function matchesDensityBand(zone: ZoneRecord, value: string) {
  if (!value) return true
  if (value === 'low') return zone.densityUnitsPerHectare <= 75
  if (value === 'mid') {
    return zone.densityUnitsPerHectare > 75 && zone.densityUnitsPerHectare <= 200
  }
  if (value === 'high') return zone.densityUnitsPerHectare > 200
  return true
}

function matchesSetbackBand(zone: ZoneRecord, value: string) {
  if (!value) return true
  if (value === 'urban') return zone.setbacks.front <= 3
  if (value === 'buffered') return zone.setbacks.front > 3
  return true
}

function buildMockAnswer(zone: ZoneRecord, question: string): AiResponse {
  const focus = question.toLowerCase()
  let answer =
    `${zone.zoneCode} in ${zone.neighborhood}, ${zone.municipality} allows ` +
    `${zone.permittedHousing.join(', ').toLowerCase()} with a maximum height of ` +
    `${zone.maxHeightM}m, ${zone.parkingRequirement.toLowerCase()}, and ` +
    `${zone.density.toLowerCase()}`

  if (focus.includes('parking')) {
    answer =
      `${zone.zoneCode} applies ${zone.parkingRequirement.toLowerCase()} ` +
      `This is ${zone.parkingSpacesPerUnit > 1.2 ? 'relatively parking-heavy' : 'relatively supportive of lower parking supply'} ` +
      `compared with the other sample zones.`
  } else if (focus.includes('height')) {
    answer =
      `${zone.zoneCode} permits a maximum building height of ${zone.maxHeightM} metres. ` +
      `${zone.maxHeightM <= 12 ? 'That height limit is comparatively restrictive for multifamily projects.' : 'That envelope supports mid-rise or taller housing forms depending on site design.'}`
  } else if (focus.includes('adu') || focus.includes('additional')) {
    answer =
      `${zone.additionalUnitRule} ` +
      `${zone.additionalUnitAllowed ? 'The zone is generally supportive of additional units.' : 'Additional unit permissions are limited in this zone.'}`
  } else if (focus.includes('afford')) {
    answer =
      `${zone.whyItMatters} Based on the current mock scoring, the affordability impact is rated ${zone.affordabilityImpact.toLowerCase()} and the restriction score is ${zone.restrictionScore}/100.`
  }

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

  const [mapReady, setMapReady] = useState(false)
  const [mapStatus, setMapStatus] = useState<string | null>(null)
  const [zonePick, setZonePick] = useState<ZonePick | null>(null)
  const [ingestStatus, setIngestStatus] = useState<string | null>(null)

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

  const selectedZone =
    mockZones.find((zone) => zone.id === selectedZoneId) ?? mockZones[0]

  const visibleZones = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()

    return mockZones.filter((zone) => {
      const matchesMunicipality =
        !filters.municipality || zone.municipality === filters.municipality
      const matchesZoneCategory =
        !filters.zoneCategory || zone.zoneCategory === filters.zoneCategory
      const matchesHousing =
        !filters.housingType || zone.permittedHousing.includes(filters.housingType)
      const matchesSearch =
        !search ||
        zone.areaName.toLowerCase().includes(search) ||
        zone.municipality.toLowerCase().includes(search) ||
        zone.neighborhood.toLowerCase().includes(search) ||
        zone.zoneCode.toLowerCase().includes(search)

      return (
        matchesMunicipality &&
        matchesZoneCategory &&
        matchesHousing &&
        matchesSearch &&
        matchesHeightBand(zone, filters.heightBand) &&
        matchesParkingBand(zone, filters.parkingBand) &&
        matchesDensityBand(zone, filters.densityBand) &&
        matchesSetbackBand(zone, filters.setbackBand)
      )
    })
  }, [filters, searchQuery])

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []

    const municipalityMatches = municipalities
      .filter((municipality) => municipality.toLowerCase().includes(query))
      .map((municipality) => ({
        id: `municipality-${municipality}`,
        kind: 'municipality' as const,
        label: municipality,
        municipality,
      }))

    const zoneMatches = mockZones
      .filter((zone) => {
        return (
          zone.areaName.toLowerCase().includes(query) ||
          zone.neighborhood.toLowerCase().includes(query) ||
          zone.zoneCode.toLowerCase().includes(query)
        )
      })
      .slice(0, 6)
      .map((zone) => ({
        id: `zone-${zone.id}`,
        kind: 'zone' as const,
        label: `${zone.areaName} · ${zone.zoneCode}`,
        zoneId: zone.id,
      }))

    const savedMatches = savedViews
      .filter((savedView) => savedView.name.toLowerCase().includes(query))
      .map((savedView) => ({
        id: `saved-${savedView.id}`,
        kind: 'saved' as const,
        label: savedView.name,
        savedViewId: savedView.id,
      }))

    return [...municipalityMatches, ...zoneMatches, ...savedMatches].slice(0, 7)
  }, [searchQuery])

  const comparedZones = mockZones.filter((zone) => compareZoneIds.includes(zone.id))

  const summaryMatchesCount = visibleZones.length
  const multiFamilyCount = visibleZones.filter((zone) => zone.multiFamilyAllowed).length
  const averageRestriction = Math.round(
    visibleZones.reduce((sum, zone) => sum + zone.restrictionScore, 0) /
      Math.max(1, visibleZones.length),
  )

  const evidenceFeed: AiSource[] = aiResponse?.sources ?? selectedZone.evidence.map((item) => ({
    id: item.id,
    label: item.title,
    excerpt: item.excerpt,
    citation: item.citation,
    url: item.url,
  }))

  const availableZoneCategories = [...new Set(mockZones.map((zone) => zone.zoneCategory))]
  const availableHousingTypes = [
    ...new Set(mockZones.flatMap((zone) => zone.permittedHousing)),
  ].sort((left, right) => left.localeCompare(right))

  function pushRecentQuery(value: string) {
    setRecentQueries((previous) => [value, ...previous.filter((item) => item !== value)].slice(0, 5))
  }

  function focusZones(zones: ZoneRecord[]) {
    if (zones.length) {
      setMapBounds(mergeZoneBounds(zones))
    }
  }

  function selectZone(zone: ZoneRecord) {
    setSelectedZoneId(zone.id)
    setActivePopupZoneId(zone.id)
    setMapBounds(featureBounds(zone.geometry))
    setBottomTab('analytics')
  }

  function applySavedView(savedViewId: string) {
    const savedView = savedViews.find((item) => item.id === savedViewId)
    if (!savedView) return

    const zones = mockZones.filter((zone) => savedView.zoneIds.includes(zone.id))
    setCompareZoneIds(savedView.zoneIds)
    setBottomPanelOpen(true)
    setBottomTab('comparison')
    setSearchQuery(savedView.name)
    pushRecentQuery(savedView.name)
    focusZones(zones)
    if (zones[0]) {
      setSelectedZoneId(zones[0].id)
      setActivePopupZoneId(zones[0].id)
    }
  }

  function handleSearchSelection(result: SearchResult) {
    if (result.kind === 'municipality') {
      const zones = mockZones.filter((zone) => zone.municipality === result.municipality)
      setFilters((previous) => ({ ...previous, municipality: result.municipality }))
      setSearchQuery(result.label)
      pushRecentQuery(result.label)
      focusZones(zones)
      if (zones[0]) {
        setSelectedZoneId(zones[0].id)
        setActivePopupZoneId(zones[0].id)
      }
      return
    }

    if (result.kind === 'zone') {
      const zone = mockZones.find((item) => item.id === result.zoneId)
      if (!zone) return
      setSearchQuery(zone.areaName)
      pushRecentQuery(`${zone.municipality} ${zone.zoneCode}`)
      selectZone(zone)
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
      const body: Record<string, unknown> = {
        q: ragQuery.trim(),
        limit: 8,
      }
      if (uploadResult?.document_id) body.document_id = uploadResult.document_id
      if (zonePick) {
        body.municipality = zonePick.municipality
        body.zone_code = zonePick.zoneCode
        body.source_object_id = zonePick.sourceObjectId
      }
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

          <div className="service-card">
            <div className="service-card__header">
              <div>
                <span>System health</span>
                <strong>API and evidence services</strong>
              </div>
              {healthLoading ? (
                <div className="status-skeleton" />
              ) : (
                <span className={`health-pill ${health ? 'health-pill--ok' : 'health-pill--offline'}`}>
                  {health ? `${health.service}: ${health.status}` : 'Demo mode'}
                </span>
              )}
            </div>
            {appError ? (
              <div className="inline-alert">
                <TriangleAlert size={16} />
                <span>{appError}</span>
              </div>
            ) : (
              <p className="muted-copy">
                Live upload and RAG workflows are available when the backend is running through the
                Vite proxy.
              </p>
            )}
          </div>

          <details className="accordion" open>
            <summary>Search municipality / address / neighborhood</summary>
            <div className="accordion__body">
              <label className="field">
                <span>Explore places</span>
                <div className="search-field">
                  <Search size={16} />
                  <input
                    type="text"
                    value={searchQuery}
                    placeholder="Waterloo, Uptown, RMU-20..."
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </label>
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="search-result"
                      onClick={() => handleSearchSelection(result)}
                    >
                      <span>{result.label}</span>
                      <small>{result.kind}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>

          <details className="accordion" open>
            <summary>Filters</summary>
            <div className="accordion__body">
              <FilterSelect
                label="Municipality"
                value={filters.municipality}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    municipality: value,
                  }))
                }
                options={[
                  { value: '', label: 'All municipalities' },
                  ...municipalities.map((item) => ({ value: item, label: item })),
                ]}
              />
              <FilterSelect
                label="Zone type"
                value={filters.zoneCategory}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    zoneCategory: value,
                  }))
                }
                options={[
                  { value: '', label: 'All zone categories' },
                  ...availableZoneCategories.map((item) => ({ value: item, label: item })),
                ]}
              />
              <FilterSelect
                label="Housing type allowed"
                value={filters.housingType}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    housingType: value,
                  }))
                }
                options={[
                  { value: '', label: 'Any housing type' },
                  ...availableHousingTypes.map((item) => ({ value: item, label: item })),
                ]}
              />
              <FilterSelect
                label="Height restrictions"
                value={filters.heightBand}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    heightBand: value,
                  }))
                }
                options={[
                  { value: '', label: 'Any height band' },
                  { value: 'low', label: 'Low-rise (<= 12m)' },
                  { value: 'mid', label: 'Mid-rise (12m to 20m)' },
                  { value: 'high', label: 'Tall / permissive (> 20m)' },
                ]}
              />
              <FilterSelect
                label="Parking requirements"
                value={filters.parkingBand}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    parkingBand: value,
                  }))
                }
                options={[
                  { value: '', label: 'Any parking profile' },
                  { value: 'low', label: 'Low parking (<= 0.9 spaces)' },
                  { value: 'mid', label: 'Moderate parking' },
                  { value: 'heavy', label: 'Parking-heavy (> 1.2 spaces)' },
                ]}
              />
              <FilterSelect
                label="Density restrictions"
                value={filters.densityBand}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    densityBand: value,
                  }))
                }
                options={[
                  { value: '', label: 'Any density level' },
                  { value: 'low', label: 'Low density (<= 75 units/ha)' },
                  { value: 'mid', label: 'Mid density' },
                  { value: 'high', label: 'High density (> 200 units/ha)' },
                ]}
              />
              <FilterSelect
                label="Setback rules"
                value={filters.setbackBand}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    setbackBand: value,
                  }))
                }
                options={[
                  { value: '', label: 'Any frontage condition' },
                  { value: 'urban', label: 'Urban frontage (<= 3m front setback)' },
                  { value: 'buffered', label: 'Buffered frontage (> 3m)' },
                ]}
              />
            </div>
          </details>

          <details className="accordion" open>
            <summary>Layers</summary>
            <div className="accordion__body">
              {[
                ['zoning', 'Zoning polygons'],
                ['neighborhoods', 'Planning communities'],
                ['districtPlans', 'District plans'],
                ['floodplain', 'Floodplain overlays'],
              ].map(([key, label]) => (
                <label className="checkbox-row" key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key as keyof LayerVisibility]}
                    onChange={() =>
                      setLayers((previous) => ({
                        ...previous,
                        [key]: !previous[key as keyof LayerVisibility],
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>

          <details className="accordion" open>
            <summary>Saved views / recent queries</summary>
            <div className="accordion__body">
              <div className="saved-views">
                {savedViews.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    className="saved-view-card"
                    onClick={() => applySavedView(view.id)}
                  >
                    <strong>{view.name}</strong>
                    <span>{view.description}</span>
                  </button>
                ))}
              </div>
              <div className="recent-list">
                {recentQueries.map((query) => (
                  <button
                    key={query}
                    type="button"
                    className="recent-list__item"
                    onClick={() => setSearchQuery(query)}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          </details>
        </aside>

        <section className="map-panel panel-surface">
          <div className="map-panel__header">
            <div>
              <span className="eyebrow">Spatial Explorer</span>
              <h2>Interactive zoning map</h2>
            </div>
            <div className="map-panel__meta">
              <span>{visibleZones.length} visible polygons</span>
              <span>{compareZoneIds.length} areas selected for compare</span>
            </div>
          </div>

          <div className="map-panel__canvas">
            {showHelp && (
              <div className="map-callout">
                <div className="map-callout__title">
                  <Sparkles size={16} />
                  <strong>Demo-ready zoning intelligence workspace</strong>
                </div>
                <p>
                  Click a polygon to open the details drawer, compare zones in the lower panel,
                  and use the evidence workspace to test the upload and RAG flows.
                </p>
                <button type="button" className="text-button" onClick={() => setShowHelp(false)}>
                  Dismiss
                </button>
              </div>
            )}

            <div className="floating-card floating-card--legend">
              <div className="floating-card__title">
                <Layers3 size={15} />
                <span>Legend</span>
              </div>
              <div className="legend-list">
                {[
                  ['#3569d4', 'Mixed-use / higher opportunity'],
                  ['#5471c9', 'Mid-rise residential'],
                  ['#c58a54', 'Low-rise / restrictive'],
                  ['#8a6ce6', 'Floodplain overlay'],
                ].map(([color, label]) => (
                  <div className="legend-item" key={label}>
                    <span className="legend-swatch" style={{ background: color }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
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

          <div className="detail-meta">
            <span className="detail-pill">{selectedZone.zoneCode}</span>
            <span className="detail-pill">{selectedZone.zoneCategory}</span>
            <span className="detail-pill">{selectedZone.zoneType}</span>
          </div>

          <p className="details-summary">{selectedZone.summary}</p>

          <div className="chip-row">
            {getStatusChips(selectedZone).map((chip) => (
              <span key={chip} className="status-chip">
                {chip}
              </span>
            ))}
          </div>

          <div className="detail-cards">
            <div className="detail-card">
              <span>Permitted housing types</span>
              <strong>{selectedZone.permittedHousing.join(', ')}</strong>
            </div>
            <div className="detail-card">
              <span>Minimum lot size</span>
              <strong>{formatNumber(selectedZone.minLotSizeSqm)} sqm</strong>
            </div>
            <div className="detail-card">
              <span>Maximum building height</span>
              <strong>{selectedZone.maxHeightM} m</strong>
            </div>
            <div className="detail-card">
              <span>Parking requirements</span>
              <strong>{selectedZone.parkingRequirement}</strong>
            </div>
            <div className="detail-card">
              <span>Front / side / rear setbacks</span>
              <strong>
                {selectedZone.setbacks.front}m / {selectedZone.setbacks.side}m /{' '}
                {selectedZone.setbacks.rear}m
              </strong>
            </div>
            <div className="detail-card">
              <span>Density / dwelling unit restrictions</span>
              <strong>{selectedZone.density}</strong>
            </div>
            <div className="detail-card">
              <span>Additional residential unit rules</span>
              <strong>{selectedZone.additionalUnitRule}</strong>
            </div>
            <div className="detail-card">
              <span>Affordability impact</span>
              <strong>
                {selectedZone.affordabilityImpact} · score {selectedZone.restrictionScore}/100
              </strong>
            </div>
          </div>

          <section className="content-card">
            <div className="card-title">
              <ShieldCheck size={16} />
              <span>Why this matters</span>
            </div>
            <p>{selectedZone.whyItMatters}</p>
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

          <section className="content-card">
            <div className="card-title">
              <Sparkles size={16} />
              <span>Ask about this area</span>
            </div>
            <div className="ask-card">
              <textarea
                value={askInput}
                onChange={(event) => setAskInput(event.target.value)}
                placeholder="Ask about permitted housing, parking, setbacks, affordability, or source evidence..."
              />
              <button type="button" className="primary-button" onClick={() => void askQuestion()}>
                {asking ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    Thinking
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Ask zoning AI
                  </>
                )}
              </button>
            </div>
            {aiResponse ? (
              <div className="ai-response">
                <div className="ai-response__meta">
                  <span className={`mode-pill mode-pill--${aiResponse.mode}`}>
                    {aiResponse.mode === 'live' ? 'Live RAG answer' : 'Structured mock answer'}
                  </span>
                  <strong>{aiResponse.question}</strong>
                </div>
                <p>{aiResponse.answer}</p>
              </div>
            ) : (
              <div className="empty-state">
                <Sparkles size={18} />
                <span>Ask a question to generate a structured zoning explanation card.</span>
              </div>
            )}
          </section>

          <section className="content-card">
            <div className="card-title">
              <Upload size={16} />
              <span>Evidence workspace</span>
            </div>
            <p className="muted-copy">
              Upload a zoning PDF to wire in the existing vectorization and evidence retrieval flow.
            </p>
            <label className="upload-field">
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => void onUploadFile(event.target.files)}
              />
              <span>Upload source PDF</span>
            </label>
            {uploadStatus && <p className="muted-copy">{uploadStatus}</p>}
            {uploadResult && (
              <div className="upload-result-card">
                <strong>{uploadResult.original_filename}</strong>
                <span>
                  {uploadResult.chunks_indexed} chunks across {uploadResult.total_pages} pages
                </span>
                <small>Document ID: {uploadResult.document_id}</small>
              </div>
            )}
          </section>
        </aside>
      </main>

      <section className={`bottom-panel panel-surface ${bottomPanelOpen ? '' : 'bottom-panel--collapsed'}`}>
        <div className="bottom-panel__header">
          <div>
            <span className="eyebrow">Analytics &amp; comparison</span>
            <h2>Cross-zone constraints and evidence review</h2>
          </div>
          <div className="bottom-panel__actions">
            {(['comparison', 'analytics', 'evidence'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab-button ${bottomTab === tab ? 'tab-button--active' : ''}`}
                onClick={() => {
                  setBottomPanelOpen(true)
                  setBottomTab(tab)
                }}
              >
                {tab}
              </button>
            ))}
            <button
              type="button"
              className="ghost-button"
              onClick={() => setBottomPanelOpen((previous) => !previous)}
            >
              {bottomPanelOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {bottomPanelOpen && bottomTab === 'comparison' && (
          comparedZones.length >= 2 ? (
            <div className="comparison-layout">
              <div className="comparison-table">
                <div className="comparison-row comparison-row--header">
                  <span>Area</span>
                  {comparedZones.map((zone) => (
                    <strong key={zone.id}>{zone.zoneCode}</strong>
                  ))}
                </div>
                {comparisonRows.map(({ label, values }) => (
                  <div className="comparison-row" key={label}>
                    <span>{label}</span>
                    {values.map((value, index) => (
                      <p key={`${label}-${comparedZones[index].id}`}>{value}</p>
                    ))}
                  </div>
                ))}
              </div>

              <div className="comparison-summary">
                <div className="content-card">
                  <div className="card-title">
                    <Sparkles size={16} />
                    <span>Housing type availability summary</span>
                  </div>
                  <p>
                    {comparedZones.filter((zone) => zone.multiFamilyAllowed).length} of{' '}
                    {comparedZones.length} compared areas allow multi-family housing, while{' '}
                    {comparedZones.filter((zone) => zone.additionalUnitAllowed).length} permit an
                    additional residential unit pathway.
                  </p>
                </div>
                <div className="content-card">
                  <div className="card-title">
                    <TriangleAlert size={16} />
                    <span>Affordability impact indicators</span>
                  </div>
                  <div className="indicator-list">
                    {comparedZones.map((zone) => (
                      <div className="indicator-row" key={zone.id}>
                        <strong>{zone.zoneCode}</strong>
                        <span>{zone.affordabilityImpact} impact</span>
                        <small>{zone.restrictionScore}/100 restriction score</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state empty-state--large">
              <GitCompareArrows size={20} />
              <span>Select two or more zones to open the comparison table.</span>
            </div>
          )
        )}

        {bottomPanelOpen && bottomTab === 'analytics' && (
          <div className="analytics-grid">
            <div className="content-card">
              <div className="card-title">
                <Sparkles size={16} />
                <span>Restriction scores</span>
              </div>
              {visibleZones
                .slice()
                .sort((left, right) => left.restrictionScore - right.restrictionScore)
                .map((zone) => (
                  <MetricBar
                    key={zone.id}
                    label={`${zone.zoneCode} · ${zone.neighborhood}`}
                    value={zone.restrictionScore}
                    max={100}
                    unit=""
                    color={zoneFill(zone)}
                  />
                ))}
            </div>
            <div className="content-card">
              <div className="card-title">
                <MapPin size={16} />
                <span>Charted development constraints</span>
              </div>
              {visibleZones.slice(0, 4).map((zone) => (
                <div className="chart-cluster" key={zone.id}>
                  <strong>{zone.zoneCode}</strong>
                  <MetricBar
                    label="Height"
                    value={zone.maxHeightM}
                    max={35}
                    unit="m"
                    color="#3569d4"
                  />
                  <MetricBar
                    label="Parking"
                    value={zone.parkingSpacesPerUnit}
                    max={2}
                    unit=""
                    color="#c58a54"
                  />
                  <MetricBar
                    label="Density"
                    value={zone.densityUnitsPerHectare}
                    max={360}
                    unit=""
                    color="#1d8c76"
                  />
                  <MetricBar
                    label="Front setback"
                    value={zone.setbacks.front}
                    max={8}
                    unit="m"
                    color="#8a6ce6"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {bottomPanelOpen && bottomTab === 'evidence' && (
          <div className="evidence-board">
            <div className="content-card">
              <div className="card-title">
                <FileText size={16} />
                <span>Recent document matches / zoning chunks</span>
              </div>
              <div className="evidence-list">
                {evidenceFeed.map((item) => (
                  <a
                    key={item.id}
                    className="evidence-item"
                    href={item.url ?? '#'}
                    target={item.url ? '_blank' : undefined}
                    rel={item.url ? 'noreferrer' : undefined}
                  >
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.excerpt}</p>
                      <small>{item.citation}</small>
                    </div>
                    {item.url ? <ArrowUpRight size={15} /> : null}
                  </a>
                ))}
              </div>
            </div>

            <div className="content-card">
              <div className="card-title">
                <Upload size={16} />
                <span>Indexed evidence session</span>
              </div>
              {uploadResult ? (
                <div className="session-card">
                  <strong>{uploadResult.original_filename}</strong>
                  <p>
                    {uploadResult.chunks_indexed} vector chunks indexed into{' '}
                    <code>{uploadResult.collection}</code>.
                  </p>
                  <small>Use the area question box to query this document with live RAG.</small>
                </div>
              ) : (
                <div className="empty-state">
                  <Upload size={18} />
                  <span>No uploaded evidence yet. Add a PDF in the right panel to test the live pipeline.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
