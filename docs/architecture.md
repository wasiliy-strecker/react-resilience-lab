# Architecture decisions

React Resilience Lab separates transport contracts, authoritative state,
delivery mechanics, and presentation so each failure has one clear owner. The
application is intentionally small enough to review, while the boundaries are
the same ones needed in a larger product.

## Runtime topology

```mermaid
flowchart TB
    subgraph Browser
        View[Incident console]
        Query[TanStack Query cache]
        Projector[Optimistic projector]
        Outbox[CommandOutbox engine]
        Storage[(IndexedDB adapter)]
        View --> Query
        View --> Projector
        Projector --> Query
        Projector --> Outbox
        Outbox <--> Storage
    end

    subgraph Node
        HTTP[Express HTTP boundary]
        Injector[Fault injector]
        Executor[Command executor]
        Store[(Versioned incident store)]
        HTTP --> Injector
        HTTP --> Executor
        Executor --> Store
    end

    Contracts[Zod transport contracts]
    Query --> HTTP
    Outbox --> HTTP
    Contracts -. validates .-> Query
    Contracts -. validates .-> HTTP
```

## Dependency ownership

| Area                      | Owns                                                                                  | Does not own                       |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/contracts`      | HTTP payload schemas and inferred static types                                        | React state or command execution   |
| `packages/command-outbox` | persistence, entry state transitions, partition ordering, transport and storage ports | incident-specific payloads or HTTP |
| `apps/web`                | query identity, optimistic projection, reconciliation, recovery UI, focus             | authoritative business state       |
| `apps/fault-api`          | versions, preconditions, idempotency, deterministic faults                            | client retry or rendering policy   |

Dependencies point inward to contracts and ports. The generic outbox never
imports incident types. Its React entry point is separate, so the core can be
used without React.

## Read path

1. Status and fault profile form the complete TanStack Query key.
2. TanStack Query gives the query function an `AbortSignal`.
3. The API client forwards that signal to `fetch` without wrapping it.
4. Unknown response JSON is parsed by a Zod schema before entering the cache.
5. A refetch failure retains the last valid snapshot and becomes a visible UI
   state.

Cache identity prevents results for different selectors from sharing a slot.
Cancellation reduces wasted work and ensures this client stops observing the
superseded operation. It does not claim that every upstream intermediary stops
processing immediately.

## Command path

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant DB as IndexedDB
    participant Queue as Command outbox
    participant API

    User->>UI: Acknowledge version 3
    UI->>DB: Persist command and optimistic snapshot
    DB-->>UI: Commit accepted
    UI-->>User: Show acknowledged version 4
    Queue->>API: POST command, Idempotency-Key, If-Match v3
    alt accepted
        API-->>Queue: authoritative version 4
        Queue->>UI: Reconcile query caches
        Queue->>DB: Delete delivered entry
    else transient failure
        API-->>Queue: 503 and retry metadata
        Queue->>DB: Return entry to pending
    else version conflict
        API-->>Queue: 412 and current incident
        Queue->>DB: Persist blocked state and context
        Queue->>UI: Reconcile authoritative incident
        UI-->>User: Focus keep-or-rebase decision
    end
```

The optimistic state comes from the persisted envelope, not a closure held in
component memory. That makes reload recovery possible and lets a conflict
remove the optimistic projection as soon as authoritative state arrives.

## Key decisions

### Persist before delivery

The UI reports a command as accepted only after IndexedDB stores it. Network
delivery starts afterwards. A storage failure therefore blocks the command
instead of producing an optimistic state that cannot be recovered.

### Partition by aggregate

Incident ID is the queue partition key. The earliest command for one incident
must finish or be resolved before later commands for that incident can run. A
blocked incident does not stop other partitions.

### Reconcile instead of invalidating blindly

Successful and conflicting command responses contain an authoritative
incident. The adapter updates every compatible cached list immediately. This
avoids a temporary rollback to an older snapshot while a refetch is in flight.

### Make conflict recovery a new intent

A blocked command is never silently rewritten. Choosing retry creates a new
command ID against the displayed server version, removes the old command, and
then delivers the replacement. Choosing keep removes the blocked intent.

### Keep test controls out of the default API

The browser suite needs deterministic state. The reset route exists only when
`LAB_TEST_RESET_TOKEN` is configured and requires the matching header. A
normal API process does not register that route.

## Deliberate limits

- API state and idempotency records are in memory and do not coordinate across
  processes.
- IndexedDB has no multi-tab leader election or storage-quota recovery.
- The queue currently drains partition heads sequentially.
- Browser delivery is at-least-once. Exactly-once is not claimed.
- axe catches a useful class of accessibility defects, not every usability or
  assistive-technology issue.
