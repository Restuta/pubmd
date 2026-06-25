import { z } from "zod";

export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const VisibilitySchema = z.enum(["public", "unlisted", "private"]);

export const PageKindSchema = z.enum(["markdown", "html"]);

export const FrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: NameSchema.optional(),
    draft: z.boolean().optional(),
    noindex: z.boolean().optional(),
    visibility: VisibilitySchema.optional(),
    description: z.string().trim().min(1).max(300).optional(),
  })
  .passthrough();

export const ClaimNamespaceResponseSchema = z.object({
  namespace: NameSchema,
  token: z.string().min(1),
});

export const PublishPageRequestSchema = z.object({
  kind: z.literal("markdown").optional(),
  markdown: z.string().min(1),
  renderMarkdown: z.string().min(1).optional(),
  reviewAnnotations: z.boolean().optional(),
  slug: NameSchema.optional(),
  pageId: z.string().uuid().optional(),
});

export const PublishHtmlRequestSchema = z.object({
  kind: z.literal("html"),
  /** The HTML as authored (kept for `?raw` and re-editing). */
  source: z.string().min(1),
  /** Self-contained HTML to serve. When omitted, `source` is served verbatim. */
  document: z.string().min(1).optional(),
  reviewAnnotations: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(300).optional(),
  noindex: z.boolean().optional(),
  slug: NameSchema.optional(),
  pageId: z.string().uuid().optional(),
});

/** A publish request is either markdown (default) or html, discriminated by `kind`. */
export const PublishRequestSchema = z.union([
  PublishHtmlRequestSchema,
  PublishPageRequestSchema,
]);

export const PublishedPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  title: z.string().min(1),
  description: z.string(),
  url: z.string().url(),
  created: z.boolean(),
  updated: z.boolean(),
  noOp: z.boolean(),
});

export const StoredPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  // Pages stored before HTML publishing existed have no `kind`; treat them as markdown.
  kind: PageKindSchema.default("markdown"),
  title: z.string().min(1),
  description: z.string(),
  visibility: VisibilitySchema,
  draft: z.boolean(),
  noindex: z.boolean(),
  contentHash: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  markdownBlobKey: z.string().min(1),
  htmlBlobKey: z.string().min(1),
});

export const NamespaceRecordSchema = z.object({
  namespace: NameSchema,
  tokenHash: z.string().min(1),
  createdAt: z.string().datetime(),
  lastPublishAt: z.string().datetime().optional(),
});

export const ListedPageSchema = z.object({
  pageId: z.string().uuid(),
  namespace: NameSchema,
  slug: NameSchema,
  title: z.string().min(1),
  description: z.string(),
  updatedAt: z.string().datetime(),
  url: z.string().url(),
});

export const ListPagesResponseSchema = z.object({
  pages: z.array(ListedPageSchema),
});

export type ClaimNamespaceResponse = z.infer<
  typeof ClaimNamespaceResponseSchema
>;
export type DocumentFrontmatter = z.infer<typeof FrontmatterSchema>;
export type ListPagesResponse = z.infer<typeof ListPagesResponseSchema>;
export type NamespaceRecord = z.infer<typeof NamespaceRecordSchema>;
export type PublishedPage = z.infer<typeof PublishedPageSchema>;
export type PublishPageRequest = z.infer<typeof PublishPageRequestSchema>;
export type PublishHtmlRequest = z.infer<typeof PublishHtmlRequestSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type PageKind = z.infer<typeof PageKindSchema>;
export type StoredPage = z.infer<typeof StoredPageSchema>;
export type Visibility = z.infer<typeof VisibilitySchema>;
