import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { CountryCode, Email, PersonName } from "../auth/schemas.js";
import { OrganizationRole } from "./roles.js";

export const OrganizationProfile = z.object({
  id: UuidString,
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  defaultCurrency: z.string(),
  freshnessDays: z.number().int(),
  createdAt: IsoDateTime,
  memberCount: z.number().int(),
  role: OrganizationRole,
});
export type OrganizationProfile = z.infer<typeof OrganizationProfile>;

export const UpdateOrganizationRequest = z
  .object({
    name: z.string().trim().min(2).max(120),
    country: CountryCode,
    defaultCurrency: z.string().trim().toUpperCase().length(3),
    freshnessDays: z.number().int().min(7).max(730),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequest>;

export const MemberStatus = z.enum(["active", "suspended"]);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const MemberSummary = z.object({
  userId: UuidString,
  email: Email,
  name: PersonName,
  role: OrganizationRole,
  status: MemberStatus,
  joinedAt: IsoDateTime,
});
export type MemberSummary = z.infer<typeof MemberSummary>;

export const UpdateMemberRequest = z
  .object({
    role: OrganizationRole,
    status: MemberStatus,
  })
  .partial()
  .refine((v) => v.role !== undefined || v.status !== undefined, "Provide role or status");
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const CreateInvitationRequest = z.object({
  email: Email,
  role: OrganizationRole.exclude(["owner"]),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const InvitationSummary = z.object({
  id: UuidString,
  email: Email,
  role: OrganizationRole,
  invitedBy: z.object({ id: UuidString, name: z.string() }),
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type InvitationSummary = z.infer<typeof InvitationSummary>;

export const InvitationPreview = z.object({
  organizationName: z.string(),
  email: Email,
  role: OrganizationRole,
  expiresAt: IsoDateTime,
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;
