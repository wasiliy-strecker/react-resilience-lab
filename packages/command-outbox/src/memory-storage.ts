import type { OutboxEntry, OutboxStorage } from './types.js'

export class MemoryOutboxStorage<
  TPayload,
  TContext = unknown,
> implements OutboxStorage<TPayload, TContext> {
  readonly #entries = new Map<string, OutboxEntry<TPayload, TContext>>()

  delete(id: string): Promise<void> {
    this.#entries.delete(id)
    return Promise.resolve()
  }

  list(): Promise<Array<OutboxEntry<TPayload, TContext>>> {
    return Promise.resolve(
      [...this.#entries.values()]
        .sort((left, right) => left.sequence - right.sequence)
        .map(cloneEntry),
    )
  }

  put(entry: OutboxEntry<TPayload, TContext>): Promise<void> {
    this.#entries.set(entry.id, cloneEntry(entry))
    return Promise.resolve()
  }
}

function cloneEntry<TPayload, TContext>(
  entry: OutboxEntry<TPayload, TContext>,
): OutboxEntry<TPayload, TContext> {
  return structuredClone(entry)
}
