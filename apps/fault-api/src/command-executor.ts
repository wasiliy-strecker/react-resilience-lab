import type {
  Incident,
  IncidentCommand,
  IncidentCommandResult,
} from '@react-resilience/contracts'

import type {
  CommandApplication,
  InMemoryIncidentStore,
} from './incident-store.js'

export type CommandExecution =
  | { kind: 'completed'; result: IncidentCommandResult }
  | { kind: 'idempotency-conflict' }
  | Exclude<CommandApplication, { kind: 'applied' }>

interface IdempotencyRecord {
  fingerprint: string
  incident: Incident
}

export class IncidentCommandExecutor {
  readonly #records = new Map<string, IdempotencyRecord>()

  constructor(private readonly store: InMemoryIncidentStore) {}

  execute(command: IncidentCommand, now: Date): CommandExecution {
    const fingerprint = JSON.stringify(command)
    const existing = this.#records.get(command.commandId)

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { kind: 'idempotency-conflict' }
      }

      return {
        kind: 'completed',
        result: {
          incident: structuredClone(existing.incident),
          replayed: true,
        },
      }
    }

    const application = this.store.apply(command, now)
    if (application.kind !== 'applied') {
      return application
    }

    this.#records.set(command.commandId, {
      fingerprint,
      incident: structuredClone(application.incident),
    })

    return {
      kind: 'completed',
      result: {
        incident: application.incident,
        replayed: false,
      },
    }
  }
}
