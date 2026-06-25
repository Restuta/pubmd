# pubmd

> `stdout` for the web — one command, one URL, done.

Publish markdown **or a self-contained HTML page** to a stable URL. Built for AI agents, usable by humans.

**Live at [bul.sh](https://bul.sh)**

> **New:** `pubmd` isn't markdown-only anymore. Point it at an `.html` file and it
> packages the page's local CSS, JS, images and fonts into **one self-contained
> document**, then serves it sandboxed from [`u.bul.sh`](https://u.bul.sh). See
> [Publishing HTML](#publishing-html).

## Current Status

- Live service: `https://bul.sh`
- Publish model: pre-render once on publish, then serve cached HTML
- Content storage: public Blob
- Metadata storage: private Blob
- Read path on Vercel: Hono + aggressive edge caching
- Published pages are effectively immutable unless explicitly republished

## Run From Source

```bash
git clone https://github.com/Restuta/pubmd.git
cd pubmd
npm install
npm run build

# Local CLI usage from source
node dist/src/cli/main.js --help
```

## Install

**macOS / Linux:**
```bash
curl -fsSL https://bul.sh/install | sh
```

**Windows (PowerShell):**
```powershell
irm https://bul.sh/install.ps1 | iex
```

Both installers download the latest prebuilt binary from GitHub Releases. (There is no npm package — `pubmd` on npm is an unrelated project.)

Default behavior (macOS/Linux):
- installs `pubmd` to `~/.local/bin`
- does not require `sudo`
- prints a PATH hint if `~/.local/bin` is not already on your shell PATH

Default behavior (Windows):
- installs `pubmd.exe` to `%LOCALAPPDATA%\pubmd`
- adds to user PATH automatically

## Quick Start

```bash
# Claim your namespace (saves the API base to your config, so later commands don't need it)
pubmd claim myname --api-base https://bul.sh

# Publish markdown
pubmd publish notes.md
# → https://bul.sh/myname/notes

# Publish an HTML page (local CSS/JS/images/fonts are inlined into one self-contained page)
pubmd publish dashboard.html
# → https://u.bul.sh/myname/dashboard

# Publish a reviewable page with inline comments and an export prompt
pubmd publish report.html --review

# Re-publish (same URL, updated content)
pubmd publish notes.md

# Pipe from stdin
cat report.md | pubmd publish --slug weekly-report --namespace myname

# List your pages
pubmd list --namespace myname

# Delete a page
pubmd remove weekly-report --namespace myname
```

> Running from source instead of an install? Swap `pubmd` for `node dist/src/cli/main.js`.


## Publishing HTML

Point `pubmd` at an `.html` file and it makes the page self-contained before upload, then serves it **verbatim** — your markup, styles and scripts, untouched.

```bash
pubmd publish dashboard.html
# → https://u.bul.sh/myname/dashboard
```

**What gets packaged into the single page:**

- `<link rel="stylesheet">` → folded into `<style>` (nested `url(...)` and one-level `@import` resolved)
- `<script src>` → inlined
- `<img src>` / `srcset`, favicons, `<video>`/`<audio>`/`<source>` → inlined as `data:` URLs
- fonts referenced from CSS `url(...)` → inlined

Remote references (`https://…`, protocol-relative) and existing `data:` URLs are left alone. Assets over a size cap and site-absolute paths (`/foo.png`) are left as references and reported.

**Where it's served:** user HTML is served from the dedicated origin [`u.bul.sh`](https://u.bul.sh) with `Content-Security-Policy: sandbox` — scripts run, but in an opaque origin with no access to `bul.sh` cookies/storage or other pages. A request to the `bul.sh` apex for an HTML page redirects to `u.bul.sh`. Markdown keeps rendering and serving from `bul.sh`.

> Multi-page sites (a folder of `.html` files) aren't hosted yet — v1 publishes one self-contained page per `publish`.

## Review Annotations

Use review mode when you want to share a page, let someone comment directly on
paragraphs or selected text, then copy one prompt that contains every annotation
and enough location context to apply the feedback later.

```bash
pubmd publish report.html --review
pubmd publish report.md --review
```

You can also opt in from the document itself:

```yaml
---
review: true
---
```

```html
<meta name="pubmd:review" content="true">
```

Review mode is injected only into the served page. The raw markdown or HTML
available through `?raw` stays unchanged.

## For AI Agents

Any AI that can run shell commands can publish. No SDK, no MCP, no API client — just a command.

### Claude Code

A `/publish` skill is available. Usage:

```
/publish report.md
/publish report.md --slug weekly-report
```

Or add this to your project's `CLAUDE.md`:

```
To share long-form output as a URL, use:
  pubmd publish <file.md> --api-base https://bul.sh
The command prints the live URL to stdout.
```

### Codex / Other AI agents

Add to `AGENTS.md` or system prompt:

```
To publish markdown to a shareable URL:
  pubmd publish <file.md> --api-base https://bul.sh
To list published pages:
  pubmd list --api-base https://bul.sh
```

### Windows AI agents

Install once via PowerShell, then use the `pubmd` command:

```powershell
irm https://bul.sh/install.ps1 | iex
pubmd publish <file.md> --api-base https://bul.sh
```

(No `npx` — there is no npm package.) Or skip install entirely with the curl/`Invoke-RestMethod` API below.

### Zero-dependency (curl)

Any agent that can run curl can publish without installing anything:

```bash
# Publish raw markdown
curl -X POST -H "Authorization: Bearer $TOKEN" \
  --data-binary @file.md \
  https://bul.sh/api/namespaces/myname/pages/publish

# Claim namespace (one-time)
curl -s -X POST https://bul.sh/api/namespaces/myname/claim
```

## Frontmatter

Control page metadata with YAML frontmatter:

```yaml
---
title: My Report
slug: custom-url-slug
description: A short summary for social previews
noindex: false        # default: true
visibility: public    # stored as metadata for now
draft: true           # stored as metadata for now
---

# My Report

Content here...
```

All fields are optional. Title and description are auto-extracted from content if not specified.

Today:
- `title`, `slug`, `description`, and `noindex` affect rendered output/metadata
- `visibility` and `draft` are stored as page metadata, but are not yet enforced in listing/access rules

## Inline HTML

pubmd renders GFM markdown and also supports a **safe subset of raw HTML** written
directly in your markdown — the same allowlist GitHub uses (via `rehype-sanitize`).
This means common authoring tags survive rendering, including collapsible sections:

```markdown
<details>
<summary>Click to expand</summary>

## Markdown still works in here

- nested lists
- **bold**, `code`, links

</details>
```

Leave a blank line after `<summary>` so the content between the tags is parsed as
markdown. Tags such as `<details>`, `<summary>`, `<kbd>`, `<sub>`, `<sup>`, `<mark>`,
`<abbr>`, and basic block/inline formatting are preserved.

Anything outside the safe subset is stripped on render, by design:
- Unsafe tags (`<script>`, `<style>`, `<iframe>`, `<object>`, …) are removed.
- Inline event handlers (`onclick`, `onerror`, …) and `javascript:` URLs are removed.
- Only known-safe attributes are kept (e.g. `open` on `<details>`).

The raw markdown you publish is stored verbatim; sanitization applies only to the
rendered HTML that is served.

## How It Works

```
PUBLISH (md):   CLI posts markdown -> server renders HTML once -> stores raw markdown + HTML
PUBLISH (html): CLI inlines local assets into one document -> server stores it -> serves verbatim
READ:           Browser hits URL -> app serves stored HTML with aggressive Vercel edge caching
```

Pages are pre-rendered on publish. On Vercel, the first read may hit the app, but subsequent reads are served from edge cache for the cache window. Zero JS, system fonts, small HTML payloads.

## Immutable Publishing Model

- A publish creates a rendered snapshot
- Existing pages do not change unless explicitly republished
- Renderer/style improvements apply to newly published or explicitly republished pages
- This avoids silent regressions in old documents when styles change

## CLI Reference

```
node dist/src/cli/main.js claim <namespace>                                 Claim a namespace, get API token
node dist/src/cli/main.js publish [file.md|file.html] [--slug <s>] [--ns <n>] [--review]  Publish or update a page
node dist/src/cli/main.js list [--namespace <n>]                             List your published pages
node dist/src/cli/main.js remove <slug> [--namespace <n>]                    Delete a page
```

Config stored in `~/.config/pub/config.json`. File-to-URL mappings stored in `.pub` in the working directory.

### Obsidian Vaults And Repo-Owned Publish State

When `pubmd publish` targets a file inside an Obsidian vault (detected via the nearest ancestor containing `.obsidian/`), it also writes a committed-friendly manifest at:

```text
.pubmd/pages.toml
```

The manifest stores the vault-relative source path plus the canonical publish mapping:

```toml
[[pages]]
source = "10-product/00-vision-v1.md"
namespace = "a"
slug = "orba-vision"
page_id = "123e4567-e89b-12d3-a456-426614174000"
url = "https://bul.sh/a/orba-vision"
title = "Product Vision v1"
updated_at = "2026-03-27T00:00:00.000Z"
```

This manifest is designed for repository knowledge and can be committed. The older `.pub` file remains a local working-state cache.

## Development

```bash
npm run dev          # local server with hot reload
npm test             # run tests
npm run verify       # test + lint + typecheck + build
```

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/namespaces/:ns/claim` | none | Claim namespace, returns token |
| POST | `/api/namespaces/:ns/pages/publish` | Bearer | Publish/update a page (markdown, or `{ "kind": "html", "source": "…" }`) |
| GET | `/api/namespaces/:ns/pages` | Bearer | List pages |
| DELETE | `/api/namespaces/:ns/pages/:slug` | Bearer | Delete a page |
| GET | `/:ns/:slug` | none | Read published page (HTML pages serve from `u.bul.sh`, sandboxed) |
| GET | `/:ns/:slug?raw` | none | Read the source (markdown, or HTML for html pages) |
