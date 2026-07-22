import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createIncidentOutbox, type IncidentOutbox } from './incident-outbox.js'

interface IncidentOutboxContextValue {
  outbox: IncidentOutbox
  storageError: Error | null
}

const IncidentOutboxContext = createContext<IncidentOutboxContextValue | null>(
  null,
)

export interface IncidentOutboxProviderProps {
  children: ReactNode
  outbox?: IncidentOutbox
}

export function IncidentOutboxProvider({
  children,
  outbox,
}: IncidentOutboxProviderProps) {
  const queryClient = useQueryClient()
  const [activeOutbox] = useState(
    () =>
      outbox ??
      createIncidentOutbox({
        isOnline: () => globalThis.navigator.onLine,
        queryClient,
      }),
  )
  const [storageError, setStorageError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const initialize = async () => {
      try {
        await activeOutbox.initialize()
        await activeOutbox.flush()
      } catch (error) {
        if (active) {
          setStorageError(asError(error))
        }
      }
    }
    const flushAfterReconnect = () => {
      void activeOutbox.flush().catch((error: unknown) => {
        if (active) {
          setStorageError(asError(error))
        }
      })
    }
    const scheduleRetry = () => {
      if (retryTimer) {
        globalThis.clearTimeout(retryTimer)
        retryTimer = undefined
      }

      const retryAfterMs = activeOutbox
        .getSnapshot()
        .filter(
          (entry) =>
            entry.status === 'pending' &&
            entry.failure?.kind === 'transient' &&
            entry.failure.retryAfterMs !== undefined,
        )
        .reduce<number | undefined>(
          (shortest, entry) =>
            shortest === undefined
              ? entry.failure?.retryAfterMs
              : Math.min(shortest, entry.failure?.retryAfterMs ?? shortest),
          undefined,
        )

      if (retryAfterMs !== undefined) {
        retryTimer = globalThis.setTimeout(flushAfterReconnect, retryAfterMs)
      }
    }

    void initialize()
    const unsubscribe = activeOutbox.subscribe(scheduleRetry)
    scheduleRetry()
    globalThis.addEventListener('online', flushAfterReconnect)

    return () => {
      active = false
      if (retryTimer) {
        globalThis.clearTimeout(retryTimer)
      }
      unsubscribe()
      globalThis.removeEventListener('online', flushAfterReconnect)
    }
  }, [activeOutbox])

  return (
    <IncidentOutboxContext.Provider
      value={{ outbox: activeOutbox, storageError }}
    >
      {children}
    </IncidentOutboxContext.Provider>
  )
}

export function useIncidentOutbox(): IncidentOutboxContextValue {
  const context = useContext(IncidentOutboxContext)
  if (!context) {
    throw new Error('IncidentOutboxProvider is missing')
  }
  return context
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Command outbox failed')
}
