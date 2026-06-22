# Spec: HTML publishing (`pubmd publish page.html`)

> **Status: implemented (v1).** Built on `feat/html-publishing` atop the landed inliner
> work (#3/#4). Shipped: `kind` discriminator, shared `src/core/data-url.ts`,
> `src/core/inline-html.ts` (CSS incl. nested `url()` + one-level `@import`, scripts,
> images, `srcset`, favicons, media), `src/core/html-meta.ts`, the `publishHtmlPage`
> server branch (serves verbatim, skips the markdown pipeline), and read-route isolation
> headers (`CSP: sandbox` + `Permissions-Policy` + `nosniff` + `X-Robots-Tag`).
> Deferred from v1: `--inline-remote` / `--no-scripts` CLI flags (the inliner supports the
> options; the CLI uses defaults), remote-asset fetching, and multi-page folder hosting
> (§11 v2). Domain: pages are served from the app origin until `u.bul.sh` is assigned —
> `CSP: sandbox` makes the isolation work regardless (§9).

## 1. Goal

Publish a standalone `.html` file to a stable bul.sh URL with the same one-command
ergonomics as markdown:

```bash
pubmd publish report.html
→ https://bul.sh/myname/report
```

The published page **renders as a real web page** (interactive JS/CSS allowed), is
**permanent/immutable** until republished, and is **served safely** (a malicious page
cannot attack bul.sh or other users — see §9).

Non-goals (v1): hosting multi-file site trees / `dist/` folders (see §11, v2).

## 2. Core design principle: one self-contained file

Do **not** host a tree of assets. pubmd's model is one immutable, pre-rendered blob per
page, served by a single Hono route with edge caching. That model maps 1:1 to a single
*self-contained* HTML document. So:

- At **publish time**, the CLI walks the HTML and **inlines every local asset**
  (CSS, images, fonts, local JS) into one `<!doctype html>…</html>` document.
- That document flows through the **same** store-and-serve path as markdown's rendered
  HTML. No new storage layout, no asset-serving route, no manifest.

A self-contained HTML file is the literal analog of "one markdown file → one URL".
This is also what most agent-generated HTML *is* (a report, dashboard, viz) — one
artifact, not a webpack build.

## 3. Where the work happens (division of labor)

Mirrors the markdown flow exactly (`buildRenderMarkdown` runs in the CLI, server just
stores). Server has no access to the user's local files, so **inlining must be
client-side**.

| Step | markdown today | html (new) |
|------|----------------|------------|
| read input | `readFile(file, "utf8")` | same |
| transform (CLI) | `prepareMarkdownBodyForPublish` → inline images/excalidraw | `prepareHtmlForPublish` → inline all local assets (§6) |
| send | `{ markdown, renderMarkdown? }` | `{ kind:"html", source, document }` |
| render (server) | `renderMarkdownToHtml` + `buildHtmlDocument` | **skipped** — `document` is already final |
| store | `<id>.md` (raw) + `<id>.html` (rendered) | `<id>.src.html` (raw) + `<id>.html` (inlined, served) |
| serve | `context.html(...)` + edge cache | same body, **+ isolation headers** (§9) |

The HTML path is *cheaper* than markdown — it skips the entire unified pipeline.

## 4. Data model

Add a discriminator to `StoredPage` (back-compatible: existing pages default to
`markdown`).

```ts
// contract.ts
export const PageKindSchema = z.enum(["markdown", "html"]).default("markdown");

// StoredPageSchema += 
//   kind: PageKindSchema
// (markdownBlobKey keeps its name for markdown; for html it holds the raw-source key.
//  Optionally introduce sourceBlobKey alias to avoid the misnomer — see Open Decisions.)
```

Publish request becomes a discriminated union on `kind`:

```ts
export const PublishMarkdownRequestSchema = z.object({
  kind: z.literal("markdown").optional(),       // default
  markdown: z.string().min(1),
  renderMarkdown: z.string().min(1).optional(),
  slug: NameSchema.optional(),
  pageId: z.string().uuid().optional(),
});

export const PublishHtmlRequestSchema = z.object({
  kind: z.literal("html"),
  source: z.string().min(1),                    // raw HTML as authored (for ?raw / re-edit)
  document: z.string().min(1).optional(),       // self-contained HTML to serve.
                                                 // if omitted, server serves `source` verbatim
                                                 // (pure-curl path, no inlining)
  title: z.string().trim().min(1).max(200).optional(),       // override; else parsed from <title>
  description: z.string().trim().min(1).max(300).optional(), // override; else <meta description>
  noindex: z.boolean().optional(),              // default true (same as markdown)
  slug: NameSchema.optional(),
  pageId: z.string().uuid().optional(),
});

export const PublishRequestSchema = z.discriminatedUnion("kind", [...]);
```

`document` optional is what makes the **zero-dependency curl path** work:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"kind":"html","source":"<!doctype html><h1>hi</h1>"}' \
  https://bul.sh/api/namespaces/myname/pages/publish
```

## 5. Server: `publishPage` HTML branch

In `publish-service.ts`, branch on `kind`:

```
if kind === "html":
  document   = input.document ?? input.source            // serve verbatim if no inlining
  meta       = extractHtmlMeta(document)                  // <title>, <meta name=description>
  title      = input.title       ?? meta.title ?? <filename-or-slug>
  description= input.description ?? meta.description ?? ""
  noindex    = input.noindex ?? true
  htmlBlob   = document                                   // NO buildHtmlDocument wrapping
  sourceBlob = input.source
  contentHash= sha256({ kind, document, slug, title, description, noindex })
  // no-op check, savePage(page, {content: source, key: <id>.src.html},
  //                            {content: document, key: <id>.html}) — identical downstream
```

Key points:
- **No `buildHtmlDocument`** — we never wrap user HTML in the bul.sh template/stylesheet.
  The user's `<head>` is theirs. (Markdown still wraps, unchanged.)
- `extractHtmlMeta` is a tiny read-only parse (regex or `rehype-parse`) for listing
  metadata only — it does **not** mutate the body.
- Slug default for HTML = filename basename (titles are often long), falling back to
  `slugify(<title>)`.
- `noindex` is enforced via the **`X-Robots-Tag` response header** at serve time, not by
  editing the document (keeps "serve verbatim" pure).

## 6. The shared asset inliner

Factor a content-agnostic inliner used by **both** paths (DRY with #3/#4). Extract the
data-URL helpers (`buildDataUrl`, `mimeTypeForExtension`) from `publish-markdown.ts` into
`src/core/data-url.ts`; markdown's image inliner and the HTML inliner both consume it.

```ts
// src/core/inline-assets.ts
export interface InlineAssetsOptions {
  baseDir: string;
  inlineRemote?: boolean;    // default false — leave https:// refs as-is
  maxAssetBytes?: number;    // default 2 MiB; larger assets are left as references + warned
  maxTotalBytes?: number;    // default 8 MiB; abort/skip past budget (anti-abuse, §10)
  allowScripts?: boolean;    // default true (page served sandboxed, §9); false = strip <script>
}
export interface InlineAssetsResult {
  html: string;
  inlined: { ref: string; bytes: number }[];
  skipped: { ref: string; reason: "too-large" | "remote" | "not-found" | "unsupported" }[];
  totalBytes: number;
}
export async function inlineHtmlAssets(html, opts): Promise<InlineAssetsResult>;
```

Implementation: parse with `rehype-parse` → walk the hast tree (already in the
unified/rehype family the repo uses) → rewrite nodes → `rehype-stringify`. The CLI's
`prepareHtmlForPublish(html, sourcePath)` calls this with `baseDir = dirname(sourcePath)`.

### Asset matrix

| Reference | Local / relative | Remote (`https://`) |
|-----------|------------------|---------------------|
| `<img src>`, `<img srcset>` | inline → data URI (reuse #3 logic) | leave (default); `--inline-remote` |
| `<link rel=stylesheet href>` | read file → fold into `<style>` | leave (CDN resolves at view) |
| inline `<style>` | keep, but rewrite `url(...)` inside (§6.1) | n/a |
| `@font-face` / CSS `url()` | inline with size cap, else leave | leave |
| `<script src>` / inline `<script>` | inline if `allowScripts` (default) | leave |
| `<link rel=icon>` favicon | inline if small | leave |
| `<source src>`, `poster`, `<video>/<audio> src` | inline if under cap, else leave | leave |

### 6.1 The one genuinely new bit: CSS `url()` recursion

When a stylesheet is folded into `<style>`, the `url(...)` references **inside it**
(background images, `@font-face`) are relative to the **stylesheet's** directory, not the
HTML's. So the inliner must track each asset's own base dir and recurse one level:
`page.html` → `css/app.css` → `../img/bg.png` resolves against `css/`, not the page.
v1 may use a careful `url(\([^)]+\))` regex with documented limits (no `@import` chasing
beyond one level; `url()` in `<img srcset>` candidate lists handled separately).

## 7. CLI changes

In `runPublish` (`main.ts`), detect kind by extension/content (`.html`/`.htm`):

```
const ext = extname(filePath).toLowerCase();
if (ext === ".html" || ext === ".htm") {
  const source = await readFile(file, "utf8");
  const { html: document } = await prepareHtmlForPublish(source, file, { inlineRemote, ... });
  body = { kind: "html", source, document, slug?, pageId? };
} else { /* existing markdown path */ }
```

New flags: `--inline-remote`, `--max-asset-size`, `--no-scripts`. Print a one-line summary
of inlined/skipped assets to stderr (skipped-because-too-large is a silent footgun
otherwise). Page→URL mapping reuse (`mapping.files[...]`) is unchanged.

## 8. Read path

`GET /:namespace/:slug` is mostly unchanged — it already serves stored HTML via
`context.html()`. Additions, gated on `page.kind === "html"`:
- Set the **isolation headers** (§9): CSP/sandbox, `Permissions-Policy`,
  `X-Content-Type-Options: nosniff`, never `Set-Cookie`.
- `?raw` returns the **source** HTML (`text/html`/`text/plain`) instead of markdown.
- `noindex` → `X-Robots-Tag: noindex,nofollow`.
- Edge-cache headers unchanged (immutable artifact, same as markdown).

## 9. Security model (the important part)

**Threat model assumption:** bul.sh has **no web login and no cookies, ever.** All auth is
a bearer token in the user's local config file — never present in the browser. This is a
deliberate, load-bearing constraint, not an accident, and it removes an entire class of
risk.

### What the no-login model removes

Because there is no ambient authority on the origin, serving attacker-controlled HTML+JS is
**much** safer than the textbook stored-XSS case:

- **No cookie/session theft, no CSRF, no account takeover** — there are no cookies or
  sessions to steal or ride. A malicious page's `fetch('/api/...')` cannot attach the
  bearer token (it lives on disk, not in the browser).
- **The "no ambient authority" invariant:** a same-origin `fetch` from a published page
  gets *nothing it couldn't already get with `curl`* — there is no privileged, cookie-gated
  endpoint to reach. So same-origin cross-page reads confer no escalation.

> ⚠️ This invariant is the security foundation. If a web login/dashboard or any
> cookie-based auth is ever added to `bul.sh`, **most of the removed risks come back** and
> origin isolation (below) becomes mandatory rather than precautionary.

### What still remains (ranked)

1. **Domain-reputation blast radius — the primary risk.** Independent of auth. Anyone can
   publish a convincing phishing page (`bul.sh/x/paypal-verify`) or a malware/redirect page;
   it borrows credibility from your domain + TLS. If Safe Browsing / SmartScreen flags
   `bul.sh`, the browser interstitial covers the **entire domain — markdown publishing dies
   with it.** One bad actor takes down the core product. This is a business-continuity risk,
   not a data-breach risk, and it's the whole reason to still isolate.
2. **Malware/abuse distribution vector.** Cryptominers, drive-by redirects, fingerprinting,
   fake-download pages — all run in a static page, no login needed. Sandbox + Permissions-
   Policy blunt the *capabilities*, but not the page's *existence* → needs abuse reporting +
   takedown.
3. **Cross-page storage / service workers — largely already neutralized.** All `bul.sh/*`
   pages share a storage partition, so in theory a page could poison shared
   `localStorage`/IndexedDB or register a persistent service worker. But **the single-blob
   architecture blocks the dangerous part**: a SW script must be served from a real
   same-origin URL with a JS MIME type, and pubmd serves one self-contained `text/html`
   blob with no endpoint exposing the user's `.js` as `application/javascript`. So SW
   hijack is not reachable today. Residual harm (shared localStorage between independent
   pages, quota exhaustion) is browser-local and low. **⚠️ This reopens if v2 folder hosting
   ships** (arbitrary `.js` served same-origin) — see §11.
4. **Minor / header-fixable:** permission prompts "from bul.sh", clickjacking if embedded.

### Fix: `CSP: sandbox` is the load-bearing control; the domain is a cheap hedge

The security-critical control is **not** the domain — it's the sandbox header. A separate
domain only buys *reputation* isolation, which is low-stakes for a small, token-gated,
mostly-internal tool (see Proportionality).

1. **Opaque-origin sandbox via header (the actual isolation):**
   `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups` loads the doc
   in a *unique null/opaque origin*. Crucially, a sandboxed document is **not same-origin
   with `bul.sh` even when served from a `bul.sh` URL** — so user JS cannot touch the apex's
   cookies/storage/API, and (being a fresh opaque origin per document) cannot share storage
   with other user pages. Scripts still run, so interactivity is preserved. This one header
   does the heavy lifting regardless of which host serves it.
2. **Serve from a dedicated subdomain — decided: `u.bul.sh`.** Short, free (subdomain of the
   existing domain), clean URLs (`u.bul.sh/<ns>/<slug>`), and gives origin separation +
   cookie-scoping hygiene. Keep the API/markdown on apex `bul.sh`. A separate *registrable*
   domain (`githubusercontent.com`-style) is the only thing that buys true reputation
   isolation, and is **deferred** until/unless this becomes a popular public host — it's
   overkill now.
   > **Not a one-way door:** if it ever grows public, stand up a separate domain then and
   > `301` old `u.bul.sh/...` URLs forward — redirects preserve links, so the
   > permanent-URL promise survives the migration. (Serving on the *apex* is the choice that
   > would be expensive to undo; `u.bul.sh` already avoids it.)
3. **Tight CSP for exfiltration/embedding:** assets are inlined so the page needs no
   network — lock `default-src 'self' data:`, `connect-src 'none'`, `form-action 'none'`,
   `frame-ancestors 'none'`, `base-uri 'none'`.
4. **Lock capabilities:** `Permissions-Policy: camera=(), microphone=(), geolocation=(),
   payment=(), usb=()`; `X-Content-Type-Options: nosniff`; never set cookies on the content
   origin.

### Proportionality

Two factors already lower urgency: publishing is **not anonymous** (a claimed namespace +
token gives you a revocation/takedown handle and deters mass abuse), and the single-blob
design kills the service-worker vector. So this is **"do the separate-domain thing before
bul.sh gets popular enough to be an attractive phishing host"** — a launch prerequisite for
URL stability reasons, not a five-alarm fire. Industry precedent for the pattern: GitHub
(`githubusercontent.com`), Google (`googleusercontent.com`), Glitch (`*.glitch.me`).
htmlship's "scripts run in an isolated opaque origin" is exactly the `CSP: sandbox`
mechanism in step 2.

## 10. Limits / anti-abuse (composes with #1)

- Per-asset cap (default 2 MiB) and total document cap (default 8 MiB) in the inliner →
  prevents using bul.sh as a CDN / blob dump.
- Reuse #1's namespace publish rate limits and hosted guards.
- Reject obviously-binary `document`; require it to parse as HTML.

## 11. Phasing

- **v1 — single self-contained file** (this spec): small, on-brand, fast, reuses #3/#4.
- **v2 — `pubmd publish ./dist/`** (folders): a new blob-prefix layout
  (`<id>/index.html`, `<id>/assets/*`) + a wildcard `/:ns/:slug/*` asset route with
  content-type detection. Breaks the single-immutable-blob elegance; only build if real
  multi-page demand appears. here.now/quickish occupy this space already.

## 12. Tests

- Unit (`inline-assets.test.ts`): each row of the asset matrix; CSS `url()` recursion;
  remote left alone; size-cap skip + warning; `--no-scripts` strips JS.
- Unit: `extractHtmlMeta` title/description; slug default = filename.
- Integration (`cli.test.ts`): publish `.html` → served verbatim, correct `content-type`,
  data-URI present; curl path with no `document`.
- Integration (`server.test.ts`): isolation headers present on `kind:html`, absent on
  markdown; `?raw` returns source; `noindex` → `X-Robots-Tag`.
- Security: same-origin `fetch` from a published page is blocked by sandbox; cookies not
  set on content origin.

## 13. Open decisions

1. **Content origin — DECIDED: `u.bul.sh`** (short, free subdomain; `u.bul.sh/<ns>/<slug>`)
   + `CSP: sandbox` as the real isolation control. A separate registrable domain
   (`githubusercontent.com`-style) is deferred until/unless this becomes a popular public
   host; it can be added later with `301`s from `u.bul.sh` (§9, "not a one-way door").
2. **Field naming:** keep `markdownBlobKey` (misnomer for html) vs add `sourceBlobKey`
   alias + migrate. Recommend alias, no migration (default in zod).
3. **Default `allowScripts`:** true (interactive, sandboxed) vs false (static-only, safest).
   Recommend true given the sandbox.
4. **Wrap-vs-verbatim:** confirmed verbatim (no bul.sh template injection for html).
