import { Injectable } from "@nestjs/common";
import {
  newId,
  PrismaService,
  type EmailToken,
  type EmailTokenPurpose,
  type Prisma,
} from "@leadforge/db-postgres";

@Injectable()
export class EmailTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    userId: string,
    purpose: EmailTokenPurpose,
    tokenHash: string,
    expiresAt: Date,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<EmailToken> {
    // Only one live token per purpose: consuming older ones prevents link confusion.
    await tx.emailToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return tx.emailToken.create({ data: { id: newId(), userId, purpose, tokenHash, expiresAt } });
  }

  findLive(tokenHash: string, purpose: EmailTokenPurpose): Promise<EmailToken | null> {
    return this.prisma.emailToken.findFirst({
      where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  consume(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<EmailToken> {
    return tx.emailToken.update({ where: { id }, data: { consumedAt: new Date() } });
  }

  async countRecent(userId: string, purpose: EmailTokenPurpose, withinMs: number): Promise<number> {
    return this.prisma.emailToken.count({
      where: { userId, purpose, createdAt: { gt: new Date(Date.now() - withinMs) } },
    });
  }
}
