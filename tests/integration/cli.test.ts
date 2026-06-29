import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type StartedTestServer, startTestServer } from "./test-server.js";

const repoRoot = process.cwd();

describe("cli integration", () => {
  let server: StartedTestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("claims, publishes, republishes, lists, and removes through the real CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      notePath,
      `---
title: First Note
---

Hello from CLI.
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const firstPublish = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    const firstUrl = firstPublish.stdout.trim();
    expect(firstUrl).toContain("/restuta/first-note");

    await writeFile(
      notePath,
      `---
title: First Note
---

Updated body.
`,
      "utf8",
    );

    const secondPublish = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    expect(secondPublish.stdout.trim()).toBe(firstUrl);

    const publicResponse = await fetch(firstUrl);
    expect(await publicResponse.text()).toContain("Updated body.");

    const listResult = await runCli(["list", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });
    expect(listResult.stdout).toContain("first-note");

    await runCli(["remove", "first-note", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const removedResponse = await fetch(firstUrl);
    expect(removedResponse.status).toBe(404);

    const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as {
      files: Record<string, unknown>;
    };
    expect(Object.keys(mapping.files)).toHaveLength(0);
  });

  it("publishes with an --expires TTL and reports the deadline on stderr", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-exp-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(notePath, "---\ntitle: TTL Note\n---\n\nBody.\n", "utf8");

    const env = {
      PUB_CONFIG_DIR: configDir,
      PUB_MAPPING_PATH: mappingPath,
    };

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env,
    });

    const published = await runCli(
      ["publish", notePath, "--api-base", server.origin, "--expires", "7d"],
      { cwd, env },
    );

    // stdout stays a bare URL; the deadline goes to stderr.
    expect(published.stdout.trim()).toContain("/restuta/ttl-note");
    expect(published.stderr).toContain("Expires");

    const served = await fetch(published.stdout.trim());
    expect(served.status).toBe(200);
  });

  it("renders local image embeds while preserving the original raw markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-img-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");
    const imagePath = path.join(cwd, "diagram.svg");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="green"/></svg>',
      "utf8",
    );
    await writeFile(
      notePath,
      `---
title: Embedded Image
---

Look:

![[diagram.svg|320x200]]
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const publishResult = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    const pageUrl = publishResult.stdout.trim();

    const htmlResponse = await fetch(pageUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data:image/svg+xml;base64,");

    const rawResponse = await fetch(`${pageUrl}?raw=1`);
    const rawMarkdown = await rawResponse.text();
    expect(rawMarkdown).toContain("![[diagram.svg|320x200]]");
  });

  it("renders Excalidraw embeds from sibling exported images while preserving the raw note", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-excal-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "note.md");
    const drawingPath = path.join(cwd, "landscape.excalidraw.md");
    const exportPath = path.join(cwd, "landscape.svg");

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      drawingPath,
      `---
excalidraw-plugin: parsed
---
`,
      "utf8",
    );
    await writeFile(
      exportPath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="orange"/></svg>',
      "utf8",
    );
    await writeFile(
      notePath,
      `---
title: Excalidraw Embed
---

Diagram:

![[landscape.excalidraw.md]]
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: mappingPath,
      },
    });

    const publishResult = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      {
        cwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: mappingPath,
        },
      },
    );
    const pageUrl = publishResult.stdout.trim();

    const htmlResponse = await fetch(pageUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data:image/svg+xml;base64,");

    const rawResponse = await fetch(`${pageUrl}?raw=1`);
    const rawMarkdown = await rawResponse.text();
    expect(rawMarkdown).toContain("![[landscape.excalidraw.md]]");
  });

  it("writes a vault manifest and reuses it across working directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-vault-"));
    const configDir = path.join(root, "config");
    const firstMappingPath = path.join(root, "first.pub");
    const secondMappingPath = path.join(root, "second.pub");
    const vaultRoot = path.join(root, "vault");
    const firstCwd = path.join(vaultRoot, "notes");
    const secondCwd = vaultRoot;
    const notePath = path.join(firstCwd, "vision.md");
    const manifestPath = path.join(vaultRoot, ".pubmd", "pages.toml");

    server = await startTestServer(root);
    await mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true });
    await mkdir(firstCwd, { recursive: true });
    await writeFile(
      notePath,
      `---
title: Product Vision
---

First version.
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd: firstCwd,
      env: {
        PUB_CONFIG_DIR: configDir,
        PUB_MAPPING_PATH: firstMappingPath,
      },
    });

    const firstUrl = (
      await runCli(["publish", notePath, "--api-base", server.origin], {
        cwd: firstCwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: firstMappingPath,
        },
      })
    ).stdout.trim();

    const manifestContents = await readFile(manifestPath, "utf8");
    expect(manifestContents).toContain('source = "notes/vision.md"');
    expect(manifestContents).toContain('slug = "product-vision"');
    expect(manifestContents).toContain(firstUrl);

    await writeFile(
      notePath,
      `---
title: Product Vision Renamed
---

Updated body.
`,
      "utf8",
    );

    const secondPublish = await runCli(
      ["publish", path.join("notes", "vision.md"), "--api-base", server.origin],
      {
        cwd: secondCwd,
        env: {
          PUB_CONFIG_DIR: configDir,
          PUB_MAPPING_PATH: secondMappingPath,
        },
      },
    );
    const secondUrl = secondPublish.stdout.trim();

    expect(secondUrl).toBe(firstUrl);

    const pageResponse = await fetch(firstUrl);
    expect(await pageResponse.text()).toContain("Updated body.");
  });

  it("publishes a multi-file HTML page, inlining css/js/images into one self-contained page", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "publish-it-cli-html-"));
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const pagePath = path.join(cwd, "page.html");
    const env = {
      PUB_CONFIG_DIR: configDir,
      PUB_MAPPING_PATH: mappingPath,
    };

    server = await startTestServer(root);
    await mkdir(path.join(cwd, "css"), { recursive: true });
    await mkdir(path.join(cwd, "img"), { recursive: true });
    await writeFile(
      path.join(cwd, "img", "bg.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="purple"/></svg>',
      "utf8",
    );
    await writeFile(
      path.join(cwd, "css", "app.css"),
      ".hero { background: url(../img/bg.svg); }",
      "utf8",
    );
    await writeFile(
      path.join(cwd, "app.js"),
      "window.__loaded = 'INLINE_JS_MARKER';",
      "utf8",
    );
    await writeFile(
      pagePath,
      `<!doctype html>
<html>
  <head>
    <title>Dashboard</title>
    <link rel="stylesheet" href="css/app.css">
  </head>
  <body>
    <h1 class="hero">HEADING_MARKER</h1>
    <script src="app.js"></script>
  </body>
</html>
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env,
    });

    const publishResult = await runCli(
      ["publish", pagePath, "--api-base", server.origin],
      { cwd, env },
    );
    const pageUrl = publishResult.stdout.trim();
    expect(pageUrl).toContain("/restuta/page");

    const response = await fetch(pageUrl);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const html = await response.text();
    expect(html).toContain("HEADING_MARKER");
    expect(html).toContain("INLINE_JS_MARKER");
    expect(html).toContain('url("data:image/svg+xml;base64,');
    expect(html).not.toContain('href="css/app.css"');
    expect(html).not.toContain('src="app.js"');

    const rawResponse = await fetch(`${pageUrl}?raw=1`);
    expect(rawResponse.headers.get("content-type")).toContain("text/plain");
    expect(await rawResponse.text()).toContain(
      '<link rel="stylesheet" href="css/app.css">',
    );
  });

  it("publishes HTML with opt-in comments while preserving the clean URL and raw source", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "publish-it-cli-review-html-"),
    );
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const pagePath = path.join(cwd, "review.html");
    const env = {
      PUB_CONFIG_DIR: configDir,
      PUB_MAPPING_PATH: mappingPath,
    };

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      pagePath,
      `<!doctype html>
<html>
  <head><title>Review HTML</title></head>
  <body><main><p>Original HTML paragraph.</p></main></body>
</html>
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env,
    });

    const publishResult = await runCli(
      ["publish", pagePath, "--comments", "--api-base", server.origin],
      { cwd, env },
    );
    const commentsUrl = publishResult.stdout.trim();
    const cleanUrl = cleanPublishedUrl(commentsUrl);

    expect(commentsUrl).toBe(`${cleanUrl}?comments=1`);

    const htmlResponse = await fetch(commentsUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data-pubmd-review-annotations");
    expect(html).toContain('id="pubmdReviewToolbar"');
    expect(html).toContain("commentsEnabled()");
    expect(html).toContain(">Clear all<");
    expect(html).not.toContain("modeToggle");

    const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as {
      files: Record<string, { url: string }>;
    };
    const mappedUrls = Object.values(mapping.files).map((entry) => entry.url);
    expect(mappedUrls).toContain(cleanUrl);
    expect(mappedUrls).not.toContain(commentsUrl);

    const rawResponse = await fetch(`${cleanUrl}?raw=1`);
    const rawHtml = await rawResponse.text();
    expect(rawHtml).toContain("Original HTML paragraph.");
    expect(rawHtml).not.toContain("data-pubmd-review-annotations");
  });

  it("publishes HTML meta opt-in review annotations", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "publish-it-cli-review-meta-"),
    );
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const pagePath = path.join(cwd, "review-meta.html");
    const env = {
      PUB_CONFIG_DIR: configDir,
      PUB_MAPPING_PATH: mappingPath,
    };

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      pagePath,
      `<!doctype html>
<html>
  <head>
    <title>Review Meta</title>
    <meta name="pubmd:comments" content="true">
  </head>
  <body><main><p>Meta opt-in paragraph.</p></main></body>
</html>
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env,
    });

    const publishResult = await runCli(
      ["publish", pagePath, "--api-base", server.origin],
      { cwd, env },
    );
    const commentsUrl = publishResult.stdout.trim();
    const cleanUrl = cleanPublishedUrl(commentsUrl);

    expect(commentsUrl).toBe(`${cleanUrl}?comments=1`);

    const htmlResponse = await fetch(commentsUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data-pubmd-review-annotations");
    expect(html).toContain('id="pubmdReviewDrawer"');
  });

  it("publishes markdown frontmatter opt-in review annotations", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "publish-it-cli-review-md-"),
    );
    const configDir = path.join(root, "config");
    const mappingPath = path.join(root, ".pub");
    const cwd = path.join(root, "workspace");
    const notePath = path.join(cwd, "review-note.md");
    const env = {
      PUB_CONFIG_DIR: configDir,
      PUB_MAPPING_PATH: mappingPath,
    };

    server = await startTestServer(root);
    await mkdir(cwd, { recursive: true });
    await writeFile(
      notePath,
      `---
title: Review Note
comments: true
---

# Review Note

Markdown paragraph for comments.
`,
      "utf8",
    );

    await runCli(["claim", "restuta", "--api-base", server.origin], {
      cwd,
      env,
    });

    const publishResult = await runCli(
      ["publish", notePath, "--api-base", server.origin],
      { cwd, env },
    );
    const commentsUrl = publishResult.stdout.trim();
    const cleanUrl = cleanPublishedUrl(commentsUrl);

    expect(commentsUrl).toBe(`${cleanUrl}?comments=1`);

    const htmlResponse = await fetch(commentsUrl);
    const html = await htmlResponse.text();
    expect(html).toContain("data-pubmd-review-annotations");
    expect(html).toContain('id="pubmdReviewPopup"');

    const rawResponse = await fetch(`${cleanUrl}?raw=1`);
    expect(await rawResponse.text()).toContain("comments: true");
  });
});

function cleanPublishedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.toString();
}

async function runCli(
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
): Promise<{ stderr: string; stdout: string }> {
  await mkdirIfNeeded(options.cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
        path.join(repoRoot, "src/cli/main.ts"),
        ...args,
      ],
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`CLI exited with code ${code}: ${stderr}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function mkdirIfNeeded(target: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(target, { recursive: true });
}
