import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  MemoryOutboxStorage,
  type OutboxEntry,
} from '@react-resilience/command-outbox'
import type {
  ApiProblem,
  Incident,
  IncidentCommand,
  IncidentCommandResult,
} from '@react-resilience/contracts'

import { generatedAt, incidentFixtures } from '../../test/fixtures.js'
import {
  IncidentApiError,
  type SendIncidentCommandInput,
} from './incident-api.js'
import {
  createIncidentOutbox,
  createOptimisticIncident,
  fingerprintIncidentCommand,
  projectIncidentSnapshot,
  type IncidentCommandEnvelope,
} from './incident-outbox.js'
import { incidentQueryKeys } from './incident-queries.js'

const acknowledgeCommand: IncidentCommand = {
  commandId: '96721f40-ebcd-4b48-911b-f5609b39bff8',
  expectedVersion: 3,
  incidentId: 'inc-1042',
  type: 'acknowledge',
}
const openIncident = findIncident('inc-1042')
const acknowledgedIncident = findIncident('inc-1038')

describe('incident command outbox adapter', () => {
  it('reconciles delivered commands across status-specific query caches', async () => {
    const queryClient = createSeededQueryClient()
    const acknowledged = createOptimisticIncident(
      openIncident,
      acknowledgeCommand,
      new Date('2026-07-22T09:10:00.000Z'),
    )
    const outbox = createTestOutbox(queryClient, () =>
      Promise.resolve({ incident: acknowledged, replayed: false }),
    )
    await enqueueAcknowledge(outbox, acknowledged)

    await outbox.flush()

    expect(outbox.getSnapshot()).toEqual([])
    expect(
      queryClient.getQueryData<{ items: Incident[] }>(
        incidentQueryKeys.list('all', 'normal'),
      )?.items[0],
    ).toMatchObject({ status: 'acknowledged', version: 4 })
    expect(
      queryClient.getQueryData<{ items: Incident[] }>(
        incidentQueryKeys.list('open', 'normal'),
      )?.items,
    ).toEqual([])
    expect(
      queryClient
        .getQueryData<{ items: Incident[] }>(
          incidentQueryKeys.list('acknowledged', 'normal'),
        )
        ?.items.map((incident) => incident.id),
    ).toEqual(['inc-1042'])
  })

  it('blocks only the conflicted partition and restores authoritative state', async () => {
    const queryClient = createSeededQueryClient()
    const currentIncident: Incident = {
      ...openIncident,
      assignee: 'External operator',
      version: 4,
    }
    const problem = createProblem({
      code: 'version-conflict',
      currentIncident,
      status: 412,
    })
    const outbox = createTestOutbox(queryClient, () =>
      Promise.reject(new IncidentApiError(problem)),
    )
    await enqueueAcknowledge(
      outbox,
      createOptimisticIncident(
        openIncident,
        acknowledgeCommand,
        new Date('2026-07-22T09:10:00.000Z'),
      ),
    )

    await outbox.flush()

    expect(outbox.getSnapshot()[0]).toMatchObject({
      failure: { context: problem, kind: 'conflict' },
      status: 'blocked',
    })
    expect(
      queryClient.getQueryData<{ items: Incident[] }>(
        incidentQueryKeys.list('all', 'normal'),
      )?.items[0],
    ).toMatchObject({ assignee: 'External operator', version: 4 })
  })

  it('maps transient and permanent API failures to explicit queue states', async () => {
    const transientOutbox = createTestOutbox(new QueryClient(), () =>
      Promise.reject(
        new IncidentApiError(
          createProblem({
            code: 'temporarily-unavailable',
            retryAfterMs: 1_000,
            status: 503,
          }),
        ),
      ),
    )
    await enqueueAcknowledge(
      transientOutbox,
      createOptimisticIncident(
        openIncident,
        acknowledgeCommand,
        new Date('2026-07-22T09:10:00.000Z'),
      ),
    )
    await transientOutbox.flush()

    expect(transientOutbox.getSnapshot()[0]?.failure).toMatchObject({
      kind: 'transient',
      retryAfterMs: 1_000,
    })

    const rejectedOutbox = createTestOutbox(new QueryClient(), () =>
      Promise.reject(
        new IncidentApiError(
          createProblem({ code: 'invalid-transition', status: 409 }),
        ),
      ),
    )
    await enqueueAcknowledge(
      rejectedOutbox,
      createOptimisticIncident(
        openIncident,
        acknowledgeCommand,
        new Date('2026-07-22T09:10:00.000Z'),
      ),
    )
    await rejectedOutbox.flush()

    expect(rejectedOutbox.getSnapshot()[0]).toMatchObject({
      failure: { kind: 'rejected' },
      status: 'blocked',
    })
  })

  it('keeps unknown transport errors retryable', async () => {
    const outbox = createTestOutbox(new QueryClient(), () =>
      Promise.reject(new Error('Network disconnected')),
    )
    await enqueueAcknowledge(
      outbox,
      createOptimisticIncident(
        openIncident,
        acknowledgeCommand,
        new Date('2026-07-22T09:10:00.000Z'),
      ),
    )

    await outbox.flush()

    expect(outbox.getSnapshot()[0]?.failure).toMatchObject({
      kind: 'transient',
      message: 'Network disconnected',
    })
  })
})

describe('incident optimistic projection', () => {
  it('projects active envelopes into matching filters and ignores blocked work', () => {
    const optimisticIncident = createOptimisticIncident(
      openIncident,
      acknowledgeCommand,
      new Date('2026-07-22T09:10:00.000Z'),
    )
    const active = createEntry(optimisticIncident, 'pending')
    const blocked = createEntry(
      { ...optimisticIncident, id: 'inc-blocked' },
      'blocked',
    )

    expect(
      projectIncidentSnapshot(
        incidentFixtures,
        [active, blocked],
        'acknowledged',
      ).map((incident) => incident.id),
    ).toEqual(['inc-1042', 'inc-1038'])
    expect(projectIncidentSnapshot(incidentFixtures, [active], 'open')).toEqual(
      [],
    )
  })

  it('creates optimistic acknowledge, assign, and resolve snapshots', () => {
    const at = new Date('2026-07-22T09:10:00.000Z')
    const assignedCommand: IncidentCommand = {
      ...acknowledgeCommand,
      commandId: 'bbc51be8-6201-4ebf-9352-c8daa3f17e61',
      type: 'assign',
      assignee: 'On-call operator',
    }
    const resolveCommand: IncidentCommand = {
      ...acknowledgeCommand,
      commandId: '6f16f102-a13f-4102-9873-8842bc1362ac',
      incidentId: 'inc-1038',
      expectedVersion: 7,
      type: 'resolve',
      resolutionNote: 'Queue recovered',
    }

    expect(
      createOptimisticIncident(openIncident, assignedCommand, at),
    ).toMatchObject({ assignee: 'On-call operator', version: 4 })
    expect(
      createOptimisticIncident(acknowledgedIncident, resolveCommand, at),
    ).toMatchObject({
      resolutionNote: 'Queue recovered',
      status: 'resolved',
      version: 8,
    })
    expect(fingerprintIncidentCommand(acknowledgeCommand)).toContain(
      'acknowledge',
    )
    expect(fingerprintIncidentCommand(assignedCommand)).toContain(
      'On-call operator',
    )
    expect(fingerprintIncidentCommand(resolveCommand)).toContain(
      'Queue recovered',
    )
  })
})

function createTestOutbox(
  queryClient: QueryClient,
  send: (input: SendIncidentCommandInput) => Promise<IncidentCommandResult>,
) {
  return createIncidentOutbox({
    queryClient,
    send,
    storage: new MemoryOutboxStorage<IncidentCommandEnvelope, ApiProblem>(),
  })
}

function createSeededQueryClient(): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(incidentQueryKeys.list('all', 'normal'), {
    generatedAt,
    items: [openIncident],
  })
  queryClient.setQueryData(incidentQueryKeys.list('open', 'normal'), {
    generatedAt,
    items: [openIncident],
  })
  queryClient.setQueryData(incidentQueryKeys.list('acknowledged', 'normal'), {
    generatedAt,
    items: [],
  })
  return queryClient
}

async function enqueueAcknowledge(
  outbox: ReturnType<typeof createTestOutbox>,
  optimisticIncident: Incident,
): Promise<void> {
  await outbox.enqueue({
    fingerprint: fingerprintIncidentCommand(acknowledgeCommand),
    id: acknowledgeCommand.commandId,
    partitionKey: acknowledgeCommand.incidentId,
    payload: {
      command: acknowledgeCommand,
      faultProfile: 'normal',
      optimisticIncident,
    },
  })
}

function createProblem(
  overrides: Partial<ApiProblem> & Pick<ApiProblem, 'code' | 'status'>,
): ApiProblem {
  return {
    type: 'https://react-resilience.dev/problems/test',
    title: 'Command failed',
    detail: 'Command could not be applied.',
    requestId: 'request-test-1',
    ...overrides,
  }
}

function createEntry(
  optimisticIncident: Incident,
  status: 'pending' | 'blocked',
): OutboxEntry<IncidentCommandEnvelope, ApiProblem> {
  return {
    attemptCount: 0,
    enqueuedAt: '2026-07-22T09:10:00.000Z',
    failure:
      status === 'blocked'
        ? { kind: 'conflict', message: 'Blocked' }
        : undefined,
    fingerprint: fingerprintIncidentCommand(acknowledgeCommand),
    id: `${acknowledgeCommand.commandId}-${optimisticIncident.id}`,
    partitionKey: optimisticIncident.id,
    payload: {
      command: acknowledgeCommand,
      faultProfile: 'normal',
      optimisticIncident,
    },
    sequence: 1,
    status,
  }
}

function findIncident(id: string): Incident {
  const incident = incidentFixtures.find((candidate) => candidate.id === id)
  if (!incident) {
    throw new Error(`Missing incident fixture ${id}`)
  }
  return incident
}
