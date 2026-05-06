import { NameSchema } from "./contract.js";

/** Converts text into a stable URL-safe ASCII slug. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .replaceAll(/-{2,}/g, "-");

  return slug.length > 0 ? slug : "note";
}

/** Returns a slug that does not collide with already-used slugs. */
export function uniqueSlug(baseSlug: string, usedSlugs: Set<string>): string {
  let candidate = baseSlug;
  let suffix = 1;

  while (usedSlugs.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

/** Generates browser-executable slugify source using the shared server slugifier. */
export function slugifyFunctionSource(functionName: string): string {
  return namedFunctionSource(slugify, "slugify", functionName);
}

/** Generates browser-executable unique-slug source using the shared server helper. */
export function uniqueSlugFunctionSource(functionName: string): string {
  return namedFunctionSource(uniqueSlug, "uniqueSlug", functionName);
}

function namedFunctionSource(
  source: { toString(): string },
  originalName: string,
  functionName: string,
): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName)) {
    throw new Error(`Invalid function name: ${functionName}`);
  }

  return source
    .toString()
    .replace(
      new RegExp(`^function\\s+${originalName}\\s*\\(`),
      `function ${functionName}(`,
    );
}

/** Validates and returns a namespace or slug name. */
export function ensureName(value: string): string {
  return NameSchema.parse(value);
}
