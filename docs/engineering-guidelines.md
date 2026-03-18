# Engineering Guidelines

## Stack
- Runtime: Node 22+
- Language: TypeScript with `strict` mode
- HTTP: Hono
- Tests: Vitest
- Formatting/Linting: Biome

## Architecture
- Keep three layers explicit:
  - `src/core/`: contracts, parsing, rendering, domain logic, storage abstractions
  - `src/server/`: HTTP routes and server bootstrapping
  - `src/cli/`: command parsing, config, local mapping, and HTTP client behavior
- Domain logic should live in `src/core/`, not inside route handlers or CLI commands.
- Treat `page_id` as the durable identity. `slug` is a mutable public alias.
- Keep storage pluggable. File-backed storage is acceptable for local development and tests. Hosted backends can come later.

## TypeScript Rules
- Never use `any`.
- Prefer explicit return types for exported functions.
- Validate all untrusted input with Zod.
- Keep public data shapes in a shared contract module so CLI and server do not drift.

## Testing Rules
- New behavior requires tests.
- Cover both:
  - core/domain behavior
  - integration behavior through the HTTP app and CLI where practical
- No network calls in unit tests.
- Prefer real file-system backed integration tests over mocks when testing publish flows.

## Verification
Before every commit:

```bash
npm run verify
```

Then perform a brief self-review:
- check for scope creep
- check for missing tests
- check for accidental API/contract drift
- check for docs/progress updates when relevant

