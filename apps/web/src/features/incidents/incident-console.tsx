import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type {
  FaultProfile,
  Incident,
  IncidentStatus,
} from '@react-resilience/contracts'

import { IncidentApiError, type StatusFilter } from './incident-api.js'
import { incidentListQueryOptions } from './incident-queries.js'

const filters: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All incidents', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Acknowledged', value: 'acknowledged' },
  { label: 'Resolved', value: 'resolved' },
]

const faultProfiles: Array<{
  badge: string
  description: string
  label: string
  value: FaultProfile
}> = [
  {
    badge: '24',
    description: '24 ms stable latency',
    label: 'Normal',
    value: 'normal',
  },
  {
    badge: '850',
    description: '850 ms stable latency',
    label: 'Slow',
    value: 'slow',
  },
  {
    badge: '3×',
    description: 'Every third request fails',
    label: 'Flaky',
    value: 'flaky',
  },
  {
    badge: '412',
    description: 'Commands meet a newer version',
    label: 'Conflict',
    value: 'conflict',
  },
]

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
})

export function IncidentConsole() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [faultProfile, setFaultProfile] = useState<FaultProfile>('normal')
  const [selectedId, setSelectedId] = useState('')
  const query = useQuery(incidentListQueryOptions(filter, faultProfile))
  const incidents = query.data?.items ?? []
  const selectedIncident =
    incidents.find((incident) => incident.id === selectedId) ?? incidents[0]
  const activeProfile =
    faultProfiles.find((profile) => profile.value === faultProfile) ??
    faultProfiles[0]

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
          <IncidentSummary incidents={incidents} />
        </div>

        <div className="filter-bar" aria-label="Filter incidents by status">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.value}
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

        <QueryStatus
          error={query.error}
          hasData={query.data !== undefined}
          isFetching={query.isFetching}
          isPending={query.isPending}
          isPlaceholderData={query.isPlaceholderData}
          onRefresh={() => void query.refetch()}
        />

        {query.isPending ? (
          <InitialQueryState />
        ) : query.isError && query.data === undefined ? (
          <QueryFailure
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <IncidentWorkspace
            incidents={incidents}
            isStale={query.isPlaceholderData}
            onSelect={setSelectedId}
            selectedIncident={selectedIncident}
          />
        )}
      </section>

      <aside className="lab-panel" aria-labelledby="lab-panel-title">
        <p className="eyebrow">Failure controls</p>
        <h2 id="lab-panel-title">Network profile</h2>
        <p>
          Change the API behavior while requests are active. Superseded reads
          are cancelled before their responses can replace newer state.
        </p>

        <fieldset className="profile-options">
          <legend>Fault profile</legend>
          {faultProfiles.map((profile) => (
            <label
              className="profile-option"
              data-active={profile.value === faultProfile}
              key={profile.value}
            >
              <input
                checked={profile.value === faultProfile}
                name="fault-profile"
                onChange={() => setFaultProfile(profile.value)}
                type="radio"
                value={profile.value}
              />
              <span>
                <strong>{profile.label}</strong>
                <small>{profile.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {activeProfile ? (
          <div className="profile-card" aria-label="Current network profile">
            <span className="profile-icon" aria-hidden="true">
              {activeProfile.badge}
            </span>
            <span>
              <strong>{activeProfile.label}</strong>
              <small>{activeProfile.description}</small>
            </span>
          </div>
        ) : null}

        <div className="contract-note">
          <strong>Current contract</strong>
          <p>
            Remote reads with shared runtime validation and explicit
            cancellation.
          </p>
        </div>
      </aside>
    </div>
  )
}

function IncidentSummary({ incidents }: { incidents: Incident[] }) {
  const count = (status: IncidentStatus) =>
    incidents.filter((incident) => incident.status === status).length

  return (
    <dl className="summary-metrics" aria-label="Visible incident summary">
      <div>
        <dt>Open</dt>
        <dd>{count('open')}</dd>
      </div>
      <div>
        <dt>Acknowledged</dt>
        <dd>{count('acknowledged')}</dd>
      </div>
      <div>
        <dt>Queued changes</dt>
        <dd>0</dd>
      </div>
    </dl>
  )
}

interface QueryStatusProps {
  error: Error | null
  hasData: boolean
  isFetching: boolean
  isPending: boolean
  isPlaceholderData: boolean
  onRefresh: () => void
}

function QueryStatus({
  error,
  hasData,
  isFetching,
  isPending,
  isPlaceholderData,
  onRefresh,
}: QueryStatusProps) {
  let message = 'Snapshot is current.'
  let tone = 'ready'

  if (isPending) {
    message = 'Loading incident stream.'
    tone = 'loading'
  } else if (error && hasData) {
    message = 'Refresh failed. Showing the last successful snapshot.'
    tone = 'error'
  } else if (isPlaceholderData) {
    message = 'Switching view. Keeping the last snapshot visible.'
    tone = 'loading'
  } else if (isFetching) {
    message = 'Refreshing incident stream.'
    tone = 'loading'
  }

  return (
    <div className="query-toolbar">
      <p className="query-status" data-tone={tone} role="status">
        <span aria-hidden="true" />
        {message}
      </p>
      <button disabled={isFetching} onClick={onRefresh} type="button">
        {isFetching ? 'Refreshing' : 'Refresh snapshot'}
      </button>
    </div>
  )
}

function InitialQueryState() {
  return (
    <div className="query-state" role="status">
      <span className="state-indicator" aria-hidden="true" />
      <div>
        <strong>Loading incident stream</strong>
        <p>The first validated snapshot is on its way.</p>
      </div>
    </div>
  )
}

function QueryFailure({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  const detail =
    error instanceof IncidentApiError
      ? error.problem.detail
      : 'The response could not be validated or the API is unreachable.'

  return (
    <div className="query-state" data-tone="error" role="alert">
      <div>
        <strong>Incident stream unavailable</strong>
        <p>{detail}</p>
      </div>
      <button onClick={onRetry} type="button">
        Retry request
      </button>
    </div>
  )
}

interface IncidentWorkspaceProps {
  incidents: Incident[]
  isStale: boolean
  onSelect: (incidentId: string) => void
  selectedIncident: Incident | undefined
}

function IncidentWorkspace({
  incidents,
  isStale,
  onSelect,
  selectedIncident,
}: IncidentWorkspaceProps) {
  return (
    <div className="incident-grid" data-stale={isStale}>
      <div className="incident-list" aria-label="Incidents">
        {incidents.length > 0 ? (
          incidents.map((incident) => (
            <IncidentListItem
              incident={incident}
              isSelected={incident.id === selectedIncident?.id}
              key={incident.id}
              onSelect={onSelect}
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
