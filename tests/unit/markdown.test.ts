import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  autolinkBareUrls,
  buildHtmlDocument,
  getActiveHeadingId,
  parseMarkdownDocument,
  renderMarkdownToHtml,
  TOC_ACTIVE_OFFSET_PX,
} from "../../src/core/markdown.js";

class TestClassList {
  private readonly classes = new Set<string>();

  add(className: string): void {
    this.classes.add(className);
  }

  toggle(className: string, force?: boolean): void {
    if (force ?? !this.classes.has(className)) {
      this.classes.add(className);
      return;
    }

    this.classes.delete(className);
  }
}

class TestElement {
  readonly tagName: string;
  readonly children: TestElement[] = [];
  readonly classList = new TestClassList();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  className = "";
  href = "";
  id = "";
  innerHTML = "";
  textContent: string;
  private readonly attributes = new Map<string, string>();

  constructor(tagName: string, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
  }

  appendChild(child: TestElement): TestElement {
    this.children.push(child);
    return child;
  }

  addEventListener(_eventName: string, _listener: unknown): void {}

  getAttribute(name: string): string | null {
    if (name === "href") {
      return this.href;
    }

    return this.attributes.get(name) ?? null;
  }

  querySelector(_selector: string): TestElement | null {
    return null;
  }

  querySelectorAll(selector: string): TestElement[] {
    if (selector !== "a") {
      return [];
    }

    return this.children.flatMap((child) => [
      ...(child.tagName === "A" ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  scrollIntoView(_options: unknown): void {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class TestDocument {
  readonly body = new TestElement("body");

  constructor(private readonly headings: TestElement[]) {}

  createElement(tagName: string): TestElement {
    return new TestElement(tagName);
  }

  querySelectorAll(selector: string): TestElement[] {
    if (selector === "pre") {
      return [];
    }

    if (selector === "article h1, article h2, article h3, article h4") {
      return this.headings;
    }

    return this.body.querySelectorAll(selector);
  }
}

class TestIntersectionObserver {
  observe(_target: TestElement): void {}
}

function runDocumentScript(html: string, document: TestDocument): void {
  const script = html.match(/<script>\n([\s\S]*?)\n {4}<\/script>/)?.[1];
  if (!script) {
    throw new Error("Expected generated document to include a script");
  }

  runInNewContext(script, {
    document,
    IntersectionObserver: TestIntersectionObserver,
    navigator: { clipboard: { writeText: () => undefined } },
    setTimeout: () => undefined,
    window: {
      innerHeight: 0,
      scrollY: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      requestAnimationFrame: () => 0,
    },
  });
}

describe("markdown pipeline", () => {
  it("extracts frontmatter and sensible defaults", () => {
    const parsed = parseMarkdownDocument(`---
title: Launch Notes
noindex: false
---

# Hello

This is a release note.`);

    expect(parsed.title).toBe("Launch Notes");
    expect(parsed.noindex).toBe(false);
    expect(parsed.description).toBe("This is a release note.");
  });

  it("renders GFM markdown and wraps html document metadata", async () => {
    const rendered = await renderMarkdownToHtml(`
## Demo

| name | value |
| --- | --- |
| foo | bar |

\`\`\`ts
const answer = 42;
\`\`\`
`);
    const html = buildHtmlDocument({
      title: "Demo",
      description: "Example",
      noindex: true,
      bodyHtml: rendered.html,
    });

    expect(rendered.html).toContain("<table>");
    expect(rendered.html).toContain("language-ts");
    expect(html).toContain('meta name="robots" content="noindex,nofollow"');
    expect(html).toContain('rel="icon"');
    expect(html).toContain("--link:");
    expect(html).toContain("text-underline-offset");
    expect(html).toContain('const pageTitle = "Demo";');
    expect(html).toContain("article h1, article h2, article h3, article h4");
    expect(html).toContain("depth-root");
    expect(html).toContain("depth-child");
    expect(html).toContain("const setActive = id =>");
    expect(html).toContain("if (targetId) setActive(targetId);");
  });

  it("builds adaptive TOC logic for documents that use body h1 headings", () => {
    const html = buildHtmlDocument({
      title: "Doc Title",
      description: "Example",
      noindex: true,
      bodyHtml:
        "<h1>Doc Title</h1><h1>Section</h1><h2>Child</h2><h1>Another</h1>",
    });

    expect(html).toContain('const pageTitle = "Doc Title";');
    expect(html).toContain("article h1, article h2, article h3, article h4");
    expect(html).toContain("depth-root");
    expect(html).toContain("depth-child");
  });

  it("renders deterministic heading ids and de-dupes slug collisions", async () => {
    const rendered = await renderMarkdownToHtml(`
## AI And Predictive Health

### Why It Matters

## AI And Predictive Health

## AI And Predictive Health 1

## Привет 👋

## Foo

## Foo 1

## Foo
`);

    expect(rendered.html).toContain(
      '<h2 id="ai-and-predictive-health">AI And Predictive Health</h2>',
    );
    expect(rendered.html).toContain(
      '<h3 id="why-it-matters">Why It Matters</h3>',
    );
    expect(rendered.html).toContain(
      '<h2 id="ai-and-predictive-health-1">AI And Predictive Health</h2>',
    );
    expect(rendered.html).toContain(
      '<h2 id="ai-and-predictive-health-1-1">AI And Predictive Health 1</h2>',
    );
    expect(rendered.html).toContain('<h2 id="note">');
    expect(rendered.html).toContain('<h2 id="foo">Foo</h2>');
    expect(rendered.html).toContain('<h2 id="foo-1">Foo 1</h2>');
    expect(rendered.html).toContain('<h2 id="foo-2">Foo</h2>');
  });

  it("assigns deterministic TOC fallback ids for raw body headings", () => {
    const html = buildHtmlDocument({
      title: "Doc Title",
      description: "Example",
      noindex: true,
      bodyHtml: "",
    });
    const alreadyLinked = new TestElement("h2", "Already Linked");
    alreadyLinked.id = "custom-existing";
    const headings = [
      new TestElement("h1", "Doc Title"),
      new TestElement("h1", "AI And Predictive Health"),
      new TestElement("h2", "AI And Predictive Health 1"),
      new TestElement("h2", "Café Health 💡"),
      new TestElement("h1", "AI And Predictive Health"),
      new TestElement("h1", "Привет 👋"),
      alreadyLinked,
      new TestElement("h1", "Foo"),
      new TestElement("h1", "Foo 1"),
      new TestElement("h1", "Foo"),
    ];

    const document = new TestDocument(headings);
    runDocumentScript(html, document);

    expect(headings.map((heading) => heading.id)).toEqual([
      "",
      "ai-and-predictive-health",
      "ai-and-predictive-health-1",
      "cafe-health",
      "ai-and-predictive-health-2",
      "note",
      "custom-existing",
      "foo",
      "foo-1",
      "foo-2",
    ]);
    expect(
      document.body.querySelectorAll("a").map((link) => link.href),
    ).toEqual([
      "#ai-and-predictive-health",
      "#ai-and-predictive-health-1",
      "#cafe-health",
      "#ai-and-predictive-health-2",
      "#note",
      "#custom-existing",
      "#foo",
      "#foo-1",
      "#foo-2",
    ]);
  });

  it("renders real-world mixed markdown structures cleanly", async () => {
    const rendered = await renderMarkdownToHtml(`
# Publish-It — Project Plan

Like [telegra.ph](https://telegra.ph) but for the terminal era.

> One command, one URL, done.

- Why Build This
  - JotBird exists
  - Rentry exists
- Philosophy
  - stable URLs
  - simple publishing

1. Claim namespace
2. Publish markdown

\`inline code\`

\`\`\`
CLI or curl
  ↓ HTTP POST with Bearer token
Edge Function (Hono)
  ↓
Stores raw .md + pre-rendered .html
\`\`\`
`);

    expect(rendered.html).toContain(
      '<h1 id="publish-it-project-plan">Publish-It',
    );
    expect(rendered.html).toContain('<a href="https://telegra.ph">');
    expect(rendered.html).toContain("<blockquote>");
    expect(rendered.html).toContain("<ul>");
    expect(rendered.html).toContain("<ol>");
    expect(rendered.html).toContain("<code>inline code</code>");
    expect(rendered.html).toContain("<pre><code>CLI or curl");
    expect(rendered.html).toContain("Edge Function (Hono)");
  });

  it("renders Obsidian callouts with styled wrapper markup", async () => {
    const rendered = await renderMarkdownToHtml(`
> [!warning] Heads up
> Keep this page private.
`);

    const html = buildHtmlDocument({
      title: "Callouts",
      description: "Example",
      noindex: true,
      bodyHtml: rendered.html,
    });

    expect(rendered.html).toContain('class="callout"');
    expect(rendered.html).toContain('data-callout="warning"');
    expect(rendered.html).toContain("Heads up");
    expect(rendered.html).toContain("Keep this page private.");
    expect(html).toContain('.callout[data-callout="warning"]');
    expect(html).toContain(".callout-title");
  });

  it("supports callout aliases and collapsible state", async () => {
    const rendered = await renderMarkdownToHtml(`
> [!faq]- Common questions
> This one starts collapsed.
`);

    expect(rendered.html).toContain("<details");
    expect(rendered.html).toContain('data-callout="question"');
    expect(rendered.html).not.toContain("<details open");
    expect(rendered.html).toContain("Common questions");
    expect(rendered.html).toContain("This one starts collapsed.");
  });

  it("renders expanded foldable callouts with the default title", async () => {
    const rendered = await renderMarkdownToHtml(`
> [!tip]+
> This one starts open.
`);

    expect(rendered.html).toContain('data-callout="tip"');
    expect(rendered.html).toContain("<details");
    expect(rendered.html).toContain(
      '<details class="callout" data-callout="tip" open>',
    );
    expect(rendered.html).toContain(">Tip<");
    expect(rendered.html).toContain("This one starts open.");
  });

  it("preserves nested markdown content inside callouts", async () => {
    const rendered = await renderMarkdownToHtml(`
> [!tip]
> Use **strong formatting** inside callouts.
>
> - first item
> - second item
`);

    expect(rendered.html).toContain('data-callout="tip"');
    expect(rendered.html).toContain("<strong>strong formatting</strong>");
    expect(rendered.html).toContain("<ul>");
    expect(rendered.html).toContain("<li>first item</li>");
  });
});

describe("raw HTML in markdown", () => {
  it("preserves author-written <details>/<summary> with nested markdown (fixture)", async () => {
    const fixture = await readFile(
      fileURLToPath(new URL("../fixtures/details-summary.md", import.meta.url)),
      "utf8",
    );
    const rendered = await renderMarkdownToHtml(fixture);

    // Collapsible wrapper survives rendering.
    expect(rendered.html).toContain("<details>");
    expect(rendered.html).toContain("</details>");
    expect(rendered.html).toContain("<summary>Click me</summary>");
    // Markdown inside the details block still renders.
    expect(rendered.html).toMatch(
      /<h2 id="nested-heading">Nested heading<\/h2>/,
    );
    expect(rendered.html).toContain("<li>Bullet</li>");
    expect(rendered.html).toContain("<li>Another bullet</li>");
  });

  it("keeps the safe open attribute on <details>", async () => {
    const rendered = await renderMarkdownToHtml(`
<details open>
<summary>Already expanded</summary>

Body copy.

</details>
`);

    expect(rendered.html).toContain("<details open>");
    expect(rendered.html).toContain("<summary>Already expanded</summary>");
  });

  it("strips unsafe tags and attributes while keeping safe HTML", async () => {
    const rendered = await renderMarkdownToHtml(`
# Heading

<details onclick="steal()">
<summary>Trustworthy</summary>

<script>alert('xss')</script>
<iframe src="https://evil.example"></iframe>
<img src="x" onerror="alert(1)">

Safe paragraph with <kbd>Ctrl</kbd>.

</details>
`);

    // Safe subset is preserved.
    expect(rendered.html).toContain("<details>");
    expect(rendered.html).toContain("<summary>Trustworthy</summary>");
    expect(rendered.html).toContain("<kbd>Ctrl</kbd>");
    // Unsafe tags/attributes are removed.
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("<iframe");
    expect(rendered.html).not.toContain("onclick");
    expect(rendered.html).not.toContain("onerror");
  });

  it("neutralizes javascript: protocol links written as raw HTML", async () => {
    const rendered = await renderMarkdownToHtml(
      `<a href="javascript:alert(1)">click</a>`,
    );

    expect(rendered.html).not.toContain("javascript:");
  });
});

describe("getActiveHeadingId", () => {
  it("returns an empty id when there are no headings", () => {
    expect(getActiveHeadingId([])).toBe("");
  });

  it("uses the first heading before the scroll threshold is reached", () => {
    expect(
      getActiveHeadingId([
        { id: "intro", top: 180 },
        { id: "details", top: 420 },
      ]),
    ).toBe("intro");
  });

  it("uses the last heading that has crossed the active offset", () => {
    expect(
      getActiveHeadingId(
        [
          { id: "intro", top: -240 },
          { id: "details", top: 80 },
          { id: "faq", top: 280 },
        ],
        TOC_ACTIVE_OFFSET_PX,
      ),
    ).toBe("details");
  });

  it("promotes a clicked destination once it reaches the viewport threshold", () => {
    expect(
      getActiveHeadingId(
        [
          { id: "intro", top: -320 },
          { id: "details", top: -40 },
          { id: "faq", top: 40 },
        ],
        TOC_ACTIVE_OFFSET_PX,
      ),
    ).toBe("faq");
  });

  it("keeps the last heading active near the end of the page", () => {
    expect(
      getActiveHeadingId(
        [
          { id: "section-one", top: -300 },
          { id: "child-one", top: -120 },
          { id: "section-two", top: 600 },
        ],
        TOC_ACTIVE_OFFSET_PX,
        true,
      ),
    ).toBe("section-two");
  });
});

describe("autolinkBareUrls", () => {
  it("links bare domain URLs", () => {
    expect(autolinkBareUrls("check github.com/foo/bar for details")).toBe(
      "check [github.com/foo/bar](https://github.com/foo/bar) for details",
    );
  });

  it("links bare domain without path", () => {
    expect(autolinkBareUrls("visit hono.dev")).toBe(
      "visit [hono.dev](https://hono.dev)",
    );
  });

  it("handles multiple bare URLs on one line", () => {
    const input = "see github.com/a and npmjs.com/b";
    const result = autolinkBareUrls(input);
    expect(result).toContain("[github.com/a](https://github.com/a)");
    expect(result).toContain("[npmjs.com/b](https://npmjs.com/b)");
  });

  it("does not double-link existing markdown links", () => {
    const input = "[Quartz](https://github.com/jackyzha0/quartz)";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs that already have a protocol", () => {
    const input = "see https://github.com/foo/bar";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs inside inline code", () => {
    const input = "use `github.com/foo/bar` for this";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("does not link URLs inside code blocks", () => {
    const input = "text\n```\ngithub.com/foo/bar\n```\nmore text";
    expect(autolinkBareUrls(input)).toBe(input);
  });

  it("links URLs with various TLDs", () => {
    for (const url of [
      "example.io/path",
      "tool.sh",
      "app.dev/docs",
      "site.co/page",
      "telegra.ph",
      "paste.rs",
      "listed.to",
    ]) {
      const result = autolinkBareUrls(url);
      expect(result).toBe(`[${url}](https://${url})`);
    }
  });

  it("renders bare URLs as clickable links in HTML output", async () => {
    const rendered = await renderMarkdownToHtml(
      "Quartz source: github.com/jackyzha0/quartz",
    );
    expect(rendered.html).toContain(
      'href="https://github.com/jackyzha0/quartz"',
    );
  });

  it("preserves data URL image sources in rendered HTML", async () => {
    const rendered = await renderMarkdownToHtml(
      "![Diagram](data:image/svg+xml;base64,PHN2Zy8+)",
    );

    expect(rendered.html).toContain('src="data:image/svg+xml;base64,PHN2Zy8+"');
  });

  it("strips wikilinks and autolinks URLs inside them", async () => {
    const rendered = await renderMarkdownToHtml(
      "like [[telegra.ph]] but for the terminal era",
    );
    expect(rendered.html).toContain('href="https://telegra.ph"');
    expect(rendered.html).not.toContain("[[");
  });

  it("strips wikilinks that are not URLs", async () => {
    const rendered = await renderMarkdownToHtml(
      "see [[jotbird-analysis]] for details",
    );
    expect(rendered.html).not.toContain("[[");
    expect(rendered.html).toContain("jotbird-analysis");
  });
});
