import { del, get, put } from "@vercel/blob";
import { z } from "zod";

import {
  type NamespaceRecord,
  NamespaceRecordSchema,
  type StoredPage,
  StoredPageSchema,
} from "./contract.js";
import {
  type FilePayload,
  NamespaceNotFoundError,
  PageNotFoundError,
  type PublishRepository,
} from "./repository.js";

const LookupRecordSchema = z.object({
  pageId: z.string().uuid(),
});

const NamespacePageIndexSchema = z.object({
  pages: z.array(StoredPageSchema),
});

export function createBlobStore(
  contentToken: string,
  metadataToken: string,
): PublishRepository {
  async function claimNamespace(
    namespace: string,
    tokenHash: string,
  ): Promise<void> {
    const record: NamespaceRecord = {
      namespace,
      tokenHash,
      createdAt: new Date().toISOString(),
    };

    await writeJsonBlob(namespacePath(namespace), record, false);
  }

  async function getNamespace(
    namespace: string,
  ): Promise<NamespaceRecord | null> {
    return readJsonBlob(namespacePath(namespace), NamespaceRecordSchema);
  }

  async function touchNamespace(
    namespace: string,
    lastPublishAt: string,
  ): Promise<void> {
    const current = await getNamespace(namespace);

    if (current === null) {
      throw new NamespaceNotFoundError(namespace);
    }

    await writeJsonBlob(namespacePath(namespace), {
      ...current,
      lastPublishAt,
    });
  }

  async function listPages(namespace: string): Promise<StoredPage[]> {
    const index = await readJsonBlob(
      namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );
    const pages = index?.pages ?? [];

    return pages.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async function findPageById(pageId: string): Promise<StoredPage | null> {
    return readJsonBlob(pagePath(pageId), StoredPageSchema);
  }

  async function findPageBySlug(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    const lookup = await readJsonBlob(
      lookupPath(namespace, slug),
      LookupRecordSchema,
    );

    if (lookup === null) {
      return null;
    }

    return findPageById(lookup.pageId);
  }

  async function savePage(
    page: StoredPage,
    markdown: FilePayload,
    html: FilePayload,
  ): Promise<void> {
    const previousPage = await findPageById(page.pageId);

    await Promise.all([
      writeContentBlob(markdown.key, markdown.content),
      writeContentBlob(html.key, html.content),
      writeJsonBlob(pagePath(page.pageId), page),
      writeJsonBlob(lookupPath(page.namespace, page.slug), {
        pageId: page.pageId,
      }),
      writeNamespaceIndex(page.namespace, page),
    ]);

    if (previousPage !== null && previousPage.slug !== page.slug) {
      await del(lookupPath(previousPage.namespace, previousPage.slug), {
        token: metadataToken,
      });
    }
  }

  async function deletePage(page: StoredPage): Promise<void> {
    await Promise.all([
      del(
        [pagePath(page.pageId), lookupPath(page.namespace, page.slug)],
        { token: metadataToken },
      ),
      del(
        [page.markdownBlobKey, page.htmlBlobKey],
        { token: contentToken },
      ),
      removeFromNamespaceIndex(page.namespace, page.pageId),
    ]);
  }

  async function readMarkdown(key: string): Promise<string> {
    return readTextBlob(key);
  }

  async function readHtml(key: string): Promise<string> {
    return readTextBlob(key);
  }

  async function readTextBlob(pathname: string): Promise<string> {
    const result = await get(pathname, {
      access: "public",
      token: contentToken,
    });

    if (result === null || result.statusCode !== 200) {
      throw new Error(`Blob not found: ${pathname}`);
    }

    return streamToString(result.stream);
  }

  async function readJsonBlob<T>(
    pathname: string,
    schema: { parse(input: unknown): T },
  ): Promise<T | null> {
    const result = await get(pathname, {
      access: "private",
      token: metadataToken,
      useCache: false,
    });

    if (result === null || result.statusCode !== 200) {
      return null;
    }

    return schema.parse(
      JSON.parse(await streamToString(result.stream)) as unknown,
    );
  }

  async function writeContentBlob(
    key: string,
    content: string,
  ): Promise<void> {
    await put(key, content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: contentToken,
    });
  }

  async function writeJsonBlob(
    pathname: string,
    value: unknown,
    allowOverwrite = true,
  ): Promise<void> {
    await put(pathname, stringifyJson(value), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite,
      token: metadataToken,
    });
  }

  function namespacePath(namespace: string): string {
    return `namespaces/${namespace}.json`;
  }

  function namespaceIndexPath(namespace: string): string {
    return `indexes/${namespace}.json`;
  }

  function pagePath(pageId: string): string {
    return `pages/${pageId}.json`;
  }

  function lookupPath(namespace: string, slug: string): string {
    return `lookups/${namespace}/${slug}.json`;
  }

  async function writeNamespaceIndex(
    namespace: string,
    page: StoredPage,
  ): Promise<void> {
    const current = await readJsonBlob(
      namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );
    const nextPages = [...(current?.pages ?? [])];
    const existingIndex = nextPages.findIndex(
      (currentPage) => currentPage.pageId === page.pageId,
    );

    if (existingIndex === -1) {
      nextPages.push(page);
    } else {
      nextPages[existingIndex] = page;
    }

    await writeJsonBlob(namespaceIndexPath(namespace), {
      pages: nextPages,
    });
  }

  async function removeFromNamespaceIndex(
    namespace: string,
    pageId: string,
  ): Promise<void> {
    const current = await readJsonBlob(
      namespaceIndexPath(namespace),
      NamespacePageIndexSchema,
    );

    if (current === null) {
      return;
    }

    await writeJsonBlob(namespaceIndexPath(namespace), {
      pages: current.pages.filter((page) => page.pageId !== pageId),
    });
  }

  return {
    claimNamespace,
    deletePage,
    findPageById,
    findPageBySlug,
    getNamespace,
    listPages,
    readHtml,
    readMarkdown,
    savePage,
    touchNamespace,
  };
}

async function streamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return new Response(stream).text();
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
