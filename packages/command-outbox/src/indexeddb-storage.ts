import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { OutboxEntry, OutboxStorage } from './types.js'

interface CommandOutboxSchema<TPayload, TContext> extends DBSchema {
  commands: {
    key: string
    value: OutboxEntry<TPayload, TContext>
    indexes: { 'by-sequence': number }
  }
}

export interface IndexedDbOutboxStorageOptions {
  readonly databaseName?: string
}

export class IndexedDbOutboxStorage<
  TPayload,
  TContext = unknown,
> implements OutboxStorage<TPayload, TContext> {
  readonly #database: Promise<
    IDBPDatabase<CommandOutboxSchema<TPayload, TContext>>
  >

  constructor(options: IndexedDbOutboxStorageOptions = {}) {
    this.#database = openDB<CommandOutboxSchema<TPayload, TContext>>(
      options.databaseName ?? 'react-resilience-command-outbox',
      1,
      {
        upgrade(database) {
          const store = database.createObjectStore('commands', {
            keyPath: 'id',
          })
          store.createIndex('by-sequence', 'sequence')
        },
      },
    )
  }

  async close(): Promise<void> {
    const database = await this.#database
    database.close()
  }

  async delete(id: string): Promise<void> {
    const database = await this.#database
    await database.delete('commands', id)
  }

  async list(): Promise<Array<OutboxEntry<TPayload, TContext>>> {
    const database = await this.#database
    return database.getAllFromIndex('commands', 'by-sequence')
  }

  async put(entry: OutboxEntry<TPayload, TContext>): Promise<void> {
    const database = await this.#database
    await database.put('commands', structuredClone(entry))
  }
}
