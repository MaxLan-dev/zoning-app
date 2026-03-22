import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'

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

type ZonePick = {
  id: number
  municipality: string
  zoneCode: string
  sourceObjectId: string
  sourceDocuments: string[]
}

function zoneStyle(feature?: GeoJSON.Feature): L.PathOptions {
  const m = (feature?.properties as { municipality?: string } | undefined)?.municipality
  const kitchener = m === 'kitchener'
  return {
    color: kitchener ? '#b8442a' : '#1a5fb4',
    weight: 1,
    fillOpacity: 0.14,
  }
}

function App() {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const geoLayerRef = useRef<L.GeoJSON | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [ragQuery, setRagQuery] = useState('')
  const [ragOut, setRagOut] = useState<string | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [mapStatus, setMapStatus] = useState<string | null>(null)
  const [zonePick, setZonePick] = useState<ZonePick | null>(null)
  const [ingestStatus, setIngestStatus] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => setError(null))
      .catch(() => {
        setError(
          'API unreachable. Start the Flask backend (port 5000) and use the Vite dev server so /api proxies correctly.',
        )
      })
  }, [])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      maxBounds: WK_MAX_BOUNDS,
      maxBoundsViscosity: 0.85,
      minZoom: 10,
      maxZoom: 18,
    }).setView(WK_CENTER, WK_INITIAL_ZOOM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    mapRef.current = map
    setMapReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!mapReady) return
    void loadWaterlooKitchenerZones()
  }, [mapReady])

  async function loadWaterlooKitchenerZones() {
    setMapStatus('Loading Waterloo + Kitchener zones…')
    setZonePick(null)
    const res = await fetch(GEOJSON_URL)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMapStatus(
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`,
      )
      return
    }
    const map = mapRef.current
    if (!map) {
      setMapStatus('Map not ready.')
      return
    }
    if (geoLayerRef.current) {
      map.removeLayer(geoLayerRef.current)
      geoLayerRef.current = null
    }
    const fc = data as GeoJSON.FeatureCollection
    const layer = L.geoJSON(fc, {
      style: zoneStyle,
      onEachFeature: (_feature, ly) => {
        ly.on('click', (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng
          void (async () => {
            const r = await fetch(AT_POINT_URL(lat, lng))
            const j = await r.json()
            const first = j.matches?.[0]
            if (first) {
              setZonePick({
                id: first.id as number,
                municipality: first.municipality as string,
                zoneCode: first.zoneCode as string,
                sourceObjectId: first.sourceObjectId as string,
                sourceDocuments: (first.sourceDocuments as string[]) || [],
              })
            } else {
              setZonePick(null)
            }
          })()
        })
      },
    })
    layer.addTo(map)
    geoLayerRef.current = layer
    if (fc.features?.length) {
      try {
        map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 14 })
      } catch {
        map.setView(WK_CENTER, WK_INITIAL_ZOOM)
      }
      setMapStatus(
        `${fc.features.length} zones (Waterloo + Kitchener). Click a polygon.`,
      )
    } else {
      map.setView(WK_CENTER, WK_INITIAL_ZOOM)
      setMapStatus(
        'No zone polygons in the database. Run ingest for waterloo and kitchener (POST /api/v1/jobs/ingest-zoning).',
      )
    }
  }

  async function onUploadFile(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    setUploadStatus('Uploading…')
    setUploadResult(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadStatus(null)
        setError(
          typeof data.message === 'string'
            ? data.message
            : `Upload failed (${res.status})`,
        )
        return
      }
      setError(null)
      setUploadStatus(null)
      setUploadResult(data as UploadResult)
    } catch {
      setUploadStatus(null)
      setError('Upload failed (network error).')
    }
  }

  async function onRag() {
    if (!ragQuery.trim()) return
    setRagOut('…')
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
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setRagOut(JSON.stringify(data, null, 2))
    } catch {
      setRagOut('request failed')
    }
  }

  async function ingestZonePdfs() {
    if (!zonePick) return
    setIngestStatus('Ingesting…')
    try {
      const res = await fetch(
        `/api/v1/zones/${zonePick.id}/ingest-documents`,
        { method: 'POST' },
      )
      const data = await res.json().catch(() => ({}))
      setIngestStatus(JSON.stringify(data, null, 2))
    } catch {
      setIngestStatus('request failed')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Zoning · Waterloo &amp; Kitchener</h1>
        <p className="tagline">
          Map locked to the two cities · click a zone · ingest PDFs · RAG (Groq)
        </p>
      </header>

      {error && (
        <section className="panel">
          <p className="err">{error}</p>
        </section>
      )}

      <section className="panel">
        <h2>Map</h2>
        <p className="hint">
          Data: <code>region=waterloo-kitchener</code> (City of Waterloo + City of
          Kitchener records). Blue polygons ≈ Waterloo, red-orange ≈ Kitchener.
          Official viewer reference:{' '}
          <a
            href="https://maps.waterloo.ca/html5viewer/?viewer=waterlooviewer&amp;layerTheme=Zoning"
            target="_blank"
            rel="noreferrer"
          >
            City of Waterloo zoning map
          </a>
          .
        </p>
        <div className="row">
          <button type="button" onClick={() => void loadWaterlooKitchenerZones()}>
            Reload zones
          </button>
        </div>
        {mapStatus && <p className="muted">{mapStatus}</p>}
        <div ref={mapEl} className="map-frame" />
        {zonePick && (
          <div className="zone-panel">
            <p>
              <strong>{zonePick.zoneCode}</strong>{' '}
              <span className="muted">
                ({zonePick.municipality}) · id {zonePick.id}
              </span>
            </p>
            <p className="muted">
              sourceObjectId: <code>{zonePick.sourceObjectId}</code>
            </p>
            {zonePick.sourceDocuments.length > 0 ? (
              <ul className="upload-result">
                {zonePick.sourceDocuments.map((u) => (
                  <li key={u}>
                    <code>{u}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No sourceDocuments URLs on this record.</p>
            )}
            <button type="button" onClick={() => void ingestZonePdfs()}>
              Ingest PDF URLs into Qdrant
            </button>
            {ingestStatus && <pre className="rag-out">{ingestStatus}</pre>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Vectorize PDF (upload)</h2>
        <p className="hint">Optional manual upload; map flow prefers URL ingest.</p>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => void onUploadFile(e.target.files)}
        />
        {uploadStatus && <p className="muted">{uploadStatus}</p>}
        {uploadResult && (
          <ul className="upload-result">
            <li>
              <strong>{uploadResult.original_filename}</strong> →{' '}
              {uploadResult.chunks_indexed} chunks, {uploadResult.total_pages}{' '}
              pages
            </li>
            <li>
              Document ID: <code>{uploadResult.document_id}</code>
            </li>
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>RAG (Groq)</h2>
        <p className="hint">
          Uses the selected zone&apos;s municipality / zone code when a polygon is
          selected.
        </p>
        <input
          type="text"
          value={ragQuery}
          placeholder="Question"
          onChange={(e) => setRagQuery(e.target.value)}
          style={{ width: '100%', maxWidth: '28rem' }}
        />{' '}
        <button type="button" onClick={() => void onRag()}>
          Ask
        </button>
        {ragOut && <pre className="rag-out">{ragOut}</pre>}
      </section>
    </div>
  )
}

export default App
