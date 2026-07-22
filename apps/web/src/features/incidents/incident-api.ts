import {
  apiProblemSchema,
  incidentListResponseSchema,
  type ApiProblem,
  type FaultProfile,
  type IncidentListResponse,
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
    const parsedProblem = apiProblemSchema.safeParse(payload)
    if (parsedProblem.success) {
      throw new IncidentApiError(parsedProblem.data)
    }

    throw new Error(`Incident API returned an invalid ${response.status} body`)
  }

  return incidentListResponseSchema.parse(payload)
}
