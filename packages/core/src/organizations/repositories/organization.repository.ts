import { Injectable } from "@nestjs/common";
import { newId, PrismaService, type Organization, type Prisma } from "@leadforge/db-postgres";

@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
  }

  async slugExists(slug: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    return (await tx.organization.count({ where: { slug } })) > 0;
  }

  create(
    data: { name: string; slug: string; country: string; createdByUserId: string },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Organization> {
    return tx.organization.create({ data: { id: newId(), ...data } });
  }

  update(
    id: string,
    data: Partial<
      Pick<
        Organization,
        "name" | "country" | "defaultCurrency" | "freshnessDays" | "deletionRequestedAt"
      >
    >,
  ): Promise<Organization> {
    return this.prisma.organization.update({ where: { id }, data });
  }

  countMembers(id: string): Promise<number> {
    return this.prisma.membership.count({ where: { organizationId: id, status: "active" } });
  }
}
