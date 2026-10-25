import { Injectable } from "@nestjs/common";
import { newId, PrismaService, type Prisma, type Session } from "@leadforge/db-postgres";

export interface NewSession {
  id?: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NewSession, tx: Prisma.TransactionClient = this.prisma): Promise<Session> {
    return tx.session.create({ data: { id: data.id ?? newId(), ...data } });
  }

  findById(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  findActiveById(id: string): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  listActiveForUser(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });
  }

  touch(id: string): Promise<Session> {
    return this.prisma.session.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  revoke(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<Prisma.BatchPayload> {
    return tx.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeFamily(
    familyId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Prisma.BatchPayload> {
    return tx.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Prisma.BatchPayload> {
    return tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }
}
