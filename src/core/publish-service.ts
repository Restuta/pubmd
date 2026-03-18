import { randomUUID } from "node:crypto";

import type {
  ClaimNamespaceResponse,
  PublishedPage,
  StoredPage,
} from "./contract.js";
import { constantTimeEqual, createToken, sha256 } from "./hash.js";
import {
  buildHtmlDocument,
  parseMarkdownDocument,
  renderMarkdownToHtml,
} from "./markdown.js";
import {
  AuthenticationError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  PageNotFoundError,
  type PublishRepository,
  SlugConflictError,
} from "./repository.js";
import { ensureName, slugify } from "./slug.js";

export interface PublishPageInput {
  markdown: string;
  namespace: string;
  pageId?: string;
  requestedSlug?: string;
  token: string;
  origin: string;
}

export interface ListPagesInput {
  namespace: string;
  origin: string;
  token: string;
}

export interface RemovePageInput {
  namespace: string;
  slug: string;
  token: string;
}

export class PublishService {
  constructor(private readonly repository: PublishRepository) {}

  async claimNamespace(namespace: string): Promise<ClaimNamespaceResponse> {
    const safeNamespace = ensureName(namespace);
    const existing = await this.repository.getNamespace(safeNamespace);

    if (existing !== null) {
      throw new NamespaceExistsError(safeNamespace);
    }

    const token = createToken();
    await this.repository.claimNamespace(safeNamespace, sha256(token));

    return {
      namespace: safeNamespace,
      token,
    };
  }

  async publishPage(input: PublishPageInput): Promise<PublishedPage> {
    const safeNamespace = ensureName(input.namespace);
    await this.authenticate(safeNamespace, input.token);

    const parsed = parseMarkdownDocument(input.markdown);
    const requestedSlug =
      input.requestedSlug ?? parsed.frontmatter.slug ?? slugify(parsed.title);
    const safeSlug = ensureName(slugify(requestedSlug));
    const existingPage = await this.resolveExistingPage(
      safeNamespace,
      safeSlug,
      input.pageId,
    );
    const pageId = existingPage?.pageId ?? randomUUID();
    const slug = safeSlug;
    const now = new Date().toISOString();
    const markdownBlobKey = `${pageId}.md`;
    const htmlBlobKey = `${pageId}.html`;
    const rendered = await renderMarkdownToHtml(parsed.body);
    const htmlDocument = buildHtmlDocument({
      title: parsed.title,
      description: parsed.description,
      noindex: parsed.noindex,
      bodyHtml: rendered.html,
    });
    const contentHash = sha256(
      JSON.stringify({
        markdown: input.markdown,
        slug,
        title: parsed.title,
        description: parsed.description,
        noindex: parsed.noindex,
        visibility: parsed.visibility,
        draft: parsed.draft,
      }),
    );
    const noOp =
      existingPage !== null &&
      existingPage.contentHash === contentHash &&
      existingPage.slug === slug;

    if (!noOp) {
      const page: StoredPage = {
        pageId,
        namespace: safeNamespace,
        slug,
        title: parsed.title,
        description: parsed.description,
        visibility: parsed.visibility,
        draft: parsed.draft,
        noindex: parsed.noindex,
        contentHash,
        createdAt: existingPage?.createdAt ?? now,
        updatedAt: now,
        markdownBlobKey,
        htmlBlobKey,
      };

      await this.repository.savePage(
        page,
        {
          content: input.markdown,
          key: markdownBlobKey,
        },
        {
          content: htmlDocument,
          key: htmlBlobKey,
        },
      );

      await this.repository.touchNamespace(safeNamespace, now);
    }

    return {
      pageId,
      namespace: safeNamespace,
      slug,
      title: parsed.title,
      description: parsed.description,
      url: this.buildPageUrl(input.origin, safeNamespace, slug),
      created: existingPage === null && !noOp,
      updated: existingPage !== null && !noOp,
      noOp,
    };
  }

  async listPages(input: ListPagesInput): Promise<
    Array<{
      pageId: string;
      namespace: string;
      slug: string;
      title: string;
      description: string;
      updatedAt: string;
      url: string;
    }>
  > {
    const safeNamespace = ensureName(input.namespace);
    await this.authenticate(safeNamespace, input.token);

    const pages = await this.repository.listPages(safeNamespace);
    return pages.map((page) => ({
      pageId: page.pageId,
      namespace: page.namespace,
      slug: page.slug,
      title: page.title,
      description: page.description,
      updatedAt: page.updatedAt,
      url: this.buildPageUrl(input.origin, page.namespace, page.slug),
    }));
  }

  async removePage(input: RemovePageInput): Promise<void> {
    const safeNamespace = ensureName(input.namespace);
    const safeSlug = ensureName(input.slug);
    await this.authenticate(safeNamespace, input.token);

    const page = await this.repository.findPageBySlug(safeNamespace, safeSlug);

    if (page === null) {
      throw new PageNotFoundError(safeNamespace, safeSlug);
    }

    await this.repository.deletePage(page);
  }

  async getPublicPage(
    namespace: string,
    slug: string,
  ): Promise<StoredPage | null> {
    return this.repository.findPageBySlug(
      ensureName(namespace),
      ensureName(slug),
    );
  }

  async readHtml(page: StoredPage): Promise<string> {
    return this.repository.readHtml(page.htmlBlobKey);
  }

  async readMarkdown(page: StoredPage): Promise<string> {
    return this.repository.readMarkdown(page.markdownBlobKey);
  }

  private async authenticate(namespace: string, token: string): Promise<void> {
    const record = await this.repository.getNamespace(namespace);

    if (record === null) {
      throw new NamespaceNotFoundError(namespace);
    }

    if (!constantTimeEqual(record.tokenHash, sha256(token))) {
      throw new AuthenticationError();
    }
  }

  private buildPageUrl(
    origin: string,
    namespace: string,
    slug: string,
  ): string {
    return new URL(`/${namespace}/${slug}`, origin).toString();
  }

  private async resolveExistingPage(
    namespace: string,
    slug: string,
    pageId: string | undefined,
  ): Promise<StoredPage | null> {
    if (pageId !== undefined) {
      const byId = await this.repository.findPageById(pageId);

      if (byId === null) {
        return null;
      }

      if (byId.namespace !== namespace) {
        throw new AuthenticationError();
      }

      const slugOwner = await this.repository.findPageBySlug(namespace, slug);

      if (slugOwner !== null && slugOwner.pageId !== byId.pageId) {
        throw new SlugConflictError(namespace, slug);
      }

      return byId;
    }

    return this.repository.findPageBySlug(namespace, slug);
  }
}
