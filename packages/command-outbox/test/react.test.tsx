import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CommandOutbox, MemoryOutboxStorage } from '../src/index.js'
import { useCommandOutboxSnapshot } from '../src/react.js'

describe('useCommandOutboxSnapshot', () => {
  it('bridges stable external snapshots into React', async () => {
    const outbox = new CommandOutbox<{ value: string }, string>({
      storage: new MemoryOutboxStorage(),
      transport: {
        deliver: () => Promise.resolve({ kind: 'delivered', result: 'ok' }),
      },
    })
    await outbox.initialize()
    const { result, unmount } = renderHook(() =>
      useCommandOutboxSnapshot(outbox),
    )

    await act(async () => {
      await outbox.enqueue({
        fingerprint: 'command-1:value',
        id: 'command-1',
        partitionKey: 'incident-a',
        payload: { value: 'queued' },
      })
    })

    expect(result.current).toMatchObject([
      { id: 'command-1', status: 'pending' },
    ])
    unmount()
  })
})
