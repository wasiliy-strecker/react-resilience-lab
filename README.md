# React Resilience Lab

[![CI](https://github.com/wasiliy-strecker/react-resilience-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/wasiliy-strecker/react-resilience-lab/actions/workflows/ci.yml)
![React 19](https://img.shields.io/badge/React-19.2-61dafb)
![Node.js 24](https://img.shields.io/badge/Node.js-24%20LTS-339933)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Production-minded React patterns for cancellation, race-free data fetching,
optimistic updates, conflict recovery, offline replay, and accessible failure
states.

The lab uses an incident operations console and an intentionally unreliable
Node.js API to make failure behavior reproducible. Every resilience claim is
designed to gain an executable proof as the project progresses.

## Why this project exists

Async interfaces often look correct on a stable local connection while hiding
failure modes that appear in production:

- an older response replaces data from a newer filter
- an optimistic change remains visible after the server rejects it
- reconnecting submits the same mutation more than once
- a version conflict silently overwrites another operator's work
- loading and error states remove context or strand keyboard focus

The repository isolates these behaviors in one small domain instead of hiding
them inside an unrelated product.

## Current foundation

The first milestone establishes:

- runtime-validated incident and command contracts with Zod
- a deterministic Express API boundary and health endpoint
- a responsive React incident console with a stable baseline profile
- strict TypeScript, type-aware ESLint, coverage thresholds, and CI

Fault injection, remote queries, mutation replay, and recovery semantics arrive
in focused pull requests so their design remains reviewable.

## Quick start

Requirements are Node.js 22.12 or newer and pnpm 11. Node.js 24 LTS is the
primary runtime.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The supporting API listens on
`http://127.0.0.1:3001`.

## Architecture

```mermaid
flowchart LR
    Browser[React incident console] --> Contracts[Shared runtime contracts]
    Browser -. upcoming query and outbox adapters .-> API[Fault API]
    API --> Contracts
    API --> Seed[Deterministic incident state]
```

The contracts package owns transport shapes, not application behavior. The web
application owns presentation and client orchestration. The API owns the
authoritative incident state and later fault injection.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm verify` runs the complete sequence. CI verifies Node.js 22, 24, and 26.

## Repository layout

```text
react-resilience-lab/
├── apps/
│   ├── fault-api/       Deterministic Node.js API and fault boundary
│   └── web/             React incident operations console
├── packages/
│   └── contracts/       Shared Zod schemas and inferred TypeScript types
└── .github/workflows/   Reproducible CI verification
```

## License

Copyright 2026 Wasiliy Strecker. Licensed under the
[Apache License 2.0](LICENSE).
