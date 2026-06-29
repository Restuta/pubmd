import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_EXPIRATION_MS } from "../../src/core/expiration.js";
import type { NamespaceExpirationResolver } from "../../src/core/namespace-config.js";
import { type StartedTestServer, startTestServer } from "./test-server.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PublishResult {
  expiresAt: string | null;
  noOp: boolean;
  pageId: string;
  slug: string;
  url: string;
}

describe("page expiration", () => {
  let server: StartedTestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function claim(origin: string, ns: string): Promise<string> {
    const res = await fetch(`${origin}/api/namespaces/${ns}/claim`, {
      method: "POST",
    });
    return ((await res.json()) as { token: string }).token;
  }

  async function publish(
    origin: string,
    ns: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; result: PublishResult }> {
    const res = await fetch(`${origin}/api/namespaces/${ns}/pages/publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, result: (await res.json()) as PublishResult };
  }

  it("never expires by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-default-"));
    server = await startTestServer(root);
    const token = await claim(server.origin, "alice");

    const { result } = await publish(server.origin, "alice", token, {
      markdown: "---\ntitle: Forever\n---\n\nBody.",
    });

    expect(result.expiresAt).toBeNull();
  });

  it("applies a per-page duration and the 14-day default", async () => {
    const base = Date.parse("2026-06-29T00:00:00.000Z");
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-page-"));
    server = await startTestServer(root, {
      serviceOptions: { now: () => base },
    });
    const token = await claim(server.origin, "alice");

    const explicit = await publish(server.origin, "alice", token, {
      markdown: "---\ntitle: Short Lived\n---\n\nBody.",
      expires: "7d",
    });
    expect(Date.parse(explicit.result.expiresAt ?? "")).toBe(
      base + 7 * MS_PER_DAY,
    );

    const defaulted = await publish(server.origin, "alice", token, {
      markdown: "---\ntitle: Default TTL\n---\n\nBody.",
      expires: true,
    });
    expect(Date.parse(defaulted.result.expiresAt ?? "")).toBe(
      base + DEFAULT_EXPIRATION_MS,
    );
  });

  it("reads expires from frontmatter", async () => {
    const base = Date.parse("2026-06-29T00:00:00.000Z");
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-front-"));
    server = await startTestServer(root, {
      serviceOptions: { now: () => base },
    });
    const token = await claim(server.origin, "alice");

    const { result } = await publish(server.origin, "alice", token, {
      markdown: "---\ntitle: FM\nexpires: 2d\n---\n\nBody.",
    });

    expect(Date.parse(result.expiresAt ?? "")).toBe(base + 2 * MS_PER_DAY);
  });

  it("404s an expired page and drops it from listings", async () => {
    const clock = { value: Date.parse("2026-06-29T00:00:00.000Z") };
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-gone-"));
    server = await startTestServer(root, {
      serviceOptions: { now: () => clock.value },
    });
    const token = await claim(server.origin, "alice");

    const { result } = await publish(server.origin, "alice", token, {
      markdown: "---\ntitle: Ephemeral\n---\n\nBody.",
      expires: "1d",
    });

    // Live before the deadline.
    expect((await fetch(result.url)).status).toBe(200);
    const listBefore = (await (
      await fetch(`${server.origin}/api/namespaces/alice/pages`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { pages: unknown[] };
    expect(listBefore.pages).toHaveLength(1);

    // Advance past expiry.
    clock.value += 2 * MS_PER_DAY;

    expect((await fetch(result.url)).status).toBe(404);
    const listAfter = (await (
      await fetch(`${server.origin}/api/namespaces/alice/pages`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { pages: unknown[] };
    expect(listAfter.pages).toHaveLength(0);
  });

  it("expires pages in namespaces under policy, with per-page override", async () => {
    const base = Date.parse("2026-06-29T00:00:00.000Z");
    const resolveNamespaceExpiration: NamespaceExpirationResolver = (ns) =>
      ns === "secret" ? true : undefined;
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-ns-"));
    server = await startTestServer(root, {
      serviceOptions: { now: () => base, resolveNamespaceExpiration },
    });

    const secretToken = await claim(server.origin, "secret");
    const publicToken = await claim(server.origin, "public");

    // Sensitive namespace: pages expire with the default TTL automatically.
    const secret = await publish(server.origin, "secret", secretToken, {
      markdown: "---\ntitle: Classified\n---\n\nBody.",
    });
    expect(Date.parse(secret.result.expiresAt ?? "")).toBe(
      base + DEFAULT_EXPIRATION_MS,
    );

    // A page can opt out even under a namespace policy.
    const pinned = await publish(server.origin, "secret", secretToken, {
      markdown: "---\ntitle: Pinned\n---\n\nBody.",
      expires: "never",
    });
    expect(pinned.result.expiresAt).toBeNull();

    // Unconfigured namespace: still never expires.
    const open = await publish(server.origin, "public", publicToken, {
      markdown: "---\ntitle: Open\n---\n\nBody.",
    });
    expect(open.result.expiresAt).toBeNull();
  });

  it("keeps the original deadline when republishing identical content", async () => {
    const clock = { value: Date.parse("2026-06-29T00:00:00.000Z") };
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-repub-"));
    server = await startTestServer(root, {
      serviceOptions: { now: () => clock.value },
    });
    const token = await claim(server.origin, "alice");
    const body = {
      markdown: "---\ntitle: Stable\n---\n\nSame body.",
      expires: "10d",
    };

    const first = await publish(server.origin, "alice", token, body);
    clock.value += 3 * MS_PER_DAY;
    const second = await publish(server.origin, "alice", token, body);

    expect(second.result.noOp).toBe(true);
    expect(second.result.expiresAt).toBe(first.result.expiresAt);
  });

  it("rejects an invalid duration with 400", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pubmd-exp-bad-"));
    server = await startTestServer(root);
    const token = await claim(server.origin, "alice");

    const res = await fetch(
      `${server.origin}/api/namespaces/alice/pages/publish`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          markdown: "---\ntitle: Bad\n---\n\nBody.",
          expires: "whenever",
        }),
      },
    );

    expect(res.status).toBe(400);
  });
});
