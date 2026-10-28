import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { OrganizationRole } from "../organizations/roles.js";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const Email = z.string().trim().toLowerCase().email().max(254);

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

export const PersonName = z.string().trim().min(1).max(120);

export const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, "Use a two-letter country code");

export const RegisterRequest = z.object({
  email: Email,
  password: Password,
  name: PersonName,
  organizationName: z.string().trim().min(2).max(120),
  country: CountryCode.default("NG"),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const VerifyEmailRequest = z.object({ token: z.string().min(16).max(256) });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>;

export const ForgotPasswordRequest = z.object({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.object({
  token: z.string().min(16).max(256),
  password: Password,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const UserSummary = z.object({
  id: UuidString,
  email: Email,
  name: PersonName,
  emailVerifiedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type UserSummary = z.infer<typeof UserSummary>;

export const OrganizationMembershipSummary = z.object({
  id: UuidString,
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  role: OrganizationRole,
  /** Stage 10: set while the organization is scheduled for deletion (every member sees a banner). */
  deletionRequestedAt: IsoDateTime.nullable(),
  /** Stage 10: when the purge may start (deletionRequestedAt plus the 14-day grace); null when none is pending. */
  purgeAfter: IsoDateTime.nullable(),
});
export type OrganizationMembershipSummary = z.infer<typeof OrganizationMembershipSummary>;

export const MeResponse = z.object({
  user: UserSummary,
  organizations: z.array(OrganizationMembershipSummary),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const SessionSummary = z.object({
  id: UuidString,
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
