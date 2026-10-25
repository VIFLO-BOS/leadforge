/**
 * Development seed. Creates placeholder plans (flagged is_placeholder) and one synthetic
 * organization with an owner. Refuses to run in production. All data is clearly synthetic.
 */
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";

const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "synthetic-owner-pass-2026";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const prisma = new PrismaClient();
  try {
    const plans = [
      {
        code: "starter",
        name: "Starter",
        interval: "monthly",
        priceMinor: 0n,
        includedCredits: 200,
        maxMembers: 2,
        exportRowCap: 1000,
        sortOrder: 1,
      },
      {
        code: "growth",
        name: "Growth",
        interval: "monthly",
        priceMinor: 0n,
        includedCredits: 2000,
        maxMembers: 10,
        exportRowCap: 25000,
        sortOrder: 2,
      },
      {
        code: "scale",
        name: "Scale",
        interval: "monthly",
        priceMinor: 0n,
        includedCredits: 10000,
        maxMembers: 50,
        exportRowCap: 250000,
        sortOrder: 3,
      },
    ] as const;
    for (const p of plans) {
      await prisma.plan.upsert({
        where: { code: p.code },
        update: { isPlaceholder: true },
        create: {
          id: uuidv7(),
          code: p.code,
          name: p.name,
          description: "Placeholder plan. Pricing has not been published.",
          interval: p.interval,
          priceMinor: p.priceMinor,
          currency: "NGN",
          includedCredits: p.includedCredits,
          maxMembers: p.maxMembers,
          exportRowCap: p.exportRowCap,
          isActive: true,
          isPlaceholder: true,
          sortOrder: p.sortOrder,
        },
      });
    }

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

    process.stdout.write(
      `Seed complete.\n  Sign in: ${OWNER_EMAIL} / ${OWNER_PASSWORD}\n  Plans: ${plans.length} placeholder plans (pricing not published)\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
