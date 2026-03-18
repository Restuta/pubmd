# AGENTS.md — Publish It

Start here for any implementation work in this repository.

## Source Of Truth
- Read [docs/project-plan.md](/Users/restuta/Projects/publish-it/docs/project-plan.md) first.
- Treat [docs/project-plan.md](/Users/restuta/Projects/publish-it/docs/project-plan.md) as the product and milestone source of truth.
- Treat [docs/engineering-guidelines.md](/Users/restuta/Projects/publish-it/docs/engineering-guidelines.md) as canonical for code style, architecture boundaries, and verification workflow.
- Use [docs/progress.md](/Users/restuta/Projects/publish-it/docs/progress.md) for implementation status and milestone notes.

## Required Workflow
1. Confirm scope against [docs/project-plan.md](/Users/restuta/Projects/publish-it/docs/project-plan.md).
2. Keep increments small enough to test end to end.
3. Write tests for all new behavior and regression risk.
4. Run `npm run verify` before every commit.
5. Perform a self-review before every commit.
6. If Claude review is part of the current milestone, request it after local verification and address feedback before moving on.
7. Update [docs/project-plan.md](/Users/restuta/Projects/publish-it/docs/project-plan.md) milestone checkboxes when a milestone item is truly complete.
8. Update [docs/progress.md](/Users/restuta/Projects/publish-it/docs/progress.md) with a short status entry after each milestone.
9. Never commit credentials, API keys, or local auth files.

## Project Constraints
- Favor minimal public surface area and simple internals that support stable URLs.
- Keep `publish` idempotent. Do not reintroduce a separate `update` concept.
- Preserve the distinction between durable `page_id` and public `slug`.
- Keep markdown support intentionally narrow for MVP.
- Prefer portable abstractions so the system can move from local/file-backed storage to hosted storage without rewriting the contract.

