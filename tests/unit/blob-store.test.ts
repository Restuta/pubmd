import { beforeEach, describe, expect, it, vi } from "vitest";

const blobState = vi.hoisted(() => {
  return {
    stores: new Map<string, Map<string, string>>(),
  };
});

vi.mock("@vercel/blob", () => {
  function getStore(token: string): Map<string, string> {
    let store = blobState.stores.get(token);

    if (store === undefined) {
      store = new Map<string, string>();
      blobState.stores.set(token, store);
    }

    return store;
  }

  return {
    del: vi.fn(
      async (target: string | string[], options: { token: string }) => {
        const store = getStore(options.token);
        const pathnames = Array.isArray(target) ? target : [target];

        for (const pathname of pathnames) {
          store.delete(pathname);
        }
      },
    ),
    get: vi.fn(async (pathname: string, options: { token: string }) => {
      const store = getStore(options.token);
      const value = store.get(pathname);

      if (value === undefined) {
        return null;
      }

      const body = new Response(value).body;

      if (body === null) {
        throw new Error("Response body was unexpectedly null.");
      }

      return {
        statusCode: 200 as const,
        stream: body,
      };
    }),
    put: vi.fn(
      async (
        pathname: string,
        body: string,
        options: { allowOverwrite?: boolean; token: string },
      ) => {
        const store = getStore(options.token);

        if (options.allowOverwrite === false && store.has(pathname)) {
          throw new Error("already exists");
        }

        store.set(pathname, body);
        return {
          pathname,
          url: `https://blob.example/${pathname}`,
        };
      },
    ),
  };
});

import { del } from "@vercel/blob";

import { createBlobStore } from "../../src/core/blob-store.js";
import type { StoredPage } from "../../src/core/contract.js";

describe("createBlobStore", () => {
  const contentToken = "content-token";
  const metadataToken = "metadata-token";

  beforeEach(() => {
    blobState.stores.clear();
  });

  it("claims and updates namespaces in metadata storage", async () => {
    const store = createBlobStore(contentToken, metadataToken);

    await store.claimNamespace("demo", "hash-1");
    await store.touchNamespace("demo", "2026-03-19T00:00:00.000Z");

    const namespace = await store.getNamespace("demo");
    expect(namespace).toMatchObject({
      namespace: "demo",
      tokenHash: "hash-1",
      lastPublishAt: "2026-03-19T00:00:00.000Z",
    });
  });

  it("stores content publicly and metadata privately", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      createdAt: "2026-03-19T00:00:00.000Z",
      description: "Demo description",
      pageId: "11111111-1111-4111-8111-111111111111",
      slug: "demo-page",
      title: "Demo Page",
      updatedAt: "2026-03-19T00:00:00.000Z",
    });

    await store.savePage(
      page,
      { content: "# demo", key: page.markdownBlobKey },
      { content: "<h1>demo</h1>", key: page.htmlBlobKey },
    );

    expect(await store.readMarkdown(page.markdownBlobKey)).toBe("# demo");
    expect(await store.readHtml(page.htmlBlobKey)).toBe("<h1>demo</h1>");
    expect(await store.findPageById(page.pageId)).toMatchObject({
      slug: "demo-page",
      title: "Demo Page",
    });
    expect(await store.findPageBySlug("demo", "demo-page")).toMatchObject({
      pageId: page.pageId,
    });
    expect(await store.listPages("demo")).toHaveLength(1);
  });

  it("stores protected content in the private store and moves it when protection toggles", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      pageId: "44444444-4444-4444-8444-444444444444",
      slug: "secret",
      passwordHash: "salt:hash",
    });

    await store.savePage(
      page,
      { content: "# secret", key: page.markdownBlobKey },
      { content: "<h1>secret</h1>", key: page.htmlBlobKey },
    );

    const contentStore = () => blobState.stores.get(contentToken);
    const privateStore = () => blobState.stores.get(metadataToken);
    const inStore = (token: string, key: string) =>
      blobState.stores.get(token)?.has(key) ?? false;

    // protected content never touches the public store
    expect(inStore(contentToken, page.htmlBlobKey)).toBe(false);
    expect(inStore(contentToken, page.markdownBlobKey)).toBe(false);
    expect(privateStore()?.get(page.htmlBlobKey)).toBe("<h1>secret</h1>");
    expect(await store.readHtml(page.htmlBlobKey, "private")).toBe(
      "<h1>secret</h1>",
    );

    // removing protection moves the content to the public store and deletes
    // the private copy
    const reopened = makePage({
      ...page,
      passwordHash: undefined,
      updatedAt: "2026-03-19T00:05:00.000Z",
    });
    await store.savePage(
      reopened,
      { content: "# secret", key: reopened.markdownBlobKey },
      { content: "<h1>secret</h1>", key: reopened.htmlBlobKey },
    );
    expect(contentStore()?.get(reopened.htmlBlobKey)).toBe("<h1>secret</h1>");
    expect(inStore(metadataToken, reopened.htmlBlobKey)).toBe(false);

    // protecting again moves it back to private and deletes the public copy
    const reprotected = makePage({
      ...page,
      passwordHash: "salt:hash2",
      updatedAt: "2026-03-19T00:10:00.000Z",
    });
    await store.savePage(
      reprotected,
      { content: "# secret", key: reprotected.markdownBlobKey },
      { content: "<h1>secret</h1>", key: reprotected.htmlBlobKey },
    );
    expect(privateStore()?.get(reprotected.htmlBlobKey)).toBe(
      "<h1>secret</h1>",
    );
    expect(inStore(contentToken, reprotected.htmlBlobKey)).toBe(false);

    // delete removes protected content from the private store
    await store.deletePage(reprotected);
    expect(inStore(metadataToken, reprotected.htmlBlobKey)).toBe(false);
  });

  it("removes old-store blobs on a kind change combined with a protection toggle", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    // markdown page, public: blobs are {id}.md + {id}.html in the content store
    const mdPage = makePage({
      pageId: "55555555-5555-4555-8555-555555555555",
      slug: "changing",
      kind: "markdown",
    });

    await store.savePage(
      mdPage,
      { content: "# v1", key: mdPage.markdownBlobKey },
      { content: "<h1>v1</h1>", key: mdPage.htmlBlobKey },
    );
    expect(storeHas(contentToken, mdPage.markdownBlobKey)).toBe(true);

    // republished as a protected HTML page: the source key becomes .html.src
    // and the content moves to the private store
    const htmlPage = makePage({
      pageId: mdPage.pageId,
      slug: "changing",
      kind: "html",
      passwordHash: "salt:hash",
      markdownBlobKey: `${mdPage.pageId}.html.src`,
      updatedAt: "2026-03-19T00:05:00.000Z",
    });

    await store.savePage(
      htmlPage,
      { content: "<title>v2</title>", key: htmlPage.markdownBlobKey },
      { content: "<title>v2</title>", key: htmlPage.htmlBlobKey },
    );

    // no trace of the old markdown source or rendered page in the public store
    expect(storeHas(contentToken, mdPage.markdownBlobKey)).toBe(false);
    expect(storeHas(contentToken, mdPage.htmlBlobKey)).toBe(false);
    // new content lives only in the private store
    const privateStore = blobState.stores.get(metadataToken);
    expect(privateStore?.get(htmlPage.markdownBlobKey)).toBe(
      "<title>v2</title>",
    );
    expect(privateStore?.get(htmlPage.htmlBlobKey)).toBe("<title>v2</title>");
  });

  it("sweeps the public store on retry when a cleanup died mid-save", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      pageId: "66666666-6666-4666-8666-666666666666",
      slug: "retry",
    });

    await store.savePage(
      page,
      { content: "# v1", key: page.markdownBlobKey },
      { content: "<h1>v1</h1>", key: page.htmlBlobKey },
    );
    expect(storeHas(contentToken, page.htmlBlobKey)).toBe(true);

    // The cleanup del rejects transiently AFTER the protected record was
    // persisted — the retry trap: previousPage now reads as already protected.
    vi.mocked(del).mockImplementationOnce(async () => {
      throw new Error("transient blob error");
    });
    const protectedPage = makePage({
      ...page,
      passwordHash: "salt:hash",
      updatedAt: "2026-03-19T00:05:00.000Z",
    });
    await expect(
      store.savePage(
        protectedPage,
        { content: "# v2", key: protectedPage.markdownBlobKey },
        { content: "<h1>v2</h1>", key: protectedPage.htmlBlobKey },
      ),
    ).rejects.toThrow("transient blob error");
    expect(storeHas(contentToken, page.htmlBlobKey)).toBe(true);

    // the retry sweeps the leftover public blobs anyway
    await store.savePage(
      protectedPage,
      { content: "# v2", key: protectedPage.markdownBlobKey },
      { content: "<h1>v2</h1>", key: protectedPage.htmlBlobKey },
    );
    expect(storeHas(contentToken, page.htmlBlobKey)).toBe(false);
    expect(storeHas(contentToken, page.markdownBlobKey)).toBe(false);
    expect(blobState.stores.get(metadataToken)?.get(page.htmlBlobKey)).toBe(
      "<h1>v2</h1>",
    );
  });

  it("updates slug lookups when a page is renamed", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const original = makePage({
      pageId: "22222222-2222-4222-8222-222222222222",
      slug: "old-slug",
      title: "Old",
      updatedAt: "2026-03-19T00:00:00.000Z",
    });
    const renamed = makePage({
      pageId: original.pageId,
      slug: "new-slug",
      title: "New",
      updatedAt: "2026-03-19T00:05:00.000Z",
    });

    await store.savePage(
      original,
      { content: "# old", key: original.markdownBlobKey },
      { content: "<h1>old</h1>", key: original.htmlBlobKey },
    );
    await store.savePage(
      renamed,
      { content: "# new", key: renamed.markdownBlobKey },
      { content: "<h1>new</h1>", key: renamed.htmlBlobKey },
    );

    expect(await store.findPageBySlug("demo", "old-slug")).toBeNull();
    expect(await store.findPageBySlug("demo", "new-slug")).toMatchObject({
      pageId: renamed.pageId,
      slug: "new-slug",
    });
  });

  it("removes metadata lookups, index entries, and content blobs on delete", async () => {
    const store = createBlobStore(contentToken, metadataToken);
    const page = makePage({
      pageId: "33333333-3333-4333-8333-333333333333",
      slug: "delete-me",
      title: "Delete Me",
    });

    await store.savePage(
      page,
      { content: "# delete", key: page.markdownBlobKey },
      { content: "<h1>delete</h1>", key: page.htmlBlobKey },
    );

    await store.deletePage(page);

    expect(await store.findPageById(page.pageId)).toBeNull();
    expect(await store.findPageBySlug("demo", "delete-me")).toBeNull();
    expect(await store.listPages("demo")).toEqual([]);
    await expect(store.readHtml(page.htmlBlobKey)).rejects.toThrow(
      "Blob not found",
    );
  });
});

function storeHas(token: string, key: string): boolean {
  return blobState.stores.get(token)?.has(key) ?? false;
}

function makePage(overrides: Partial<StoredPage>): StoredPage {
  return {
    pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    namespace: "demo",
    slug: "page",
    kind: "markdown",
    title: "Page",
    description: "Description",
    visibility: "unlisted",
    draft: false,
    noindex: true,
    contentHash: "hash",
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    expiresAt: null,
    markdownBlobKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md",
    htmlBlobKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.html",
    ...overrides,
  };
}
