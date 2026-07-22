# Testing strategy

The suite chooses the narrowest boundary that can prove each guarantee. Pure
state transitions stay fast and deterministic, while integration and browser
tests are reserved for behavior that depends on real framework or platform
semantics.

## Evidence layers

| Layer                   | Boundary                                      | Examples                                                                           |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Contract tests          | unknown JSON to Zod schema                    | discriminated commands, problem details, invalid payload rejection                 |
| Unit tests              | one stateful component                        | incident versioning, idempotency records, outbox transitions, FIFO partitions      |
| React integration tests | component, query client, MSW, storage adapter | request cancellation, stale snapshot policy, optimistic projection, focus recovery |
| API integration tests   | Express app through HTTP                      | headers, `ETag`, `If-Match`, problem responses, replay semantics                   |
| Browser proofs          | React, IndexedDB, proxy, and live Node API    | reload during outage, reconnect replay, real conflict recovery, axe scan           |

Tests use injected clocks, identifiers, fault decisions, and memory adapters
where those dependencies are part of the subject. Timing-sensitive behavior is
asserted through observable state rather than arbitrary sleeps.

## Browser scenarios

`e2e/resilience.spec.ts` starts the API and web development servers through the
Playwright configuration. Each test receives a new browser context. The API
state is reset through an environment-enabled, token-gated test route.

The outage scenario deliberately aborts only API traffic. Static application
assets can reload, while list and command requests fail. This proves that the
optimistic incident is reconstructed from IndexedDB rather than surviving in
React memory. Dispatching the browser `online` event then exercises the same
replay hook used after a real reconnect.

The conflict scenario uses the API's conflict profile. The server performs an
actual concurrent update, returns its authoritative snapshot, and leaves the
persisted command blocked until the user selects a recovery action.

## Coverage policy

Vitest coverage thresholds are configured per package and enforced in CI.
Coverage is treated as a regression signal, not as proof by itself. Assertions
target externally observable guarantees such as command order, exact headers,
cache contents, persisted state, focus, and rendered recovery actions.

## Commands

```bash
pnpm verify
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

CI runs `pnpm verify` on Node.js 22, 24, and 26. A separate Node.js 24 job
installs Chromium and runs the integrated browser proofs.
