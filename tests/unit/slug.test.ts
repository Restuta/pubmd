import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  ensureName,
  slugify,
  slugifyFunctionSource,
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

  it("rejects invalid names", () => {
    expect(() => ensureName("bad/slug")).toThrow();
  });
});
