import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inlineHtmlAssets } from "../../src/core/inline-html.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Writes a set of files (keyed by relative path) into a fresh temp dir; returns the dir. */
async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inline-html-"));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(dir, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  return dir;
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="teal"/></svg>';

describe("inlineHtmlAssets", () => {
  it("folds a local stylesheet into a <style> block", async () => {
    const baseDir = await workspace({
      "style.css": "body { color: rgb(1, 2, 3); }",
    });
    const { html, inlinedCount } = await inlineHtmlAssets(
      '<head><link rel="stylesheet" href="style.css"></head>',
      { baseDir },
    );

    expect(html).toContain("<style>body { color: rgb(1, 2, 3); }</style>");
    expect(html).not.toContain("<link");
    expect(inlinedCount).toBe(1);
  });

  it("inlines a local image as a data URL", async () => {
    const baseDir = await workspace({ "logo.svg": SVG });
    const { html } = await inlineHtmlAssets('<img src="logo.svg">', {
      baseDir,
    });

    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).not.toContain('src="logo.svg"');
  });

  it("inlines a local script and removes its src", async () => {
    const baseDir = await workspace({
      "app.js": "console.log('hello from app');",
    });
    const { html } = await inlineHtmlAssets('<script src="app.js"></script>', {
      baseDir,
    });

    expect(html).toContain("console.log('hello from app');");
    expect(html).not.toContain('src="app.js"');
  });

  it("strips all scripts when allowScripts is false", async () => {
    const baseDir = await workspace({ "app.js": "alert(1)" });
    const { html } = await inlineHtmlAssets(
      '<script src="app.js"></script><script>alert(2)</script><p>keep</p>',
      { baseDir, allowScripts: false },
    );

    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("alert(2)");
    expect(html).not.toContain("<script");
    expect(html).toContain("<p>keep</p>");
  });

  it("rewrites url() inside an inline <style> relative to the page dir", async () => {
    const baseDir = await workspace({ "bg.svg": SVG });
    const { html } = await inlineHtmlAssets(
      "<style>.hero { background: url(bg.svg); }</style>",
      { baseDir },
    );

    expect(html).toContain('url("data:image/svg+xml;base64,');
    expect(html).not.toContain("url(bg.svg)");
  });

  it("resolves url() in a stylesheet relative to the stylesheet's own directory (multi-file)", async () => {
    const baseDir = await workspace({
      "css/app.css": ".hero { background: url(../img/bg.svg); }",
      "img/bg.svg": SVG,
    });
    const { html } = await inlineHtmlAssets(
      '<link rel="stylesheet" href="css/app.css">',
      { baseDir },
    );

    expect(html).toContain('url("data:image/svg+xml;base64,');
    expect(html).not.toContain("../img/bg.svg");
  });

  it("inlines a one-level @import", async () => {
    const baseDir = await workspace({
      "css/app.css": '@import "base.css";\n.a { color: red; }',
      "css/base.css": ".b { color: blue; }",
    });
    const { html } = await inlineHtmlAssets(
      '<link rel="stylesheet" href="css/app.css">',
      { baseDir },
    );

    expect(html).toContain(".b { color: blue; }");
    expect(html).toContain(".a { color: red; }");
    expect(html).not.toContain("@import");
  });

  it("leaves remote and data references untouched", async () => {
    const baseDir = await workspace({});
    const input =
      '<img src="https://example.com/x.png"><img src="data:image/gif;base64,AAA"><img src="//cdn.example.com/y.png">';
    const { html, inlinedCount } = await inlineHtmlAssets(input, { baseDir });

    expect(html).toBe(input);
    expect(inlinedCount).toBe(0);
  });

  it("leaves missing assets in place and records them as skipped", async () => {
    const baseDir = await workspace({});
    const { html, skipped } = await inlineHtmlAssets(
      '<img src="missing.png">',
      { baseDir },
    );

    expect(html).toContain('src="missing.png"');
    expect(skipped).toEqual([{ ref: "missing.png", reason: "not-found" }]);
  });

  it("skips assets larger than maxAssetBytes", async () => {
    const baseDir = await workspace({ "big.svg": "x".repeat(500) });
    const { html, skipped } = await inlineHtmlAssets('<img src="big.svg">', {
      baseDir,
      maxAssetBytes: 100,
    });

    expect(html).toContain('src="big.svg"');
    expect(skipped).toEqual([{ ref: "big.svg", reason: "too-large" }]);
  });

  it("records site-absolute paths as skipped", async () => {
    const baseDir = await workspace({});
    const { html, skipped } = await inlineHtmlAssets('<img src="/logo.svg">', {
      baseDir,
    });

    expect(html).toContain('src="/logo.svg"');
    expect(skipped).toEqual([{ ref: "/logo.svg", reason: "absolute-path" }]);
  });

  it("handles reversed attribute order and single quotes", async () => {
    const baseDir = await workspace({ "style.css": ".q { color: green; }" });
    const { html } = await inlineHtmlAssets(
      "<link href='style.css' rel=\"stylesheet\">",
      { baseDir },
    );

    expect(html).toContain("<style>.q { color: green; }</style>");
  });

  it("inlines a favicon link", async () => {
    const baseDir = await workspace({ "favicon.svg": SVG });
    const { html } = await inlineHtmlAssets(
      '<link rel="icon" href="favicon.svg">',
      { baseDir },
    );

    expect(html).toContain('href="data:image/svg+xml;base64,');
  });

  it("strips query strings when resolving local assets", async () => {
    const baseDir = await workspace({ "logo.svg": SVG });
    const { html } = await inlineHtmlAssets('<img src="logo.svg?v=2">', {
      baseDir,
    });

    expect(html).toContain("data:image/svg+xml;base64,");
  });

  it("inlines each candidate in a srcset", async () => {
    const baseDir = await workspace({ "a.svg": SVG, "b.svg": SVG });
    const { html, inlinedCount } = await inlineHtmlAssets(
      '<img srcset="a.svg 1x, b.svg 2x">',
      { baseDir },
    );

    const dataUrls = html.match(/data:image\/svg\+xml;base64,/g) ?? [];
    expect(dataUrls).toHaveLength(2);
    expect(html).toContain("1x");
    expect(html).toContain("2x");
    expect(inlinedCount).toBe(2);
  });

  it("escapes a closing script tag inside inlined JS", async () => {
    const baseDir = await workspace({
      "app.js": 'document.write("</script>");',
    });
    const { html } = await inlineHtmlAssets('<script src="app.js"></script>', {
      baseDir,
    });

    expect(html).toContain("<\\/script>");
    // exactly one real closing tag remains (the wrapper's)
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(1);
  });
});
