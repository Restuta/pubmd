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

  it("reads the pubmd:expires directive", () => {
    expect(
      extractHtmlMeta('<meta name="pubmd:expires" content="7d">').expires,
    ).toBe("7d");
    expect(
      extractHtmlMeta("<meta content='true' name='pubmd:expires'>").expires,
    ).toBe("true");
  });

  it("does not confuse a hyphenated attribute (data-name) for name", () => {
    const meta = extractHtmlMeta(
      '<meta data-name="ignored" name="pubmd:expires" content="7d">',
    );

    expect(meta.expires).toBe("7d");
  });

  it("returns null when title, description, and expires are absent", () => {
    const meta = extractHtmlMeta("<h1>No head metadata here</h1>");

    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.expires).toBeNull();
  });

  it("ignores an empty title", () => {
    const meta = extractHtmlMeta("<title>   </title>");

    expect(meta.title).toBeNull();
  });
});
