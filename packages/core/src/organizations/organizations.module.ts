import { Module } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service.js";
import { InvitationsService } from "./invitations.service.js";
import { OrganizationRepository } from "./repositories/organization.repository.js";
import { MembershipRepository } from "./repositories/membership.repository.js";
import { InvitationRepository } from "./repositories/invitation.repository.js";
import { IdentityModule } from "../auth/identity.module.js";

@Module({
  imports: [IdentityModule],
  providers: [
    OrganizationsService,
    InvitationsService,
    OrganizationRepository,
    MembershipRepository,
    InvitationRepository,
  ],
  exports: [
    OrganizationsService,
    InvitationsService,
    OrganizationRepository,
    MembershipRepository,
    InvitationRepository,
  ],
})
export class OrganizationsModule {}
