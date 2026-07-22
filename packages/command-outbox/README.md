# `@react-resilience/command-outbox`

A framework-light, persistent command queue for at-least-once browser delivery.
The core does not depend on the incident domain or TanStack Query.

```ts
const outbox = new CommandOutbox({
  storage: new IndexedDbOutboxStorage(),
  transport: {
    async deliver(entry) {
      const result = await commandApi.send(entry.payload)
      return { kind: 'delivered', result }
    },
  },
})

await outbox.initialize()
await outbox.enqueue({
  id: command.id,
  partitionKey: command.aggregateId,
  fingerprint: canonicalFingerprint(command),
  payload: command,
})
await outbox.flush()
```

## Public pieces

- `CommandOutbox`, the lifecycle and partition scheduler
- `OutboxStorage`, the replaceable persistence port
- `OutboxTransport`, the explicit delivery-outcome port
- `MemoryOutboxStorage`, useful for unit tests and non-durable workflows
- `IndexedDbOutboxStorage`, the durable browser adapter
- `useCommandOutboxSnapshot`, available from the `/react` export

The engine coalesces concurrent flush calls, recovers interrupted `sending`
entries as `pending`, processes FIFO within each partition, and allows blocked
partitions to coexist with deliverable work in other partitions.

See the repository-level [outbox semantics](../../docs/outbox-semantics.md) for
failure guarantees, crash boundaries, and deliberate limits.
