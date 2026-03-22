import { useEffect, useState } from 'react'
import './App.css'

type Health = { status: string; service: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    </div>
  )
}

export default App
