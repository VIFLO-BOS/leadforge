import { z } from "zod";

/** UUID (any version). PostgreSQL-owned identifiers use UUID v7. */
export const UuidString = z.string().uuid();
export type UuidString = z.infer<typeof UuidString>;

/** 24-character hex MongoDB ObjectId. */
export const ObjectIdString = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Must be a 24-character hexadecimal identifier");
export type ObjectIdString = z.infer<typeof ObjectIdString>;

export const IsoDateTime = z.string().datetime({ offset: true });

/** Header name carrying the asserted organization scope. The server always verifies membership. */
export const ORGANIZATION_HEADER = "x-organization-id";
export const CSRF_HEADER = "x-csrf-token";
export const REQUEST_ID_HEADER = "x-request-id";
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const ACCESS_COOKIE = "lf_access";
export const REFRESH_COOKIE = "lf_refresh";
export const CSRF_COOKIE = "lf_csrf";
