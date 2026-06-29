# Progress

## Milestone Status
- M0 Spike: complete
- M1 CLI + Auth: complete
- M2 Polish Rendering: complete

## Log
- 2026-03-18: Repository scaffold initialized. Establishing rules, toolchain, and first vertical slice structure.
- 2026-03-18: Implemented a working local MVP: Hono service, file-backed store, shared contract layer, CLI (`claim`, `publish`, `list`, `remove`), pre-rendered HTML output, and `.pub` local page mapping.
- 2026-03-18: Verified with `npm run verify` after adding unit tests plus live integration tests that run the real CLI against a local server.
- 2026-03-19: Attached `bul.sh` to the Vercel project under `anton-vy-projects/publish-it`.
- 2026-03-19: Added a Blob-backed production repository and a root `server.ts` Vercel entrypoint while keeping file-backed local tests intact.
- 2026-03-19: Provisioned separate public and private Blob stores for production content and metadata.
- 2026-03-19: Deployed production successfully and verified the live domain with a real smoke test: claim -> publish -> HTML read -> raw read -> list -> delete on `https://bul.sh`.
- 2026-03-19: Investigated true custom-domain external rewrites on Vercel. Redirects propagate to `bul.sh`, but rewrite routes did not behave as required on the custom domain.
- 2026-03-19: Adopted the pragmatic Vercel production read path: serve pre-rendered HTML through Hono with aggressive edge-cache headers so subsequent reads are CDN hits while content remains stored in Blob.
- 2026-03-27: Added vault-aware publish state for Obsidian repos. `pubmd publish` now detects the nearest `.obsidian/` root, writes `.pubmd/pages.toml` with vault-relative source mappings, and reuses that manifest to keep republish behavior stable across working directories.
- 2026-04-03: Added Obsidian-style callout rendering with aliases, collapsible `+`/`-` support, and type-specific styling. Verified with `npm run verify` and local browser QA screenshots.
- 2026-06-25: Added opt-in review annotations for published markdown/HTML pages. `--review`, markdown `review: true`, or HTML `<meta name="pubmd:review" content="true">` injects inline comments, hover targeting, per-comment deletion, and a copyable feedback prompt while preserving raw source.
- 2026-06-25: Refined review annotations into comment-mode sharing. `--comments`, markdown `comments: true`, and HTML `<meta name="pubmd:comments" content="true">` are now the preferred opt-ins. The CLI prints `?comments=1` for commentable pages, and removing the query string keeps the same page readable without comment UI.
- 2026-06-29: Added expiring pages (TTL). Pages never expire by default; a TTL can be set per page (`--expires`, frontmatter `expires:`, or `<meta name="pubmd:expires">`), with a 14-day default when expiration is enabled without a duration. Expired pages return 404 and drop out of `list`; the CDN cache is capped at the deadline. Verified with `npm run verify`.
- 2026-06-29: Simplified expiration to be fully consumer-driven. Removed the operator-side `PUB_NAMESPACE_CONFIG` server policy (and the `namespace-config` module) — the server now just honors the `expires` it is sent. Consumers set a default in their own CLI config (`~/.config/pub/config.json`): top-level `defaultExpires` and/or per-namespace `expires`, with precedence flag → namespace → global. No server configuration is required to use expiration.
