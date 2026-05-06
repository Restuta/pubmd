import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  ensureName,
  slugify,
  slugifyFunctionSource,
  uniqueSlug,
  uniqueSlugFunctionSource,
} from "../../src/core/slug.js";

describe("slug utilities", () => {
  it("slugifies headings into URL-safe slugs", () => {
    expect(slugify("Quarterly Report: Q1 2026")).toBe(
      "quarterly-report-q1-2026",
    );
  });

  it("falls back to note for empty content", () => {
    expect(slugify("!!!")).toBe("note");
  });

  it("generates client slugify source that matches server slugify behavior", () => {
    const clientSlugify = runInNewContext(
      `${slugifyFunctionSource("slugifyHeading")}; slugifyHeading;`,
    ) as (input: string) => string;

    const examples = [
      "AI And Predictive Health",
      "Café health 💡",
      "Привет 👋",
      "Quarterly Report: Q1 2026",
    ];

    for (const example of examples) {
      expect(clientSlugify(example)).toBe(slugify(example));
    }
  });

  it("generates unique slugs without colliding with suffixed headings", () => {
    const usedSlugs = new Set<string>();

    expect(uniqueSlug("foo", usedSlugs)).toBe("foo");
    expect(uniqueSlug("foo-1", usedSlugs)).toBe("foo-1");
    expect(uniqueSlug("foo", usedSlugs)).toBe("foo-2");
  });

  it("generates client unique slug source that matches server behavior", () => {
    const clientUniqueSlug = runInNewContext(
      `${uniqueSlugFunctionSource("uniqueHeadingId")}; uniqueHeadingId;`,
    ) as (baseSlug: string, usedSlugs: Set<string>) => string;
    const serverUsedSlugs = new Set(["foo", "foo-1"]);
    const clientUsedSlugs = new Set(["foo", "foo-1"]);

    expect(clientUniqueSlug("foo", clientUsedSlugs)).toBe(
      uniqueSlug("foo", serverUsedSlugs),
    );
  });

  it("rejects invalid names", () => {
    expect(() => ensureName("bad/slug")).toThrow();
  });
});
