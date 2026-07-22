import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { IncidentStatus } from '@react-resilience/contracts'

import { generatedAt, incidentFixtures } from './fixtures.js'

export const incidentListHandler = http.get(
  '*/api/incidents',
  ({ request }) => {
    const status = new URL(request.url).searchParams.get(
      'status',
    ) as IncidentStatus | null
    const items = status
      ? incidentFixtures.filter((incident) => incident.status === status)
      : incidentFixtures

    return HttpResponse.json({ generatedAt, items })
  },
)

export const server = setupServer(incidentListHandler)
