import { useSyncExternalStore } from 'react'

import type { CommandOutbox } from './command-outbox.js'
import type { OutboxEntry } from './types.js'

export function useCommandOutboxSnapshot<TPayload, TResult, TContext = unknown>(
  outbox: CommandOutbox<TPayload, TResult, TContext>,
): ReadonlyArray<OutboxEntry<TPayload, TContext>> {
  return useSyncExternalStore(
    outbox.subscribe,
    outbox.getSnapshot,
    outbox.getSnapshot,
  )
}
