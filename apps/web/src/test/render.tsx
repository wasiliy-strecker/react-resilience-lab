import { type ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

import { MemoryOutboxStorage } from '@react-resilience/command-outbox'
import type { ApiProblem } from '@react-resilience/contracts'

import { createAppQueryClient } from '../app/query-client.js'
import { IncidentOutboxProvider } from '../features/incidents/incident-outbox-context.js'
import {
  createIncidentOutbox,
  type IncidentCommandEnvelope,
  type IncidentOutbox,
} from '../features/incidents/incident-outbox.js'

interface RenderOptions {
  createOutbox?: (
    queryClient: ReturnType<typeof createAppQueryClient>,
  ) => IncidentOutbox
  outbox?: IncidentOutbox
}

export function renderWithQueryClient(
  element: ReactElement,
  options: RenderOptions = {},
) {
  const queryClient = createAppQueryClient()
  const outbox =
    options.outbox ??
    options.createOutbox?.(queryClient) ??
    createIncidentOutbox({
      isOnline: () => false,
      queryClient,
      storage: new MemoryOutboxStorage<IncidentCommandEnvelope, ApiProblem>(),
    })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <IncidentOutboxProvider outbox={outbox}>
          {element}
        </IncidentOutboxProvider>
      </QueryClientProvider>,
    ),
    outbox,
    queryClient,
  }
}
