import { useEffect, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useCommandOutboxSnapshot } from '@react-resilience/command-outbox/react'
import type {
  FaultProfile,
  Incident,
  IncidentCommand,
  IncidentStatus,
} from '@react-resilience/contracts'

import { IncidentApiError, type StatusFilter } from './incident-api.js'
import { useIncidentOutbox } from './incident-outbox-context.js'
import {
  createOptimisticIncident,
  fingerprintIncidentCommand,
  projectIncidentSnapshot,
  rebaseIncidentCommand,
  type IncidentOutboxEntry,
} from './incident-outbox.js'
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
  const [queueError, setQueueError] = useState<{
    error: Error
    incidentId: string
  } | null>(null)
  const [queueingIncidentId, setQueueingIncidentId] = useState<string | null>(
    null,
  )
  const { outbox, storageError } = useIncidentOutbox()
  const outboxEntries = useCommandOutboxSnapshot(outbox)
  const query = useQuery(incidentListQueryOptions(filter, faultProfile))
  const incidents = projectIncidentSnapshot(
    query.data?.items ?? [],
    outboxEntries,
    filter,
  )
  const selectedIncident =
    incidents.find((incident) => incident.id === selectedId) ?? incidents[0]
  const selectedEntry = selectedIncident
    ? outboxEntries.find((entry) => entry.partitionKey === selectedIncident.id)
    : undefined
  const selectedQueueError =
    queueError && queueError.incidentId === selectedIncident?.id
      ? queueError.error
      : null
  const activeProfile =
    faultProfiles.find((profile) => profile.value === faultProfile) ??
    faultProfiles[0]

  const queueCommand = async (
    incident: Incident,
    type: 'acknowledge' | 'assign',
  ) => {
    setQueueError(null)
    setQueueingIncidentId(incident.id)

    const commandId = globalThis.crypto.randomUUID()
    const command: IncidentCommand =
      type === 'acknowledge'
        ? {
            commandId,
            expectedVersion: incident.version,
            incidentId: incident.id,
            type,
          }
        : {
            assignee: 'On-call operator',
            commandId,
            expectedVersion: incident.version,
            incidentId: incident.id,
            type,
          }

    try {
      await outbox.enqueue({
        fingerprint: fingerprintIncidentCommand(command),
        id: command.commandId,
        partitionKey: command.incidentId,
        payload: {
          command,
          faultProfile,
          optimisticIncident: createOptimisticIncident(
            incident,
            command,
            new Date(),
          ),
        },
      })
      await outbox.flush()
    } catch (error) {
      setQueueError({
        error:
          error instanceof Error
            ? error
            : new Error('Command could not be queued'),
        incidentId: incident.id,
      })
    } finally {
      setQueueingIncidentId(null)
    }
  }

  const recoverCommand = async (
    entry: IncidentOutboxEntry,
    decision: 'discard' | 'retry',
  ) => {
    setQueueError(null)
    setQueueingIncidentId(entry.partitionKey)

    try {
      if (decision === 'discard') {
        await outbox.discard(entry.id)
        return
      }

      const currentIncident = entry.failure?.context?.currentIncident
      if (!currentIncident) {
        throw new Error('The server version is unavailable for recovery')
      }

      const command = rebaseIncidentCommand(
        entry.payload.command,
        currentIncident.version,
        globalThis.crypto.randomUUID(),
      )
      await outbox.enqueue({
        fingerprint: fingerprintIncidentCommand(command),
        id: command.commandId,
        partitionKey: command.incidentId,
        payload: {
          command,
          faultProfile,
          optimisticIncident: createOptimisticIncident(
            currentIncident,
            command,
            new Date(),
          ),
        },
      })
      await outbox.discard(entry.id)
      await outbox.flush()
    } catch (error) {
      setQueueError({
        error:
          error instanceof Error
            ? error
            : new Error('Conflict recovery failed'),
        incidentId: entry.partitionKey,
      })
    } finally {
      setQueueingIncidentId(null)
    }
  }

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
          <IncidentSummary
            incidents={incidents}
            queuedCount={outboxEntries.length}
          />
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
            onCommand={(incident, type) => void queueCommand(incident, type)}
            onRecover={(entry, decision) =>
              void recoverCommand(entry, decision)
            }
            onSelect={setSelectedId}
            queueError={selectedQueueError}
            queueingIncidentId={queueingIncidentId}
            selectedEntry={selectedEntry}
            selectedIncident={selectedIncident}
            storageError={storageError}
            useConflictProfile={faultProfile === 'conflict'}
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

        <div
          aria-label="Command outbox status"
          aria-live="polite"
          className="outbox-card"
        >
          <span>
            <strong>Command outbox</strong>
            <small>IndexedDB backed</small>
          </span>
          <strong>{outboxEntries.length}</strong>
          <p>
            {outboxEntries.some((entry) => entry.status === 'blocked')
              ? 'A conflict is isolated to its incident.'
              : 'Queued changes survive a reload and replay in order.'}
          </p>
        </div>

        <div className="contract-note">
          <strong>Current contract</strong>
          <p>
            Cancellable reads and idempotent versioned commands with persistent
            replay.
          </p>
        </div>
      </aside>
    </div>
  )
}

function IncidentSummary({
  incidents,
  queuedCount,
}: {
  incidents: Incident[]
  queuedCount: number
}) {
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
        <dd>{queuedCount}</dd>
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
      <button autoFocus onClick={onRetry} type="button">
        Retry request
      </button>
    </div>
  )
}

interface IncidentWorkspaceProps {
  incidents: Incident[]
  isStale: boolean
  onCommand: (incident: Incident, type: 'acknowledge' | 'assign') => void
  onRecover: (entry: IncidentOutboxEntry, decision: 'discard' | 'retry') => void
  onSelect: (incidentId: string) => void
  queueError: Error | null
  queueingIncidentId: string | null
  selectedEntry: IncidentOutboxEntry | undefined
  selectedIncident: Incident | undefined
  storageError: Error | null
  useConflictProfile: boolean
}

function IncidentWorkspace({
  incidents,
  isStale,
  onCommand,
  onRecover,
  onSelect,
  queueError,
  queueingIncidentId,
  selectedEntry,
  selectedIncident,
  storageError,
  useConflictProfile,
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
        <IncidentDetails
          entry={selectedEntry}
          incident={selectedIncident}
          isQueueing={queueingIncidentId === selectedIncident.id}
          onCommand={onCommand}
          onRecover={onRecover}
          queueError={queueError}
          storageError={storageError}
          useConflictProfile={useConflictProfile}
        />
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

interface IncidentDetailsProps {
  entry: IncidentOutboxEntry | undefined
  incident: Incident
  isQueueing: boolean
  onCommand: (incident: Incident, type: 'acknowledge' | 'assign') => void
  onRecover: (entry: IncidentOutboxEntry, decision: 'discard' | 'retry') => void
  queueError: Error | null
  storageError: Error | null
  useConflictProfile: boolean
}

function IncidentDetails({
  entry,
  incident,
  isQueueing,
  onCommand,
  onRecover,
  queueError,
  storageError,
  useConflictProfile,
}: IncidentDetailsProps) {
  const recoveryRef = useRef<HTMLDivElement>(null)
  const commandPending = entry !== undefined || isQueueing
  const actionNote = getActionNote({
    entry,
    isQueueing,
    queueError,
    storageError,
  })

  useEffect(() => {
    if (entry?.status === 'blocked') {
      recoveryRef.current?.focus()
    }
  }, [entry?.id, entry?.status])

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
        <button
          disabled={
            commandPending ||
            incident.status !== 'open' ||
            storageError !== null
          }
          onClick={() => onCommand(incident, 'acknowledge')}
          type="button"
        >
          Acknowledge
        </button>
        <button
          disabled={
            commandPending ||
            incident.status === 'resolved' ||
            storageError !== null
          }
          onClick={() => onCommand(incident, 'assign')}
          type="button"
        >
          Assign to me
        </button>
      </div>
      <p className="action-note" role="status">
        {actionNote}
      </p>
      {entry?.status === 'blocked' ? (
        <CommandRecovery
          entry={entry}
          onRecover={onRecover}
          recoveryRef={recoveryRef}
          useConflictProfile={useConflictProfile}
        />
      ) : null}
    </aside>
  )
}

interface CommandRecoveryProps {
  entry: IncidentOutboxEntry
  onRecover: (entry: IncidentOutboxEntry, decision: 'discard' | 'retry') => void
  recoveryRef: RefObject<HTMLDivElement | null>
  useConflictProfile: boolean
}

function CommandRecovery({
  entry,
  onRecover,
  recoveryRef,
  useConflictProfile,
}: CommandRecoveryProps) {
  const isConflict = entry.failure?.kind === 'conflict'
  const currentVersion = entry.failure?.context?.currentIncident?.version

  return (
    <div
      aria-labelledby="command-recovery-title"
      className="command-recovery"
      ref={recoveryRef}
      role="alert"
      tabIndex={-1}
    >
      <h3 id="command-recovery-title">
        {isConflict ? 'Command needs a decision' : 'Command was rejected'}
      </h3>
      <p>
        {isConflict
          ? `The server is at version ${currentVersion ?? 'unknown'}. Keep that state or retry explicitly.`
          : 'Keep the server state and remove this command from the outbox.'}
      </p>
      {isConflict && useConflictProfile ? (
        <p className="recovery-hint">
          Choose a non-conflict network profile before retrying.
        </p>
      ) : null}
      <div>
        {isConflict ? (
          <button
            disabled={useConflictProfile}
            onClick={() => onRecover(entry, 'retry')}
            type="button"
          >
            Retry on version {currentVersion ?? 'current'}
          </button>
        ) : null}
        <button onClick={() => onRecover(entry, 'discard')} type="button">
          Keep server version
        </button>
      </div>
    </div>
  )
}

function getActionNote({
  entry,
  isQueueing,
  queueError,
  storageError,
}: {
  entry: IncidentOutboxEntry | undefined
  isQueueing: boolean
  queueError: Error | null
  storageError: Error | null
}): string {
  if (storageError) {
    return 'Persistent command storage is unavailable.'
  }
  if (queueError) {
    return queueError.message
  }
  if (isQueueing) {
    return 'Saving the command before delivery.'
  }
  if (entry?.status === 'blocked') {
    return entry.failure?.kind === 'conflict'
      ? 'A newer incident version blocked this command.'
      : 'The server rejected this queued command.'
  }
  if (entry?.status === 'sending') {
    return 'Delivering the persisted command.'
  }
  if (entry?.failure?.kind === 'transient') {
    return 'Delivery failed temporarily. The command remains queued.'
  }
  if (entry) {
    return 'The optimistic change is saved and waiting for delivery.'
  }
  return 'Commands are persisted before delivery and guarded by incident version.'
}
