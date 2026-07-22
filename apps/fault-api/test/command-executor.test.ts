import { describe, expect, it } from 'vitest'

import type { IncidentCommand } from '@react-resilience/contracts'

import { IncidentCommandExecutor } from '../src/command-executor.js'
import { InMemoryIncidentStore } from '../src/incident-store.js'
import { createSeedIncidents } from '../src/incidents.js'

const now = new Date('2026-07-22T10:00:00.000Z')
const acknowledgeCommand: IncidentCommand = {
  commandId: 'fb631789-70b1-4c28-915d-56ec1fd65e07',
  incidentId: 'inc-1042',
  expectedVersion: 3,
  type: 'acknowledge',
}

describe('IncidentCommandExecutor', () => {
  it('applies a command once and replays the original result', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const executor = new IncidentCommandExecutor(store)

    const applied = executor.execute(acknowledgeCommand, now)
    const replayed = executor.execute(acknowledgeCommand, now)

    expect(applied).toMatchObject({
      kind: 'completed',
      result: { incident: { version: 4 }, replayed: false },
    })
    expect(replayed).toMatchObject({
      kind: 'completed',
      result: { incident: { version: 4 }, replayed: true },
    })
    expect(store.find('inc-1042')?.version).toBe(4)
  })

  it('rejects reuse of an idempotency key for another command', () => {
    const executor = new IncidentCommandExecutor(
      new InMemoryIncidentStore(createSeedIncidents()),
    )

    executor.execute(acknowledgeCommand, now)
    const result = executor.execute(
      {
        ...acknowledgeCommand,
        expectedVersion: 4,
        type: 'assign',
        assignee: 'Lee',
      },
      now,
    )

    expect(result).toEqual({ kind: 'idempotency-conflict' })
  })

  it('does not reserve idempotency keys for rejected commands', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const executor = new IncidentCommandExecutor(store)
    const stale = { ...acknowledgeCommand, expectedVersion: 2 }

    expect(executor.execute(stale, now).kind).toBe('version-conflict')
    expect(
      executor.execute({ ...stale, expectedVersion: 3 }, now),
    ).toMatchObject({ kind: 'completed' })
  })
})
