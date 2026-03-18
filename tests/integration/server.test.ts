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
});
