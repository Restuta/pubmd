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

export class FileStore implements PublishRepository {
  private readonly blobsDir: string;
  private readonly namespacesDir: string;
  private readonly pagesDir: string;
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.namespacesDir = path.join(rootDir, "namespaces");
    this.pagesDir = path.join(rootDir, "pages");
    this.blobsDir = path.join(rootDir, "blobs");
  }

  async claimNamespace(namespace: string, tokenHash: string): Promise<void> {
    await this.ensureDirectories();

    const namespacePath = this.namespacePath(namespace);

    if (await pathExists(namespacePath)) {
      throw new Error("NAMESPACE_EXISTS");
    }

    const now = new Date().toISOString();
    const record: NamespaceRecord = {
      namespace,
      tokenHash,
      createdAt: now,
    };

    await writeJson(namespacePath, record);
  }

  async getNamespace(namespace: string): Promise<NamespaceRecord | null> {
    await this.ensureDirectories();

    const filePath = this.namespacePath(namespace);

    if (!(await pathExists(filePath))) {
      return null;
    }

    return NamespaceRecordSchema.parse(await readJson(filePath));
  }

  async touchNamespace(
    namespace: string,
    lastPublishAt: string,
  ): Promise<void> {
    const current = await this.getNamespace(namespace);

    if (current === null) {
      throw new Error("NAMESPACE_NOT_FOUND");
    }

    await writeJson(this.namespacePath(namespace), {
      ...current,
      lastPublishAt,
    });
  }

  async listPages(namespace: string): Promise<StoredPage[]> {
    await this.ensureDirectories();

    const entries = await readdir(this.pagesDir);
    const pages: StoredPage[] = [];

    for (const entry of entries) {
      const filePath = path.join(this.pagesDir, entry);
      const page = StoredPageSchema.parse(await readJson(filePath));

      if (page.namespace === namespace) {
        pages.push(page);
      }
    }

    return pages.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async findPageById(pageId: string): Promise<StoredPage | null> {
    await this.ensureDirectories();

    const filePath = this.pagePath(pageId);

    if (!(await pathExists(filePath))) {
      return null;
    }

    return StoredPageSchema.parse(await readJson(filePath));
  }

  async findPageBySlug(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    const pages = await this.listPages(namespace);
    return pages.find((page) => page.slug === slug) ?? null;
  }

  async savePage(
    page: StoredPage,
    markdown: FilePayload,
    html: FilePayload,
  ): Promise<void> {
    await this.ensureDirectories();

    await writeFile(
      path.join(this.blobsDir, markdown.key),
      markdown.content,
      "utf8",
    );
    await writeFile(path.join(this.blobsDir, html.key), html.content, "utf8");
    await writeJson(this.pagePath(page.pageId), page);
  }

  async deletePage(page: StoredPage): Promise<void> {
    await this.ensureDirectories();

    if ((await this.findPageById(page.pageId)) === null) {
      throw new PageNotFoundError(page.namespace, page.slug);
    }

    await unlinkIfExists(path.join(this.blobsDir, page.markdownBlobKey));
    await unlinkIfExists(path.join(this.blobsDir, page.htmlBlobKey));
    await unlinkIfExists(this.pagePath(page.pageId));
  }

  async readMarkdown(key: string): Promise<string> {
    return readFile(path.join(this.blobsDir, key), "utf8");
  }

  async readHtml(key: string): Promise<string> {
    return readFile(path.join(this.blobsDir, key), "utf8");
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.namespacesDir, { recursive: true });
    await mkdir(this.pagesDir, { recursive: true });
    await mkdir(this.blobsDir, { recursive: true });
  }

  private namespacePath(namespace: string): string {
    return path.join(this.namespacesDir, `${namespace}.json`);
  }

  private pagePath(pageId: string): string {
    return path.join(this.pagesDir, `${pageId}.json`);
  }
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
