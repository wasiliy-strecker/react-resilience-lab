import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  MemoryOutboxStorage,
  type OutboxStorage,
} from '@react-resilience/command-outbox'
import type { ApiProblem } from '@react-resilience/contracts'

import { incidentFixtures } from '../../test/fixtures.js'
import { IncidentApiError } from './incident-api.js'
import {
  IncidentOutboxProvider,
  useIncidentOutbox,
} from './incident-outbox-context.js'
import {
  createIncidentOutbox,
  createOptimisticIncident,
  fingerprintIncidentCommand,
  type IncidentCommandEnvelope,
  type IncidentOutbox,
} from './incident-outbox.js'

describe('IncidentOutboxProvider', () => {
  it('reports persistent storage initialization failures', async () => {
    const queryClient = new QueryClient()
    const storage: OutboxStorage<IncidentCommandEnvelope, ApiProblem> = {
      delete: () => Promise.resolve(),
      list: () => Promise.reject(new Error('IndexedDB denied')),
      put: () => Promise.resolve(),
    }
    const outbox = createIncidentOutbox({ queryClient, storage })
    const { result } = renderHook(() => useIncidentOutbox(), {
      wrapper: createWrapper(queryClient, outbox),
    })

    await waitFor(() => {
      expect(result.current.storageError?.message).toBe('IndexedDB denied')
    })
  })

  it('flushes after reconnect and exposes delivery storage failures', async () => {
    const queryClient = new QueryClient()
    const memory = new MemoryOutboxStorage<
      IncidentCommandEnvelope,
      ApiProblem
    >()
    let failWrites = false
    const storage: OutboxStorage<IncidentCommandEnvelope, ApiProblem> = {
      delete: (id) => memory.delete(id),
      list: () => memory.list(),
      put: (entry) =>
        failWrites
          ? Promise.reject(new Error('IndexedDB write failed'))
          : memory.put(entry),
    }
    let online = false
    const outbox = createIncidentOutbox({
      isOnline: () => online,
      queryClient,
      send: () =>
        Promise.resolve({ incident: getOpenIncident(), replayed: false }),
      storage,
    })
    const command = {
      commandId: '96721f40-ebcd-4b48-911b-f5609b39bff8',
      expectedVersion: 3,
      incidentId: 'inc-1042',
      type: 'acknowledge',
    } as const
    await outbox.enqueue({
      fingerprint: fingerprintIncidentCommand(command),
      id: command.commandId,
      partitionKey: command.incidentId,
      payload: {
        command,
        faultProfile: 'normal',
        optimisticIncident: createOptimisticIncident(
          getOpenIncident(),
          command,
          new Date('2026-07-22T09:10:00.000Z'),
        ),
      },
    })
    const { result, unmount } = renderHook(() => useIncidentOutbox(), {
      wrapper: createWrapper(queryClient, outbox),
    })

    online = true
    failWrites = true
    globalThis.dispatchEvent(new Event('online'))

    await waitFor(() => {
      expect(result.current.storageError?.message).toBe(
        'IndexedDB write failed',
      )
    })
    unmount()
  })

  it('retries transient delivery after the server-provided delay', async () => {
    const queryClient = new QueryClient()
    let attempts = 0
    const outbox = createIncidentOutbox({
      isOnline: () => true,
      queryClient,
      send: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(
              new IncidentApiError({
                type: 'https://react-resilience.dev/problems/temporarily-unavailable',
                code: 'temporarily-unavailable',
                title: 'Try later',
                status: 503,
                detail: 'The deterministic profile rejected this attempt.',
                requestId: 'request-test-1',
                retryAfterMs: 5,
              }),
            )
          : Promise.resolve({
              incident: {
                ...getOpenIncident(),
                status: 'acknowledged',
                version: 4,
              },
              replayed: false,
            })
      },
      storage: new MemoryOutboxStorage(),
    })
    const command = {
      commandId: '96721f40-ebcd-4b48-911b-f5609b39bff8',
      expectedVersion: 3,
      incidentId: 'inc-1042',
      type: 'acknowledge',
    } as const
    await outbox.enqueue({
      fingerprint: fingerprintIncidentCommand(command),
      id: command.commandId,
      partitionKey: command.incidentId,
      payload: {
        command,
        faultProfile: 'flaky',
        optimisticIncident: createOptimisticIncident(
          getOpenIncident(),
          command,
          new Date('2026-07-22T09:10:00.000Z'),
        ),
      },
    })
    const { unmount } = renderHook(() => useIncidentOutbox(), {
      wrapper: createWrapper(queryClient, outbox),
    })

    await waitFor(() => {
      expect(attempts).toBe(2)
      expect(outbox.getSnapshot()).toEqual([])
    })
    unmount()
  })

  it('requires a provider', () => {
    expect(() => renderHook(() => useIncidentOutbox())).toThrow(
      'IncidentOutboxProvider is missing',
    )
  })
})

function createWrapper(queryClient: QueryClient, outbox: IncidentOutbox) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <IncidentOutboxProvider outbox={outbox}>
          {children}
        </IncidentOutboxProvider>
      </QueryClientProvider>
    )
  }
}

function getOpenIncident() {
  const incident = incidentFixtures.find(
    (candidate) => candidate.id === 'inc-1042',
  )
  if (!incident) {
    throw new Error('Missing open incident fixture')
  }
  return incident
}
