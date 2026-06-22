import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildDataUrl } from "./data-url.js";

export interface InlineHtmlOptions {
  /** Directory the HTML file lives in; relative refs resolve against it. */
  baseDir: string;
  /** Largest single asset (raw bytes, pre-base64) to inline. Defaults to 2 MiB. */
  maxAssetBytes?: number;
  /** Total raw bytes to inline across the whole page. Defaults to 10 MiB. */
  maxTotalBytes?: number;
  /** Inline local `<script src>` contents. Defaults to true; false strips all scripts. */
  allowScripts?: boolean;
}

export interface SkippedAsset {
  ref: string;
  reason: "absolute-path" | "not-found" | "too-large" | "total-cap";
}

export interface InlineHtmlResult {
  html: string;
  /** Number of local references folded into the document. */
  inlinedCount: number;
  /** Local references that could not be inlined (left untouched in the HTML). */
  skipped: SkippedAsset[];
}

interface InlineContext {
  baseDir: string;
  maxAssetBytes: number;
  maxTotalBytes: number;
  allowScripts: boolean;
  inlinedCount: number;
  totalBytes: number;
  skipped: SkippedAsset[];
}

const DEFAULT_MAX_ASSET_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 3;

/**
 * Walks an HTML document and folds every resolvable LOCAL asset into it, producing a
 * single self-contained file. Stylesheets and scripts are folded as text; images, fonts
 * and media become `data:` URLs. Remote (`http(s)://`, protocol-relative) and `data:`
 * references are left untouched.
 */
export async function inlineHtmlAssets(
  html: string,
  options: InlineHtmlOptions,
): Promise<InlineHtmlResult> {
  const context: InlineContext = {
    baseDir: options.baseDir,
    maxAssetBytes: options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    allowScripts: options.allowScripts ?? true,
    inlinedCount: 0,
    totalBytes: 0,
    skipped: [],
  };

  let result = html;
  result = await inlineStyleBlocks(result, context);
  result = await inlineStylesheetLinks(result, context);
  result = await inlineScripts(result, context);
  result = await inlineImages(result, context);
  result = await inlineFavicons(result, context);
  result = await inlineMediaTags(result, context);

  return {
    html: result,
    inlinedCount: context.inlinedCount,
    skipped: context.skipped,
  };
}

// --- transforms -------------------------------------------------------------

async function inlineStyleBlocks(
  html: string,
  context: InlineContext,
): Promise<string> {
  return replaceAsync(
    html,
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    async (_full, attrs, css) => {
      const inlined = await inlineCssText(css, context.baseDir, context, 0);
      return `<style${attrs}>${inlined}</style>`;
    },
  );
}

async function inlineStylesheetLinks(
  html: string,
  context: InlineContext,
): Promise<string> {
  return replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    const rel = getAttr(tag, "rel");

    if (rel === null || !/(?:^|\s)stylesheet(?:\s|$)/i.test(rel)) {
      return tag;
    }

    const href = getAttr(tag, "href");

    if (href === null) {
      return tag;
    }

    const resolved = resolveLocal(context, href);

    if (resolved === null) {
      return tag;
    }

    const css = await readTextAsset(context, href, resolved);

    if (css === null) {
      return tag;
    }

    const inlined = await inlineCssText(
      css,
      path.dirname(resolved),
      context,
      0,
    );
    context.inlinedCount += 1;
    const media = getAttr(tag, "media");
    const mediaAttr = media === null ? "" : ` media="${media}"`;
    return `<style${mediaAttr}>${inlined}</style>`;
  });
}

async function inlineScripts(
  html: string,
  context: InlineContext,
): Promise<string> {
  return replaceAsync(
    html,
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    async (full, attrs, _body) => {
      if (!context.allowScripts) {
        return "";
      }

      const src = getAttr(attrs, "src");

      if (src === null) {
        return full; // inline script — keep as-is
      }

      const resolved = resolveLocal(context, src);

      if (resolved === null) {
        return full; // remote script — keep the reference
      }

      const js = await readTextAsset(context, src, resolved);

      if (js === null) {
        return full;
      }

      context.inlinedCount += 1;
      const type = getAttr(attrs, "type");
      const typeAttr = type === null ? "" : ` type="${type}"`;
      const safe = js.replaceAll(/<\/script>/gi, "<\\/script>");
      return `<script${typeAttr}>${safe}</script>`;
    },
  );
}

async function inlineImages(
  html: string,
  context: InlineContext,
): Promise<string> {
  return replaceAsync(html, /<img\b[^>]*>/gi, async (tag) => {
    let result = await inlineUrlAttr(tag, "src", context);
    const srcset = getAttr(result, "srcset");

    if (srcset !== null) {
      const next = await inlineSrcset(srcset, context);

      if (next !== srcset) {
        result = setAttr(result, "srcset", next);
      }
    }

    return result;
  });
}

async function inlineFavicons(
  html: string,
  context: InlineContext,
): Promise<string> {
  return replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    const rel = getAttr(tag, "rel");

    if (rel === null || !/icon/i.test(rel)) {
      return tag;
    }

    return inlineUrlAttr(tag, "href", context);
  });
}

async function inlineMediaTags(
  html: string,
  context: InlineContext,
): Promise<string> {
  let result = await replaceAsync(html, /<source\b[^>]*>/gi, async (tag) => {
    let next = await inlineUrlAttr(tag, "src", context);
    const srcset = getAttr(next, "srcset");

    if (srcset !== null) {
      const inlinedSrcset = await inlineSrcset(srcset, context);

      if (inlinedSrcset !== srcset) {
        next = setAttr(next, "srcset", inlinedSrcset);
      }
    }

    return next;
  });

  result = await replaceAsync(
    result,
    /<(?:video|audio)\b[^>]*>/gi,
    async (tag) => {
      const withSrc = await inlineUrlAttr(tag, "src", context);
      return inlineUrlAttr(withSrc, "poster", context);
    },
  );

  return result;
}

// --- CSS --------------------------------------------------------------------

async function inlineCssText(
  css: string,
  cssBaseDir: string,
  context: InlineContext,
  depth: number,
): Promise<string> {
  if (depth > MAX_IMPORT_DEPTH) {
    return css;
  }

  const withImports = await replaceAsync(
    css,
    /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)([^;]*);/gi,
    async (full, _q1, urlRef, _q2, plainRef, trailing) => {
      const ref = (urlRef ?? plainRef ?? "").trim();
      // A trailing media query would change semantics if inlined unconditionally.
      if (trailing !== undefined && trailing.trim().length > 0) {
        return full;
      }

      const resolved = resolveLocal(context, ref, cssBaseDir);

      if (resolved === null) {
        return full;
      }

      const imported = await readTextAsset(context, ref, resolved);

      if (imported === null) {
        return full;
      }

      context.inlinedCount += 1;
      return inlineCssText(
        imported,
        path.dirname(resolved),
        context,
        depth + 1,
      );
    },
  );

  return replaceAsync(
    withImports,
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    async (full, _quote, ref) => {
      const trimmed = ref.trim();
      const resolved = resolveLocal(context, trimmed, cssBaseDir);

      if (resolved === null) {
        return full;
      }

      const bytes = await readBinaryAsset(context, trimmed, resolved);

      if (bytes === null) {
        return full;
      }

      context.inlinedCount += 1;
      return `url("${buildDataUrl(bytes, path.extname(resolved))}")`;
    },
  );
}

// --- shared helpers ---------------------------------------------------------

async function inlineUrlAttr(
  tag: string,
  attr: string,
  context: InlineContext,
): Promise<string> {
  const value = getAttr(tag, attr);

  if (value === null) {
    return tag;
  }

  const resolved = resolveLocal(context, value);

  if (resolved === null) {
    return tag;
  }

  const bytes = await readBinaryAsset(context, value, resolved);

  if (bytes === null) {
    return tag;
  }

  context.inlinedCount += 1;
  return setAttr(tag, attr, buildDataUrl(bytes, path.extname(resolved)));
}

async function inlineSrcset(
  srcset: string,
  context: InlineContext,
): Promise<string> {
  const candidates = srcset.split(",");
  const out: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const [url, ...descriptor] = trimmed.split(/\s+/);
    const resolved = url === undefined ? null : resolveLocal(context, url);

    if (url === undefined || resolved === null) {
      out.push(trimmed);
      continue;
    }

    const bytes = await readBinaryAsset(context, url, resolved);

    if (bytes === null) {
      out.push(trimmed);
      continue;
    }

    context.inlinedCount += 1;
    out.push(
      [buildDataUrl(bytes, path.extname(resolved)), ...descriptor].join(" "),
    );
  }

  return out.join(", ");
}

/** Resolves a reference to an absolute local path, or null if it isn't a local file. */
function resolveLocal(
  context: InlineContext,
  rawRef: string,
  baseDir: string = context.baseDir,
): string | null {
  const ref = rawRef.trim();

  if (ref.length === 0 || ref.startsWith("#") || ref.startsWith("//")) {
    return null;
  }

  if (/^data:/i.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return null; // data: URL or any scheme (http:, https:, mailto:, tel:, ...)
  }

  if (ref.startsWith("/")) {
    record(context, rawRef, "absolute-path");
    return null;
  }

  const withoutQuery = ref.split(/[?#]/)[0] ?? ref;
  let decoded = withoutQuery;

  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // Keep the raw path if it isn't valid percent-encoding.
  }

  return path.resolve(baseDir, decoded);
}

async function readBinaryAsset(
  context: InlineContext,
  ref: string,
  absPath: string,
): Promise<Buffer | null> {
  try {
    const buffer = await readFile(absPath);

    if (buffer.byteLength > context.maxAssetBytes) {
      record(context, ref, "too-large");
      return null;
    }

    if (context.totalBytes + buffer.byteLength > context.maxTotalBytes) {
      record(context, ref, "total-cap");
      return null;
    }

    context.totalBytes += buffer.byteLength;
    return buffer;
  } catch {
    record(context, ref, "not-found");
    return null;
  }
}

async function readTextAsset(
  context: InlineContext,
  ref: string,
  absPath: string,
): Promise<string | null> {
  const buffer = await readBinaryAsset(context, ref, absPath);
  return buffer === null ? null : buffer.toString("utf8");
}

function record(
  context: InlineContext,
  ref: string,
  reason: SkippedAsset["reason"],
): void {
  context.skipped.push({ ref, reason });
}

function getAttr(tagOrAttrs: string, name: string): string | null {
  const match = tagOrAttrs.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );

  if (match === null) {
    return null;
  }

  return match[1] ?? match[2] ?? match[3] ?? null;
}

function setAttr(tag: string, name: string, value: string): string {
  const quoted = new RegExp(`(\\s${name})\\s*=\\s*(?:"[^"]*"|'[^']*')`, "i");

  if (quoted.test(tag)) {
    return tag.replace(quoted, `$1="${value}"`);
  }

  const unquoted = new RegExp(`(\\s${name})\\s*=\\s*[^\\s>]+`, "i");

  if (unquoted.test(tag)) {
    return tag.replace(unquoted, `$1="${value}"`);
  }

  return tag;
}

async function replaceAsync(
  text: string,
  pattern: RegExp,
  replacer: (...args: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...text.matchAll(pattern)];

  if (matches.length === 0) {
    return text;
  }

  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    const full = match[0];
    const index = match.index ?? 0;
    result += text.slice(lastIndex, index);
    result += await replacer(...(match as unknown as string[]));
    lastIndex = index + full.length;
  }

  result += text.slice(lastIndex);
  return result;
}
