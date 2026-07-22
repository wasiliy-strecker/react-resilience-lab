import type {
  Incident,
  IncidentCommand,
  IncidentStatus,
} from '@react-resilience/contracts'

export type CommandApplication =
  | { kind: 'applied'; incident: Incident }
  | { kind: 'not-found' }
  | { kind: 'version-conflict'; currentIncident: Incident }
  | {
      kind: 'invalid-transition'
      currentIncident: Incident
      detail: string
    }

export class InMemoryIncidentStore {
  readonly #incidents: Map<string, Incident>

  constructor(seed: Incident[]) {
    this.#incidents = new Map(
      seed.map((incident) => [incident.id, structuredClone(incident)]),
    )
  }

  list(status?: IncidentStatus): Incident[] {
    return [...this.#incidents.values()]
      .filter((incident) => status === undefined || incident.status === status)
      .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
      .map((incident) => structuredClone(incident))
  }

  find(incidentId: string): Incident | undefined {
    const incident = this.#incidents.get(incidentId)
    return incident ? structuredClone(incident) : undefined
  }

  apply(command: IncidentCommand, now: Date): CommandApplication {
    const current = this.#incidents.get(command.incidentId)

    if (!current) {
      return { kind: 'not-found' }
    }

    if (current.version !== command.expectedVersion) {
      return {
        kind: 'version-conflict',
        currentIncident: structuredClone(current),
      }
    }

    const transitionError = validateTransition(current, command)
    if (transitionError) {
      return {
        kind: 'invalid-transition',
        currentIncident: structuredClone(current),
        detail: transitionError,
      }
    }

    const updated = applyCommand(current, command, now)
    this.#incidents.set(updated.id, updated)

    return { kind: 'applied', incident: structuredClone(updated) }
  }

  simulateConcurrentUpdate(
    incidentId: string,
    now: Date,
  ): Incident | undefined {
    const current = this.#incidents.get(incidentId)
    if (!current) {
      return undefined
    }

    const updated: Incident = {
      ...current,
      assignee: current.assignee ?? 'External operator',
      updatedAt: now.toISOString(),
      version: current.version + 1,
    }
    this.#incidents.set(incidentId, updated)
    return structuredClone(updated)
  }
}

function validateTransition(
  incident: Incident,
  command: IncidentCommand,
): string | undefined {
  if (incident.status === 'resolved') {
    return 'Resolved incidents are immutable.'
  }

  if (command.type === 'acknowledge' && incident.status !== 'open') {
    return 'Only open incidents can be acknowledged.'
  }

  if (command.type === 'resolve' && incident.status !== 'acknowledged') {
    return 'An incident must be acknowledged before it can be resolved.'
  }

  return undefined
}

function applyCommand(
  incident: Incident,
  command: IncidentCommand,
  now: Date,
): Incident {
  const base: Incident = {
    ...incident,
    updatedAt: now.toISOString(),
    version: incident.version + 1,
  }

  switch (command.type) {
    case 'acknowledge':
      return { ...base, status: 'acknowledged' }
    case 'assign':
      return { ...base, assignee: command.assignee }
    case 'resolve':
      return {
        ...base,
        status: 'resolved',
        resolutionNote: command.resolutionNote,
      }
  }
}
