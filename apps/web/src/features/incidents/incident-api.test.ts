import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { generatedAt, incidentFixtures } from '../../test/fixtures.js'
import { server } from '../../test/server.js'
import {
  fetchIncidentList,
  sendIncidentCommand,
  type IncidentApiError,
} from './incident-api.js'

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

describe('sendIncidentCommand', () => {
  const command = {
    commandId: '96721f40-ebcd-4b48-911b-f5609b39bff8',
    expectedVersion: 3,
    incidentId: 'inc-1042',
    type: 'acknowledge',
  } as const

  it('sends idempotency and version preconditions with the command', async () => {
    let receivedBody: unknown
    server.use(
      http.post('*/api/incidents/inc-1042/commands', async ({ request }) => {
        receivedBody = await request.json()
        expect(request.headers.get('idempotency-key')).toBe(command.commandId)
        expect(request.headers.get('if-match')).toBe('"inc-1042-v3"')
        expect(request.headers.get('x-lab-fault-profile')).toBe('normal')
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

    const result = await sendIncidentCommand({
      command,
      faultProfile: 'normal',
    })

    expect(receivedBody).toEqual(command)
    expect(result.incident).toMatchObject({
      id: 'inc-1042',
      status: 'acknowledged',
      version: 4,
    })
  })

  it('preserves authoritative conflict context', async () => {
    server.use(
      http.post('*/api/incidents/inc-1042/commands', () =>
        HttpResponse.json(
          {
            type: 'https://react-resilience.dev/problems/version-conflict',
            code: 'version-conflict',
            title: 'Incident version changed',
            status: 412,
            detail: 'Reload before retrying.',
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

    const result = sendIncidentCommand({ command, faultProfile: 'conflict' })

    await expect(result).rejects.toEqual(
      expect.objectContaining<Partial<IncidentApiError>>({
        problem: expect.objectContaining({
          code: 'version-conflict',
          currentIncident: expect.objectContaining({ version: 4 }) as object,
        }) as IncidentApiError['problem'],
      }),
    )
  })

  it('rejects malformed command success payloads', async () => {
    server.use(
      http.post('*/api/incidents/inc-1042/commands', () =>
        HttpResponse.json({ replayed: false }),
      ),
    )

    const result = sendIncidentCommand({ command, faultProfile: 'normal' })

    await expect(result).rejects.toMatchObject({ name: 'ZodError' })
  })
})
