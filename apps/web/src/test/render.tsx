import { type ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

import { createAppQueryClient } from '../app/query-client.js'

export function renderWithQueryClient(element: ReactElement) {
  const queryClient = createAppQueryClient()
  return {
    ...render(
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
    ),
    queryClient,
  }
}
