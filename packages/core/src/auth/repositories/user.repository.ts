import { Injectable } from "@nestjs/common";
import { newId, PrismaService, type Prisma, type User } from "@leadforge/db-postgres";

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  create(
    data: { email: string; passwordHash: string; name: string },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<User> {
    return tx.user.create({ data: { id: newId(), ...data } });
  }

  markEmailVerified(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<User> {
    return tx.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  }

  updatePassword(
    id: string,
    passwordHash: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<User> {
    return tx.user.update({ where: { id }, data: { passwordHash } });
  }
}
