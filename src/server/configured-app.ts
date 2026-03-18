import path from "node:path";

import { BlobStore } from "../core/blob-store.js";
import { FileStore } from "../core/file-store.js";
import { PublishService } from "../core/publish-service.js";
import { createApp } from "./app.js";

export interface AppConfig {
  dataDir?: string;
}

export function createConfiguredApp(config: AppConfig = {}) {
  const contentBlobToken = getEnv("BLOB_READ_WRITE_TOKEN");
  const metadataBlobToken = getEnv("METADATA_BLOB_READ_WRITE_TOKEN");
  const repository =
    contentBlobToken !== undefined &&
    contentBlobToken.length > 0 &&
    metadataBlobToken !== undefined &&
    metadataBlobToken.length > 0
      ? new BlobStore(contentBlobToken, metadataBlobToken)
      : new FileStore(
          config.dataDir ??
            getEnv("PUB_DATA_DIR") ??
            path.resolve(process.cwd(), ".tmp/publish-it-data"),
        );
  const service = new PublishService(repository);

  return createApp(service);
}

function getEnv(
  name:
    | "BLOB_READ_WRITE_TOKEN"
    | "METADATA_BLOB_READ_WRITE_TOKEN"
    | "PUB_DATA_DIR",
): string | undefined {
  return process.env[name];
}
