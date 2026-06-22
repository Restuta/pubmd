import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type StartedTestServer, startTestServer } from "./test-server.js";

describe("server integration", () => {
  let server: StartedTestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("claims namespaces, publishes pages, serves html and raw markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-server-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/claim`,
      { method: "POST" },
    );
    expect(claimResponse.status).toBe(201);
    const claimed = (await claimResponse.json()) as { token: string };
    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: `---
title: Launch Post
description: Short launch note
noindex: false
---

# Hello

This is the body.`,
        }),
      },
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      created: boolean;
      noOp: boolean;
      pageId: string;
      slug: string;
      updated: boolean;
      url: string;
    };
    expect(published.slug).toBe("launch-post");
    expect(published.created).toBe(true);
    expect(published.updated).toBe(false);
    expect(published.noOp).toBe(false);

    const noOpResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: `---
title: Launch Post
description: Short launch note
noindex: false
---

# Hello

This is the body.`,
        }),
      },
    );
    expect(noOpResponse.status).toBe(200);
    const noOpPublished = (await noOpResponse.json()) as {
      created: boolean;
      noOp: boolean;
      updated: boolean;
      url: string;
    };
    expect(noOpPublished.url).toBe(published.url);
    expect(noOpPublished.created).toBe(false);
    expect(noOpPublished.updated).toBe(false);
    expect(noOpPublished.noOp).toBe(true);

    const htmlResponse = await fetch(published.url);
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(htmlResponse.headers.get("cdn-cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=86400",
    );
    expect(htmlResponse.headers.get("vercel-cdn-cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=86400",
    );
    expect(html).toContain("<title>Launch Post</title>");
    expect(html).toContain("This is the body.");

    const rawResponse = await fetch(`${published.url}?raw=1`);
    expect(rawResponse.status).toBe(200);
    expect(await rawResponse.text()).toContain("This is the body.");

    const listResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages`,
      {
        headers: {
          authorization: `Bearer ${claimed.token}`,
        },
      },
    );
    const listed = (await listResponse.json()) as {
      pages: Array<{ slug: string; url: string }>;
    };
    expect(listed.pages).toHaveLength(1);
    expect(listed.pages[0]?.slug).toBe("launch-post");
  });

  it("serves published html verbatim with sandbox isolation, while markdown stays unsandboxed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-html-"));
    server = await startTestServer(root);

    const claimed = (await (
      await fetch(`${server.origin}/api/namespaces/restuta/claim`, {
        method: "POST",
      })
    ).json()) as { token: string };
    const headers = {
      authorization: `Bearer ${claimed.token}`,
      "content-type": "application/json",
    };

    const htmlDocument =
      "<!doctype html><html><head><title>Raw HTML</title></head><body><h1>verbatim</h1><script>window.x = 1;</script></body></html>";
    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "html", source: htmlDocument }),
      },
    );
    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      slug: string;
      url: string;
    };
    // slug derives from the <title>
    expect(published.slug).toBe("raw-html");

    const pageResponse = await fetch(published.url);
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toContain("text/html");
    expect(pageResponse.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(pageResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pageResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    // served byte-for-byte: no bul.sh template wrapping
    expect(await pageResponse.text()).toBe(htmlDocument);

    const rawResponse = await fetch(`${published.url}?raw=1`);
    expect(rawResponse.headers.get("content-type")).toContain("text/plain");
    expect(rawResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await rawResponse.text()).toBe(htmlDocument);

    // a markdown page on the same server must NOT carry the sandbox headers
    const mdPublish = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          markdown: "---\ntitle: Plain Note\n---\n\nBody.",
        }),
      },
    );
    const mdPage = (await mdPublish.json()) as { url: string };
    const mdResponse = await fetch(mdPage.url);
    expect(mdResponse.headers.get("content-security-policy")).toBeNull();
    expect(mdResponse.headers.get("x-content-type-options")).toBeNull();
  });

  it("serves html from the configured content origin and redirects apex hits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-origin-"));
    const userContentOrigin = "https://u.bul.sh";
    server = await startTestServer(root, { userContentOrigin });

    const claimed = (await (
      await fetch(`${server.origin}/api/namespaces/restuta/claim`, {
        method: "POST",
      })
    ).json()) as { token: string };
    const headers = {
      authorization: `Bearer ${claimed.token}`,
      "content-type": "application/json",
    };

    const htmlPublish = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "html",
          source: "<title>Routed</title><h1>hi</h1>",
        }),
      },
    );
    const htmlPage = (await htmlPublish.json()) as {
      url: string;
      slug: string;
    };
    // published URL points at the content origin, not the apex
    expect(htmlPage.url).toBe(`${userContentOrigin}/restuta/${htmlPage.slug}`);

    // requesting the html page on the apex 301s to the content origin
    const apexHit = await fetch(`${server.origin}/restuta/${htmlPage.slug}`, {
      redirect: "manual",
    });
    expect(apexHit.status).toBe(301);
    expect(apexHit.headers.get("location")).toBe(
      `${userContentOrigin}/restuta/${htmlPage.slug}`,
    );

    // a markdown page is still served on the apex (no redirect)
    const mdPublish = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ markdown: "---\ntitle: Stay\n---\n\nBody." }),
      },
    );
    const mdPage = (await mdPublish.json()) as { url: string };
    expect(mdPage.url).toBe(`${server.origin}/restuta/stay`);
    const mdHit = await fetch(mdPage.url, { redirect: "manual" });
    expect(mdHit.status).toBe(200);
  });
});
