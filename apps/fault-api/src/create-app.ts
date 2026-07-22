import { randomUUID } from 'node:crypto'

import {
  apiProblemSchema,
  incidentCommandResultSchema,
  incidentCommandSchema,
  incidentListResponseSchema,
  incidentStatusSchema,
  type ApiProblem,
} from '@react-resilience/contracts'
import express, { type Request, type Response } from 'express'

import { IncidentCommandExecutor } from './command-executor.js'
import { formatIncidentEtag } from './etag.js'
import { InMemoryIncidentStore } from './incident-store.js'
import { createSeedIncidents } from './incidents.js'

export interface AppDependencies {
  now: () => Date
  requestId: () => string
}

const defaultDependencies: AppDependencies = {
  now: () => new Date(),
  requestId: randomUUID,
}

export function createApp(
  overrides: Partial<AppDependencies> = {},
): express.Express {
  const dependencies: AppDependencies = {
    ...defaultDependencies,
    ...overrides,
  }
  const store = new InMemoryIncidentStore(createSeedIncidents())
  const executor = new IncidentCommandExecutor(store)
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

  app.get('/api/incidents', (request, response) => {
    const parsedStatus = parseStatus(request.query['status'])
    if (!parsedStatus.success) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/validation-failed',
        code: 'validation-failed',
        title: 'Invalid incident filter',
        status: 400,
        detail: 'The status filter is not recognized.',
        requestId: getRequestId(request),
      })
      return
    }

    const body = incidentListResponseSchema.parse({
      items: store.list(parsedStatus.status),
      generatedAt: dependencies.now().toISOString(),
    })
    response.status(200).json(body)
  })

  app.get('/api/incidents/:incidentId', (request, response) => {
    const incidentId = request.params['incidentId']
    const incident = incidentId ? store.find(incidentId) : undefined
    if (!incident) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/not-found',
        code: 'not-found',
        title: 'Incident not found',
        status: 404,
        detail: `Incident ${incidentId ?? 'unknown'} was not found.`,
        requestId: getRequestId(request),
      })
      return
    }

    response
      .setHeader('etag', formatIncidentEtag(incident.id, incident.version))
      .status(200)
      .json(incident)
  })

  app.post('/api/incidents/:incidentId/commands', (request, response) => {
    const body: unknown = request.body
    const parsedCommand = incidentCommandSchema.safeParse(body)
    if (!parsedCommand.success) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/validation-failed',
        code: 'validation-failed',
        title: 'Invalid incident command',
        status: 400,
        detail: 'The request body does not match an incident command.',
        requestId: getRequestId(request),
      })
      return
    }

    const command = parsedCommand.data
    const routeIncidentId = request.params['incidentId']
    const idempotencyKey = request.header('idempotency-key')
    const ifMatch = request.header('if-match')

    if (routeIncidentId !== command.incidentId) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/validation-failed',
        code: 'validation-failed',
        title: 'Incident identifier mismatch',
        status: 400,
        detail: 'The route and command must refer to the same incident.',
        requestId: getRequestId(request),
      })
      return
    }

    if (!idempotencyKey || idempotencyKey !== command.commandId) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/validation-failed',
        code: 'validation-failed',
        title: 'Invalid idempotency key',
        status: 400,
        detail: 'Idempotency-Key must match the command identifier.',
        requestId: getRequestId(request),
      })
      return
    }

    if (!ifMatch) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/precondition-required',
        code: 'precondition-required',
        title: 'Version precondition required',
        status: 428,
        detail: 'If-Match is required for incident commands.',
        requestId: getRequestId(request),
      })
      return
    }

    const expectedEtag = formatIncidentEtag(
      command.incidentId,
      command.expectedVersion,
    )
    if (ifMatch !== expectedEtag) {
      sendProblem(response, {
        type: 'https://react-resilience.dev/problems/validation-failed',
        code: 'validation-failed',
        title: 'Version precondition mismatch',
        status: 400,
        detail: 'If-Match must represent the command expectedVersion.',
        requestId: getRequestId(request),
      })
      return
    }

    const execution = executor.execute(command, dependencies.now())

    switch (execution.kind) {
      case 'completed': {
        const result = incidentCommandResultSchema.parse(execution.result)
        response
          .setHeader(
            'etag',
            formatIncidentEtag(result.incident.id, result.incident.version),
          )
          .status(200)
          .json(result)
        return
      }
      case 'not-found':
        sendProblem(response, {
          type: 'https://react-resilience.dev/problems/not-found',
          code: 'not-found',
          title: 'Incident not found',
          status: 404,
          detail: `Incident ${command.incidentId} was not found.`,
          requestId: getRequestId(request),
        })
        return
      case 'version-conflict':
        response.setHeader(
          'etag',
          formatIncidentEtag(
            execution.currentIncident.id,
            execution.currentIncident.version,
          ),
        )
        sendProblem(response, {
          type: 'https://react-resilience.dev/problems/version-conflict',
          code: 'version-conflict',
          title: 'Incident version changed',
          status: 412,
          detail: 'Reload the current incident before retrying this command.',
          requestId: getRequestId(request),
          currentIncident: execution.currentIncident,
        })
        return
      case 'invalid-transition':
        sendProblem(response, {
          type: 'https://react-resilience.dev/problems/invalid-transition',
          code: 'invalid-transition',
          title: 'Incident transition rejected',
          status: 409,
          detail: execution.detail,
          requestId: getRequestId(request),
          currentIncident: execution.currentIncident,
        })
        return
      case 'idempotency-conflict':
        sendProblem(response, {
          type: 'https://react-resilience.dev/problems/idempotency-conflict',
          code: 'idempotency-conflict',
          title: 'Idempotency key already used',
          status: 409,
          detail: 'The key belongs to a different incident command.',
          requestId: getRequestId(request),
        })
    }
  })

  app.use((request, response) => {
    sendProblem(response, {
      type: 'https://react-resilience.dev/problems/not-found',
      code: 'not-found',
      title: 'Route not found',
      status: 404,
      detail: `No route is registered for ${request.method} ${request.path}.`,
      requestId: getRequestId(request),
    })
  })

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof SyntaxError) {
        sendProblem(response, {
          type: 'https://react-resilience.dev/problems/validation-failed',
          code: 'validation-failed',
          title: 'Malformed JSON',
          status: 400,
          detail: 'The request body is not valid JSON.',
          requestId: getRequestId(request),
        })
        return
      }

      next(error)
    },
  )

  return app
}

function getRequestId(request: Request): string {
  return request.header('x-request-id') ?? 'request-id-unavailable'
}

function sendProblem(response: Response, input: ApiProblem): void {
  const problem = apiProblemSchema.parse(input)
  response.status(problem.status).type('application/problem+json').json(problem)
}

function parseStatus(value: unknown):
  | {
      success: true
      status: ReturnType<typeof incidentStatusSchema.parse> | undefined
    }
  | { success: false } {
  if (value === undefined) {
    return { success: true, status: undefined }
  }

  const parsed = incidentStatusSchema.safeParse(value)
  return parsed.success
    ? { success: true, status: parsed.data }
    : { success: false }
}
