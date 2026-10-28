import { tmpdir } from "node:os";
import path from "node:path";
import { Global, Module } from "@nestjs/common";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { DownloadSigner } from "./download-signer.js";
import { LocalObjectStorage } from "./local-storage.js";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage.js";
import { S3ObjectStorage } from "./s3-storage.js";

/** Default local storage root, shared by the API and the worker on one host. */
export function defaultLocalStorageDir(): string {
  return path.join(tmpdir(), "leadforge-object-storage");
}

export function createObjectStorage(env: ServerEnv): ObjectStorage {
  if (env.OBJECT_STORAGE_DRIVER === "s3") {
    return new S3ObjectStorage({
      endpoint:
        env.OBJECT_STORAGE_ENDPOINT ?? `https://s3.${env.OBJECT_STORAGE_REGION}.amazonaws.com`,
      region: env.OBJECT_STORAGE_REGION,
      bucket: env.OBJECT_STORAGE_BUCKET!,
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY!,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    });
  }
  return new LocalObjectStorage(env.OBJECT_STORAGE_LOCAL_DIR ?? defaultLocalStorageDir());
}

/** Object storage (OBJECT_STORAGE_*) and the export download-link signer. */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      useFactory: (env: ServerEnv) => createObjectStorage(env),
    },
    {
      provide: DownloadSigner,
      inject: [ENV],
      useFactory: (env: ServerEnv) =>
        env.EXPORT_SIGNING_SECRET
          ? new DownloadSigner(env.EXPORT_SIGNING_SECRET)
          : DownloadSigner.derived(env.CSRF_SECRET),
    },
  ],
  exports: [OBJECT_STORAGE, DownloadSigner],
})
export class StorageModule {}
