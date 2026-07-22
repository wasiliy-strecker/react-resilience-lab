import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import type { FaultProfile } from '@react-resilience/contracts'

import { fetchIncidentList, type StatusFilter } from './incident-api.js'

export const incidentQueryKeys = {
  all: ['incidents'] as const,
  list: (status: StatusFilter, faultProfile: FaultProfile) =>
    [...incidentQueryKeys.all, 'list', { faultProfile, status }] as const,
}

export function incidentListQueryOptions(
  status: StatusFilter,
  faultProfile: FaultProfile,
) {
  return queryOptions({
    queryKey: incidentQueryKeys.list(status, faultProfile),
    queryFn: ({ signal }) =>
      fetchIncidentList({ faultProfile, signal, status }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 10_000,
  })
}
