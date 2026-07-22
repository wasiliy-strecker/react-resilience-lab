import type { Incident } from '@react-resilience/contracts'

const incidents = [
  {
    id: 'inc-1042',
    title: 'Checkout latency above threshold',
    service: 'checkout-api',
    summary: 'The 95th percentile crossed the customer-facing threshold.',
    severity: 'high',
    status: 'open',
    assignee: null,
    resolutionNote: null,
    version: 3,
    detectedAt: '2026-07-22T08:12:00.000Z',
    updatedAt: '2026-07-22T08:16:00.000Z',
  },
  {
    id: 'inc-1038',
    title: 'Delayed webhook deliveries',
    service: 'event-relay',
    summary: 'Delivery age is rising while the downstream queue recovers.',
    severity: 'medium',
    status: 'acknowledged',
    assignee: 'Mara Chen',
    resolutionNote: null,
    version: 7,
    detectedAt: '2026-07-22T07:32:00.000Z',
    updatedAt: '2026-07-22T08:07:00.000Z',
  },
  {
    id: 'inc-1029',
    title: 'Search replica resynchronized',
    service: 'catalog-search',
    summary: 'The affected replica is healthy after a controlled rebuild.',
    severity: 'low',
    status: 'resolved',
    assignee: 'Noah Williams',
    resolutionNote: 'Replica rebuild completed and lag returned to baseline.',
    version: 11,
    detectedAt: '2026-07-21T22:18:00.000Z',
    updatedAt: '2026-07-22T06:41:00.000Z',
  },
] satisfies Incident[]

export function createSeedIncidents(): Incident[] {
  return structuredClone(incidents)
}
