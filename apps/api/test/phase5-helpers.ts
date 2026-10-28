import { inflateRawSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type TestAgent from "supertest/lib/agent.js";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import type { OrganizationRole, ServerEnv } from "@leadforge/contracts";
import {
  BulkQueueHandler,
  ENV,
  ExportQueueHandler,
  QueueNames,
  TokenService,
} from "@leadforge/core";
import { addMember, API, orgHeaders, TEST_QUEUE_PREFIX, type Harness } from "./harness.js";
import { createOwner, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";

export const ROLES: OrganizationRole[] = ["owner", "admin", "researcher", "sales_rep", "analyst"];

/** An organization with one member per role. */
export async function createTeam(
  h: Harness,
  prefix: string,
): Promise<Record<OrganizationRole, OrgUser>> {
  const owner = await createOwner(h, `${prefix}-owner@example.test`, `${prefix} Org`);
  const team = { owner } as Record<OrganizationRole, OrgUser>;
  for (const role of ["admin", "researcher", "sales_rep", "analyst"] as const) {
    const m = await addMember(h, owner.orgId, role, `${prefix}-${role}@example.test`);
    team[role] = { agent: m.agent, orgId: owner.orgId, userId: m.userId };
  }
  return team;
}

export interface Workers {
  failures: string[];
  close(): Promise<void>;
}

/** Real BullMQ workers for the Phase 5 queues, wired like apps/worker. */
export function startPhase5Workers(
  h: Harness,
  queues: Array<"exports" | "bulk"> = ["exports", "bulk"],
): Workers {
  const failures: string[] = [];
  const handlers = {
    exports: [QueueNames.exports, h.app.get(ExportQueueHandler, { strict: false })],
    bulk: [QueueNames.bulk, h.app.get(BulkQueueHandler, { strict: false })],
  } as const;
  const workers = queues.map((q) => {
    const [name, handler] = handlers[q];
    const w = new Worker(
      name,
      (job: Job) => (handler as { handle(job: Job): Promise<unknown> }).handle(job),
      {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
        prefix: TEST_QUEUE_PREFIX,
        concurrency: 2,
      },
    );
    w.on("failed", (job, err) => failures.push(`${name}:${job?.name}:${err?.message}`));
    return w;
  });
  return { failures, close: async () => void (await Promise.all(workers.map((w) => w.close()))) };
}

/** Polls GET `path` until `done(data)` holds. */
export async function pollUntil(
  u: OrgUser,
  path: string,
  done: (data: Json) => boolean,
  timeoutMs = 30_000,
): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  let last: Json = {};
  for (;;) {
    const res = await u.agent.get(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));
    last = res.body.data as Json;
    if (res.status === 200 && done(last)) return last;
    if (Date.now() > deadline)
      throw new Error(`Timed out polling ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export const isTerminal = (d: Json) =>
  ["completed", "completed_with_errors", "failed", "expired"].includes(String(d.status));

export const call = (
  u: OrgUser,
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  body?: object,
) => {
  const req = u.agent[method](`${API}${path}`).set(orgHeaders(u.agent, u.orgId));
  return method === "get" ? req : req.send(body ?? {});
};

export const bulk = (u: OrgUser, body: object, key: string = randomUUID()) =>
  u.agent
    .post(`${API}/bulk-operations`)
    .set(orgHeaders(u.agent, u.orgId))
    .set("Idempotency-Key", key)
    .send(body);

/** GET a signed download URL (absolute) with the agent's cookies; returns status, headers and raw bytes. */
export async function download(
  agent: TestAgent,
  url: string,
): Promise<{ status: number; body: Buffer; json: Json | null; headers: Record<string, string> }> {
  const u = new URL(url);
  const res = await agent
    .get(`${u.pathname}${u.search}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  const body = res.body as Buffer;
  let json: Json | null = null;
  if (String(res.headers["content-type"] ?? "").includes("json"))
    json = JSON.parse(body.toString("utf8")) as Json;
  return { status: res.status, body, json, headers: res.headers as Record<string, string> };
}

/** The Accept header browsers send when they open a page. */
export const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/**
 * Opens a signed download URL the way a browser does when the user follows a link:
 * `fetch-metadata` sends Sec-Fetch-Mode: navigate (current browsers), `accept-html` sends only an
 * HTML-preferring Accept header (browsers without Fetch Metadata). Redirects are not followed, so
 * a 303 and its Location can be asserted; the body is kept as raw bytes.
 */
export async function navigate(
  agent: TestAgent,
  url: string,
  how: "fetch-metadata" | "accept-html" = "fetch-metadata",
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Buffer; json: Json | null; headers: Record<string, string> }> {
  const u = new URL(url);
  let req = agent.get(`${u.pathname}${u.search}`).redirects(0).set("Accept", BROWSER_ACCEPT);
  if (how === "fetch-metadata")
    req = req
      .set("Sec-Fetch-Mode", "navigate")
      .set("Sec-Fetch-Dest", "document")
      .set("Sec-Fetch-Site", "same-origin");
  for (const [name, value] of Object.entries(extraHeaders)) req = req.set(name, value);
  const res = await req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  const body = res.body as Buffer;
  const json = String(res.headers["content-type"] ?? "").includes("json")
    ? (JSON.parse(body.toString("utf8")) as Json)
    : null;
  return { status: res.status, body, json, headers: res.headers as Record<string, string> };
}

/**
 * A correctly signed access token that expired two minutes ago (the guard answers 401
 * TOKEN_EXPIRED for it), for requests made with `Authorization: Bearer`.
 */
export async function expiredAccessToken(h: Harness, userId: string): Promise<string> {
  const env = h.app.get(ENV, { strict: false }) as ServerEnv;
  const signer = new TokenService({ ...env, JWT_ACCESS_TTL_SECONDS: -120 });
  await signer.onModuleInit();
  return signer.signAccessToken({ sub: userId, sid: randomUUID(), ev: true });
}

/** Reads a ZIP (central directory, deflate or store) into name -> bytes. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a ZIP");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const data = zip.subarray(
      offset + 30 + localName + localExtra,
      offset + 30 + localName + localExtra + size,
    );
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** RFC 4180 reader for assertions (quoted fields, doubled quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  return rows;
}

/**
 * Inserts `n` copies of an existing business (new ids, slugs and names), straight into MongoDB:
 * a fast way to build selections larger than a bulk chunk or the bulk cap.
 */
export async function cloneBusinesses(
  h: Harness,
  organizationId: string,
  templateId: string,
  n: number,
  namePrefix = "Clone",
): Promise<string[]> {
  const db = h.app.get(MongoService).database;
  const template = await db
    .collection(Collections.businesses)
    .findOne({ _id: new ObjectId(templateId), organizationId });
  if (!template) throw new Error("No template business");
  const ids: string[] = [];
  for (let start = 0; start < n; start += 1000) {
    const docs = Array.from({ length: Math.min(1000, n - start) }, (_, k) => {
      const i = start + k;
      const _id = new ObjectId();
      ids.push(_id.toHexString());
      const name = `${namePrefix} ${i} (Sample)`;
      return {
        ...template,
        _id,
        slug: `${String(template.slug)}-${_id.toHexString()}`,
        name: { ...(template.name as object), value: name, normalized: name.toLowerCase() },
        website: null,
        phones: [],
        emails: [],
        externalRefs: [],
        dedupKeys: [],
      };
    });
    await db.collection(Collections.businesses).insertMany(docs);
  }
  return ids;
}
