import type { QueryClient, QueryKey } from '@tanstack/react-query'

import {
  CommandOutbox,
  IndexedDbOutboxStorage,
  type OutboxEntry,
  type OutboxStorage,
} from '@react-resilience/command-outbox'
import type {
  ApiProblem,
  FaultProfile,
  Incident,
  IncidentCommand,
  IncidentCommandResult,
  IncidentListResponse,
} from '@react-resilience/contracts'

import {
  IncidentApiError,
  sendIncidentCommand,
  type StatusFilter,
} from './incident-api.js'
import { incidentQueryKeys } from './incident-queries.js'

export interface IncidentCommandEnvelope {
  readonly command: IncidentCommand
  readonly faultProfile: FaultProfile
  readonly optimisticIncident: Incident
}

export type IncidentOutbox = CommandOutbox<
  IncidentCommandEnvelope,
  IncidentCommandResult,
  ApiProblem
>

export type IncidentOutboxEntry = OutboxEntry<
  IncidentCommandEnvelope,
  ApiProblem
>

export interface CreateIncidentOutboxOptions {
  readonly isOnline?: () => boolean
  readonly now?: () => Date
  readonly queryClient: QueryClient
  readonly send?: typeof sendIncidentCommand
  readonly storage?: OutboxStorage<IncidentCommandEnvelope, ApiProblem>
}

export function createIncidentOutbox({
  isOnline,
  now,
  queryClient,
  send = sendIncidentCommand,
  storage = new IndexedDbOutboxStorage<IncidentCommandEnvelope, ApiProblem>(),
}: CreateIncidentOutboxOptions): IncidentOutbox {
  const outbox = new CommandOutbox<
    IncidentCommandEnvelope,
    IncidentCommandResult,
    ApiProblem
  >({
    ...(isOnline ? { isOnline } : {}),
    ...(now ? { now } : {}),
    storage,
    transport: {
      async deliver(entry) {
        try {
          const result = await send(entry.payload)
          return { kind: 'delivered', result }
        } catch (error) {
          if (!(error instanceof IncidentApiError)) {
            throw error
          }

          const problem = error.problem
          if (problem.code === 'version-conflict') {
            return {
              context: problem,
              kind: 'blocked',
              message: problem.detail,
              reason: 'conflict',
            }
          }

          if (problem.status >= 500) {
            return {
              kind: 'retry',
              message: problem.detail,
              ...(problem.retryAfterMs === undefined
                ? {}
                : { retryAfterMs: problem.retryAfterMs }),
            }
          }

          return {
            context: problem,
            kind: 'blocked',
            message: problem.detail,
            reason: 'rejected',
          }
        }
      },
    },
  })

  outbox.subscribeEvents((event) => {
    if (event.type === 'delivered') {
      reconcileIncidentQueries(queryClient, event.result.incident)
      return
    }

    if (event.type === 'blocked') {
      const currentIncident = event.entry.failure?.context?.currentIncident
      if (currentIncident) {
        reconcileIncidentQueries(queryClient, currentIncident)
      }
    }
  })

  return outbox
}

export function projectIncidentSnapshot(
  authoritative: Incident[],
  entries: ReadonlyArray<OutboxEntry<IncidentCommandEnvelope, ApiProblem>>,
  status: StatusFilter,
): Incident[] {
  const incidents = new Map(
    authoritative.map((incident) => [incident.id, incident]),
  )

  for (const entry of entries) {
    if (entry.status !== 'blocked') {
      incidents.set(
        entry.payload.optimisticIncident.id,
        entry.payload.optimisticIncident,
      )
    }
  }

  return [...incidents.values()]
    .filter((incident) => status === 'all' || incident.status === status)
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
}

export function createOptimisticIncident(
  incident: Incident,
  command: IncidentCommand,
  updatedAt: Date,
): Incident {
  const base: Incident = {
    ...incident,
    updatedAt: updatedAt.toISOString(),
    version: command.expectedVersion + 1,
  }

  switch (command.type) {
    case 'acknowledge':
      return { ...base, status: 'acknowledged' }
    case 'assign':
      return { ...base, assignee: command.assignee }
    case 'resolve':
      return {
        ...base,
        resolutionNote: command.resolutionNote,
        status: 'resolved',
      }
  }
}

export function fingerprintIncidentCommand(command: IncidentCommand): string {
  switch (command.type) {
    case 'acknowledge':
      return JSON.stringify({
        commandId: command.commandId,
        expectedVersion: command.expectedVersion,
        incidentId: command.incidentId,
        type: command.type,
      })
    case 'assign':
      return JSON.stringify({
        assignee: command.assignee,
        commandId: command.commandId,
        expectedVersion: command.expectedVersion,
        incidentId: command.incidentId,
        type: command.type,
      })
    case 'resolve':
      return JSON.stringify({
        commandId: command.commandId,
        expectedVersion: command.expectedVersion,
        incidentId: command.incidentId,
        resolutionNote: command.resolutionNote,
        type: command.type,
      })
  }
}

function reconcileIncidentQueries(
  queryClient: QueryClient,
  incident: Incident,
): void {
  const queries = queryClient.getQueriesData<IncidentListResponse>({
    queryKey: incidentQueryKeys.all,
  })

  for (const [queryKey, data] of queries) {
    if (!data) {
      continue
    }

    const status = getStatusFromQueryKey(queryKey)
    if (!status) {
      continue
    }

    const items = data.items.filter((item) => item.id !== incident.id)
    if (status === 'all' || status === incident.status) {
      items.push(incident)
      items.sort((left, right) =>
        right.detectedAt.localeCompare(left.detectedAt),
      )
    }

    queryClient.setQueryData(queryKey, { ...data, items })
  }
}

function getStatusFromQueryKey(queryKey: QueryKey): StatusFilter | undefined {
  const selector = queryKey[2]
  if (!selector || typeof selector !== 'object' || !('status' in selector)) {
    return undefined
  }

  const status: unknown = selector.status
  return status === 'all' ||
    status === 'open' ||
    status === 'acknowledged' ||
    status === 'resolved'
    ? status
    : undefined
}
