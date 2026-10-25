import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ContactRequest, ServerEnv } from "@leadforge/contracts";
import { newId, PrismaService } from "@leadforge/db-postgres";
import { ENV } from "../config/env.module.js";

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** Stores a submission. Honeypot hits are accepted but dropped. */
  async submit(dto: ContactRequest, ip: string): Promise<{ received: true }> {
    if (dto.website && dto.website.length > 0) return { received: true };
    await this.prisma.contactSubmission.create({
      data: {
        id: newId(),
        kind: dto.kind,
        name: dto.name,
        email: dto.email,
        company: dto.company ?? null,
        message: dto.message,
        ipHash: createHash("sha256").update(`${this.env.CSRF_SECRET}:${ip}`).digest("hex"),
      },
    });
    return { received: true };
  }
}
