import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  ListPagesResponseSchema,
  PublishRequestSchema,
} from "../core/contract.js";
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
        const body = PublishRequestSchema.parse(await context.req.json());

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
              };
      } else {
        const slug = context.req.query("slug") ?? undefined;
        const pageId = context.req.query("pageId") ?? undefined;
        const expires = context.req.query("expires") ?? undefined;
        const text = await context.req.text();

        // The JSON path requires non-empty content; keep the raw-body path consistent
        // so an empty publish can't silently create a blank page (slugged "note").
        if (text.trim().length === 0) {
          throw new HTTPException(400, { message: "Request body is empty." });
        }

        const optional = {
          ...(slug === undefined ? {} : { requestedSlug: slug }),
          ...(pageId === undefined ? {} : { pageId }),
          ...(expires === undefined ? {} : { expires }),
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

      if (context.req.query("raw") !== undefined) {
        return context.text(await service.readMarkdown(page), 200, {
          "content-type":
            page.kind === "html"
              ? "text/plain; charset=utf-8"
              : "text/markdown; charset=utf-8",
          // never let a browser sniff raw user source into an executable type
          "x-content-type-options": "nosniff",
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

      return context.html(await service.readHtml(page), 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        ...cdnCacheHeaders(page.expiresAt),
        ...(page.kind === "html" ? userHtmlSecurityHeaders(page.noindex) : {}),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  });

  return app;
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
  const defaultCdnCache = "public, s-maxage=60, stale-while-revalidate=86400";

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
