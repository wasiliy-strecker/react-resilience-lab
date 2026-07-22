export type OutboxStatus = 'pending' | 'sending' | 'blocked'

export type OutboxFailureKind = 'conflict' | 'rejected' | 'transient'

export interface OutboxFailure<TContext = unknown> {
  readonly kind: OutboxFailureKind
  readonly message: string
  readonly context?: TContext
  readonly retryAfterMs?: number
}

export interface OutboxEntry<TPayload, TContext = unknown> {
  readonly attemptCount: number
  readonly enqueuedAt: string
  readonly failure: OutboxFailure<TContext> | undefined
  readonly fingerprint: string
  readonly id: string
  readonly partitionKey: string
  readonly payload: TPayload
  readonly sequence: number
  readonly status: OutboxStatus
}

export interface EnqueueCommand<TPayload> {
  readonly fingerprint: string
  readonly id: string
  readonly partitionKey: string
  readonly payload: TPayload
}

export interface OutboxStorage<TPayload, TContext = unknown> {
  delete(id: string): Promise<void>
  list(): Promise<Array<OutboxEntry<TPayload, TContext>>>
  put(entry: OutboxEntry<TPayload, TContext>): Promise<void>
}

export type DeliveryOutcome<TResult, TContext = unknown> =
  | { readonly kind: 'delivered'; readonly result: TResult }
  | {
      readonly kind: 'retry'
      readonly message: string
      readonly retryAfterMs?: number
    }
  | {
      readonly kind: 'blocked'
      readonly message: string
      readonly reason: 'conflict' | 'rejected'
      readonly context?: TContext
    }

export interface OutboxTransport<TPayload, TResult, TContext = unknown> {
  deliver(
    entry: OutboxEntry<TPayload, TContext>,
  ): Promise<DeliveryOutcome<TResult, TContext>>
}

export type OutboxLifecycleEvent<TPayload, TResult, TContext = unknown> =
  | {
      readonly type: 'enqueued' | 'sending' | 'retry-scheduled' | 'blocked'
      readonly entry: OutboxEntry<TPayload, TContext>
    }
  | {
      readonly type: 'delivered'
      readonly entry: OutboxEntry<TPayload, TContext>
      readonly result: TResult
    }
  | {
      readonly type: 'discarded'
      readonly entry: OutboxEntry<TPayload, TContext>
    }

export interface CommandOutboxOptions<TPayload, TResult, TContext = unknown> {
  readonly isOnline?: () => boolean
  readonly now?: () => Date
  readonly storage: OutboxStorage<TPayload, TContext>
  readonly transport: OutboxTransport<TPayload, TResult, TContext>
}
