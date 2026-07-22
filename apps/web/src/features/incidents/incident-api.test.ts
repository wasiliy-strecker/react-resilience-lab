import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { generatedAt, incidentFixtures } from '../../test/fixtures.js'
import { server } from '../../test/server.js'
import { fetchIncidentList, type IncidentApiError } from './incident-api.js'

describe('fetchIncidentList', () => {
  it('sends the selected filter and fault profile and validates the response', async () => {
    let receivedProfile: string | null = null
    server.use(
      http.get('*/api/incidents', ({ request }) => {
        const url = new URL(request.url)
        receivedProfile = request.headers.get('x-lab-fault-profile')

        expect(url.searchParams.get('status')).toBe('acknowledged')
        return HttpResponse.json({
          generatedAt,
          items: [incidentFixtures[1]],
        })
      }),
    )

    const result = await fetchIncidentList({
      faultProfile: 'slow',
      signal: new AbortController().signal,
      status: 'acknowledged',
    })

    expect(receivedProfile).toBe('slow')
    expect(result.items.map((incident) => incident.id)).toEqual(['inc-1038'])
  })

  it('forwards cancellation to the underlying request', async () => {
    const controller = new AbortController()
    let releaseRequest: (() => void) | undefined
    const requestStarted = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    let observedAbort = false

    server.use(
      http.get('*/api/incidents', async ({ request }) => {
        releaseRequest?.()
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => {
            observedAbort = true
            resolve()
          })
        })
        return HttpResponse.json({ generatedAt, items: incidentFixtures })
      }),
    )

    const result = fetchIncidentList({
      faultProfile: 'normal',
      signal: controller.signal,
      status: 'all',
    })
    await requestStarted
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(observedAbort).toBe(true)
  })

  it('preserves typed problem details for caller recovery', async () => {
    server.use(
      http.get('*/api/incidents', () =>
        HttpResponse.json(
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
        ),
      ),
    )

    const result = fetchIncidentList({
      faultProfile: 'flaky',
      signal: new AbortController().signal,
      status: 'all',
    })

    await expect(result).rejects.toEqual(
      expect.objectContaining<Partial<IncidentApiError>>({
        name: 'IncidentApiError',
        problem: expect.objectContaining({
          code: 'temporarily-unavailable',
          retryAfterMs: 1_000,
        }) as IncidentApiError['problem'],
      }),
    )
  })

  it('rejects success payloads that violate the runtime contract', async () => {
    server.use(
      http.get('*/api/incidents', () =>
        HttpResponse.json({ generatedAt, items: [{ id: 'incomplete' }] }),
      ),
    )

    const result = fetchIncidentList({
      faultProfile: 'normal',
      signal: new AbortController().signal,
      status: 'all',
    })

    await expect(result).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('rejects error payloads that do not match problem details', async () => {
    server.use(
      http.get('*/api/incidents', () =>
        HttpResponse.json({ message: 'Proxy failed' }, { status: 502 }),
      ),
    )

    const result = fetchIncidentList({
      faultProfile: 'normal',
      signal: new AbortController().signal,
      status: 'all',
    })

    await expect(result).rejects.toThrow(
      'Incident API returned an invalid 502 body',
    )
  })
})
