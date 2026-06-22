import { describe, expect, it } from "vitest";

import { extractHtmlMeta } from "../../src/core/html-meta.js";

describe("extractHtmlMeta", () => {
  it("reads title and description", () => {
    const meta = extractHtmlMeta(
      '<head><title>My Report</title><meta name="description" content="A short summary"></head>',
    );

    expect(meta.title).toBe("My Report");
    expect(meta.description).toBe("A short summary");
  });

  it("handles attribute order and single quotes on the description meta", () => {
    const meta = extractHtmlMeta(
      "<meta content='Reversed order' name='description'>",
    );

    expect(meta.description).toBe("Reversed order");
  });

  it("collapses whitespace and decodes basic entities in the title", () => {
    const meta = extractHtmlMeta("<title>  Tom &amp;\n  Jerry  </title>");

    expect(meta.title).toBe("Tom & Jerry");
  });

  it("returns null when title and description are absent", () => {
    const meta = extractHtmlMeta("<h1>No head metadata here</h1>");

    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
  });

  it("ignores an empty title", () => {
    const meta = extractHtmlMeta("<title>   </title>");

    expect(meta.title).toBeNull();
  });
});
