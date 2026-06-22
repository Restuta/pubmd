import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  autolinkBareUrls,
  buildHtmlDocument,
  parseMarkdownDocument,
  renderMarkdownToHtml,
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
