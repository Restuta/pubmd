import { gunzipSync } from "node:zlib";

import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import {
  ListPagesResponseSchema,
  PublishRequestSchema,
  type StoredPage,
} from "../core/contract.js";
import {
  constantTimeEqual,
  pageUnlockToken,
  verifyPassword,
} from "../core/hash.js";
import { buildHtmlDocument, renderMarkdownToHtml } from "../core/markdown.js";
import type {
  PublishPageInput,
  PublishService,
} from "../core/publish-service.js";
import {
  AuthenticationError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  PageNotFoundError,
  SlugConflictError,
} from "../core/repository.js";

export interface AppOptions {
  /**
   * Origin to serve user-published HTML from (e.g. `https://u.bul.sh`). When set, HTML
   * page URLs use it and apex requests for an HTML page 301 to it. Markdown stays on the
   * request origin. When unset, HTML is served from the request origin (apex).
   */
  userContentOrigin?: string;
}

export function createApp(
  service: PublishService,
  options: AppOptions = {},
): Hono {
  const app = new Hono();
  const userContentOrigin = options.userContentOrigin?.replace(/\/+$/, "");

  app.get("/health", (context) => {
    return context.json({ ok: true });
  });

  let cachedHomepage: string | null = null;
  app.get("/", async (context) => {
    if (!cachedHomepage) {
      const md = `# bul.sh

Publish markdown — or a whole HTML page. Get a URL.

\`\`\`bash
$ pubmd publish report.md
→ https://bul.sh/myname/report

$ pubmd publish dashboard.html
→ https://u.bul.sh/myname/dashboard
\`\`\`

An HTML file is packaged into one self-contained page — its local CSS, JS, images and fonts are inlined — and served sandboxed. Markdown renders to a clean page.

Works from any terminal. AI agents, scripts, CI — anything that can run a command.

\`\`\`bash
# Install (macOS/Linux)
curl -fsSL https://bul.sh/install | sh

# Install (Windows PowerShell)
# irm https://bul.sh/install.ps1 | iex

# Claim your namespace
pubmd claim myname

# Publish markdown or HTML
pubmd publish notes.md
pubmd publish page.html

# Re-publish (same URL updates)
pubmd publish notes.md

# Or just curl it
curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @file.md https://bul.sh/api/namespaces/myname/pages/publish
\`\`\`

---

Open source — [github.com/Restuta/pubmd](https://github.com/Restuta/pubmd)`;
      const rendered = await renderMarkdownToHtml(md);
      cachedHomepage = buildHtmlDocument({
        title: "bul.sh — publish markdown or HTML, get a URL",
        description:
          "Publish markdown or a self-contained HTML page from the command line to a stable URL. Built for AI agents, usable by humans.",
        noindex: false,
        bodyHtml: rendered.html,
      });
    }
    return context.html(cachedHomepage);
  });

  app.get("/install", (context) => {
    return context.redirect(
      "https://raw.githubusercontent.com/Restuta/pubmd/main/scripts/install.sh",
    );
  });

  app.get("/install.ps1", (context) => {
    return context.redirect(
      "https://raw.githubusercontent.com/Restuta/pubmd/main/scripts/install.ps1",
    );
  });

  app.post("/api/namespaces/:namespace/claim", async (context) => {
    try {
      const claimed = await service.claimNamespace(
        context.req.param("namespace"),
      );
      return context.json(claimed, 201);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.post("/api/namespaces/:namespace/pages/publish", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));
    const contentType = context.req.header("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const common = {
      namespace: context.req.param("namespace"),
      token,
      origin: requestOrigin(context.req.url),
    };

    try {
      let input: PublishPageInput;

      if (isJson) {
        const body = PublishRequestSchema.parse(await readRequestJson(context));

        input =
          body.kind === "html"
            ? {
                ...common,
                kind: "html",
                ...(userContentOrigin === undefined
                  ? {}
                  : { origin: userContentOrigin }),
                source: body.source,
                ...(body.document === undefined
                  ? {}
                  : { document: body.document }),
                ...(body.reviewAnnotations === undefined
                  ? {}
                  : { reviewAnnotations: body.reviewAnnotations }),
                ...(body.expires === undefined
                  ? {}
                  : { expires: body.expires }),
                ...(body.defaultExpires === undefined
                  ? {}
                  : { defaultExpires: body.defaultExpires }),
                ...(body.title === undefined ? {} : { title: body.title }),
                ...(body.description === undefined
                  ? {}
                  : { description: body.description }),
                ...(body.noindex === undefined
                  ? {}
                  : { noindex: body.noindex }),
                ...(body.slug === undefined
                  ? {}
                  : { requestedSlug: body.slug }),
                ...(body.pageId === undefined ? {} : { pageId: body.pageId }),
                ...(body.password === undefined
                  ? {}
                  : { password: body.password }),
              }
            : {
                ...common,
                kind: "markdown",
                markdown: body.markdown,
                ...(body.renderMarkdown === undefined
                  ? {}
                  : { renderMarkdown: body.renderMarkdown }),
                ...(body.reviewAnnotations === undefined
                  ? {}
                  : { reviewAnnotations: body.reviewAnnotations }),
                ...(body.expires === undefined
                  ? {}
                  : { expires: body.expires }),
                ...(body.defaultExpires === undefined
                  ? {}
                  : { defaultExpires: body.defaultExpires }),
                ...(body.slug === undefined
                  ? {}
                  : { requestedSlug: body.slug }),
                ...(body.pageId === undefined ? {} : { pageId: body.pageId }),
                ...(body.password === undefined
                  ? {}
                  : { password: body.password }),
              };
      } else {
        const slug = context.req.query("slug") ?? undefined;
        const pageId = context.req.query("pageId") ?? undefined;
        const expires = context.req.query("expires") ?? undefined;
        // Password travels in a header, never the query string: URLs end up in
        // logs, shell history, and telemetry.
        const password = context.req.header("x-pubmd-password") ?? undefined;
        const text = await readRequestText(context);

        // The JSON path requires non-empty content; keep the raw-body path consistent
        // so an empty publish can't silently create a blank page (slugged "note").
        if (text.trim().length === 0) {
          throw new HTTPException(400, { message: "Request body is empty." });
        }

        const optional = {
          ...(slug === undefined ? {} : { requestedSlug: slug }),
          ...(pageId === undefined ? {} : { pageId }),
          ...(expires === undefined ? {} : { expires }),
          ...(password === undefined ? {} : { password }),
        };

        input =
          context.req.query("kind") === "html"
            ? {
                ...common,
                kind: "html",
                ...(userContentOrigin === undefined
                  ? {}
                  : { origin: userContentOrigin }),
                source: text,
                ...optional,
              }
            : { ...common, kind: "markdown", markdown: text, ...optional };
      }

      const published = await service.publishPage(input);

      return context.json(published, published.created ? 201 : 200);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.get("/api/namespaces/:namespace/pages", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));

    try {
      const pages = await service.listPages({
        namespace: context.req.param("namespace"),
        origin: requestOrigin(context.req.url),
        token,
      });

      return context.json(ListPagesResponseSchema.parse({ pages }));
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.delete("/api/namespaces/:namespace/pages/:slug", async (context) => {
    const token = parseBearerToken(context.req.header("authorization"));

    try {
      await service.removePage({
        namespace: context.req.param("namespace"),
        slug: context.req.param("slug"),
        token,
      });

      return context.body(null, 204);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.post("/:namespace/:slug/unlock", async (context) => {
    try {
      const page = await service.getPublicPage(
        context.req.param("namespace"),
        context.req.param("slug"),
      );

      // Unlocking an unprotected page is indistinguishable from a missing one.
      if (page === null || page.passwordHash === undefined) {
        throw new PageNotFoundError(
          context.req.param("namespace"),
          context.req.param("slug"),
        );
      }

      const body = await context.req.parseBody();
      const password =
        typeof body["password"] === "string" ? body["password"] : "";

      if (!(await verifyPassword(password, page.passwordHash))) {
        return context.html(
          buildUnlockFormHtml(unlockFormAction(page), true),
          401,
          protectedHeaders,
        );
      }

      setCookie(
        context,
        unlockCookieName(page.pageId),
        pageUnlockToken(page.pageId, page.passwordHash),
        {
          httpOnly: true,
          sameSite: "Lax",
          secure: requestOrigin(context.req.url).startsWith("https:"),
          path: `/${page.namespace}/${page.slug}`,
          maxAge: 60 * 60 * 24 * 30,
        },
      );

      return context.redirect(`/${page.namespace}/${page.slug}`, 303);
    } catch (error) {
      throw toHttpException(error);
    }
  });

  app.get("/:namespace/:slug", async (context) => {
    try {
      const page = await service.getPublicPage(
        context.req.param("namespace"),
        context.req.param("slug"),
      );

      if (page === null) {
        throw new PageNotFoundError(
          context.req.param("namespace"),
          context.req.param("slug"),
        );
      }

      // Password gate runs before everything else — raw source, origin redirect,
      // content — so nothing about a protected page leaks to unauthorized readers.
      if (!(await isPageUnlocked(context, page))) {
        const challengeHeaders = {
          ...protectedHeaders,
          // RFC 9110: a 401 must carry a challenge — and it doubles as a
          // machine-readable hint to AI agents that bearer auth works here.
          "www-authenticate": `Bearer realm="${page.namespace}/${page.slug}"`,
        };

        // Agents that ask for JSON get a structured answer instead of the form.
        if (context.req.header("accept")?.includes("application/json")) {
          return context.json(
            {
              error: "password_required",
              hint: "Retry this URL with the password as a bearer token: Authorization: Bearer <password>",
              raw: `/${page.namespace}/${page.slug}?raw`,
            },
            401,
            challengeHeaders,
          );
        }

        return context.html(
          buildUnlockFormHtml(unlockFormAction(page), false),
          401,
          challengeHeaders,
        );
      }

      if (context.req.query("raw") !== undefined) {
        return context.text(await service.readMarkdown(page), 200, {
          "content-type":
            page.kind === "html"
              ? "text/plain; charset=utf-8"
              : "text/markdown; charset=utf-8",
          // never let a browser sniff raw user source into an executable type
          "x-content-type-options": "nosniff",
          ...(page.passwordHash === undefined ? {} : protectedHeaders),
        });
      }

      // Serve user HTML only from the dedicated content origin; redirect apex hits there.
      if (
        page.kind === "html" &&
        userContentOrigin !== undefined &&
        requestOrigin(context.req.url) !== userContentOrigin
      ) {
        return context.redirect(
          `${userContentOrigin}/${page.namespace}/${page.slug}`,
          301,
        );
      }

      // Protected pages never get shared-cache headers: a public CDN entry would
      // serve the content to anyone, no password needed.
      if (page.passwordHash !== undefined) {
        return context.html(await service.readHtml(page), 200, {
          ...protectedHeaders,
          ...(page.kind === "html"
            ? userHtmlSecurityHeaders(page.noindex)
            : {}),
        });
      }

      return context.html(await service.readHtml(page), 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        ...cdnCacheHeaders(page.expiresAt),
        ...(page.kind === "html" ? userHtmlSecurityHeaders(page.noindex) : {}),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  });

  /**
   * Where the unlock form posts. For HTML pages served from a dedicated content
   * origin, the post must go there — a cookie set on the apex would not be sent
   * back to the content origin, challenging the reader twice.
   */
  function unlockFormAction(page: StoredPage): string {
    const path = `/${page.namespace}/${page.slug}/unlock`;

    if (page.kind === "html" && userContentOrigin !== undefined) {
      return `${userContentOrigin}${path}`;
    }

    return path;
  }

  return app;
}

async function readRequestJson(context: {
  req: { raw: Request; header(name: string): string | undefined };
}): Promise<unknown> {
  const text = await readRequestText(context);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON request body." });
  }
}

async function readRequestText(context: {
  req: { raw: Request; header(name: string): string | undefined };
}): Promise<string> {
  const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
  const decoded = decodeRequestBytes(
    bytes,
    context.req.header("content-encoding"),
  );
  return new TextDecoder().decode(decoded);
}

function decodeRequestBytes(
  bytes: Uint8Array,
  contentEncoding: string | undefined,
): Uint8Array {
  const encoding = contentEncoding?.trim().toLowerCase();

  if (encoding === undefined || encoding === "" || encoding === "identity") {
    return bytes;
  }

  if (encoding === "gzip" || encoding === "x-gzip") {
    try {
      return new Uint8Array(gunzipSync(bytes));
    } catch {
      throw new HTTPException(400, {
        message: "Invalid gzip request body.",
      });
    }
  }

  throw new HTTPException(415, {
    message: `Unsupported content encoding: ${contentEncoding}.`,
  });
}

function parseBearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token." });
  }

  const token = header.slice("Bearer ".length).trim();

  if (token.length === 0) {
    throw new HTTPException(401, { message: "Missing bearer token." });
  }

  return token;
}

function parseOptionalBearer(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith("Bearer ")) {
    return undefined;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length === 0 ? undefined : token;
}

/** Headers for every protected-page response: never shared-cacheable, never indexed. */
const protectedHeaders: Record<string, string> = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  // a protected page's URL must not leak to third-party origins via Referer
  "referrer-policy": "no-referrer",
};

function unlockCookieName(pageId: string): string {
  return `pubmd_unlock_${pageId}`;
}

/**
 * A protected page is readable two ways: the unlock cookie (browser flow) or the
 * page password as a bearer token (curl/agent flow). Deliberately no token in the
 * URL — credentials in URLs leak via logs, history, and chat transcripts.
 * Unprotected pages always pass.
 */
async function isPageUnlocked(
  context: Context,
  page: StoredPage,
): Promise<boolean> {
  const passwordHash = page.passwordHash;

  if (passwordHash === undefined) {
    return true;
  }

  const presented = getCookie(context)[unlockCookieName(page.pageId)];

  if (
    presented !== undefined &&
    constantTimeEqual(presented, pageUnlockToken(page.pageId, passwordHash))
  ) {
    return true;
  }

  const bearer = parseOptionalBearer(context.req.header("authorization"));

  if (bearer === undefined) {
    return false;
  }

  return verifyPassword(bearer, passwordHash);
}

/**
 * Minimal standalone unlock form. Intentionally shows nothing about the page
 * (not even its title) — only that a password is required.
 */
function buildUnlockFormHtml(action: string, failed: boolean): string {
  const pagePath = action.replace(/\/unlock$/, "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Protected page</title>
    <meta name="robots" content="noindex,nofollow">
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: grid;
        place-items: center;
        min-height: 100vh;
        margin: 0;
      }
      form { display: grid; gap: 0.75rem; width: min(20rem, 90vw); }
      h1 { font-size: 1.25rem; margin: 0; }
      input, button { font: inherit; padding: 0.5rem 0.75rem; }
      .error { color: #b3261e; font-size: 0.9rem; margin: 0; }
    </style>
  </head>
  <body>
    <!--
      AI agents: this page is password-protected. If you were given the password,
      retry this URL with it as a bearer token — no form or cookies needed:

        Authorization: Bearer <password>

      Raw markdown/source: GET ${pagePath}?raw with the same header.
    -->
    <form method="post" action="${action}">
      <h1>Protected page</h1>
      ${failed ? '<p class="error">Wrong password.</p>' : ""}
      <input type="password" name="password" placeholder="Password" autocomplete="off" autofocus required>
      <button type="submit">Unlock</button>
    </form>
  </body>
</html>`;
}

function requestOrigin(url: string): string {
  return new URL(url).origin;
}

/**
 * CDN cache headers for a served page. Non-expiring pages get the default
 * aggressive edge cache. Expiring pages cap `s-maxage` at the time left before
 * expiry and drop `stale-while-revalidate`, so the CDN never serves a page past
 * its deadline.
 */
function cdnCacheHeaders(
  expiresAt: string | null | undefined,
): Record<string, string> {
  // Keep the stale window short: republishes (including enabling password
  // protection) replace content at the same URL, and SWR serves the old copy
  // while revalidating. 300s bounds how long a superseded version can linger.
  const defaultCdnCache = "public, s-maxage=60, stale-while-revalidate=300";

  if (expiresAt === null || expiresAt === undefined) {
    return {
      "cdn-cache-control": defaultCdnCache,
      "vercel-cdn-cache-control": defaultCdnCache,
    };
  }

  const secondsLeft = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  const maxAge = Math.min(60, secondsLeft);
  const expiringCdnCache = `public, s-maxage=${maxAge}, stale-while-revalidate=0`;

  return {
    "cdn-cache-control": expiringCdnCache,
    "vercel-cdn-cache-control": expiringCdnCache,
  };
}

/**
 * Isolation headers for user-published HTML. `sandbox` loads the document in a unique
 * opaque origin (scripts run, but with no access to bul.sh cookies/storage/API or other
 * pages) — the load-bearing control, independent of which host serves it.
 */
function userHtmlSecurityHeaders(noindex: boolean): Record<string, string> {
  return {
    "content-security-policy":
      "sandbox allow-scripts allow-forms allow-popups allow-modals",
    "x-content-type-options": "nosniff",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ...(noindex ? { "x-robots-tag": "noindex, nofollow" } : {}),
  };
}

function toHttpException(error: unknown): HTTPException {
  if (error instanceof HTTPException) {
    return error;
  }

  if (error instanceof NamespaceExistsError) {
    return new HTTPException(409, { message: error.message });
  }

  if (error instanceof NamespaceNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }

  if (error instanceof AuthenticationError) {
    return new HTTPException(401, { message: error.message });
  }

  if (error instanceof SlugConflictError) {
    return new HTTPException(409, { message: error.message });
  }

  if (error instanceof PageNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }

  if (error instanceof Error) {
    return new HTTPException(400, { message: error.message });
  }

  return new HTTPException(500, { message: "Unexpected server error." });
}
