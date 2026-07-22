import { http, HttpResponse, delay } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MemoryOutboxStorage } from '@react-resilience/command-outbox'
import type { ApiProblem } from '@react-resilience/contracts'

import { generatedAt, incidentFixtures } from '../../test/fixtures.js'
import { renderWithQueryClient } from '../../test/render.js'
import { server } from '../../test/server.js'
import { IncidentConsole } from './incident-console.js'
import {
  createIncidentOutbox,
  type IncidentCommandEnvelope,
} from './incident-outbox.js'

describe('IncidentConsole', () => {
  it('loads and renders a validated remote incident snapshot', async () => {
    renderWithQueryClient(<IncidentConsole />)

    expect(
      screen.getByRole('heading', { name: 'Active incident response' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', {
        name: /Checkout latency above threshold/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Snapshot is current.')).toBeInTheDocument()
  })

  it('requests filtered data without losing the selected detail context', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<IncidentConsole />)
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('button', { name: 'Acknowledged' }))

    expect(
      await screen.findByRole('button', {
        name: /Delayed webhook deliveries/,
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: /Checkout latency above threshold/,
        }),
      ).not.toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { name: 'Delayed webhook deliveries' }),
    ).toBeInTheDocument()
  })

  it('updates details when an incident is selected', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<IncidentConsole />)

    await user.click(
      await screen.findByRole('button', {
        name: /Delayed webhook deliveries/,
      }),
    )

    expect(
      screen.getByRole('heading', { name: 'Delayed webhook deliveries' }),
    ).toBeInTheDocument()
  })

  it('renders explicit initial loading and empty states', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/incidents', async ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        await delay(40)
        return HttpResponse.json({
          generatedAt,
          items: status === 'resolved' ? [] : incidentFixtures,
        })
      }),
    )
    renderWithQueryClient(<IncidentConsole />)

    expect(screen.getByText('Loading incident stream')).toBeInTheDocument()
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })
    await user.click(screen.getByRole('button', { name: 'Resolved' }))

    expect(
      await screen.findByText('No incidents match this status.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Select a status with visible incidents.'),
    ).toBeInTheDocument()
  })

  it('shows typed failures and recovers through an explicit retry', async () => {
    const user = userEvent.setup()
    let attempts = 0
    server.use(
      http.get('*/api/incidents', () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.json(
            {
              type: 'https://react-resilience.dev/problems/temporarily-unavailable',
              code: 'temporarily-unavailable',
              title: 'Fault profile rejected the request',
              status: 503,
              detail: 'The deterministic flaky profile rejected this attempt.',
              requestId: 'request-test-1',
              retryAfterMs: 1_000,
            },
            { status: 503 },
          )
        }

        return HttpResponse.json({ generatedAt, items: incidentFixtures })
      }),
    )
    renderWithQueryClient(<IncidentConsole />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The deterministic flaky profile rejected this attempt.',
    )
    await user.click(screen.getByRole('button', { name: 'Retry request' }))

    expect(
      await screen.findByRole('button', {
        name: /Checkout latency above threshold/,
      }),
    ).toBeInTheDocument()
  })

  it('keeps the last valid snapshot when a background refresh fails', async () => {
    const user = userEvent.setup()
    let attempts = 0
    let markRefreshStarted: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve
    })
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })

    server.use(
      http.get('*/api/incidents', async () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.json({ generatedAt, items: incidentFixtures })
        }

        markRefreshStarted?.()
        await refreshGate
        return HttpResponse.json(
          {
            type: 'https://react-resilience.dev/problems/temporarily-unavailable',
            code: 'temporarily-unavailable',
            title: 'Fault profile rejected the request',
            status: 503,
            detail: 'The deterministic flaky profile rejected this attempt.',
            requestId: 'request-test-1',
            retryAfterMs: 1_000,
          },
          { status: 503 },
        )
      }),
    )
    renderWithQueryClient(<IncidentConsole />)
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
    await refreshStarted
    expect(screen.getByText('Refreshing incident stream.')).toBeInTheDocument()
    releaseRefresh?.()

    expect(
      await screen.findByText(
        'Refresh failed. Showing the last successful snapshot.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Checkout latency above threshold/,
      }),
    ).toBeInTheDocument()
  })

  it('sends profile changes through a profile-specific query key', async () => {
    const user = userEvent.setup()
    const profiles: Array<string | null> = []
    server.use(
      http.get('*/api/incidents', ({ request }) => {
        profiles.push(request.headers.get('x-lab-fault-profile'))
        return HttpResponse.json({ generatedAt, items: incidentFixtures })
      }),
    )
    renderWithQueryClient(<IncidentConsole />)
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('radio', { name: /^Slow/ }))

    await waitFor(() => {
      expect(profiles).toEqual(['normal', 'slow'])
    })
    expect(screen.getByLabelText('Current network profile')).toHaveTextContent(
      '850 ms stable latency',
    )
  })

  it('persists an optimistic acknowledgement while offline', async () => {
    const user = userEvent.setup()
    const { outbox } = renderWithQueryClient(<IncidentConsole />)
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))

    const details = screen.getByLabelText(
      'Checkout latency above threshold details',
    )
    expect(await within(details).findByText('acknowledged')).toBeInTheDocument()
    expect(within(details).getByText('Version 4')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Command outbox status')).getByText('1'),
    ).toBeInTheDocument()
    expect(outbox.getSnapshot()[0]).toMatchObject({
      partitionKey: 'inc-1042',
      status: 'pending',
    })
  })

  it('persists an optimistic assignment with its semantic command', async () => {
    const user = userEvent.setup()
    const { outbox } = renderWithQueryClient(<IncidentConsole />)
    await user.click(
      await screen.findByRole('button', {
        name: /Delayed webhook deliveries/,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Assign to me' }))

    expect(
      await screen.findByText(
        'The optimistic change is saved and waiting for delivery.',
      ),
    ).toBeInTheDocument()
    expect(outbox.getSnapshot()[0]?.payload.command).toMatchObject({
      assignee: 'On-call operator',
      incidentId: 'inc-1038',
      type: 'assign',
    })
  })

  it('reconciles a delivered command and clears the persisted entry', async () => {
    const user = userEvent.setup()
    let receivedIdempotencyKey: string | null = null
    server.use(
      http.post('*/api/incidents/inc-1042/commands', ({ request }) => {
        receivedIdempotencyKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          incident: {
            ...incidentFixtures[0],
            status: 'acknowledged',
            version: 4,
          },
          replayed: false,
        })
      }),
    )
    const { outbox } = renderWithQueryClient(<IncidentConsole />, {
      createOutbox: (queryClient) =>
        createIncidentOutbox({
          isOnline: () => true,
          queryClient,
          storage: new MemoryOutboxStorage<
            IncidentCommandEnvelope,
            ApiProblem
          >(),
        }),
    })
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => {
      expect(outbox.getSnapshot()).toEqual([])
      expect(receivedIdempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })
    expect(
      within(
        screen.getByLabelText('Checkout latency above threshold details'),
      ).getByText('acknowledged'),
    ).toBeInTheDocument()
  })

  it('shows authoritative state when a command is blocked by a conflict', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('*/api/incidents/inc-1042/commands', () =>
        HttpResponse.json(
          {
            type: 'https://react-resilience.dev/problems/version-conflict',
            code: 'version-conflict',
            title: 'Incident version changed',
            status: 412,
            detail: 'Reload the current incident before retrying this command.',
            requestId: 'request-test-1',
            currentIncident: {
              ...incidentFixtures[0],
              assignee: 'External operator',
              version: 4,
            },
          },
          { status: 412 },
        ),
      ),
    )
    const { outbox } = renderWithQueryClient(<IncidentConsole />, {
      createOutbox: (queryClient) =>
        createIncidentOutbox({
          isOnline: () => true,
          queryClient,
          storage: new MemoryOutboxStorage<
            IncidentCommandEnvelope,
            ApiProblem
          >(),
        }),
    })
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })
    await user.click(screen.getByRole('radio', { name: /^Conflict/ }))

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))

    await waitFor(() => {
      expect(outbox.getSnapshot()[0]?.status).toBe('blocked')
    })
    const details = screen.getByLabelText(
      'Checkout latency above threshold details',
    )
    expect(within(details).getByText('Version 4')).toBeInTheDocument()
    expect(within(details).getByText('External operator')).toBeInTheDocument()
    expect(
      within(details).getByText(
        'A newer incident version blocked this command.',
      ),
    ).toBeInTheDocument()
  })

  it('aborts a superseded filter request before stale data can win', async () => {
    const user = userEvent.setup()
    let signalOpenRequest: (() => void) | undefined
    const openRequestStarted = new Promise<void>((resolve) => {
      signalOpenRequest = resolve
    })
    let openRequestAborted = false

    server.use(
      http.get('*/api/incidents', async ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')

        if (status === 'open') {
          signalOpenRequest?.()
          await new Promise<void>((resolve) => {
            const handleAbort = () => {
              openRequestAborted = true
              resolve()
            }
            if (request.signal.aborted) {
              handleAbort()
            } else {
              request.signal.addEventListener('abort', handleAbort, {
                once: true,
              })
            }
          })
          return HttpResponse.json({
            generatedAt,
            items: [incidentFixtures[0]],
          })
        }

        if (status === 'acknowledged') {
          return HttpResponse.json({
            generatedAt,
            items: [incidentFixtures[1]],
          })
        }

        return HttpResponse.json({ generatedAt, items: incidentFixtures })
      }),
    )
    renderWithQueryClient(<IncidentConsole />)
    await screen.findByRole('button', {
      name: /Checkout latency above threshold/,
    })

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await openRequestStarted
    await user.click(screen.getByRole('button', { name: 'Acknowledged' }))

    expect(
      await screen.findByRole('button', {
        name: /Delayed webhook deliveries/,
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(openRequestAborted).toBe(true)
      expect(
        screen.queryByRole('button', {
          name: /Checkout latency above threshold/,
        }),
      ).not.toBeInTheDocument()
    })
  })
})
