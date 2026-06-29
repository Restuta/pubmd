import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNamespaceExpirationResolver,
  loadNamespaceExpirationResolver,
  NamespaceConfigSchema,
  parseNamespaceConfig,
} from "../../src/core/namespace-config.js";

describe("createNamespaceExpirationResolver", () => {
  it("prefers a namespace policy over the global default", () => {
    const resolve = createNamespaceExpirationResolver(
      NamespaceConfigSchema.parse({
        default: { expires: false },
        namespaces: {
          secret: { expires: true },
          scratch: { expires: "7d" },
        },
      }),
    );

    expect(resolve("secret")).toBe(true);
    expect(resolve("scratch")).toBe("7d");
  });

  it("falls back to the global default, then to undefined", () => {
    const resolve = createNamespaceExpirationResolver(
      NamespaceConfigSchema.parse({
        default: { expires: "30d" },
        namespaces: {},
      }),
    );

    expect(resolve("anything")).toBe("30d");

    const noDefault = createNamespaceExpirationResolver(
      NamespaceConfigSchema.parse({ namespaces: {} }),
    );
    expect(noDefault("anything")).toBeUndefined();
  });
});

describe("loadNamespaceExpirationResolver", () => {
  it("returns a no-op resolver when no source is configured", () => {
    expect(loadNamespaceExpirationResolver(undefined)("x")).toBeUndefined();
    expect(loadNamespaceExpirationResolver("")("x")).toBeUndefined();
  });

  it("accepts inline JSON", () => {
    const resolve = loadNamespaceExpirationResolver(
      '{ "namespaces": { "secret": { "expires": true } } }',
    );
    expect(resolve("secret")).toBe(true);
    expect(resolve("public")).toBeUndefined();
  });

  it("reads a config file path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pubmd-nsconfig-"));
    const configPath = path.join(dir, "namespaces.json");
    await writeFile(
      configPath,
      JSON.stringify({ namespaces: { secret: { expires: "12h" } } }),
      "utf8",
    );

    const resolve = loadNamespaceExpirationResolver(configPath);
    expect(resolve("secret")).toBe("12h");
  });

  it("treats a missing config file as no policy", () => {
    const resolve = loadNamespaceExpirationResolver(
      path.join(os.tmpdir(), "pubmd-does-not-exist-12345.json"),
    );
    expect(resolve("secret")).toBeUndefined();
  });
});

describe("parseNamespaceConfig", () => {
  it("rejects unknown expiration value shapes", () => {
    expect(() =>
      parseNamespaceConfig('{ "namespaces": { "x": { "expires": {} } } }'),
    ).toThrow();
  });
});
