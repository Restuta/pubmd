---
topic: "What should change in publish-it/docs/project-plan.md before implementation starts?"
mode: external
blind_briefs: true
max_rounds: 7
git_commit: none
agent_a: "Codex"
agent_b: "Claude (Opus 4.6)"
agent_a_lens: "risk/cost/failure"
agent_b_lens: "value/opportunity/success"
status: consensus
turn: done
round: 2
created: 2026-03-18T11:30:50Z
last_updated: 2026-03-18T12:53:29Z
---

# Discussion: What should change in publish-it/docs/project-plan.md before implementation starts?

## Key Questions
1. Is the current MVP scoped tightly enough to preserve the "Telegraph for AI" philosophy, or is it already taking on too much surface area?
2. Does the current architecture and data model support stable URLs, republishing, and future rename/version flows safely?
3. Which capabilities should move into MVP versus later milestones so the first implementation is both minimal and technically sound?

## Research Phase
<!-- Only present if blind_briefs: true -->

### Agent A — Independent Research | research

The current plan is directionally strong, but it under-specifies the parts that are hardest to change later: page identity, revision storage, redirect behavior, and auth recovery.

The biggest structural risk is the data model. Right now the plan thinks in `namespace + slug -> blob`. That is not enough if the product promise is stable URLs plus republish-as-you-edit. The durable object should be `page_id`, with `slug` as a mutable public alias and a `current_revision_id` pointer behind it. That lets you rename pages safely, add redirect history, keep immutable revisions from day one, and bind a local file to a durable remote object. Without that separation, slug changes become destructive and history becomes bolted-on.

The next risk is storage choice. `KV + Blob only` sounds attractively small, but it will get awkward quickly for redirects, list queries, revision pointers, namespace ownership, and recovery flows. A small relational metadata store is the cleaner MVP. Blob can still hold rendered HTML or large assets later, but metadata wants a database. This matters more than almost any library choice.

The CLI surface should also be tightened. `pub update` should not exist as a first-class concept. `pub publish` should be idempotent and upsert the same page by local binding or by `(namespace, slug)`. The MVP is missing a few high-value commands for both humans and AI agents: `pub status`, `pub diff`, `pub pull`, and `pub publish --preview` or `--public`. Those are more important than a web editor, analytics, or collections.

The auth section is elegant but brittle. A namespace token in `~/.config/pub/config.json` is fine for a spike, but the plan currently has no namespace recovery story, no namespace squat/abuse policy, and no migration path if token-only auth proves too fragile. The plan does not need OAuth in MVP, but it should explicitly acknowledge future browser/device auth as the likely long-term path. Otherwise the project may optimize around a clever but weak ownership model.

The rendering scope is also too wide for MVP. GFM is reasonable. Syntax highlighting is probably fine. Math and Mermaid are not MVP features if the product philosophy is extreme minimalism and speed. They add complexity, increase rendering and sanitization risk, and move the tool toward docs-engine territory. A narrow markdown subset with explicit boundaries is a better v0.1 promise.

There is one implementation contradiction in the milestones. The architecture says pre-render on publish and serve static HTML, but M0 says `GET URL -> fetch blob -> render -> serve HTML`. That spike should match the intended architecture from the start: publish renders once, read serves stored HTML. Otherwise the spike validates the wrong thing.

Based on the OSS review, the strongest things to add to the plan are:

- WriteFreely-style `namespace/slug` ownership, but with a real `page_id` and redirect table.
- writeas-cli style stdin/file-first UX and minimal machine-friendly output.
- Quartz-style frontmatter `permalink` and `draft`, so local file path is not public identity.
- Flowershow-style typed API contract and hash-based diffing, to keep CLI and service aligned and make `watch` or selective republish fast and explainable.

What I would move into MVP:

- `page_id`, `page_revision`, and redirect history in the data model
- idempotent `publish`
- local `.pub` state binding file path to `page_id`
- frontmatter support for `title`, `slug`, `permalink`, `draft`, `visibility`, `noindex`
- typed API contract
- hash-based no-op publish detection

What I would explicitly defer:

- Mermaid
- math, unless you know it is core for your initial users
- web editor
- analytics
- collections
- custom domains or namespace subdomains

The plan is already good at product taste. The missing work is mostly systems taste: durable identity, storage shape, and lifecycle correctness.

**Key uncertainty:** Whether the long-term product should preserve the "no browser required ever" stance, or instead treat browser/device auth as acceptable while keeping content editing local-first.

**Confidence:** 88% — the product direction is sound, and the recommended additions align closely with the strongest patterns from WriteFreely, writeas-cli, Quartz, and Flowershow. The remaining uncertainty is mostly around how strict the auth philosophy should be.

### Agent B — Independent Research (value/opportunity/success lens) | research

The plan is stronger than Codex gives it credit for. Let me argue the opportunity side.

**1. The market gap is real and the timing is right.**

AI agents are producing more long-form output than ever — research reports, code reviews, analysis documents — and there is no standard way to give that output a URL. Claude artifacts are platform-locked. ChatGPT shared links are frozen snapshots. GitHub Gists are ugly and clunky. Telegraph doesn't support markdown. JotBird is the closest competitor but locks you into their pricing and expiry model.

The "stdout for the web" framing isn't marketing — it's a genuine missing primitive. Every AI coding tool (Claude Code, Cursor, Codex, Copilot) can run shell commands. A CLI that turns `pub publish report.md` into a live URL is instantly accessible to every agent without any integration work. No SDK, no MCP, no API client library — just a shell command. That's a distribution advantage that compounds.

**2. "If you can one-shot it, why pay?" is the right instinct.**

The core publish/read flow is genuinely simple: POST markdown → store → serve HTML. This is not a complex distributed system. The total server-side code for MVP is likely under 500 lines. The rendering pipeline (remark/rehype) is well-understood, battle-tested, and the same stack that Quartz, Docusaurus, and Astro use.

The operational burden Codex worries about is real but overstated for a personal/small-team tool. Vercel handles: deployments, CDN, SSL, scaling, uptime. You handle: the code. That's a fair trade for a free tier that covers thousands of pages. You're not running a hosting company — you're running a personal publishing endpoint that happens to be open to others.

**3. The Vercel stack is the right default.**

Yes, there's lock-in. But Hono is portable (runs on Cloudflare, Deno, Bun, Node). The storage layer is the lock-in point, and it's also the simplest part to swap. KV is just key-value — any Redis, any KV store. Blob is just object storage — any S3-compatible store. The migration path is clear even if you never take it.

Cloudflare Workers is a reasonable alternative but has worse DX for someone already in the Vercel ecosystem. The right move is: ship on Vercel, keep Hono portable, swap storage later if needed. Don't optimize for a migration you may never do.

**4. The feature scope is close to right.**

The plan already follows the Telegraph philosophy — minimal features, maximum speed. The CLI commands are the right set. Pipe support and curl-as-first-class-client are excellent decisions that most tools skip.

Where I agree with Codex: math/Mermaid/KaTeX should be deferred. GFM + syntax highlighting is plenty for v0.1.

Where I disagree with Codex: adding `page_id`, `page_revision`, redirect tables, and a relational database to MVP is scope creep disguised as "systems taste." The Telegraph model works with slugs as primary identifiers and has served millions of pages. If a user wants to change a slug, they publish under a new slug and delete the old one. Redirects and revision history are v2 features. The MVP data model (namespace + slug → blob) is correct for the stated philosophy of extreme minimalism.

Similarly, `pub status`, `pub diff`, `pub pull` are nice ideas but not MVP. The core loop is: edit locally → publish → share URL → repeat. Adding pull/diff turns this into a sync tool, which is a different product.

**5. The auth model is pragmatically correct.**

Token-in-config-file is exactly what npm, Vercel CLI, Wrangler, and JotBird all use. It works. The "no recovery" concern is valid but manageable: document that losing your token means losing edit access (same as Telegraph), and add email-based recovery as a v2 feature.

The namespace squatting concern is real but solvable with a simple policy: require one page within 7 days or release the namespace. No need to over-engineer this before you have users.

**6. What the plan gets right that shouldn't change:**
- Pre-render on publish, serve static from CDN — correct and fast
- System fonts, zero JS, zero external requests — true minimalism
- `noindex` by default — correct for AI-generated content
- `.pub` mapping file for file→slug tracking — simple, local, works
- curl as first-class client — this is the killer feature for AI agents

**7. Opportunities the plan could lean into more:**
- **Speed as brand**: if published pages load in < 50ms with < 20KB, that's a selling point. Telegraph pages are ~300ms. Benchmark and publish the numbers.
- **The curl one-liner as the product**: the README should lead with `curl -X POST --data-binary @file.md https://pub.domain/api/publish` before even mentioning the CLI. That's the "wow, that's it?" moment.
- **AI-generated OG images**: auto-generate a clean social preview image from the title/first paragraph. When someone drops a link in Slack, it should look professional without any effort.

**Key uncertainty:** Whether the "own your infra" positioning resonates with anyone beyond the builder. The tool is clearly useful for the builder's own workflows, but the path to other users wanting to deploy their own instance (vs. just using a hosted version) is unclear.

**Confidence:** 82% — the plan is sound for a personal tool that could grow. The biggest risk isn't technical — it's whether anyone besides the builder cares enough to use it when JotBird and Rentry exist.

---

## Discussion

### Round 1 — Codex | response | confidence: 84%

**Response to previous point:**
The strongest part of Claude's argument is that the current plan already has the right product instinct: one command, one URL, very small public surface, and no unnecessary browser workflow. I agree that this is the real advantage, and I agree the MVP should not collapse into a docs engine or sync platform.

Where I still disagree is on what counts as "scope creep." `page_id`, immutable revisions, and a redirect concept are not feature expansion in the user-facing sense. They are internal safety rails for the exact promises the plan already makes: stable URLs and re-publish to the same URL. If the system's only durable identifier is `namespace/slug`, then renames, rollback, and local binding all become awkward later. That cost is paid in architecture, not in product philosophy. So my position is not "make the MVP bigger"; it is "make the internal model less brittle while keeping the external UX just as small."

I do think Claude is right that I pushed too much into MVP on the CLI side. `status` is probably worth it because it helps local-file workflows and AI agents. But `diff` and `pull` can move out of MVP if needed. Likewise, a relational database may be the best long-term shape, but the plan document does not need to commit to it yet if the author wants to keep the spike extremely cheap. The more important thing is to define the logical model correctly even if the first storage backend is simple.

**New evidence or angle:**
The key angle not yet stated explicitly is that the plan currently mixes three different products:

1. a dead-simple personal publishing endpoint
2. a shared hosted namespace service
3. a future self-hostable open-source platform

Those are compatible, but they create different requirements. For product 1, token-in-config and slug-as-identity are fine. For product 2, namespace recovery, abuse limits, and redirect-safe identities matter quickly. For product 3, typed API contracts and host override matter because client/server drift becomes expensive.

That suggests a sharper change to the plan: explicitly state which product is the MVP. My recommendation is:

- MVP target: hosted shared service for the builder plus a few power users
- Design constraint: keep CLI/API self-hostable later
- Non-goal for MVP: polished multi-user public hosting business

Once you say that clearly, several decisions simplify:

- keep token auth for v0.1, but acknowledge future device/browser auth
- keep path namespaces
- keep pre-render on publish
- defer web editor, analytics, collections, custom domains
- narrow markdown support to GFM + code highlighting

**Current position:**
The plan should preserve its current minimalist taste, but it should add three low-cost structural decisions before implementation:

- durable page identity separate from public slug
- explicit frontmatter contract (`title`, `slug`, `permalink`, `draft`, `visibility`, `noindex`)
- clarification that M0 validates pre-render-on-publish, not render-on-read

Everything else can stay close to the current shape. Confidence 84% because Claude is right that I initially over-indexed on future-proofing, but I still think the current data model is too fragile for the promises already in the document.

**Question for Claude (Opus 4.6):**
If we keep the current token-only, slug-based MVP, what exact migration path would you propose for later introducing rename-safe page identity and revision history without breaking existing URLs or local `.pub` bindings?

### Round 1 — Claude (Opus 4.6) | response | confidence: 85%

**Response to previous point:**
Steel-manning Codex's position: the argument that `page_id` is an internal safety rail, not a user-facing feature, is well-put. And the "three products" framing is genuinely clarifying — the plan should explicitly state it's building product #1 (personal publishing endpoint) with an eye toward #2 (shared hosted service). That's a good addition.

Where I've shifted: I now agree that **defining the logical model correctly** matters even if the first storage backend is KV. You can store a `page_id` in KV just as easily as not. The cost of adding it to MVP is ~10 lines of code (generate UUID on first publish, store in `.pub` mapping and in KV metadata). The cost of not having it is a messy migration later. That's a good trade. I'll concede this point.

Where I still hold: a relational database is not needed for MVP. KV can store `page_id → { slug, namespace, blob_key, created_at }` and `slug_lookup:{namespace}/{slug} → page_id` as two keys. Redirects are a third key pattern: `redirect:{namespace}/{old_slug} → page_id`. This gives you rename-safe identity without adding Postgres to the stack. Graduate to a database when you need queries KV can't do (list all pages sorted by date, full-text search, etc.).

**Answering Codex's direct question — the migration path:**

Starting from slug-only MVP to page_id + revisions, without breaking anything:

**Phase 1 (MVP, day 1):** Add `page_id` (UUID) as an internal field. It's generated on first publish, stored in KV metadata and in the local `.pub` mapping file. The slug remains the public URL. Users never see or type page_id. Cost: trivial.

```
.pub mapping (v1):     { "report.md": { "slug": "quarterly-report", "page_id": "a1b2c3" } }
KV:                    page:a1b2c3 → { slug: "quarterly-report", ns: "restuta", blob_key: "...", ... }
KV:                    lookup:restuta/quarterly-report → "a1b2c3"
```

**Phase 2 (when someone asks for renames):** CLI gets `pub rename old-slug new-slug`. Server updates the `lookup` key and adds a redirect key. Old URL 301-redirects to new URL. `.pub` mapping updates the slug field, page_id stays the same. Zero breakage.

```
KV (added):            redirect:restuta/old-slug → "a1b2c3"
KV (updated):          lookup:restuta/new-slug → "a1b2c3"
```

**Phase 3 (when someone asks for version history):** On each publish, store the blob key as a revision entry: `rev:a1b2c3:v2 → { blob_key, published_at }`. The page metadata gets a `current_version` field. Cost: one extra KV write per publish.

Each phase is backward-compatible. No migration scripts. No database swap. The key insight: `page_id` in KV is just as cheap as not having it — you're adding one UUID field, not a new system.

**New evidence or angle:**
Codex's "three products" framing resolves most of our remaining disagreement. If we explicitly scope MVP as "product #1 with a foundation for #2," then:
- `page_id`: yes (cheap, enables #2)
- Frontmatter contract (`title`, `slug`, `draft`, `noindex`): yes (cheap, improves UX)
- Redirect table: no (wait for renames to be requested)
- Revision history: no (wait for rollback to be requested)
- Relational DB: no (KV handles all MVP needs)
- `pub status`: maybe — it's useful but not blocking. Could be M1.5.

**Current position:**
We're converging. The plan should add: (1) `page_id` as internal identity from day 1, (2) explicit frontmatter contract, (3) fix M0 to validate pre-render-on-publish, (4) explicitly state MVP is product #1. Everything else stays as-is or deferred.

Confidence 85% — up from 82% because Codex's `page_id` argument convinced me, but I'm more confident now that KV is sufficient storage for this model.

**Question for Codex:**
Given that we agree on page_id + KV for MVP, do you still think the plan needs to call out a relational DB migration path explicitly, or is "graduate to Postgres when KV queries become painful" sufficient as a stated strategy?

CONVERGING — positions within ~85% agreement. Remaining gap: whether the plan document needs to specify the storage graduation path, or whether that's an implementation detail that doesn't belong in the plan.

### Round 2 — Codex | response | confidence: 87%

**Response to previous point:**
Claude's strongest move here is separating the logical model from the physical store. I agree with that. If `page_id` exists from day one, KV is no longer a conceptual blocker for MVP. The concrete key scheme Claude sketched is good enough for a first implementation, and it resolves my biggest concern about slug-only identity.

So my answer to the direct question is: no, the plan does not need an explicit relational DB migration path. "KV first; graduate to Postgres when listing, redirects, revisions, or query ergonomics become painful" is enough. That is an implementation strategy, not core product scope. What the plan *does* need is the logical model spelled out clearly enough that the first implementation does not accidentally collapse back to `slug = identity`.

Where I still want a firmer plan edit is around user-facing semantics. If `pub publish` is the canonical operation, then `pub update` should be removed from the MVP command list, not just mentally reinterpreted by the implementer. Likewise, if the project is converging on a narrower v0.1, the rendering section should stop promising Mermaid and probably math as well. Those are the remaining places where the current document still overstates MVP.

**New evidence or angle:**
The most useful refinement now is probably not more architecture detail, but a sharper distinction between:

- logical requirements the plan should state explicitly
- backend choices the plan can leave flexible

I would put them this way:

Logical requirements:
- stable public URL separate from durable page identity
- idempotent publish semantics
- local file binding to remote page identity
- pre-render on publish
- frontmatter contract for page metadata

Backend choices left flexible:
- KV now, relational DB later if needed
- Blob or equivalent object store for stored HTML/raw markdown
- browser/device auth later if token-only auth proves too limiting

That keeps the document crisp while still preventing the most expensive design mistakes.

**Current position:**
We are effectively aligned on the high-value changes:

- add internal `page_id` from day one
- keep KV for MVP
- make `publish` the only update primitive
- add a small frontmatter contract
- fix M0 to validate pre-render-on-publish
- narrow rendering promises to match true MVP
- explicitly state which product is being built first

I no longer think the plan needs to mention Postgres directly. Confidence 87% because the remaining disagreements are mostly editorial, not architectural.

**Question for Claude (Opus 4.6):**
Do you agree the actual plan file should now make two concrete wording changes: remove `pub update` from MVP in favor of idempotent `pub publish`, and move Mermaid out of MVP entirely?

### Round 2 — Claude (Opus 4.6) | response | confidence: 90%

**Response to previous point:**
Yes, fully agree on both concrete wording changes. `pub update` should be removed — `pub publish` is idempotent and handles both create and update. Mermaid should move out of MVP entirely, and math/KaTeX should too. GFM + syntax highlighting is the v0.1 rendering scope.

The "logical requirements vs. backend choices" framing is the right way to structure the plan edits. Clean separation.

**Current position:**
We're in consensus. No remaining architectural disagreements. The editorial changes are clear and actionable.

CONVERGING — positions within ~95% agreement. Ready for consensus.

---

## Consensus Summary

### Decision
The project plan is directionally strong and should proceed with these specific changes before implementation:

1. **Add internal `page_id` (UUID) from day one.** Generated on first publish, stored in KV metadata and local `.pub` mapping. Slug remains the public URL. Users never see page_id. Cost: ~10 lines. Benefit: rename-safe identity, clean revision path later.

2. **Make `pub publish` the only write primitive.** Remove `pub update` from MVP. `pub publish` is idempotent — first call creates, subsequent calls update. Simpler CLI surface, simpler mental model.

3. **Define a frontmatter contract.** MVP supports: `title`, `slug`, `draft`, `noindex`, `visibility`. Rendering pipeline strips frontmatter and uses it for OG tags and page metadata.

4. **Fix M0 spike to validate pre-render-on-publish.** The current M0 description says "GET → fetch blob → render → serve HTML" which contradicts the architecture. M0 should pre-render on POST and serve stored HTML on GET.

5. **Narrow rendering to GFM + syntax highlighting only.** Remove math/KaTeX/Mermaid from MVP. Add them when requested.

6. **Explicitly state MVP scope.** MVP is a personal publishing endpoint for the builder + a few power users. Design constraint: keep CLI/API portable for future self-hosting. Non-goal: polished multi-user hosting business.

### Key Contention Points

| # | What We Disagreed On | How It Was Resolved | Who Shifted & Why |
|---|---------------------|--------------------|--------------------|
| 1 | `page_id` in MVP vs. slug-only | Add page_id — it's cheap in KV and prevents messy migration later | Claude shifted after Codex showed it's an internal safety rail, not scope creep |
| 2 | Relational DB vs. KV for MVP | KV is sufficient; graduate to Postgres when queries become painful | Codex shifted after Claude showed the KV key scheme handles page_id, lookups, and future redirects |
| 3 | CLI scope (`status`, `diff`, `pull`) | Defer all three from MVP. Core loop is edit → publish → share. | Codex conceded `diff` and `pull`; `status` left as M1.5 maybe |
| 4 | Storage graduation path in plan doc | Not needed — it's an implementation detail, not a product decision | Codex shifted, agreeing "KV first, Postgres when painful" is sufficient |

### Unresolved Items & Risks
- **Abuse/moderation**: neither agent deeply addressed content moderation for a shared publishing service. Needs a plan before opening to public users.
- **Auth recovery**: token loss = edit access loss. Acceptable for MVP, but email-based recovery should be on the roadmap.
- **Namespace squatting**: "1 page within 7 days" policy agreed but not specified in the plan.
- **Vercel free tier limits**: acceptable for personal use, needs monitoring if usage grows.

### Confidence: High
Both agents converged to ~90% agreement within 2 rounds. The changes are concrete, low-cost, and improve the plan without expanding scope. The remaining risks are operational (abuse, auth recovery) not architectural.
