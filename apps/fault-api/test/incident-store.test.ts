import { describe, expect, it } from 'vitest'

import type { IncidentCommand } from '@react-resilience/contracts'

import { InMemoryIncidentStore } from '../src/incident-store.js'
import { createSeedIncidents } from '../src/incidents.js'

const now = new Date('2026-07-22T10:00:00.000Z')

function command(
  values: Partial<IncidentCommand> & Pick<IncidentCommand, 'type'>,
): IncidentCommand {
  return {
    commandId: '6cf01cf6-00cd-43e6-95cd-a1b8379c897b',
    incidentId: 'inc-1042',
    expectedVersion: 3,
    ...values,
  } as IncidentCommand
}

describe('InMemoryIncidentStore', () => {
  it('returns isolated snapshots in deterministic order', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const snapshot = store.list()

    snapshot[0]!.title = 'mutated outside the store'

    expect(store.list()[0]?.id).toBe('inc-1042')
    expect(store.find('inc-1042')?.title).toBe(
      'Checkout latency above threshold',
    )
  })

  it('filters incidents by status', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())

    expect(store.list('acknowledged').map((incident) => incident.id)).toEqual([
      'inc-1038',
    ])
  })

  it('applies an acknowledge command against the expected version', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const result = store.apply(command({ type: 'acknowledge' }), now)

    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') {
      throw new Error('Expected the command to apply')
    }
    expect(result.incident).toMatchObject({
      status: 'acknowledged',
      version: 4,
      updatedAt: now.toISOString(),
    })
  })

  it('returns the authoritative snapshot for stale commands', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const result = store.apply(
      command({ type: 'acknowledge', expectedVersion: 2 }),
      now,
    )

    expect(result).toMatchObject({
      kind: 'version-conflict',
      currentIncident: { version: 3 },
    })
  })

  it('enforces the incident transition model', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const result = store.apply(
      command({ type: 'resolve', resolutionNote: 'Recovered' }),
      now,
    )

    expect(result).toMatchObject({
      kind: 'invalid-transition',
      currentIncident: { status: 'open' },
    })
  })

  it('reports missing incidents without creating state', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())
    const result = store.apply(
      command({ type: 'acknowledge', incidentId: 'inc-missing' }),
      now,
    )

    expect(result).toEqual({ kind: 'not-found' })
  })

  it('can reproduce an external version change', () => {
    const store = new InMemoryIncidentStore(createSeedIncidents())

    expect(store.simulateConcurrentUpdate('inc-1042', now)).toMatchObject({
      assignee: 'External operator',
      version: 4,
    })
    expect(store.simulateConcurrentUpdate('missing', now)).toBeUndefined()
  })
})
