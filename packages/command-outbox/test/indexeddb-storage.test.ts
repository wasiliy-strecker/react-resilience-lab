import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { IndexedDbOutboxStorage, type OutboxEntry } from '../src/index.js'

interface Payload {
  value: string
}

describe('IndexedDbOutboxStorage', () => {
  it('persists serializable commands in sequence across storage instances', async () => {
    const databaseName = `outbox-${crypto.randomUUID()}`
    const first = new IndexedDbOutboxStorage<Payload>({ databaseName })
    await first.put(createEntry('command-2', 2))
    await first.put(createEntry('command-1', 1))
    await first.close()

    const reopened = new IndexedDbOutboxStorage<Payload>({ databaseName })
    expect((await reopened.list()).map((entry) => entry.id)).toEqual([
      'command-1',
      'command-2',
    ])

    await reopened.delete('command-1')
    expect((await reopened.list()).map((entry) => entry.id)).toEqual([
      'command-2',
    ])
    await reopened.close()
    await deleteDB(databaseName)
  })
})

function createEntry(id: string, sequence: number): OutboxEntry<Payload> {
  return {
    attemptCount: 0,
    enqueuedAt: '2026-07-22T12:00:00.000Z',
    failure: undefined,
    fingerprint: `${id}:fingerprint`,
    id,
    partitionKey: 'incident-a',
    payload: { value: id },
    sequence,
    status: 'pending',
  }
}
