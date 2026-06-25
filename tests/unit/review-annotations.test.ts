import { describe, expect, it } from "vitest";

import {
  applyReviewAnnotations,
  hasReviewAnnotationsOptIn,
  injectReviewAnnotations,
} from "../../src/core/review-annotations.js";

const BASIC_HTML = `<!doctype html>
<html>
  <head>
    <title>Reviewable Page</title>
  </head>
  <body>
    <main>
      <h1>Reviewable Page</h1>
      <p>First paragraph for review.</p>
    </main>
  </body>
</html>`;

describe("review annotations", () => {
  it("detects HTML meta opt-in", () => {
    expect(
      hasReviewAnnotationsOptIn(
        '<html><head><meta name="pubmd:comments" content="true"></head></html>',
      ),
    ).toBe(true);
    expect(
      hasReviewAnnotationsOptIn(
        "<html><head><meta content='TRUE' name='pubmd:review'></head></html>",
      ),
    ).toBe(true);
    expect(
      hasReviewAnnotationsOptIn(
        '<html><head><meta name="pubmd:review" content="false"></head></html>',
      ),
    ).toBe(false);
  });

  it("adds the annotation UI when enabled", () => {
    const html = applyReviewAnnotations(BASIC_HTML, true);

    expect(html).toContain("data-pubmd-review-annotations");
    expect(html).toContain('id="pubmdReviewToolbar"');
    expect(html).toContain('id="pubmdReviewDrawer"');
    expect(html).toContain('id="pubmdReviewPopup"');
    expect(html).toContain('id="pubmdReviewExport"');
    expect(html).toContain("What should change?");
    expect(html).toContain("window.name");
    expect(html).toContain("function commentsEnabled()");
    expect(html).toContain('var value = params.get("comments");');
    expect(html).toContain("if (!commentsEnabled())");
  });

  it("hides comment chrome until the URL has comments=1", () => {
    const html = injectReviewAnnotations(BASIC_HTML);

    expect(html).toContain(".pubmd-review-root,");
    expect(html).toContain(".pubmd-review-export {");
    expect(html).toContain("display: none;");
    expect(html).toContain("body.pubmd-review-active .pubmd-review-root");
    expect(html).toContain('value === "1"');
  });

  it("does nothing when disabled by the caller", () => {
    expect(applyReviewAnnotations(BASIC_HTML, false)).toBe(BASIC_HTML);
  });

  it("does not duplicate injection if run twice", () => {
    const once = injectReviewAnnotations(BASIC_HTML);
    const twice = injectReviewAnnotations(once);

    expect(twice).toBe(once);
    expect(twice.match(/data-pubmd-review-annotations/g)).toHaveLength(1);
    expect(twice.match(/id="pubmdReviewDrawer"/g)).toHaveLength(1);
  });

  it("keeps bottom controls limited to Clear all", () => {
    const html = injectReviewAnnotations(BASIC_HTML);
    const toolbar = html.match(
      /<div[^>]*id="pubmdReviewToolbar"[\s\S]*?<\/div>/,
    )?.[0];

    expect(toolbar).toContain(">Clear all<");
    expect(toolbar).not.toContain("Copy");
    expect(toolbar).not.toContain("Comments");
    expect(toolbar).not.toContain("0 comments");
    expect(html).not.toContain("modeToggle");
    expect(html).not.toContain("commentsToggle");
    expect(html).not.toContain("Annotating on");
    expect(html).not.toContain("Enter saves");
  });

  it("renders drawer cards with individual Delete controls", () => {
    const html = injectReviewAnnotations(BASIC_HTML);

    expect(html).toContain('class="pubmd-review-card-delete"');
    expect(html).toContain(">Delete</button>");
  });

  it("scopes persisted annotations to the current page URL", () => {
    const html = injectReviewAnnotations(BASIC_HTML);

    expect(html).toContain('return STORAGE_KEY + "::" + pageUrl();');
    expect(html).toContain("localStorage.getItem(key)");
    expect(html).toContain("localStorage.setItem(key");
    expect(html).toContain("state[key] = safeAnnotations");
    expect(html).not.toContain("pubmdReviewAnnotations");
  });

  it("initializes the in-memory fallback before loading annotations", () => {
    const html = injectReviewAnnotations(BASIC_HTML);
    const fallbackIndex = html.indexOf("var memoryAnnotations = [];");
    const loadIndex = html.indexOf("annotations = loadAnnotations();");

    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeLessThan(loadIndex);
    expect(html).toContain("return annotationArray(state[key]);");
    expect(html).toContain("return memoryAnnotations;");
  });

  it("reuses an existing exportPrompt textarea instead of injecting a duplicate export section", () => {
    const html = injectReviewAnnotations(`<!doctype html>
<html>
  <head><title>Existing export</title></head>
  <body>
    <main><p>Review this.</p></main>
    <textarea id="exportPrompt"></textarea>
    <button id="copyPrompt" type="button">Copy prompt</button>
    <span id="copyStatus"></span>
  </body>
</html>`);

    expect(html).not.toContain('id="pubmdReviewExport"');
    expect(html).toContain(
      'byId("pubmdReviewExportPrompt") || byId("exportPrompt")',
    );
    expect(html).toContain(
      'byId("pubmdReviewCopyPrompt") || byId("copyPrompt")',
    );
  });
});
