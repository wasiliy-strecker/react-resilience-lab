import { describe, expect, it } from 'vitest'

import {
  apiProblemSchema,
  incidentCommandSchema,
  incidentSchema,
} from '../src/index.js'

const incident = {
  id: 'inc-1042',
  title: 'Checkout latency above threshold',
  service: 'checkout-api',
  summary: 'The 95th percentile crossed the customer-facing threshold.',
  severity: 'high',
  status: 'open',
  assignee: null,
  version: 3,
  detectedAt: '2026-07-22T08:12:00.000Z',
  updatedAt: '2026-07-22T08:16:00.000Z',
} as const

describe('incident contracts', () => {
  it('accepts a complete incident snapshot', () => {
    expect(incidentSchema.parse(incident)).toEqual(incident)
  })

  it('rejects invalid versions at the boundary', () => {
    expect(() => incidentSchema.parse({ ...incident, version: 0 })).toThrow()
  })

  it('narrows command payloads by command type', () => {
    const command = incidentCommandSchema.parse({
      commandId: 'a0bfe866-2241-49f6-a2bd-cecd0cf9a60e',
      incidentId: incident.id,
      expectedVersion: incident.version,
      type: 'assign',
      assignee: 'Mara',
    })

    expect(command.type).toBe('assign')
    if (command.type !== 'assign') {
      throw new Error('Expected an assign command')
    }
    expect(command.assignee).toBe('Mara')
  })

  it('requires diagnostic context in API problems', () => {
    expect(() =>
      apiProblemSchema.parse({
        type: 'https://react-resilience.dev/problems/unavailable',
        title: 'Service unavailable',
        status: 503,
        detail: 'The fault profile rejected this request.',
      }),
    ).toThrow()
  })
})
