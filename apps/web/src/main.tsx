import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'

import { App } from './app/app.js'
import { AppErrorBoundary } from './app/app-error-boundary.js'
import { createAppQueryClient } from './app/query-client.js'
import { IncidentOutboxProvider } from './features/incidents/incident-outbox-context.js'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The root element is missing')
}

const router = createBrowserRouter([
  {
    path: '*',
    element: <App />,
  },
])
const queryClient = createAppQueryClient()

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IncidentOutboxProvider>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </IncidentOutboxProvider>
    </QueryClientProvider>
  </StrictMode>,
)
