import { useEffect, useState } from 'react'
import './App.css'

type Health = { status: string; service: string }

type UploadResult = {
  document_id: string
  chunks_indexed: number
  total_pages: number
  original_filename: string
  uploaded_at: string
  collection: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [ragQuery, setRagQuery] = useState('')
  const [ragOut, setRagOut] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Health) => {
        setHealth(data)
        setError(null)
      })
      .catch(() => {
        setHealth(null)
        setError(
          'API unreachable. Start the Flask backend (port 5000) and use the Vite dev server so /api proxies correctly.',
        )
      })
  }, [])

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
      const res = await fetch('/api/v1/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: ragQuery.trim(),
          limit: 8,
          ...(uploadResult?.document_id
            ? { document_id: uploadResult.document_id }
            : {}),
        }),
      })
      const data = await res.json()
      setRagOut(JSON.stringify(data, null, 2))
    } catch {
      setRagOut('request failed')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>National Zoning &amp; Land Use Data Platform</h1>
        <p className="tagline">
          Flask + React (TypeScript) · Qdrant · Beautiful Soup · LangChain / LangSmith
          (optional)
        </p>
      </header>

      <section className="panel">
        <h2>API status</h2>
        {health && (
          <p className="ok">
            <code>{health.service}</code>: {health.status}
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </section>

      <section className="panel">
        <h2>Vectorize PDF</h2>
        <p className="hint">
          Uploads to the API, chunks text per page, embeds locally with
          sentence-transformers (no OpenAI key), and upserts into Qdrant with
          metadata including <code>human_label</code> (e.g. filename, timestamp,
          page x of y). Set <code>LANGSMITH_API_KEY</code> for LangChain/LangSmith
          tooling env sync when you add those libraries.
        </p>
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
            <li>
              Collection: <code>{uploadResult.collection}</code>
            </li>
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>RAG (Groq)</h2>
        <p className="hint">
          Retrieves chunks from Qdrant then answers with Groq. Uses last
          upload&apos;s <code>document_id</code> when set. Requires{' '}
          <code>GROQ_API_KEY</code> and chunk <code>text</code> in Qdrant.
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
