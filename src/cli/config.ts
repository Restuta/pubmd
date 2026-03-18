import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

const NamespaceConfigSchema = z.object({
  token: z.string().min(1),
});

const ConfigSchema = z.object({
  apiBaseUrl: z.string().url().optional(),
  defaultNamespace: z.string().optional(),
  namespaces: z.record(z.string(), NamespaceConfigSchema),
});

const MappingEntrySchema = z.object({
  namespace: z.string(),
  pageId: z.string().uuid(),
  slug: z.string(),
  url: z.string().url(),
});

const MappingSchema = z.object({
  files: z.record(z.string(), MappingEntrySchema),
});

export type PublishConfig = z.infer<typeof ConfigSchema>;
export type PublishMapping = z.infer<typeof MappingSchema>;
export type PublishMappingEntry = z.infer<typeof MappingEntrySchema>;

export async function loadConfig(): Promise<PublishConfig> {
  const configPath = getConfigPath();

  try {
    const raw = await readFile(configPath, "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        namespaces: {},
      };
    }

    throw error;
  }
}

export async function saveConfig(config: PublishConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function loadMapping(
  mappingPath = getMappingPath(),
): Promise<PublishMapping> {
  try {
    const raw = await readFile(mappingPath, "utf8");
    return MappingSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        files: {},
      };
    }

    throw error;
  }
}

export async function saveMapping(
  mapping: PublishMapping,
  mappingPath = getMappingPath(),
): Promise<void> {
  await writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
}

export function getConfigPath(): string {
  const configDir =
    getEnv("PUB_CONFIG_DIR") ?? path.join(os.homedir(), ".config", "pub");
  return path.join(configDir, "config.json");
}

export function getMappingPath(): string {
  return getEnv("PUB_MAPPING_PATH") ?? path.join(process.cwd(), ".pub");
}

export function resolveApiBase(
  config: PublishConfig,
  override?: string,
): string {
  return (
    override ??
    config.apiBaseUrl ??
    getEnv("PUB_API_BASE_URL") ??
    "http://127.0.0.1:8787"
  );
}

function getEnv(
  name: "PUB_API_BASE_URL" | "PUB_CONFIG_DIR" | "PUB_MAPPING_PATH",
): string | undefined {
  return process.env[name];
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
