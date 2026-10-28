import { describe, expect, it } from "vitest";
import {
  BUSINESS_IDS_FILTER_MAX,
  BusinessListFilter,
  BusinessListQuery,
  CorrectionRequest,
  SuppressRequest,
} from "./schemas.js";
import { ImportCommitRequest, ImportMapping } from "../imports/schemas.js";
import { ExportBusinessesRequest } from "../exports/schemas.js";
import { ERROR_STATUS } from "../common/errors.js";

describe("BusinessListQuery", () => {
  it("accepts repeated params as arrays and single params as one-element arrays", () => {
    const parsed = BusinessListQuery.parse({
      category: ["Pharmacy", "Bakery"],
      region: "Lagos",
      hasPhone: "true",
      hasEmail: "0",
      emailState: "verified",
      sort: "name:asc",
      pageSize: "50",
    });
    expect(parsed.category).toEqual(["Pharmacy", "Bakery"]);
    expect(parsed.region).toEqual(["Lagos"]);
    expect(parsed.hasPhone).toBe(true);
    expect(parsed.hasEmail).toBe(false);
    expect(parsed.emailState).toEqual(["verified"]);
    expect(parsed.sort).toEqual({ field: "name", direction: "asc" });
    expect(parsed.pageSize).toBe(50);
    expect(parsed.suppression).toBe("exclude");
  });

  it("rejects unknown states, sorts and oversized pages", () => {
    expect(BusinessListQuery.safeParse({ phoneState: "probably" }).success).toBe(false);
    expect(BusinessListQuery.safeParse({ sort: "score:desc" }).success).toBe(false);
    expect(BusinessListQuery.safeParse({ pageSize: "500" }).success).toBe(false);
    expect(BusinessListQuery.safeParse({ hasPhone: "maybe" }).success).toBe(false);
  });

  it("strips unknown keys", () => {
    const parsed = BusinessListQuery.parse({ organizationId: "x", $where: "1" });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("$where");
  });

  it("takes ids comma-separated, repeated, both, or as a JSON array, up to the cap", () => {
    const a = "65f000000000000000000001";
    const b = "65f000000000000000000002";
    const c = "65F000000000000000000003";
    expect(BusinessListQuery.parse({ ids: `${a},${b}` }).ids).toEqual([a, b]);
    expect(BusinessListQuery.parse({ ids: [a, b] }).ids).toEqual([a, b]);
    expect(BusinessListQuery.parse({ ids: [`${a}, ${b}`, c] }).ids).toEqual([a, b, c]);
    expect(BusinessListFilter.parse({ ids: [a] }).ids).toEqual([a]);
    // Empty parts are ignored; nothing left means no filter.
    expect(BusinessListQuery.parse({ ids: `${a},,` }).ids).toEqual([a]);
    expect(BusinessListQuery.parse({ ids: "" }).ids).toBeUndefined();
    expect(BusinessListQuery.parse({ ids: " , " }).ids).toBeUndefined();
    expect(BusinessListQuery.safeParse({ ids: `${a},not-an-id` }).success).toBe(false);
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => (i + 1).toString(16).padStart(24, "0"));
    expect(
      BusinessListQuery.parse({ ids: ids(BUSINESS_IDS_FILTER_MAX).join(",") }).ids,
    ).toHaveLength(100);
    const over = BusinessListQuery.safeParse({ ids: ids(BUSINESS_IDS_FILTER_MAX + 1).join(",") });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(["ids"]);
    expect(
      BusinessListQuery.safeParse({ ids: [ids(60).join(","), ids(41).join(",")] }).success,
    ).toBe(false);
  });
});

describe("CorrectionRequest", () => {
  it("discriminates by field", () => {
    expect(CorrectionRequest.parse({ field: "name", value: " Acme " })).toEqual({
      field: "name",
      value: "Acme",
    });
    expect(CorrectionRequest.safeParse({ field: "score", value: 1 }).success).toBe(false);
  });

  it("requires a target to remove a phone or email", () => {
    expect(CorrectionRequest.safeParse({ field: "phone", value: null }).success).toBe(false);
    expect(
      CorrectionRequest.safeParse({ field: "phone", value: null, target: "+2348031234567" })
        .success,
    ).toBe(true);
    expect(CorrectionRequest.safeParse({ field: "email", value: null }).success).toBe(false);
  });

  it("never lets a user set WhatsApp to confirmed", () => {
    expect(
      CorrectionRequest.safeParse({
        field: "whatsapp",
        target: "+2348031234567",
        value: "confirmed",
      }).success,
    ).toBe(false);
  });
});

describe("SuppressRequest", () => {
  it("requires a reason", () => {
    expect(SuppressRequest.safeParse({ scope: "business" }).success).toBe(false);
    expect(
      SuppressRequest.safeParse({ scope: "business", reason: "Asked to be removed" }).success,
    ).toBe(true);
  });
});

describe("ImportMapping", () => {
  it("needs exactly one name column and unique columns", () => {
    expect(ImportMapping.safeParse([{ column: 0, field: "phone" }]).success).toBe(false);
    expect(
      ImportMapping.safeParse([
        { column: 0, field: "name" },
        { column: 0, field: "phone" },
      ]).success,
    ).toBe(false);
    expect(
      ImportMapping.safeParse([
        { column: 0, field: "name" },
        { column: 1, field: "name" },
      ]).success,
    ).toBe(false);
  });

  it("allows several phone, email and category columns but one website", () => {
    expect(
      ImportMapping.safeParse([
        { column: 0, field: "name" },
        { column: 1, field: "phone" },
        { column: 2, field: "phone" },
        { column: 3, field: "email" },
        { column: 4, field: "email" },
      ]).success,
    ).toBe(true);
    expect(
      ImportMapping.safeParse([
        { column: 0, field: "name" },
        { column: 1, field: "website" },
        { column: 2, field: "website" },
      ]).success,
    ).toBe(false);
  });

  it("requires the lawful-basis attestation on commit", () => {
    const mapping = [{ column: 0, field: "name" }];
    expect(ImportCommitRequest.safeParse({ mapping }).success).toBe(false);
    expect(ImportCommitRequest.safeParse({ mapping, attestLawfulBasis: false }).success).toBe(
      false,
    );
    const ok = ImportCommitRequest.parse({ mapping, attestLawfulBasis: true });
    expect(ok.defaultCountry).toBe("NG");
  });
});

describe("ExportBusinessesRequest", () => {
  it("defaults to the directory filter with suppressed rows excluded", () => {
    const parsed = ExportBusinessesRequest.parse({});
    expect(parsed.filter.suppression).toBe("exclude");
  });

  it("caps selected ids at 1,000", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i.toString(16).padStart(24, "0"));
    expect(ExportBusinessesRequest.safeParse({ ids }).success).toBe(false);
  });

  it("accepts JSON booleans and arrays in the filter", () => {
    const parsed = ExportBusinessesRequest.parse({
      filter: { hasPhone: true, category: ["Bakery"] },
    });
    expect(parsed.filter.hasPhone).toBe(true);
  });
});

describe("error statuses", () => {
  it("maps the Phase 2 error codes", () => {
    expect(ERROR_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(ERROR_STATUS.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(ERROR_STATUS.IMPORT_INVALID).toBe(422);
    expect(ERROR_STATUS.EXPORT_TOO_LARGE).toBe(422);
  });
});
