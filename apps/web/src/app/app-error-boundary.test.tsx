import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AppErrorBoundary } from './app-error-boundary.js'

describe('AppErrorBoundary', () => {
  it('focuses an explicit reset action and recovers the render tree', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    let shouldFail = true

    function UnstableView() {
      if (shouldFail) {
        throw new Error('Render failed')
      }
      return <p>Console recovered</p>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <UnstableView />
        </AppErrorBoundary>
      </QueryClientProvider>,
    )

    const reset = screen.getByRole('button', { name: 'Reset console' })
    expect(reset).toHaveFocus()

    shouldFail = false
    await user.click(reset)

    expect(screen.getByText('Console recovered')).toBeInTheDocument()
  })
})
