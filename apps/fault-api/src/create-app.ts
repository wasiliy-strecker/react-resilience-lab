import { randomUUID } from 'node:crypto'

import { apiProblemSchema } from '@react-resilience/contracts'
import express from 'express'

import { createIncidentSnapshot } from './incidents.js'

export interface AppDependencies {
  now: () => Date
  requestId: () => string
}

const defaultDependencies: AppDependencies = {
  now: () => new Date(),
  requestId: randomUUID,
}

export function createApp(
  dependencies: AppDependencies = defaultDependencies,
): express.Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '32kb' }))
  app.use((request, response, next) => {
    const requestId = dependencies.requestId()
    request.headers['x-request-id'] = requestId
    response.setHeader('x-request-id', requestId)
    response.setHeader('cache-control', 'no-store')
    next()
  })

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  app.get('/api/incidents', (_request, response) => {
    response.status(200).json(createIncidentSnapshot(dependencies.now()))
  })

  app.use((request, response) => {
    const problem = apiProblemSchema.parse({
      type: 'https://react-resilience.dev/problems/not-found',
      code: 'not-found',
      title: 'Route not found',
      status: 404,
      detail: `No route is registered for ${request.method} ${request.path}.`,
      requestId: request.headers['x-request-id'],
    })

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem)
  })

  return app
}
