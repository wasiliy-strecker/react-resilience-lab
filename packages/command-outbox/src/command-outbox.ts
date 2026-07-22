import type {
  CommandOutboxOptions,
  DeliveryOutcome,
  EnqueueCommand,
  OutboxEntry,
  OutboxLifecycleEvent,
} from './types.js'

export class OutboxIdentityConflictError extends Error {
  constructor(readonly commandId: string) {
    super(`Command ${commandId} is already queued with different content`)
    this.name = 'OutboxIdentityConflictError'
  }
}

export class CommandOutbox<TPayload, TResult, TContext = unknown> {
  readonly #eventListeners = new Set<
    (event: OutboxLifecycleEvent<TPayload, TResult, TContext>) => void
  >()
  readonly #inFlightEnqueues = new Map<
    string,
    {
      fingerprint: string
      promise: Promise<OutboxEntry<TPayload, TContext>>
    }
  >()
  readonly #isOnline: () => boolean
  readonly #listeners = new Set<() => void>()
  readonly #now: () => Date
  readonly #options: CommandOutboxOptions<TPayload, TResult, TContext>
  #flushPromise: Promise<void> | undefined
  #flushRequested = false
  #initialization: Promise<void> | undefined
  #nextSequence = 1
  #snapshot: ReadonlyArray<OutboxEntry<TPayload, TContext>> = []

  constructor(options: CommandOutboxOptions<TPayload, TResult, TContext>) {
    this.#options = options
    this.#isOnline = options.isOnline ?? (() => true)
    this.#now = options.now ?? (() => new Date())
  }

  readonly getSnapshot = (): ReadonlyArray<OutboxEntry<TPayload, TContext>> =>
    this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribeEvents(
    listener: (
      event: OutboxLifecycleEvent<TPayload, TResult, TContext>,
    ) => void,
  ): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  async initialize(): Promise<void> {
    this.#initialization ??= this.#hydrate()
    await this.#initialization
  }

  async enqueue(
    input: EnqueueCommand<TPayload>,
  ): Promise<OutboxEntry<TPayload, TContext>> {
    await this.initialize()

    const existing = this.#snapshot.find((entry) => entry.id === input.id)
    if (existing) {
      this.#assertSameFingerprint(existing.fingerprint, input)
      return existing
    }

    const inFlight = this.#inFlightEnqueues.get(input.id)
    if (inFlight) {
      this.#assertSameFingerprint(inFlight.fingerprint, input)
      return inFlight.promise
    }

    const promise = this.#insert(input)
    this.#inFlightEnqueues.set(input.id, {
      fingerprint: input.fingerprint,
      promise,
    })

    try {
      return await promise
    } finally {
      this.#inFlightEnqueues.delete(input.id)
    }
  }

  async discard(id: string): Promise<void> {
    await this.initialize()
    const existing = this.#snapshot.find((entry) => entry.id === id)
    if (!existing) {
      return
    }

    await this.#options.storage.delete(id)
    this.#setSnapshot(this.#snapshot.filter((entry) => entry.id !== id))
    this.#emitEvent({ type: 'discarded', entry: existing })
  }

  async flush(): Promise<void> {
    await this.initialize()
    this.#flushRequested = true

    if (this.#flushPromise) {
      await this.#flushPromise
      return
    }

    const running = this.#runFlush()
    this.#flushPromise = running
    try {
      await running
    } finally {
      if (this.#flushPromise === running) {
        this.#flushPromise = undefined
      }
    }
  }

  async #hydrate(): Promise<void> {
    const stored = await this.#options.storage.list()
    const recovered = stored
      .map((entry) =>
        entry.status === 'sending'
          ? { ...entry, status: 'pending' as const }
          : entry,
      )
      .sort((left, right) => left.sequence - right.sequence)

    await Promise.all(
      recovered
        .filter(
          (entry) =>
            stored.find((candidate) => candidate.id === entry.id)?.status ===
            'sending',
        )
        .map((entry) => this.#options.storage.put(entry)),
    )
    this.#nextSequence =
      recovered.reduce(
        (highest, entry) => Math.max(highest, entry.sequence),
        0,
      ) + 1
    this.#setSnapshot(recovered)
  }

  async #insert(
    input: EnqueueCommand<TPayload>,
  ): Promise<OutboxEntry<TPayload, TContext>> {
    const sequence = this.#nextSequence
    this.#nextSequence += 1
    const entry: OutboxEntry<TPayload, TContext> = {
      attemptCount: 0,
      enqueuedAt: this.#now().toISOString(),
      failure: undefined,
      fingerprint: input.fingerprint,
      id: input.id,
      partitionKey: input.partitionKey,
      payload: input.payload,
      sequence,
      status: 'pending',
    }

    await this.#options.storage.put(entry)
    this.#setSnapshot([...this.#snapshot, entry])
    this.#emitEvent({ type: 'enqueued', entry })
    return entry
  }

  async #runFlush(): Promise<void> {
    do {
      this.#flushRequested = false
      await this.#drainOnce()
    } while (this.#flushRequested && this.#isOnline())
  }

  async #drainOnce(): Promise<void> {
    const attempted = new Set<string>()

    while (this.#isOnline()) {
      const candidate = this.#snapshot.find(
        (entry) =>
          entry.status === 'pending' &&
          !attempted.has(entry.id) &&
          this.#isPartitionHead(entry),
      )
      if (!candidate) {
        return
      }

      attempted.add(candidate.id)
      await this.#deliver(candidate)
    }
  }

  #isPartitionHead(entry: OutboxEntry<TPayload, TContext>): boolean {
    return !this.#snapshot.some(
      (candidate) =>
        candidate.partitionKey === entry.partitionKey &&
        candidate.sequence < entry.sequence,
    )
  }

  async #deliver(entry: OutboxEntry<TPayload, TContext>): Promise<void> {
    const sending: OutboxEntry<TPayload, TContext> = {
      ...entry,
      attemptCount: entry.attemptCount + 1,
      failure: undefined,
      status: 'sending',
    }
    await this.#replace(sending)
    this.#emitEvent({ type: 'sending', entry: sending })

    let outcome: DeliveryOutcome<TResult, TContext>
    try {
      outcome = await this.#options.transport.deliver(sending)
    } catch (error) {
      outcome = {
        kind: 'retry',
        message:
          error instanceof Error ? error.message : 'Command transport failed',
      }
    }

    switch (outcome.kind) {
      case 'delivered':
        await this.#options.storage.delete(sending.id)
        this.#setSnapshot(
          this.#snapshot.filter((candidate) => candidate.id !== sending.id),
        )
        this.#emitEvent({
          type: 'delivered',
          entry: sending,
          result: outcome.result,
        })
        return
      case 'retry': {
        const pending: OutboxEntry<TPayload, TContext> = {
          ...sending,
          failure: {
            kind: 'transient',
            message: outcome.message,
            ...(outcome.retryAfterMs === undefined
              ? {}
              : { retryAfterMs: outcome.retryAfterMs }),
          },
          status: 'pending',
        }
        await this.#replace(pending)
        this.#emitEvent({ type: 'retry-scheduled', entry: pending })
        return
      }
      case 'blocked': {
        const blocked: OutboxEntry<TPayload, TContext> = {
          ...sending,
          failure: {
            kind: outcome.reason,
            message: outcome.message,
            ...(outcome.context === undefined
              ? {}
              : { context: outcome.context }),
          },
          status: 'blocked',
        }
        await this.#replace(blocked)
        this.#emitEvent({ type: 'blocked', entry: blocked })
      }
    }
  }

  async #replace(entry: OutboxEntry<TPayload, TContext>): Promise<void> {
    await this.#options.storage.put(entry)
    this.#setSnapshot(
      this.#snapshot.map((candidate) =>
        candidate.id === entry.id ? entry : candidate,
      ),
    )
  }

  #assertSameFingerprint(
    fingerprint: string,
    input: EnqueueCommand<TPayload>,
  ): void {
    if (fingerprint !== input.fingerprint) {
      throw new OutboxIdentityConflictError(input.id)
    }
  }

  #setSnapshot(entries: ReadonlyArray<OutboxEntry<TPayload, TContext>>): void {
    this.#snapshot = entries
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #emitEvent(event: OutboxLifecycleEvent<TPayload, TResult, TContext>): void {
    for (const listener of this.#eventListeners) {
      listener(event)
    }
  }
}
