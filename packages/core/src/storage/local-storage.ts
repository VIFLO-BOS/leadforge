import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { assertStorageKey, type ObjectStorage, type StoredObjectStream } from "./object-storage.js";

/**
 * Filesystem driver (development and single-host installs). Writes go to a temporary file
 * that is renamed into place, so a reader never sees a partial file.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertStorageKey(key);
    const full = path.resolve(this.root, ...key.split("/"));
    if (!full.startsWith(this.root + path.sep))
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<{ bytes: number }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, full);
    return { bytes: body.length };
  }

  async get(key: string): Promise<StoredObjectStream | null> {
    const full = this.resolve(key);
    try {
      const info = await stat(full);
      if (!info.isFile()) return null;
      return { stream: createReadStream(full), bytes: info.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
