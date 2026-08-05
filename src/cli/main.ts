#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import pkg from "../../package.json" with { type: "json" };
import {
  ClaimNamespaceResponseSchema,
  ListPagesResponseSchema,
  PublishedPageSchema,
} from "../core/contract.js";
import type { ExpirationSetting } from "../core/expiration.js";
import { inlineHtmlAssets } from "../core/inline-html.js";
import { parseMarkdownDocument } from "../core/markdown.js";
import { prepareMarkdownBodyForPublish } from "../core/publish-markdown.js";
import {
  hasReviewAnnotationsOptIn,
  injectReviewAnnotations,
} from "../core/review-annotations.js";
import { slugify } from "../core/slug.js";
import {
  loadConfig,
  loadMapping,
  resolveApiBase,
  saveConfig,
  saveMapping,
} from "./config.js";
import {
  findVaultManifestEntry,
  findVaultRoot,
  getVaultManifestPath,
  loadVaultManifest,
  normalizeVaultRelativePath,
  saveVaultManifest,
  upsertVaultManifestEntry,
} from "./vault-manifest.js";

interface CommandContext {
  args: string[];
}

interface CliOptions {
  "api-base"?: string;
  comments?: boolean;
  expires?: string;
  namespace?: string;
  password?: string;
  /** Bare `--password` with no value: read the password from a hidden prompt. */
  passwordPrompt?: boolean;
  review?: boolean;
  slug?: string;
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;

  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    printHelp();
    return;
  }

  if (argv[0] === "version" || argv[0] === "--version" || argv[0] === "-v") {
    console.log(pkg.version);
    return;
  }

  const [command, ...rest] = argv;
  const context: CommandContext = { args: rest };

  switch (command) {
    case "claim":
      await runClaim(context);
      return;
    case "publish":
      await runPublish(context);
      return;
    case "list":
      await runList(context);
      return;
    case "remove":
      await runRemove(context);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runClaim(context: CommandContext): Promise<void> {
  const [namespace, ...rest] = context.args;

  if (namespace === undefined) {
    throw new Error("Usage: pub claim <namespace> [--api-base <url>]");
  }

  const options = parseOptions(rest);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/claim`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const claimed = ClaimNamespaceResponseSchema.parse(await response.json());
  config.apiBaseUrl = apiBase;
  config.defaultNamespace ??= claimed.namespace;
  config.namespaces[claimed.namespace] = {
    token: claimed.token,
  };
  await saveConfig(config);
  console.log(`Claimed namespace ${claimed.namespace}`);
}

async function runPublish(context: CommandContext): Promise<void> {
  const { positional, options } = splitArgs(context.args);
  const filePath = positional[0];
  const absoluteFilePath =
    filePath === undefined ? undefined : path.resolve(filePath);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const mapping = await loadMapping();
  const vaultRoot =
    absoluteFilePath === undefined
      ? null
      : await findVaultRoot(path.dirname(absoluteFilePath));
  const vaultManifestPath =
    vaultRoot === null ? null : getVaultManifestPath(vaultRoot);
  const vaultSourcePath =
    absoluteFilePath === undefined || vaultRoot === null
      ? undefined
      : normalizeVaultRelativePath(path.relative(vaultRoot, absoluteFilePath));
  const vaultManifest =
    vaultManifestPath === null
      ? null
      : await loadVaultManifest(vaultManifestPath);
  const manifestEntry =
    vaultManifest === null || vaultSourcePath === undefined
      ? undefined
      : findVaultManifestEntry(vaultManifest, vaultSourcePath);
  const mappingKey =
    absoluteFilePath === undefined
      ? undefined
      : path.relative(process.cwd(), absoluteFilePath);
  const existingMapping =
    mappingKey === undefined ? undefined : mapping.files[mappingKey];
  const existingPage = manifestEntry ?? existingMapping;
  const namespace =
    options.namespace ?? existingPage?.namespace ?? config.defaultNamespace;

  if (namespace === undefined) {
    throw new Error(
      "No namespace configured. Run `pub claim <namespace>` first.",
    );
  }

  const token = config.namespaces[namespace]?.token;

  if (token === undefined) {
    throw new Error(`No token configured for namespace "${namespace}".`);
  }

  const slug = options.slug ?? existingPage?.slug;
  const pageIdPart =
    existingPage?.pageId === undefined ? {} : { pageId: existingPage.pageId };
  const reviewAnnotations =
    options.review === true || options.comments === true;
  // The --expires flag is the explicit per-publish override; the consumer's
  // config (per-namespace, then global) is a lower-priority default that the
  // server ranks below the document's own frontmatter/<meta>.
  const expires = options.expires;
  const defaultExpires =
    config.namespaces[namespace]?.expires ?? config.defaultExpires;
  const requestBody =
    absoluteFilePath !== undefined && /\.html?$/i.test(absoluteFilePath)
      ? await buildHtmlRequestBody(
          absoluteFilePath,
          slug,
          pageIdPart,
          reviewAnnotations,
          expires,
          defaultExpires,
        )
      : await buildMarkdownRequestBody(
          absoluteFilePath,
          slug,
          pageIdPart,
          reviewAnnotations,
          expires,
          defaultExpires,
        );

  // Bare `--password` reads the password from a hidden prompt (or a piped line),
  // keeping it out of argv and shell history.
  if (options.passwordPrompt === true) {
    const prompted = await readPasswordHidden();

    if (prompted.trim().length === 0) {
      throw new Error(
        'Password cannot be empty (use --password "" to remove protection).',
      );
    }

    requestBody["password"] = prompted;
  }

  // Omitting --password keeps the page's existing protection; "" removes it.
  if (options.password !== undefined) {
    requestBody["password"] = options.password;
  }

  const publishBody = encodePublishRequestBody(requestBody);
  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages/publish`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: publishBody,
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const published = PublishedPageSchema.parse(await response.json());
  const outputUrl =
    requestBody["reviewAnnotations"] === true
      ? withCommentsQuery(published.url)
      : published.url;

  if (mappingKey !== undefined) {
    mapping.files[mappingKey] = {
      namespace: published.namespace,
      pageId: published.pageId,
      slug: published.slug,
      url: published.url,
    };
    await saveMapping(mapping);
  }

  if (
    vaultManifest !== null &&
    vaultManifestPath !== null &&
    vaultSourcePath !== undefined
  ) {
    const nextManifest = upsertVaultManifestEntry(vaultManifest, {
      namespace: published.namespace,
      pageId: published.pageId,
      slug: published.slug,
      source: vaultSourcePath,
      title: published.title,
      updatedAt: new Date().toISOString(),
      url: published.url,
    });
    await saveVaultManifest(nextManifest, vaultManifestPath);
  }

  if (published.expiresAt !== null) {
    console.error(`Expires ${published.expiresAt}`);
  }

  console.log(outputUrl);
}

function encodePublishRequestBody(body: Record<string, unknown>): Blob {
  // Vercel Functions have a fixed request body cap. Compress publish payloads
  // on the wire so large markdown/HTML pages stay below the platform limit.
  return new Blob([toArrayBuffer(gzipSync(JSON.stringify(body)))], {
    type: "application/json",
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function buildRenderMarkdownFromBody(
  body: string,
  sourcePath: string,
): Promise<string | undefined> {
  const renderMarkdown = await prepareMarkdownBodyForPublish(body, {
    sourcePath,
  });

  return renderMarkdown === body ? undefined : renderMarkdown;
}

async function buildMarkdownRequestBody(
  absoluteFilePath: string | undefined,
  slug: string | undefined,
  pageIdPart: { pageId?: string },
  reviewAnnotations: boolean,
  expires: ExpirationSetting,
  defaultExpires: ExpirationSetting,
): Promise<Record<string, unknown>> {
  const markdown =
    absoluteFilePath === undefined
      ? await readStdin()
      : await readFile(absoluteFilePath, "utf8");
  const parsed = parseMarkdownDocument(markdown);
  const renderMarkdown =
    absoluteFilePath === undefined
      ? undefined
      : await buildRenderMarkdownFromBody(parsed.body, absoluteFilePath);
  const shouldInjectReview =
    reviewAnnotations || isReviewFrontmatterOptIn(parsed.frontmatter);

  return {
    markdown,
    ...(renderMarkdown === undefined ? {} : { renderMarkdown }),
    ...(shouldInjectReview ? { reviewAnnotations: true } : {}),
    ...(expires === undefined ? {} : { expires }),
    ...(defaultExpires === undefined ? {} : { defaultExpires }),
    ...(slug === undefined ? {} : { slug }),
    ...pageIdPart,
  };
}

async function buildHtmlRequestBody(
  absoluteFilePath: string,
  slug: string | undefined,
  pageIdPart: { pageId?: string },
  reviewAnnotations: boolean,
  expires: ExpirationSetting,
  defaultExpires: ExpirationSetting,
): Promise<Record<string, unknown>> {
  const source = await readFile(absoluteFilePath, "utf8");
  const inlined = await inlineHtmlAssets(source, {
    baseDir: path.dirname(absoluteFilePath),
  });
  const shouldInjectReview =
    reviewAnnotations ||
    hasReviewAnnotationsOptIn(source) ||
    hasReviewAnnotationsOptIn(inlined.html);
  const document = shouldInjectReview
    ? injectReviewAnnotations(inlined.html)
    : inlined.html;

  for (const item of inlined.skipped) {
    console.error(`skipped ${item.ref} (${item.reason})`);
  }

  const fallbackSlug = slugify(
    path.basename(absoluteFilePath).replace(/\.html?$/i, ""),
  );

  return {
    kind: "html",
    source,
    document,
    ...(shouldInjectReview ? { reviewAnnotations: true } : {}),
    ...(expires === undefined ? {} : { expires }),
    ...(defaultExpires === undefined ? {} : { defaultExpires }),
    slug: slug ?? fallbackSlug,
    ...pageIdPart,
  };
}

function isReviewFrontmatterOptIn(
  frontmatter: Record<string, unknown>,
): boolean {
  const review = frontmatter["review"];
  const comments = frontmatter["comments"];
  return (
    comments === true ||
    (typeof comments === "string" && comments.toLowerCase() === "true") ||
    review === true ||
    (typeof review === "string" && review.toLowerCase() === "true")
  );
}

function withCommentsQuery(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("comments", "1");
  return parsed.toString();
}

async function runList(context: CommandContext): Promise<void> {
  const all = context.args.includes("--all");
  const filtered = context.args.filter((a) => a !== "--all");
  const { options } = splitArgs(filtered);
  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);

  const namespacesToList = all
    ? Object.keys(config.namespaces)
    : [options.namespace ?? config.defaultNamespace].filter(
        (ns): ns is string => ns !== undefined,
      );

  if (namespacesToList.length === 0) {
    throw new Error(
      "No namespace configured. Run `pubmd claim <namespace>` first.",
    );
  }

  for (const namespace of namespacesToList) {
    const token = config.namespaces[namespace]?.token;

    if (token === undefined) {
      continue;
    }

    const response = await fetch(
      `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      continue;
    }

    const payload = ListPagesResponseSchema.parse(await response.json());

    if (payload.pages.length === 0 && !all) {
      console.log("No pages published.");
      continue;
    }

    if (payload.pages.length === 0) {
      continue;
    }

    if (all) {
      console.log(`\n${namespace}/`);
    }

    for (const page of payload.pages) {
      const prefix = all ? "  " : "";
      console.log(`${prefix}${page.slug}\t${page.url}`);
    }
  }
}

async function runRemove(context: CommandContext): Promise<void> {
  const { positional, options } = splitArgs(context.args);
  const slug = positional[0];

  if (slug === undefined) {
    throw new Error(
      "Usage: pub remove <slug> [--namespace <namespace>] [--api-base <url>]",
    );
  }

  const config = await loadConfig();
  const apiBase = resolveApiBase(config, options["api-base"]);
  const namespace = options.namespace ?? config.defaultNamespace;

  if (namespace === undefined) {
    throw new Error(
      "No namespace configured. Run `pub claim <namespace>` first.",
    );
  }

  const token = config.namespaces[namespace]?.token;

  if (token === undefined) {
    throw new Error(`No token configured for namespace "${namespace}".`);
  }

  const response = await fetch(
    `${apiBase}/api/namespaces/${encodeURIComponent(namespace)}/pages/${encodeURIComponent(slug)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const mapping = await loadMapping();
  let mappingChanged = false;

  for (const [key, value] of Object.entries(mapping.files)) {
    if (value.namespace === namespace && value.slug === slug) {
      delete mapping.files[key];
      mappingChanged = true;
    }
  }

  if (mappingChanged) {
    await saveMapping(mapping);
  }

  console.log(`Removed ${namespace}/${slug}`);
}

function parseOptions(argumentsList: string[]): CliOptions {
  return splitArgs(argumentsList).options;
}

function splitArgs(argumentsList: string[]): {
  options: CliOptions;
  positional: string[];
} {
  const options: CliOptions = {};
  const positional: string[] = [];

  for (let index = 0; index < argumentsList.length; index += 1) {
    const current = argumentsList[index];

    if (current === undefined) {
      break;
    }

    if (!current.startsWith("--")) {
      positional.push(current);
      continue;
    }

    const key = current.slice(2);
    const value = argumentsList[index + 1];

    if (!isCliOptionKey(key)) {
      throw new Error(`Unknown option: --${key}`);
    }

    if (key === "comments") {
      options.comments = true;
      continue;
    }

    if (key === "review") {
      options.review = true;
      continue;
    }

    if (key === "password") {
      // Bare `--password` (no value): prompt instead, so the password never lands
      // in argv, shell history, or process listings.
      if (value === undefined || value.startsWith("--")) {
        options.passwordPrompt = true;
        continue;
      }

      options.password = value;
      index += 1;
      continue;
    }

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Expected value after ${current}`);
    }

    options[key] = value;
    index += 1;
  }

  return { options, positional };
}

/** CLI flags accepted on the command line (`passwordPrompt` is internal-only). */
type CliArgKey = Exclude<keyof CliOptions, "passwordPrompt">;

function isCliOptionKey(value: string): value is CliArgKey {
  return (
    value === "api-base" ||
    value === "comments" ||
    value === "expires" ||
    value === "namespace" ||
    value === "password" ||
    value === "review" ||
    value === "slug"
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Read a password without echoing it. On a TTY this uses raw mode (nothing is
 * echoed); piped stdin just reads the first line, so
 * `printf 'pw\n' | pubmd publish --password` works for scripts and agents.
 */
function readPasswordHidden(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buffer = "";

    const cleanup = () => {
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.pause();
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
    };

    const finish = () => {
      cleanup();
      process.stderr.write("\n");
      resolve(buffer);
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\n" || char === "\r") {
          finish();
          return;
        }

        if (char === "\u0003") {
          cleanup();
          reject(new Error("Aborted."));
          return;
        }

        buffer += char;
      }
    };

    const onEnd = () => {
      finish();
    };

    process.stderr.write("Page password: ");

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    stdin.resume();
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

function printHelp(): void {
  console.log(`Usage:
  pubmd claim <namespace> [--api-base <url>]
  pubmd publish [file] [--namespace <namespace>] [--slug <slug>] [--password [<password>]] [--comments] [--expires <when>] [--api-base <url>]
  pubmd list [--namespace <namespace>] [--all] [--api-base <url>]
  pubmd remove <slug> [--namespace <namespace>] [--api-base <url>]
  pubmd version

  publish accepts a .md or .html file. HTML pages have their local CSS, JS,
  images and fonts inlined into a single self-contained page before upload.

  --expires <when> sets a time-to-live: a duration like 7d, 12h, 30m or 2w,
  or "true" for the default 14 days, or "never". Pages never expire unless a
  TTL is set here, in frontmatter (expires:), or as a default in your config
  (~/.config/pub/config.json: top-level "defaultExpires", or "expires" under a
  namespace).

  --password protects the page: readers need the password (browser prompt or
  "Authorization: Bearer <password>"). Bare --password (no value) prompts with
  hidden input, keeping the password out of argv and shell history — prefer it
  for interactive use, or pipe a line for scripts. Omitting the flag keeps the
  current setting; --password "" removes protection.`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unexpected CLI error.";
  console.error(message);
  process.exitCode = 1;
});
