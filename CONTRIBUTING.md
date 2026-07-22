# Contributing

React Resilience Lab is organized around observable failure modes. A change
should state which behavior it protects, what guarantee it adds, and where that
guarantee is tested.

## Local verification

Use Node.js 24 LTS and pnpm 11 when possible.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Focused commands are available in each workspace package. Run the complete
verification before opening a pull request.

## Change guidelines

- Keep transport schemas in `packages/contracts`.
- Keep authoritative incident behavior in `apps/fault-api`.
- Keep React rendering and orchestration in `apps/web`.
- Prefer deterministic clocks, identifiers, and fault schedules in tests.
- Do not claim exactly-once delivery for browser-to-server mutations.
- Include keyboard and assistive-technology behavior in UI acceptance tests.

Pull requests should explain the failure mode, the chosen boundary, and the
commands used for verification.
