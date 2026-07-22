# Adversarial API failure model

The fault API is a deterministic test partner for the React client. It makes
latency, transient failures, and concurrent writes repeatable without asking
tests to depend on wall-clock timing or random probabilities.

## Selecting a profile

Send `X-Lab-Fault-Profile` with an API request. Omitting the header selects
`normal`.

| Profile    |  Delay | Read behavior                     | Command behavior                                        |
| ---------- | -----: | --------------------------------- | ------------------------------------------------------- |
| `normal`   |  24 ms | succeeds                          | uses current state                                      |
| `slow`     | 850 ms | succeeds                          | uses current state                                      |
| `flaky`    | 120 ms | every third request returns `503` | every third request returns `503`                       |
| `conflict` |  80 ms | succeeds                          | advances the target version before applying the command |

Each application instance owns its fault sequence. Creating a new app resets
the flaky counter, which keeps integration tests independent and reproducible.
The health endpoint is deliberately outside the fault boundary.

Successful and rejected fault-boundary responses expose:

- `X-Lab-Fault-Profile`, the selected profile
- `X-Lab-Delay-Ms`, the configured delay
- `Vary: X-Lab-Fault-Profile`, so caches cannot mix profiles

A flaky rejection uses RFC-style problem details, includes
`Retry-After: 1`, and provides `retryAfterMs: 1000` for clients that prefer a
numeric delay.

## Conditional command protocol

Commands are sent to `POST /api/incidents/:incidentId/commands`. A valid request
contains the same identity and version in three places:

```http
POST /api/incidents/inc-1042/commands
Idempotency-Key: 96721f40-ebcd-4b48-911b-f5609b39bff8
If-Match: "inc-1042-v3"
Content-Type: application/json

{
  "commandId": "96721f40-ebcd-4b48-911b-f5609b39bff8",
  "incidentId": "inc-1042",
  "expectedVersion": 3,
  "type": "acknowledge"
}
```

The route identifier must match `incidentId`, `Idempotency-Key` must match
`commandId`, and `If-Match` must encode `expectedVersion`. Missing version
preconditions return `428`. Stale commands return `412` with the authoritative
incident snapshot and its current `ETag`.

Completed commands are remembered by idempotency key. Repeating the same
command returns its original incident result with `replayed: true`. Reusing the
key for different command content returns `409`. Rejected commands do not
reserve the key and can be corrected and retried.

## Guarantees

- Fault behavior is deterministic for one running API instance.
- Incident snapshots are copied at the store boundary so callers cannot mutate
  authoritative state by reference.
- Version checks and command application are synchronous within the in-memory
  store.
- A successful idempotent replay does not execute the state transition twice.
- Problem responses conform to the shared runtime schema.

## Deliberate non-goals

This milestone does not claim durable or distributed idempotency. Incident
state and replay records are lost when the Node.js process restarts, and multiple
API processes do not coordinate. The lab also does not claim exactly-once
delivery. A later client outbox will demonstrate at-least-once transport with
idempotent handling, explicit conflict recovery, and honest crash boundaries.

The profiles are controlled experiments, not a general-purpose chaos platform.
Random packet loss and infrastructure faults would make the core race and
recovery tests harder to reproduce.
