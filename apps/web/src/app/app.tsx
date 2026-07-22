import { IncidentConsole } from '../features/incidents/incident-console.js'

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="React Resilience Lab home">
          <span className="brand-mark" aria-hidden="true">
            RR
          </span>
          <span>
            <strong>React Resilience Lab</strong>
            <small>Incident operations console</small>
          </span>
        </a>
        <div className="environment-chip">
          <span className="environment-dot" aria-hidden="true" />
          Live failure lab
        </div>
      </header>
      <main>
        <IncidentConsole />
      </main>
    </div>
  )
}
