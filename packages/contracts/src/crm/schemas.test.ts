import { describe, expect, it } from "vitest";
import { BulkOperationItem, BulkOperationRequest, BULK_LIMITS } from "../bulk/schemas.js";
import {
  CHECKOUT_RESUME_WINDOW_MINUTES,
  InvoiceDownloadErrorCode,
  PendingSubscriptionView,
  SubscriptionView,
} from "../billing/schemas.js";
import { ApiErrorBody, ERROR_STATUS, RETRY_AFTER_DETAIL_PATH } from "../common/errors.js";
import { parseServerEnv } from "../env.js";
import {
  CreateExportRequest,
  ExportDownloadErrorCode,
  ExportDownloadQuery,
} from "../exports/schemas.js";
import {
  ACTIVITY_OUTCOMES,
  CreateActivityRequest,
  MoveLeadRequest,
  PipelineBoardQuery,
  UpdatePipelineConfigRequest,
} from "./schemas.js";

const id = "65f000000000000000000001";

describe("CRM contracts", () => {
  it("moves a lead by stage key or direction, never both", () => {
    expect(MoveLeadRequest.safeParse({ stageKey: "qualified", version: 3 }).success).toBe(true);
    expect(MoveLeadRequest.safeParse({ direction: "next" }).success).toBe(true);
    expect(MoveLeadRequest.safeParse({ stageKey: "won", direction: "next" }).success).toBe(false);
    expect(MoveLeadRequest.safeParse({}).success).toBe(false);
    expect(MoveLeadRequest.safeParse({ stageKey: "Bad Key" }).success).toBe(false);
  });

  it("bounds the pipeline stage list and labels", () => {
    const stages = Array.from({ length: 3 }, (_, i) => ({ label: `Stage ${i}` }));
    expect(UpdatePipelineConfigRequest.parse({ version: 1, stages }).stages[0]!.archived).toBe(
      false,
    );
    expect(
      UpdatePipelineConfigRequest.safeParse({ version: 1, stages: stages.slice(0, 2) }).success,
    ).toBe(false);
    expect(
      UpdatePipelineConfigRequest.safeParse({
        version: 1,
        stages: [...stages, { label: "x".repeat(41) }],
      }).success,
    ).toBe(false);
  });

  it("takes only loggable activity types and lists outcomes per type", () => {
    expect(
      CreateActivityRequest.safeParse({ businessId: id, type: "call", outcome: "no_answer" })
        .success,
    ).toBe(true);
    expect(CreateActivityRequest.safeParse({ businessId: id, type: "stage_change" }).success).toBe(
      false,
    );
    expect(
      CreateActivityRequest.safeParse({
        businessId: id,
        type: "call",
        suppressionOverride: { reason: "short" },
      }).success,
    ).toBe(false);
    expect(ACTIVITY_OUTCOMES.note).toEqual([]);
    expect(ACTIVITY_OUTCOMES.whatsapp).toContain("read");
    expect(ACTIVITY_OUTCOMES.call).not.toContain("read");
  });

  it("selects bulk targets by ids or filter, never both, within the request limit", () => {
    expect(
      BulkOperationRequest.safeParse({
        action: "assign",
        assignedToUserId: null,
        selection: { ids: [id] },
      }).success,
    ).toBe(true);
    expect(
      BulkOperationRequest.safeParse({
        action: "move_stage",
        stageKey: "won",
        selection: { filter: { region: ["Lagos"] } },
      }).success,
    ).toBe(true);
    expect(
      BulkOperationRequest.safeParse({
        action: "add_to_list",
        listId: id,
        selection: { ids: [id], filter: {} },
      }).success,
    ).toBe(false);
    expect(
      BulkOperationRequest.safeParse({
        action: "add_to_list",
        listId: id,
        selection: { ids: [id, id] },
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: BULK_LIMITS.idsPerRequest + 1 }, (_, i) =>
      i.toString(16).padStart(24, "0"),
    );
    expect(
      BulkOperationRequest.safeParse({
        action: "remove_from_list",
        listId: id,
        selection: { ids: tooMany },
      }).success,
    ).toBe(false);
  });

  it("describes async exports by kind and parses signed download queries", () => {
    expect(CreateExportRequest.parse({ kind: "directory" })).toMatchObject({
      kind: "directory",
      filter: { suppression: "exclude" },
    });
    expect(CreateExportRequest.safeParse({ kind: "list" }).success).toBe(false);
    expect(
      ExportDownloadQuery.safeParse({
        org: "0190f0f0-0000-7000-8000-000000000001",
        expires: "1790000000",
        sig: "a".repeat(43),
      }).success,
    ).toBe(true);
    expect(
      ExportDownloadQuery.safeParse({ org: "x", expires: "1", sig: "a".repeat(43) }).success,
    ).toBe(false);
  });

  it("Stage 8: filters the board by list, names bulk items optionally, and enumerates download redirect codes", () => {
    expect(PipelineBoardQuery.parse({ listId: id })).toMatchObject({ listId: id, perStage: 20 });
    expect(PipelineBoardQuery.safeParse({ listId: "nope" }).success).toBe(false);
    const item = {
      businessId: id,
      outcome: "added",
      message: null,
      processedAt: "2026-10-27T10:00:00.000Z",
    };
    // Older payloads without the name fields still parse; new ones carry them.
    expect(BulkOperationItem.parse(item)).toEqual(item);
    expect(
      BulkOperationItem.parse({
        ...item,
        businessName: "Mama Put (Sample)",
        businessNameState: "unverified",
      }).businessName,
    ).toBe("Mama Put (Sample)");
    expect(
      BulkOperationItem.parse({ ...item, businessName: null, businessNameState: null })
        .businessNameState,
    ).toBeNull();
    expect(BulkOperationItem.safeParse({ ...item, businessNameState: "renamed" }).success).toBe(
      false,
    );
    expect(ExportDownloadErrorCode.options).toEqual([
      "DOWNLOAD_LINK_INVALID",
      "DOWNLOAD_LINK_EXPIRED",
      "EXPORT_EXPIRED",
      "EXPORT_NOT_READY",
    ]);
    expect(InvoiceDownloadErrorCode.options).toEqual([
      "DOWNLOAD_LINK_INVALID",
      "DOWNLOAD_LINK_EXPIRED",
    ]);
  });

  it("Stage 9: names the retry detail and keeps the resumable checkout fields optional", () => {
    expect(RETRY_AFTER_DETAIL_PATH).toBe("retryAfterSeconds");
    const limited = {
      error: {
        code: "RATE_LIMITED",
        message: "Too many",
        details: [{ path: RETRY_AFTER_DETAIL_PATH, message: "540" }],
        requestId: "r1",
      },
    };
    expect(ApiErrorBody.parse(limited)).toEqual(limited);
    expect(CHECKOUT_RESUME_WINDOW_MINUTES).toBe(30);
    const sub = {
      id: "0192f000-0000-7000-8000-000000000001",
      status: "incomplete",
      plan: {
        id: "0192f000-0000-7000-8000-000000000002",
        code: "team",
        name: "Team",
        interval: "monthly",
        priceMinor: 500000,
        currency: "NGN",
        includedCredits: 100,
      },
      currentPeriodStart: null,
      currentPeriodEnd: null,
      renewsAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      endedAt: null,
      providerLinked: false,
      createdAt: "2026-10-27T10:00:00.000Z",
    };
    // Older payloads without the checkout fields still parse; new ones carry both.
    expect(PendingSubscriptionView.parse(sub)).toEqual(sub);
    expect(SubscriptionView.parse(sub)).toEqual(sub);
    const resumable = {
      ...sub,
      authorizationUrl: "https://checkout.paystack.com/abc123",
      authorizationUrlExpiresAt: "2026-10-27T10:30:00.000Z",
    };
    expect(PendingSubscriptionView.parse(resumable)).toEqual(resumable);
    expect(
      PendingSubscriptionView.safeParse({ ...sub, authorizationUrl: "not a url" }).success,
    ).toBe(false);
  });

  it("maps the Phase 5 error codes to their HTTP statuses", () => {
    expect(ERROR_STATUS).toMatchObject({
      VERSION_CONFLICT: 409,
      STAGE_NOT_EMPTY: 409,
      INVALID_ASSIGNEE: 422,
      CONTACT_SUPPRESSED: 409,
      BULK_LIMIT_EXCEEDED: 422,
      EXPORT_NOT_READY: 409,
      EXPORT_EXPIRED: 410,
      DOWNLOAD_LINK_INVALID: 403,
      DOWNLOAD_LINK_EXPIRED: 410,
    });
  });
});

describe("object storage environment", () => {
  const valid = {
    APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:4000",
    DATABASE_URL: "postgresql://x",
    MONGODB_URI: "mongodb://x",
    MONGODB_DB: "x",
    REDIS_URL: "redis://x",
    JWT_PRIVATE_KEY: "x",
    JWT_PUBLIC_KEY: "x",
    CSRF_SECRET: "x".repeat(32),
    SMTP_URL: "smtp://x",
    MAIL_FROM: "x@x.test",
  };

  it("defaults to local storage, 15-minute links, 7-day files and a 10,000-row cap", () => {
    const env = parseServerEnv(valid);
    expect(env).toMatchObject({
      OBJECT_STORAGE_DRIVER: "local",
      EXPORT_DOWNLOAD_URL_TTL_SECONDS: 900,
      EXPORT_FILE_TTL_HOURS: 168,
      EXPORT_DEFAULT_ROW_CAP: 10_000,
    });
    expect(env.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(true);
  });

  it("requires a bucket and credentials for the s3 driver", () => {
    expect(() => parseServerEnv({ ...valid, OBJECT_STORAGE_DRIVER: "s3" })).toThrow(
      /OBJECT_STORAGE_BUCKET: Required when OBJECT_STORAGE_DRIVER=s3/,
    );
    const env = parseServerEnv({
      ...valid,
      OBJECT_STORAGE_DRIVER: "s3",
      OBJECT_STORAGE_BUCKET: "exports",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
    });
    expect(env.OBJECT_STORAGE_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(() => parseServerEnv({ ...valid, EXPORT_SIGNING_SECRET: "too-short" })).toThrow(
      /EXPORT_SIGNING_SECRET/,
    );
  });
});
