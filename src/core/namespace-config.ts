import { readFileSync } from "node:fs";

import { z } from "zod";

import { ExpirationSettingSchema } from "./contract.js";
import type { ExpirationSetting } from "./expiration.js";

/**
 * Server-side per-namespace policy. Today it only carries expiration defaults,
 * so that sensitive namespaces can be made to always expire without the
 * publisher opting in on every page. A per-page setting still overrides this.
 *
 * Example config (a file path or inline JSON via `PUB_NAMESPACE_CONFIG`):
 *
 * ```json
 * {
 *   "default": { "expires": false },
 *   "namespaces": {
 *     "secret": { "expires": true },
 *     "scratch": { "expires": "7d" }
 *   }
 * }
 * ```
 */

const NamespacePolicySchema = z.object({
  // `expires` accepts a boolean, a number of days, or a duration string —
  // the same shape used by page-level frontmatter (see contract.ts).
  expires: ExpirationSettingSchema.optional(),
});

export const NamespaceConfigSchema = z.object({
  default: NamespacePolicySchema.optional(),
  namespaces: z.record(z.string(), NamespacePolicySchema).default({}),
});

export type NamespaceConfig = z.infer<typeof NamespaceConfigSchema>;

/**
 * Resolves the configured expiration setting for a namespace, falling back to
 * the global `default`. Returns `undefined` when neither is configured, so the
 * caller can treat it as "not set at this level".
 */
export type NamespaceExpirationResolver = (
  namespace: string,
) => ExpirationSetting;

const NO_POLICY: NamespaceExpirationResolver = () => undefined;

export function createNamespaceExpirationResolver(
  config: NamespaceConfig,
): NamespaceExpirationResolver {
  return (namespace: string): ExpirationSetting => {
    const namespacePolicy = config.namespaces[namespace];

    if (namespacePolicy?.expires !== undefined) {
      return namespacePolicy.expires;
    }

    return config.default?.expires;
  };
}

export function parseNamespaceConfig(raw: string): NamespaceConfig {
  return NamespaceConfigSchema.parse(JSON.parse(raw));
}

/**
 * Builds a resolver from a `PUB_NAMESPACE_CONFIG`-style source. The source may
 * be inline JSON (starts with `{`) or a path to a JSON file. Returns a no-op
 * resolver when the source is undefined/empty or the file is missing, so
 * expiration stays purely opt-in by default.
 */
export function loadNamespaceExpirationResolver(
  source: string | undefined,
): NamespaceExpirationResolver {
  const trimmed = source?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return NO_POLICY;
  }

  const raw = trimmed.startsWith("{") ? trimmed : readConfigFile(trimmed);

  if (raw === null) {
    return NO_POLICY;
  }

  return createNamespaceExpirationResolver(parseNamespaceConfig(raw));
}

function readConfigFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
