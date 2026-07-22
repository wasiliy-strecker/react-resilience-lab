import { useMemo, useState } from 'react'

import type { Incident, IncidentStatus } from '@react-resilience/contracts'

import { sampleIncidents } from './sample-incidents.js'

type StatusFilter = 'all' | IncidentStatus

const filters: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All incidents', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Acknowledged', value: 'acknowledged' },
  { label: 'Resolved', value: 'resolved' },
]

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
})

interface IncidentConsoleProps {
  incidents?: Incident[]
}

export function IncidentConsole({
  incidents = sampleIncidents,
}: IncidentConsoleProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState(incidents[0]?.id ?? '')
  const visibleIncidents = useMemo(
    () =>
      filter === 'all'
        ? incidents
        : incidents.filter((incident) => incident.status === filter),
    [filter, incidents],
  )
  const selectedIncident =
    visibleIncidents.find((incident) => incident.id === selectedId) ??
    visibleIncidents[0]

  return (
    <div className="console-layout">
      <section className="incident-workspace" aria-labelledby="incidents-title">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Operations workspace</p>
            <h1 id="incidents-title">Active incident response</h1>
            <p className="intro">
              Inspect how the interface behaves when requests race, fail, or
              continue after connectivity returns.
            </p>
          </div>
          <dl className="summary-metrics" aria-label="Incident summary">
            <div>
              <dt>Open</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>Acknowledged</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>Queued changes</dt>
              <dd>0</dd>
            </div>
          </dl>
        </div>

        <div className="filter-bar" aria-label="Filter incidents by status">
          {filters.map((item) => (
            <button
              className="filter-button"
              data-active={filter === item.value}
              key={item.value}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="incident-grid">
          <div className="incident-list" aria-label="Incidents">
            {visibleIncidents.length > 0 ? (
              visibleIncidents.map((incident) => (
                <IncidentListItem
                  incident={incident}
                  isSelected={incident.id === selectedIncident?.id}
                  key={incident.id}
                  onSelect={setSelectedId}
                />
              ))
            ) : (
              <div className="empty-state">No incidents match this status.</div>
            )}
          </div>

          {selectedIncident ? (
            <IncidentDetails incident={selectedIncident} />
          ) : (
            <aside className="incident-details empty-state">
              Select a status with visible incidents.
            </aside>
          )}
        </div>
      </section>

      <aside className="lab-panel" aria-labelledby="lab-panel-title">
        <p className="eyebrow">Failure controls</p>
        <h2 id="lab-panel-title">Network profile</h2>
        <p>
          Fault injection arrives in the next milestone. The baseline keeps
          behavior intentionally stable.
        </p>
        <div className="profile-card" aria-label="Current network profile">
          <span className="profile-icon" aria-hidden="true">
            24
          </span>
          <span>
            <strong>Normal</strong>
            <small>24 ms deterministic latency</small>
          </span>
        </div>
        <div className="contract-note">
          <strong>Current contract</strong>
          <p>Read-only data with shared runtime validation.</p>
        </div>
      </aside>
    </div>
  )
}

interface IncidentListItemProps {
  incident: Incident
  isSelected: boolean
  onSelect: (incidentId: string) => void
}

function IncidentListItem({
  incident,
  isSelected,
  onSelect,
}: IncidentListItemProps) {
  return (
    <button
      className="incident-list-item"
      data-selected={isSelected}
      onClick={() => onSelect(incident.id)}
      type="button"
    >
      <span className="incident-row-meta">
        <span className="severity" data-severity={incident.severity}>
          {incident.severity}
        </span>
        <span>{incident.id}</span>
      </span>
      <strong>{incident.title}</strong>
      <span>{incident.service}</span>
      <span className="incident-row-footer">
        <span>{incident.status}</span>
        <time dateTime={incident.updatedAt}>
          {timeFormatter.format(new Date(incident.updatedAt))}
        </time>
      </span>
    </button>
  )
}

function IncidentDetails({ incident }: { incident: Incident }) {
  return (
    <aside
      className="incident-details"
      aria-label={`${incident.title} details`}
    >
      <div className="details-heading">
        <span className="severity" data-severity={incident.severity}>
          {incident.severity}
        </span>
        <span>Version {incident.version}</span>
      </div>
      <h2>{incident.title}</h2>
      <p>{incident.summary}</p>
      <dl className="details-list">
        <div>
          <dt>Service</dt>
          <dd>{incident.service}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{incident.status}</dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>{incident.assignee ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>{timeFormatter.format(new Date(incident.detectedAt))}</dd>
        </div>
      </dl>
      <div className="details-actions" aria-label="Incident actions">
        <button type="button" disabled>
          Acknowledge
        </button>
        <button type="button" disabled>
          Assign
        </button>
      </div>
      <p className="action-note">
        Mutations unlock after idempotency and conflict handling are available.
      </p>
    </aside>
  )
}
