import { Injectable } from "@nestjs/common";
import {
  newId,
  PrismaService,
  type Membership,
  type MembershipStatus,
  type Organization,
  type OrganizationRole,
  type Prisma,
  type User,
} from "@leadforge/db-postgres";

export type MembershipWithUser = Membership & { user: User };
export type MembershipWithOrganization = Membership & { organization: Organization };

@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string, userId: string): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  /** Active membership in a live organization; the only lookup authz may use. */
  findActive(organizationId: string, userId: string): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: { organizationId, userId, status: "active", organization: { deletedAt: null } },
    });
  }

  listForOrganization(organizationId: string, limit = 500): Promise<MembershipWithUser[]> {
    return this.prisma.membership.findMany({
      where: { organizationId, user: { deletedAt: null } },
      include: { user: true },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    });
  }

  listForUser(userId: string): Promise<MembershipWithOrganization[]> {
    return this.prisma.membership.findMany({
      where: { userId, status: "active", organization: { deletedAt: null } },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
  }

  countByRole(
    organizationId: string,
    role: OrganizationRole,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    return tx.membership.count({ where: { organizationId, role, status: "active" } });
  }

  create(
    data: { organizationId: string; userId: string; role: OrganizationRole },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Membership> {
    return tx.membership.create({ data: { id: newId(), ...data } });
  }

  update(
    organizationId: string,
    userId: string,
    data: { role?: OrganizationRole; status?: MembershipStatus },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Membership> {
    return tx.membership.update({
      where: { organizationId_userId: { organizationId, userId } },
      data,
    });
  }

  delete(
    organizationId: string,
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Membership> {
    return tx.membership.delete({ where: { organizationId_userId: { organizationId, userId } } });
  }
}
