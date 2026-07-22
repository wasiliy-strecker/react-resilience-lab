import request from 'supertest'
import { describe, expect, it } from 'vitest'

import {
  apiProblemSchema,
  incidentListResponseSchema,
} from '@react-resilience/contracts'

import { createApp } from '../src/create-app.js'

const dependencies = {
  now: () => new Date('2026-07-22T09:00:00.000Z'),
  requestId: () => 'request-test-1',
}

describe('fault API foundation', () => {
  it('serves a deterministic health response', async () => {
    const response = await request(createApp(dependencies)).get('/health/live')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('returns contract-valid incident snapshots', async () => {
    const response = await request(createApp(dependencies)).get(
      '/api/incidents',
    )
    const body = incidentListResponseSchema.parse(response.body)

    expect(response.status).toBe(200)
    expect(body.generatedAt).toBe('2026-07-22T09:00:00.000Z')
    expect(body.items).toHaveLength(3)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('uses problem details for unknown routes', async () => {
    const response = await request(createApp(dependencies)).get('/missing')
    const body = apiProblemSchema.parse(response.body)

    expect(response.status).toBe(404)
    expect(response.type).toBe('application/problem+json')
    expect(body.requestId).toBe('request-test-1')
  })
})
