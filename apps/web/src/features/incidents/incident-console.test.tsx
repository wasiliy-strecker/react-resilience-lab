import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { IncidentConsole } from './incident-console.js'

describe('IncidentConsole', () => {
  it('shows the baseline incident workspace', () => {
    render(<IncidentConsole />)

    expect(
      screen.getByRole('heading', { name: 'Active incident response' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Checkout latency above threshold/,
      }),
    ).toBeInTheDocument()
  })

  it('filters the visible incidents without losing the detail context', async () => {
    const user = userEvent.setup()
    render(<IncidentConsole />)

    await user.click(screen.getByRole('button', { name: 'Acknowledged' }))

    expect(
      screen.getByRole('button', { name: /Delayed webhook deliveries/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /Checkout latency above threshold/,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Delayed webhook deliveries' }),
    ).toBeInTheDocument()
  })

  it('updates details when an incident is selected', async () => {
    const user = userEvent.setup()
    render(<IncidentConsole />)

    await user.click(
      screen.getByRole('button', { name: /Delayed webhook deliveries/ }),
    )

    expect(
      screen.getByRole('heading', { name: 'Delayed webhook deliveries' }),
    ).toBeInTheDocument()
  })

  it('renders a stable empty state when no incidents are available', () => {
    render(<IncidentConsole incidents={[]} />)

    expect(
      screen.getByText('No incidents match this status.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Select a status with visible incidents.'),
    ).toBeInTheDocument()
  })
})
