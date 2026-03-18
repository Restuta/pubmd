import { describe, expect, it } from "vitest";

import { ensureName, slugify } from "../../src/core/slug.js";

describe("slug utilities", () => {
  it("slugifies headings into URL-safe slugs", () => {
    expect(slugify("Quarterly Report: Q1 2026")).toBe(
      "quarterly-report-q1-2026",
    );
  });

  it("falls back to note for empty content", () => {
    expect(slugify("!!!")).toBe("note");
  });

  it("rejects invalid names", () => {
    expect(() => ensureName("bad/slug")).toThrow();
  });
});
