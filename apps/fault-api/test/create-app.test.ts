import request from 'supertest'
import { describe, expect, it } from 'vitest'

import {
  apiProblemSchema,
  incidentCommandResultSchema,
  incidentListResponseSchema,
  incidentSchema,
  type FaultProfile,
  type IncidentCommand,
} from '@react-resilience/contracts'

import { createApp } from '../src/create-app.js'

const dependencies = {
  now: () => new Date('2026-07-22T09:00:00.000Z'),
  requestId: () => 'request-test-1',
  sleep: () => Promise.resolve(),
}

const acknowledgeCommand: IncidentCommand = {
  commandId: '96721f40-ebcd-4b48-911b-f5609b39bff8',
  incidentId: 'inc-1042',
  expectedVersion: 3,
  type: 'acknowledge',
}

describe('fault API read boundary', () => {
  it('serves a deterministic health response', async () => {
    const response = await request(createApp(dependencies)).get('/health/live')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('returns contract-valid incident snapshots', async () => {
    const response = await request(createApp(dependencies)).get(
      '/api/incidents?status=acknowledged',
    )
    const body = incidentListResponseSchema.parse(response.body)

    expect(response.status).toBe(200)
    expect(body.generatedAt).toBe('2026-07-22T09:00:00.000Z')
    expect(body.items.map((incident) => incident.id)).toEqual(['inc-1038'])
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('rejects unknown status filters', async () => {
    const response = await request(createApp(dependencies)).get(
      '/api/incidents?status=paused',
    )

    expect(response.status).toBe(400)
    expect(apiProblemSchema.parse(response.body).code).toBe('validation-failed')
  })

  it('rejects unknown fault profiles before entering the boundary', async () => {
    const response = await request(createApp(dependencies))
      .get('/api/incidents')
      .set('x-lab-fault-profile', 'chaos')

    expect(response.status).toBe(400)
    expect(apiProblemSchema.parse(response.body)).toMatchObject({
      code: 'validation-failed',
      title: 'Invalid fault profile',
    })
  })

  it('makes configured latency observable without relying on wall time', async () => {
    const delays: number[] = []
    const app = createApp({
      ...dependencies,
      sleep: (delayMs) => {
        delays.push(delayMs)
        return Promise.resolve()
      },
    })

    const response = await request(app)
      .get('/api/incidents')
      .set('x-lab-fault-profile', 'slow')

    expect(response.status).toBe(200)
    expect(delays).toEqual([850])
    expect(response.headers).toMatchObject({
      'x-lab-delay-ms': '850',
      'x-lab-fault-profile': 'slow',
      vary: 'x-lab-fault-profile',
    })
  })

  it('fails every third flaky request and exposes retry semantics', async () => {
    const app = createApp(dependencies)
    const call = () =>
      request(app).get('/api/incidents').set('x-lab-fault-profile', 'flaky')

    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)

    const rejected = await call()
    expect(rejected.status).toBe(503)
    expect(rejected.headers['retry-after']).toBe('1')
    expect(apiProblemSchema.parse(rejected.body)).toMatchObject({
      code: 'temporarily-unavailable',
      retryAfterMs: 1_000,
    })
    expect((await call()).status).toBe(200)
  })

  it('returns an entity tag with incident details', async () => {
    const response = await request(createApp(dependencies)).get(
      '/api/incidents/inc-1042',
    )

    expect(response.status).toBe(200)
    expect(response.headers['etag']).toBe('"inc-1042-v3"')
    expect(incidentSchema.parse(response.body).id).toBe('inc-1042')
  })

  it('uses problem details for unknown resources and routes', async () => {
    const missingIncident = await request(createApp(dependencies)).get(
      '/api/incidents/missing',
    )
    const missingRoute = await request(createApp(dependencies)).get('/missing')

    expect(apiProblemSchema.parse(missingIncident.body).code).toBe('not-found')
    expect(missingRoute.status).toBe(404)
    expect(missingRoute.type).toBe('application/problem+json')
    expect(apiProblemSchema.parse(missingRoute.body).requestId).toBe(
      'request-test-1',
    )
  })
})

describe('fault API command boundary', () => {
  it('applies and then replays an idempotent command', async () => {
    const app = createApp(dependencies)

    const applied = await sendCommand(app, acknowledgeCommand)
    const replayed = await sendCommand(app, acknowledgeCommand)
    const appliedBody = incidentCommandResultSchema.parse(applied.body)
    const replayedBody = incidentCommandResultSchema.parse(replayed.body)

    expect(applied.status).toBe(200)
    expect(applied.headers['etag']).toBe('"inc-1042-v4"')
    expect(appliedBody).toMatchObject({
      incident: { status: 'acknowledged', version: 4 },
      replayed: false,
    })
    expect(replayedBody).toMatchObject({
      incident: { version: 4 },
      replayed: true,
    })
  })

  it('returns the current entity for a stale version', async () => {
    const staleCommand = { ...acknowledgeCommand, expectedVersion: 2 }
    const response = await sendCommand(createApp(dependencies), staleCommand)
    const problem = apiProblemSchema.parse(response.body)

    expect(response.status).toBe(412)
    expect(response.headers['etag']).toBe('"inc-1042-v3"')
    expect(problem).toMatchObject({
      code: 'version-conflict',
      currentIncident: { version: 3 },
    })
  })

  it('turns the conflict profile into a concurrent version change', async () => {
    const response = await sendCommand(
      createApp(dependencies),
      acknowledgeCommand,
      'conflict',
    )

    expect(response.status).toBe(412)
    expect(response.headers['etag']).toBe('"inc-1042-v4"')
    expect(apiProblemSchema.parse(response.body)).toMatchObject({
      code: 'version-conflict',
      currentIncident: {
        assignee: 'External operator',
        version: 4,
      },
    })
  })

  it('requires matching route, idempotency, and version preconditions', async () => {
    const app = createApp(dependencies)
    const missingPrecondition = await request(app)
      .post('/api/incidents/inc-1042/commands')
      .set('idempotency-key', acknowledgeCommand.commandId)
      .send(acknowledgeCommand)
    const routeMismatch = await request(app)
      .post('/api/incidents/inc-1038/commands')
      .set('idempotency-key', acknowledgeCommand.commandId)
      .set('if-match', '"inc-1042-v3"')
      .send(acknowledgeCommand)
    const keyMismatch = await request(app)
      .post('/api/incidents/inc-1042/commands')
      .set('idempotency-key', '9f76d766-42ba-4f8e-a9fc-31194fd7bd80')
      .set('if-match', '"inc-1042-v3"')
      .send(acknowledgeCommand)
    const etagMismatch = await request(app)
      .post('/api/incidents/inc-1042/commands')
      .set('idempotency-key', acknowledgeCommand.commandId)
      .set('if-match', '"inc-1042-v2"')
      .send(acknowledgeCommand)

    expect(missingPrecondition.status).toBe(428)
    expect(routeMismatch.status).toBe(400)
    expect(keyMismatch.status).toBe(400)
    expect(etagMismatch.status).toBe(400)
  })

  it('rejects invalid transitions with authoritative context', async () => {
    const response = await sendCommand(createApp(dependencies), {
      commandId: '73afd8f5-a286-4e5d-831b-3263ea54585f',
      incidentId: 'inc-1042',
      expectedVersion: 3,
      type: 'resolve',
      resolutionNote: 'Recovered',
    })

    expect(response.status).toBe(409)
    expect(apiProblemSchema.parse(response.body)).toMatchObject({
      code: 'invalid-transition',
      currentIncident: { status: 'open' },
    })
  })

  it('rejects reuse of an idempotency key for a different command', async () => {
    const app = createApp(dependencies)
    await sendCommand(app, acknowledgeCommand)
    const response = await sendCommand(app, {
      ...acknowledgeCommand,
      expectedVersion: 4,
      type: 'assign',
      assignee: 'Lee',
    })

    expect(response.status).toBe(409)
    expect(apiProblemSchema.parse(response.body).code).toBe(
      'idempotency-conflict',
    )
  })

  it('rejects malformed commands and JSON', async () => {
    const app = createApp(dependencies)
    const invalidCommand = await request(app)
      .post('/api/incidents/inc-1042/commands')
      .send({ type: 'acknowledge' })
    const malformedJson = await request(app)
      .post('/api/incidents/inc-1042/commands')
      .type('application/json')
      .send('{"type":')

    expect(invalidCommand.status).toBe(400)
    expect(malformedJson.status).toBe(400)
    expect(apiProblemSchema.parse(malformedJson.body).title).toBe(
      'Malformed JSON',
    )
  })

  it('returns not found when a valid command targets missing state', async () => {
    const command: IncidentCommand = {
      ...acknowledgeCommand,
      commandId: '28a1936a-c784-4123-bf4b-237030db354f',
      incidentId: 'inc-missing',
    }
    const response = await sendCommand(createApp(dependencies), command)

    expect(response.status).toBe(404)
  })

  it('exposes a token-gated state reset only for browser tests', async () => {
    const app = createApp({
      ...dependencies,
      testResetToken: 'e2e-reset-token',
    })
    await sendCommand(app, acknowledgeCommand)

    const denied = await request(app)
      .post('/__test/reset')
      .set('x-test-reset-token', 'wrong-token')
    const reset = await request(app)
      .post('/__test/reset')
      .set('x-test-reset-token', 'e2e-reset-token')
    const incident = await request(app).get('/api/incidents/inc-1042')

    expect(denied.status).toBe(404)
    expect(reset.status).toBe(204)
    expect(incidentSchema.parse(incident.body).version).toBe(3)
  })
})

function sendCommand(
  app: ReturnType<typeof createApp>,
  command: IncidentCommand,
  profile?: FaultProfile,
) {
  const commandRequest = request(app)
    .post(`/api/incidents/${command.incidentId}/commands`)
    .set('idempotency-key', command.commandId)
    .set('if-match', `"${command.incidentId}-v${command.expectedVersion}"`)

  if (profile) {
    commandRequest.set('x-lab-fault-profile', profile)
  }

  return commandRequest.send(command)
}
