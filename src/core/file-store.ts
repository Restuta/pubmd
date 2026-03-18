import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  type NamespaceRecord,
  NamespaceRecordSchema,
  type StoredPage,
  StoredPageSchema,
} from "./contract.js";
import {
  type FilePayload,
  PageNotFoundError,
  type PublishRepository,
} from "./repository.js";

export function createFileStore(rootDir: string): PublishRepository {
  const namespacesDir = path.join(rootDir, "namespaces");
  const pagesDir = path.join(rootDir, "pages");
  const blobsDir = path.join(rootDir, "blobs");

  async function claimNamespace(
    namespace: string,
    tokenHash: string,
  ): Promise<void> {
    await ensureDirectories();

    const targetPath = namespacePath(namespace);

    if (await pathExists(targetPath)) {
      throw new Error("NAMESPACE_EXISTS");
    }

    const record: NamespaceRecord = {
      namespace,
      tokenHash,
      createdAt: new Date().toISOString(),
    };

    await writeJson(targetPath, record);
  }

  async function getNamespace(
    namespace: string,
  ): Promise<NamespaceRecord | null> {
    await ensureDirectories();

    const targetPath = namespacePath(namespace);

    if (!(await pathExists(targetPath))) {
      return null;
    }

    return NamespaceRecordSchema.parse(await readJson(targetPath));
  }

  async function touchNamespace(
    namespace: string,
    lastPublishAt: string,
  ): Promise<void> {
    const current = await getNamespace(namespace);

    if (current === null) {
      throw new Error("NAMESPACE_NOT_FOUND");
    }

    await writeJson(namespacePath(namespace), {
      ...current,
      lastPublishAt,
    });
  }

  async function listPages(namespace: string): Promise<StoredPage[]> {
    await ensureDirectories();

    const entries = await readdir(pagesDir);
    const pages: StoredPage[] = [];

    for (const entry of entries) {
      const filePath = path.join(pagesDir, entry);
      const page = StoredPageSchema.parse(await readJson(filePath));

      if (page.namespace === namespace) {
        pages.push(page);
      }
    }

    return pages.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async function findPageById(pageId: string): Promise<StoredPage | null> {
    await ensureDirectories();

    const targetPath = pagePath(pageId);

    if (!(await pathExists(targetPath))) {
      return null;
    }

    return StoredPageSchema.parse(await readJson(targetPath));
  }

  async function findPageBySlug(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    const pages = await listPages(namespace);
    return pages.find((page) => page.slug === slug) ?? null;
  }

  async function savePage(
    page: StoredPage,
    markdown: FilePayload,
    html: FilePayload,
  ): Promise<void> {
    await ensureDirectories();

    await writeFile(
      path.join(blobsDir, markdown.key),
      markdown.content,
      "utf8",
    );
    await writeFile(path.join(blobsDir, html.key), html.content, "utf8");
    await writeJson(pagePath(page.pageId), page);
  }

  async function deletePage(page: StoredPage): Promise<void> {
    await ensureDirectories();

    if ((await findPageById(page.pageId)) === null) {
      throw new PageNotFoundError(page.namespace, page.slug);
    }

    await unlinkIfExists(path.join(blobsDir, page.markdownBlobKey));
    await unlinkIfExists(path.join(blobsDir, page.htmlBlobKey));
    await unlinkIfExists(pagePath(page.pageId));
  }

  async function readMarkdown(key: string): Promise<string> {
    return readFile(path.join(blobsDir, key), "utf8");
  }

  async function readHtml(key: string): Promise<string> {
    return readFile(path.join(blobsDir, key), "utf8");
  }

  async function ensureDirectories(): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await mkdir(namespacesDir, { recursive: true });
    await mkdir(pagesDir, { recursive: true });
    await mkdir(blobsDir, { recursive: true });
  }

  function namespacePath(namespace: string): string {
    return path.join(namespacesDir, `${namespace}.json`);
  }

  function pagePath(pageId: string): string {
    return path.join(pagesDir, `${pageId}.json`);
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await rm(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}
