import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { DownloadSigner } from "./download-signer.js";
import { LocalObjectStorage } from "./local-storage.js";
import { assertStorageKey } from "./object-storage.js";
import { presignS3Url, S3ObjectStorage, type S3Config } from "./s3-storage.js";
import { buildZip } from "./zip.js";

/** The example from the Amazon S3 API reference ("Authenticating Requests: Using Query Parameters"). */
const AWS_EXAMPLE: S3Config = {
  endpoint: "https://s3.amazonaws.com",
  region: "us-east-1",
  bucket: "examplebucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  forcePathStyle: false,
};

describe("S3 Signature Version 4 presigning", () => {
  it("reproduces the documented presigned GET URL signature", () => {
    const url = new URL(
      presignS3Url(AWS_EXAMPLE, {
        method: "GET",
        key: "test.txt",
        expiresIn: 86400,
        now: new Date("2013-05-24T00:00:00Z"),
      }),
    );
    expect(url.host).toBe("examplebucket.s3.amazonaws.com");
    expect(url.pathname).toBe("/test.txt");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(url.searchParams.get("X-Amz-Date")).toBe("20130524T000000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("86400");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs path-style URLs for S3-compatible endpoints and changes the signature with the method, key or time", () => {
    const minio: S3Config = {
      ...AWS_EXAMPLE,
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
    };
    const now = new Date("2026-10-26T10:00:00Z");
    const put = new URL(
      presignS3Url(minio, { method: "PUT", key: "exports/org/1/file.zip", expiresIn: 300, now }),
    );
    expect(`${put.protocol}//${put.host}${put.pathname}`).toBe(
      "http://127.0.0.1:9000/examplebucket/exports/org/1/file.zip",
    );
    const get = new URL(
      presignS3Url(minio, { method: "GET", key: "exports/org/1/file.zip", expiresIn: 300, now }),
    );
    const other = new URL(
      presignS3Url(minio, { method: "GET", key: "exports/org/1/other.zip", expiresIn: 300, now }),
    );
    const later = new URL(
      presignS3Url(minio, {
        method: "GET",
        key: "exports/org/1/file.zip",
        expiresIn: 300,
        now: new Date(now.getTime() + 1000),
      }),
    );
    const sigs = [put, get, other, later].map((u) => u.searchParams.get("X-Amz-Signature"));
    expect(new Set(sigs).size).toBe(4);
    expect(sigs.every((s) => /^[0-9a-f]{64}$/.test(s!))).toBe(true);
  });

  it("refuses keys outside the bucket path and bad expiry", () => {
    expect(() =>
      presignS3Url(AWS_EXAMPLE, { method: "GET", key: "../secret", expiresIn: 60 }),
    ).toThrow(/Invalid storage key/);
    expect(() => presignS3Url(AWS_EXAMPLE, { method: "GET", key: "a.txt", expiresIn: 0 })).toThrow(
      /expiresIn/,
    );
  });

  it("drives PUT, GET and DELETE through presigned fetches", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url });
      if (init?.method === "GET" && url.includes("missing"))
        return new Response(null, { status: 404 });
      if (init?.method === "GET")
        return new Response("zip-bytes", { status: 200, headers: { "content-length": "9" } });
      if (init?.method === "DELETE") return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const s3 = new S3ObjectStorage(
      { ...AWS_EXAMPLE, endpoint: "http://127.0.0.1:9000", forcePathStyle: true },
      fakeFetch,
    );
    expect(await s3.put("exports/a.zip", Buffer.from("zip-bytes"), "application/zip")).toEqual({
      bytes: 9,
    });
    const got = await s3.get("exports/a.zip");
    expect(got?.bytes).toBe(9);
    const chunks: Buffer[] = [];
    for await (const c of got!.stream) chunks.push(Buffer.from(c as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe("zip-bytes");
    expect(await s3.get("exports/missing.zip")).toBeNull();
    await expect(s3.delete("exports/a.zip")).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(["PUT", "GET", "GET", "DELETE"]);
    expect(calls.every((c) => c.url.includes("X-Amz-Signature="))).toBe(true);
  });
});

describe("local object storage", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes, reads and deletes files under its root and refuses traversal", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lf-storage-test-"));
    const storage = new LocalObjectStorage(dir);
    await storage.put("exports/org/1/a.zip", Buffer.from("hello"), "application/zip");
    const got = await storage.get("exports/org/1/a.zip");
    const chunks: Buffer[] = [];
    for await (const c of got!.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("hello");
    expect(got!.bytes).toBe(5);
    await storage.delete("exports/org/1/a.zip");
    await storage.delete("exports/org/1/a.zip");
    expect(await storage.get("exports/org/1/a.zip")).toBeNull();
    await expect(storage.put("../escape.zip", Buffer.from("x"), "application/zip")).rejects.toThrow(
      /Invalid storage key/,
    );
    for (const bad of ["/abs", "a//b", "a/../b", "a/./b", "a\\b", ""])
      expect(() => assertStorageKey(bad), bad).toThrow();
  });
});

describe("download link signatures", () => {
  const signer = new DownloadSigner("0123456789abcdef0123456789abcdef-test");
  const claims = {
    organizationId: "0190f0f0-0000-7000-8000-000000000001",
    exportId: "65f000000000000000000001",
    userId: "0190f0f0-0000-7000-8000-000000000002",
    expires: 2_000_000_000,
  };

  it("verifies its own links and rejects tampering before expiry", () => {
    const sig = signer.sign(claims);
    expect(signer.verify(claims, sig, 1_000)).toEqual({ ok: true });
    expect(signer.verify({ ...claims, exportId: "65f000000000000000000002" }, sig, 1_000)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      signer.verify({ ...claims, userId: "0190f0f0-0000-7000-8000-000000000003" }, sig, 1_000),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      signer.verify(
        { ...claims, organizationId: "0190f0f0-0000-7000-8000-000000000009" },
        sig,
        1_000,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(signer.verify({ ...claims, expires: claims.expires + 3600 }, sig, 1_000)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      signer.verify(claims, `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, 1_000),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(signer.verify(claims, "short", 1_000)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports expiry only for a genuine link", () => {
    const sig = signer.sign(claims);
    expect(signer.verify(claims, sig, claims.expires + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(signer.verify(claims, sig, claims.expires)).toEqual({ ok: true });
  });

  it("derives a distinct key from another secret and refuses short secrets", () => {
    const derived = DownloadSigner.derived("0123456789abcdef0123456789abcdef-test");
    expect(derived.sign(claims)).not.toBe(signer.sign(claims));
    expect(() => new DownloadSigner("short")).toThrow(/32 characters/);
  });
});

/** Minimal ZIP reader for the assertions: central directory, then each local entry. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const data = zip.subarray(
      offset + 30 + localName + extra,
      offset + 30 + localName + extra + size,
    );
    const content = method === 8 ? inflateRawSync(data) : data;
    expect(crc32(content) >>> 0).toBe(crc);
    out.set(name, content);
    p += 46 + nameLen;
  }
  return out;
}

describe("ZIP writer", () => {
  it("writes deflated entries with UTF-8 names that read back byte for byte", () => {
    const csv = Buffer.from("\uFEFFname,phone\r\nÀdùnní Stores,+2348031234567\r\n", "utf8");
    const big = Buffer.from("x".repeat(100_000));
    const zip = buildZip([
      { name: "leadforge.csv", data: csv },
      { name: "LICENSES/CDLA-Permissive-2.0.txt", data: Buffer.from("licence text") },
      { name: "big.txt", data: big },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual([
      "leadforge.csv",
      "LICENSES/CDLA-Permissive-2.0.txt",
      "big.txt",
      "empty.txt",
    ]);
    expect(files.get("leadforge.csv")!.equals(csv)).toBe(true);
    expect(files.get("big.txt")!.equals(big)).toBe(true);
    expect(files.get("empty.txt")!.length).toBe(0);
    expect(zip.length).toBeLessThan(big.length / 10);
  });

  it("refuses unsafe entry names", () => {
    expect(() => buildZip([{ name: "../x", data: Buffer.from("x") }])).toThrow(
      /Invalid ZIP entry name/,
    );
    expect(() => buildZip([{ name: "/abs", data: Buffer.from("x") }])).toThrow(
      /Invalid ZIP entry name/,
    );
    for (const bad of ["..\\x", "a\\..\\..\\x", "C:/x", "c:x", "LICENSES/../../x"]) {
      expect(() => buildZip([{ name: bad, data: Buffer.from("x") }]), bad).toThrow(
        /Invalid ZIP entry name/,
      );
    }
    expect(() =>
      buildZip([{ name: "LICENSES/CC0-1.0.txt", data: Buffer.from("x") }]),
    ).not.toThrow();
  });
});
