import type { AuthenticatedUser, CrmActor, OrganizationScope } from "@leadforge/core";

/** The CRM actor for a request: the signed-in member and what their role allows. */
export function actorOf(user: AuthenticatedUser, org: OrganizationScope): CrmActor {
  return { userId: user.id, permissions: org.permissions };
}

/** Same pattern as discovery: 8 to 128 letters, digits or - _ . : */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
