/**
 * Development seed. Creates one synthetic organization with an owner, sample business records
 * labeled "(Sample)" (see seed-businesses.ts), a development credit grant (see seed-credits.ts),
 * and plans and credit packs from the billing catalogue with development entitlement overrides
 * (see seed-billing.ts; every built-in price is a placeholder flagged is_placeholder).
 * Idempotent. Refuses to run in production. All data is clearly synthetic.
 */
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { seedSampleBusinesses } from "./seed-businesses.js";
import { seedDevCreditGrant } from "./seed-credits.js";
import { seedBilling } from "./seed-billing.js";

const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "synthetic-owner-pass-2026";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
    if (!existing) {
      const passwordHash = await argon2.hash(OWNER_PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 64 * 1024,
        timeCost: 3,
      });
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: uuidv7(),
            email: OWNER_EMAIL,
            name: "Synthetic Owner",
            passwordHash,
            emailVerifiedAt: new Date(),
          },
        });
        const org = await tx.organization.create({
          data: {
            id: uuidv7(),
            name: "Acme Demo (Synthetic)",
            slug: "acme-demo-synthetic",
            country: "NG",
            defaultCurrency: "NGN",
            createdByUserId: user.id,
          },
        });
        await tx.membership.create({
          data: { id: uuidv7(), organizationId: org.id, userId: user.id, role: "owner" },
        });
        await tx.billingCustomer.create({
          data: { id: uuidv7(), organizationId: org.id, email: user.email, currency: "NGN" },
        });
      });
    }

    const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
    const org = await prisma.organization.findUnique({ where: { slug: "acme-demo-synthetic" } });
    if (!owner || !org) throw new Error("Seeded owner or organization is missing");
    const billing = await seedBilling(org.id);
    const report = await seedSampleBusinesses(org.id, owner.id);
    const credits = await seedDevCreditGrant(org.id, owner.id);

    process.stdout.write(
      `Seed complete.\n  Sign in: ${OWNER_EMAIL} / ${OWNER_PASSWORD}\n${billing.map((l) => `  ${l}`).join("\n")}\n  Sample businesses:\n${report.map((l) => `    ${l}`).join("\n")}\n  Credits: ${credits}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
