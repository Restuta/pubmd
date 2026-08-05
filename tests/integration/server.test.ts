import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { type StartedTestServer, startTestServer } from "./test-server.js";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

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

  it("accepts gzipped JSON publish requests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-gzip-"));
    server = await startTestServer(root);

    const claimResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/claim`,
      { method: "POST" },
    );
    const claimed = (await claimResponse.json()) as { token: string };
    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${claimed.token}`,
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        body: new Blob([
          toArrayBuffer(
            gzipSync(
              JSON.stringify({
                markdown: "---\ntitle: Gzip Note\n---\n\nCompressed body.",
              }),
            ),
          ),
        ]),
      },
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as { url: string };
    const htmlResponse = await fetch(published.url);
    expect(await htmlResponse.text()).toContain("Compressed body.");
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

  it("rejects a pageId from another namespace (404) and an empty raw body (400)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-edge-"));
    server = await startTestServer(root);

    const tokenFor = async (ns: string): Promise<string> => {
      const res = await fetch(`${server?.origin}/api/namespaces/${ns}/claim`, {
        method: "POST",
      });
      return ((await res.json()) as { token: string }).token;
    };

    const tokenA = await tokenFor("nsa");
    const tokenB = await tokenFor("nsb");

    // publish a page in namespace A, capture its pageId
    const aPublish = await fetch(
      `${server.origin}/api/namespaces/nsa/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenA}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ markdown: "---\ntitle: A Page\n---\n\nHi." }),
      },
    );
    const aPageId = ((await aPublish.json()) as { pageId: string }).pageId;

    // namespace B tries to publish using A's pageId -> 404 (not 401)
    const crossNs = await fetch(
      `${server.origin}/api/namespaces/nsb/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenB}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ markdown: "x", pageId: aPageId }),
      },
    );
    expect(crossNs.status).toBe(404);

    // an empty raw body is rejected (mirrors the JSON path's min(1))
    const empty = await fetch(
      `${server.origin}/api/namespaces/nsb/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenB}`,
          "content-type": "text/markdown",
        },
        body: "   \n  ",
      },
    );
    expect(empty.status).toBe(400);
  });

  it("gates password-protected pages behind a form, cookie, or bearer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-protected-"));
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
    const publish = (body: Record<string, unknown>) =>
      fetch(`${server?.origin}/api/namespaces/restuta/pages/publish`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

    const published = (await (
      await publish({
        markdown: "---\ntitle: Secret Plans\n---\n\nClassified body.",
        password: "open-sesame",
      })
    ).json()) as { url: string };

    // no credentials -> 401 unlock form, never shared-cacheable or indexable
    const anonymous = await fetch(published.url);
    expect(anonymous.status).toBe(401);
    const anonymousBody = await anonymous.text();
    expect(anonymousBody).toContain("Protected page");
    // agents get both the standard challenge and an in-page hint for bearer auth
    expect(anonymous.headers.get("www-authenticate")).toContain("Bearer");
    expect(anonymousBody).toContain("Authorization: Bearer");
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    expect(anonymous.headers.get("cdn-cache-control")).toBeNull();
    expect(anonymous.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(anonymous.headers.get("referrer-policy")).toBe("no-referrer");

    // agents asking for JSON get a structured 401, not the HTML form
    const jsonChallenge = await fetch(published.url, {
      headers: { accept: "application/json" },
    });
    expect(jsonChallenge.status).toBe(401);
    expect(jsonChallenge.headers.get("www-authenticate")).toContain("Bearer");
    const challenge = (await jsonChallenge.json()) as {
      error: string;
      hint: string;
      raw: string;
    };
    expect(challenge.error).toBe("password_required");
    expect(challenge.hint).toContain("Authorization: Bearer");
    expect(challenge.raw).toBe("/restuta/secret-plans?raw");

    // a token in the URL is not accepted — credentials stay out of URLs by design
    const withKey = await fetch(`${published.url}?key=${"0".repeat(64)}`);
    expect(withKey.status).toBe(401);

    // raw source is gated too
    const rawAnonymous = await fetch(`${published.url}?raw=1`);
    expect(rawAnonymous.status).toBe(401);

    // wrong bearer -> 401; right bearer -> 200 with private cache headers
    const wrongBearer = await fetch(published.url, {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrongBearer.status).toBe(401);
    const rightBearer = await fetch(published.url, {
      headers: { authorization: "Bearer open-sesame" },
    });
    expect(rightBearer.status).toBe(200);
    expect(await rightBearer.text()).toContain("Classified body.");
    expect(rightBearer.headers.get("cache-control")).toBe("private, no-store");
    expect(rightBearer.headers.get("cdn-cache-control")).toBeNull();

    // unlock form: wrong password re-renders with an error
    const failedUnlock = await fetch(`${published.url}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=nope",
      redirect: "manual",
    });
    expect(failedUnlock.status).toBe(401);
    expect(await failedUnlock.text()).toContain("Wrong password.");

    // right password -> 303 back to the page + unlock cookie
    const unlock = await fetch(`${published.url}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=open-sesame",
      redirect: "manual",
    });
    expect(unlock.status).toBe(303);
    expect(unlock.headers.get("location")).toBe("/restuta/secret-plans");
    const setCookie = unlock.headers.get("set-cookie") ?? "";
    const cookiePair = setCookie.split(";")[0] ?? "";
    expect(cookiePair).toMatch(/^pubmd_unlock_[0-9a-f-]+=.+/);
    expect(setCookie).toContain("HttpOnly");

    const withCookie = await fetch(published.url, {
      headers: { cookie: cookiePair },
    });
    expect(withCookie.status).toBe(200);
    expect(await withCookie.text()).toContain("Classified body.");

    // republish without a password keeps the protection
    await publish({
      markdown: "---\ntitle: Secret Plans\n---\n\nClassified body v2.",
    });
    const stillGated = await fetch(published.url);
    expect(stillGated.status).toBe(401);

    // rotating the password invalidates old cookies and the old password
    await publish({
      markdown: "---\ntitle: Secret Plans\n---\n\nClassified body v2.",
      password: "new-password",
    });
    const staleCookie = await fetch(published.url, {
      headers: { cookie: cookiePair },
    });
    expect(staleCookie.status).toBe(401);
    const oldPassword = await fetch(published.url, {
      headers: { authorization: "Bearer open-sesame" },
    });
    expect(oldPassword.status).toBe(401);
    const newPassword = await fetch(published.url, {
      headers: { authorization: "Bearer new-password" },
    });
    expect(newPassword.status).toBe(200);

    // empty password removes protection entirely, restoring public caching
    await publish({
      markdown: "---\ntitle: Secret Plans\n---\n\nClassified body v2.",
      password: "",
    });
    const reopened = await fetch(published.url);
    expect(reopened.status).toBe(200);
    expect(reopened.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(reopened.headers.get("cdn-cache-control")).toContain("public");

    // unlocking an unprotected page is a 404, same as a missing one
    const unlockGone = await fetch(`${published.url}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=new-password",
      redirect: "manual",
    });
    expect(unlockGone.status).toBe(404);
  });

  it("accepts a password on the raw-body curl publish path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-curl-pw-"));
    server = await startTestServer(root);

    const claimed = (await (
      await fetch(`${server.origin}/api/namespaces/restuta/claim`, {
        method: "POST",
      })
    ).json()) as { token: string };

    const publishResponse = await fetch(
      `${server.origin}/api/namespaces/restuta/pages/publish?password=kwyjibo`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${claimed.token}` },
        body: "---\ntitle: Curl Secret\n---\n\nPiped body.",
      },
    );
    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as { url: string };

    const anonymous = await fetch(published.url);
    expect(anonymous.status).toBe(401);
    const authorized = await fetch(published.url, {
      headers: { authorization: "Bearer kwyjibo" },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain("Piped body.");
  });
});
