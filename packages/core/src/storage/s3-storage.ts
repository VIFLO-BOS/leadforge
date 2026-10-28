import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { assertStorageKey, type ObjectStorage, type StoredObjectStream } from "./object-storage.js";

export interface S3Config {
  /** e.g. https://s3.eu-west-1.amazonaws.com or http://127.0.0.1:9000. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** https://endpoint/bucket/key instead of https://bucket.endpoint/key. */
  forcePathStyle: boolean;
}

export interface PresignInput {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key: string;
  /** Seconds the URL stays valid (1 to 604800). */
  expiresIn: number;
  /** Signing time; defaults to now. */
  now?: Date;
}

/** RFC 3986 percent-encoding as Signature Version 4 requires (unreserved characters kept). */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (ch === "/" && !encodeSlash)) out += ch;
    else
      for (const byte of Buffer.from(ch, "utf8"))
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** `20130524T000000Z` and `20130524`. */
function amzDates(now: Date): { amzDate: string; day: string } {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

/**
 * AWS Signature Version 4 query-string presigning for S3 (the "presigned URL" form in the S3
 * API reference, "Authenticating Requests: Using Query Parameters"). Only `host` is signed and
 * the payload is UNSIGNED-PAYLOAD, which S3 and S3-compatible services accept for presigned
 * requests.
 */
export function presignS3Url(config: S3Config, input: PresignInput): string {
  assertStorageKey(input.key);
  if (!Number.isInteger(input.expiresIn) || input.expiresIn < 1 || input.expiresIn > 604_800)
    throw new Error("expiresIn must be 1 to 604800 seconds");
  const endpoint = new URL(config.endpoint);
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const basePath = endpoint.pathname.replace(/\/$/, "");
  const objectPath = `${basePath}${config.forcePathStyle ? `/${config.bucket}` : ""}/${input.key}`;
  const canonicalUri = uriEncode(objectPath, false);

  const { amzDate, day } = amzDates(input.now ?? new Date());
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `${endpoint.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Requests are signed for this long; they are used immediately. */
const REQUEST_EXPIRY_SECONDS = 300;

/**
 * S3-compatible driver built on presigned requests (no SDK): each operation presigns its URL
 * with Signature Version 4 and calls it with fetch.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;

  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(method: PresignInput["method"], key: string): string {
    return presignS3Url(this.config, { method, key, expiresIn: REQUEST_EXPIRY_SECONDS });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<{ bytes: number }> {
    const res = await this.fetchImpl(this.url("PUT", key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "content-type": contentType, "content-length": String(body.length) },
    });
    if (!res.ok) throw new Error(`Object storage PUT failed with HTTP ${res.status}`);
    return { bytes: body.length };
  }

  async get(key: string): Promise<StoredObjectStream | null> {
    const res = await this.fetchImpl(this.url("GET", key), { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw new Error(`Object storage GET failed with HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length"));
    return {
      stream: Readable.fromWeb(res.body as unknown as WebReadableStream),
      bytes: Number.isFinite(length) && length > 0 ? length : null,
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.fetchImpl(this.url("DELETE", key), { method: "DELETE" });
    if (!res.ok && res.status !== 404)
      throw new Error(`Object storage DELETE failed with HTTP ${res.status}`);
  }
}
