import { Injectable } from "@nestjs/common";
import {
  newId,
  PrismaService,
  type Invitation,
  type Organization,
  type OrganizationRole,
  type Prisma,
  type User,
} from "@leadforge/db-postgres";

export type InvitationWithInviter = Invitation & { invitedBy: User };
export type InvitationWithOrganization = Invitation & { organization: Organization };

@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPending(organizationId: string): Promise<InvitationWithInviter[]> {
    return this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { invitedBy: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Live (unexpired, unanswered) invitations, optionally ignoring one address (member cap, Phase 6). */
  countLive(
    organizationId: string,
    tx: Prisma.TransactionClient = this.prisma,
    exceptEmail?: string,
  ): Promise<number> {
    return tx.invitation.count({
      where: {
        organizationId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(exceptEmail ? { NOT: { email: { equals: exceptEmail, mode: "insensitive" } } } : {}),
      },
    });
  }

  findPendingById(organizationId: string, id: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({
      where: { id, organizationId, acceptedAt: null, revokedAt: null },
    });
  }

  findLiveByTokenHash(tokenHash: string): Promise<InvitationWithOrganization | null> {
    return this.prisma.invitation.findFirst({
      where: {
        tokenHash,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        organization: { deletedAt: null },
      },
      include: { organization: true },
    });
  }

  async revokePendingForEmail(
    organizationId: string,
    email: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.invitation.updateMany({
      where: { organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  create(
    data: {
      organizationId: string;
      email: string;
      role: OrganizationRole;
      tokenHash: string;
      invitedByUserId: string;
      expiresAt: Date;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Invitation> {
    return tx.invitation.create({ data: { id: newId(), ...data } });
  }

  revoke(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<Invitation> {
    return tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  accept(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<Invitation> {
    return tx.invitation.update({ where: { id }, data: { acceptedAt: new Date() } });
  }
}
