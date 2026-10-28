import type TestAgent from "supertest/lib/agent.js";
import { ObjectId } from "@leadforge/db-mongo";
import type { CreateBusinessRequest } from "@leadforge/contracts";
import {
  BusinessesService,
  normalizeCreateRequest,
  SOURCE_CONFIDENCE,
  type IngestItem,
} from "@leadforge/core";
import { API, orgHeaders, registerUser, verifyEmail, type Harness } from "./harness.js";

export interface OrgUser {
  agent: TestAgent;
  orgId: string;
  userId: string;
}

/** A verified owner with their own organization. */
export async function createOwner(
  h: Harness,
  email: string,
  organizationName = "Org",
): Promise<OrgUser> {
  const agent = h.agent();
  const me = await registerUser(agent, { email, organizationName });
  await verifyEmail(h, agent, email);
  return { agent, orgId: me.organizations[0]!.id, userId: me.user.id };
}

type Spec = Partial<CreateBusinessRequest> & { name: string };

/** Inserts businesses through the real ingest path (user_import provenance). */
export async function seedBusinesses(
  h: Harness,
  organizationId: string,
  specs: Spec[],
  options: { collectedAt?: Date; userId?: string | null } = {},
): Promise<string[]> {
  const service = h.app.get(BusinessesService, { strict: false });
  const collectedAt = options.collectedAt ?? new Date();
  const items: IngestItem[] = specs.map((spec, i) => {
    const { input, errors } = normalizeCreateRequest(
      { categories: [], phones: [], emails: [], ...spec },
      "NG",
    );
    if (!input) throw new Error(`Bad fixture ${i}: ${JSON.stringify(errors)}`);
    return {
      input,
      newId: new ObjectId(),
      createdVia: { kind: "seed", importId: null, userId: options.userId ?? null },
      ctx: {
        source: "user_import",
        collectionMethod: "user_import",
        sourceRef: "test-fixture",
        collectedAt,
        confidence: SOURCE_CONFIDENCE.user_import,
        actor: { type: "system", userId: null },
        importId: null,
        note: null,
        idSeed: null,
      },
    };
  });
  const results = await service.ingestBatch(organizationId, items);
  return results.map((r) => r.businessId!.toHexString());
}

export function csvBuffer(lines: string[]): Buffer {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/** Uploads a CSV and returns the import job JSON. */
export function uploadCsv(
  user: OrgUser,
  content: Buffer,
  fileName = "businesses.csv",
  contentType = "text/csv",
) {
  return user.agent
    .post(`${API}/imports`)
    .set(orgHeaders(user.agent, user.orgId))
    .attach("file", content, { filename: fileName, contentType });
}
