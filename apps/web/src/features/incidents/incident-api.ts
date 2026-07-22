import {
  apiProblemSchema,
  incidentCommandResultSchema,
  incidentListResponseSchema,
  type ApiProblem,
  type FaultProfile,
  type IncidentListResponse,
  type IncidentCommand,
  type IncidentCommandResult,
  type IncidentStatus,
} from '@react-resilience/contracts'

export type StatusFilter = 'all' | IncidentStatus

export interface FetchIncidentListInput {
  faultProfile: FaultProfile
  signal: AbortSignal
  status: StatusFilter
  fetcher?: typeof fetch
  origin?: string
}

export interface SendIncidentCommandInput {
  command: IncidentCommand
  faultProfile: FaultProfile
  fetcher?: typeof fetch
  origin?: string
  signal?: AbortSignal
}

export class IncidentApiError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail)
    this.name = 'IncidentApiError'
  }
}

export async function fetchIncidentList({
  faultProfile,
  signal,
  status,
  fetcher = globalThis.fetch,
  origin = globalThis.location.origin,
}: FetchIncidentListInput): Promise<IncidentListResponse> {
  const url = new URL('/api/incidents', origin)
  if (status !== 'all') {
    url.searchParams.set('status', status)
  }

  const response = await fetcher(url, {
    headers: {
      accept: 'application/json, application/problem+json',
      'x-lab-fault-profile': faultProfile,
    },
    signal,
  })
  const payload: unknown = await response.json()

  if (!response.ok) {
    throwResponseError(response, payload)
  }

  return incidentListResponseSchema.parse(payload)
}

export async function sendIncidentCommand({
  command,
  faultProfile,
  fetcher = globalThis.fetch,
  origin = globalThis.location.origin,
  signal,
}: SendIncidentCommandInput): Promise<IncidentCommandResult> {
  const url = new URL(`/api/incidents/${command.incidentId}/commands`, origin)
  const response = await fetcher(url, {
    body: JSON.stringify(command),
    headers: {
      accept: 'application/json, application/problem+json',
      'content-type': 'application/json',
      'idempotency-key': command.commandId,
      'if-match': `"${command.incidentId}-v${command.expectedVersion}"`,
      'x-lab-fault-profile': faultProfile,
    },
    method: 'POST',
    ...(signal ? { signal } : {}),
  })
  const payload: unknown = await response.json()

  if (!response.ok) {
    throwResponseError(response, payload)
  }

  return incidentCommandResultSchema.parse(payload)
}

function throwResponseError(response: Response, payload: unknown): never {
  const parsedProblem = apiProblemSchema.safeParse(payload)
  if (parsedProblem.success) {
    throw new IncidentApiError(parsedProblem.data)
  }

  throw new Error(`Incident API returned an invalid ${response.status} body`)
}
