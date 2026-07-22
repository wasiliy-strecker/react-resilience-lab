import { describe, expect, it, vi } from 'vitest'

import {
  CommandOutbox,
  MemoryOutboxStorage,
  OutboxIdentityConflictError,
  type DeliveryOutcome,
  type EnqueueCommand,
  type OutboxEntry,
  type OutboxLifecycleEvent,
} from '../src/index.js'

interface TestPayload {
  action: string
}

interface TestResult {
  accepted: string
}

interface TestContext {
  version: number
}

const now = () => new Date('2026-07-22T12:00:00.000Z')

describe('CommandOutbox', () => {
  it('recovers interrupted sends as pending work during hydration', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    await storage.put(
      createEntry({
        id: 'command-2',
        sequence: 2,
        status: 'sending',
      }),
    )
    await storage.put(createEntry({ id: 'command-1', sequence: 1 }))
    const outbox = createOutbox(storage, () =>
      Promise.resolve(delivered('unused')),
    )

    await outbox.initialize()

    expect(
      outbox.getSnapshot().map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: 'command-1', status: 'pending' },
      { id: 'command-2', status: 'pending' },
    ])
    expect((await storage.list())[1]?.status).toBe('pending')
  })

  it('deduplicates concurrent enqueue calls and rejects identity reuse', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    const outbox = createOutbox(storage, () =>
      Promise.resolve(delivered('unused')),
    )
    const input = createInput('command-1', 'incident-a')
    const listener = vi.fn()
    const events: Array<
      OutboxLifecycleEvent<TestPayload, TestResult, TestContext>
    > = []
    const unsubscribe = outbox.subscribe(listener)
    const unsubscribeEvents = outbox.subscribeEvents((event) =>
      events.push(event),
    )

    const [first, duplicate] = await Promise.all([
      outbox.enqueue(input),
      outbox.enqueue(input),
    ])

    expect(first).toEqual(duplicate)
    expect(outbox.getSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalled()
    expect(events.map((event) => event.type)).toEqual(['enqueued'])
    await expect(
      outbox.enqueue({ ...input, fingerprint: 'different-content' }),
    ).rejects.toBeInstanceOf(OutboxIdentityConflictError)

    unsubscribe()
    unsubscribeEvents()
  })

  it('keeps FIFO within a partition while a conflict leaves others moving', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    const sent: string[] = []
    const outbox = createOutbox(storage, (entry) => {
      sent.push(entry.id)
      if (entry.id === 'a-1') {
        return Promise.resolve({
          context: { version: 4 },
          kind: 'blocked',
          message: 'Incident changed',
          reason: 'conflict',
        })
      }
      return Promise.resolve(delivered(entry.id))
    })
    await outbox.enqueue(createInput('a-1', 'incident-a'))
    await outbox.enqueue(createInput('a-2', 'incident-a'))
    await outbox.enqueue(createInput('b-1', 'incident-b'))

    await outbox.flush()

    expect(sent).toEqual(['a-1', 'b-1'])
    expect(
      outbox.getSnapshot().map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: 'a-1', status: 'blocked' },
      { id: 'a-2', status: 'pending' },
    ])
    expect(outbox.getSnapshot()[0]?.failure).toMatchObject({
      context: { version: 4 },
      kind: 'conflict',
    })

    await outbox.flush()
    expect(sent).toEqual(['a-1', 'b-1'])

    await outbox.discard('a-1')
    await outbox.flush()
    expect(sent).toEqual(['a-1', 'b-1', 'a-2'])
  })

  it('retries transport uncertainty with the same command identity', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    const sent: string[] = []
    let fail = true
    const outbox = createOutbox(storage, (entry) => {
      sent.push(entry.id)
      if (fail) {
        fail = false
        return Promise.reject(new Error('Connection closed after send'))
      }
      return Promise.resolve(delivered(entry.id))
    })
    await outbox.enqueue(createInput('command-1', 'incident-a'))

    await outbox.flush()

    expect(outbox.getSnapshot()[0]).toMatchObject({
      attemptCount: 1,
      failure: {
        kind: 'transient',
        message: 'Connection closed after send',
      },
      id: 'command-1',
      status: 'pending',
    })

    await outbox.flush()

    expect(sent).toEqual(['command-1', 'command-1'])
    expect(outbox.getSnapshot()).toEqual([])
  })

  it('persists work while offline and delivers after connectivity returns', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    const deliver = vi.fn(() => Promise.resolve(delivered('command-1')))
    let online = false
    const outbox = new CommandOutbox<TestPayload, TestResult, TestContext>({
      isOnline: () => online,
      now,
      storage,
      transport: { deliver },
    })
    await outbox.enqueue(createInput('command-1', 'incident-a'))

    await outbox.flush()

    expect(deliver).not.toHaveBeenCalled()
    expect(await storage.list()).toHaveLength(1)

    online = true
    await outbox.flush()

    expect(deliver).toHaveBeenCalledOnce()
    expect(await storage.list()).toEqual([])
  })

  it('stores explicit retry metadata and ignores unknown discards', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    const outbox = createOutbox(storage, () =>
      Promise.resolve({
        kind: 'retry',
        message: 'Try later',
        retryAfterMs: 1_500,
      }),
    )
    await outbox.enqueue(createInput('command-1', 'incident-a'))

    await outbox.flush()
    await outbox.discard('missing')

    expect(outbox.getSnapshot()[0]?.failure).toEqual({
      kind: 'transient',
      message: 'Try later',
      retryAfterMs: 1_500,
    })
  })

  it('coalesces concurrent flush requests into one delivery', async () => {
    const storage = new MemoryOutboxStorage<TestPayload, TestContext>()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deliver = vi.fn(async () => {
      markStarted?.()
      await gate
      return delivered('command-1')
    })
    const outbox = createOutbox(storage, deliver)
    await outbox.enqueue(createInput('command-1', 'incident-a'))

    const first = outbox.flush()
    await started
    const second = outbox.flush()
    release?.()
    await Promise.all([first, second])

    expect(deliver).toHaveBeenCalledOnce()
  })
})

function createOutbox(
  storage: MemoryOutboxStorage<TestPayload, TestContext>,
  deliverCommand: (
    entry: OutboxEntry<TestPayload, TestContext>,
  ) => Promise<DeliveryOutcome<TestResult, TestContext>>,
) {
  return new CommandOutbox<TestPayload, TestResult, TestContext>({
    now,
    storage,
    transport: { deliver: deliverCommand },
  })
}

function createInput(
  id: string,
  partitionKey: string,
): EnqueueCommand<TestPayload> {
  return {
    fingerprint: `${id}:${partitionKey}:acknowledge`,
    id,
    partitionKey,
    payload: { action: 'acknowledge' },
  }
}

function createEntry(
  overrides: Partial<OutboxEntry<TestPayload, TestContext>> = {},
): OutboxEntry<TestPayload, TestContext> {
  return {
    attemptCount: 0,
    enqueuedAt: '2026-07-22T12:00:00.000Z',
    failure: undefined,
    fingerprint: 'fingerprint',
    id: 'command-1',
    partitionKey: 'incident-a',
    payload: { action: 'acknowledge' },
    sequence: 1,
    status: 'pending',
    ...overrides,
  }
}

function delivered(accepted: string): DeliveryOutcome<TestResult, TestContext> {
  return { kind: 'delivered', result: { accepted } }
}
