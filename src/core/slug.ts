import { NameSchema } from "./contract.js";

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

export function ensureName(value: string): string {
  return NameSchema.parse(value);
}
