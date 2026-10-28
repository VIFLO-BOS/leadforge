/**
 * Development-only credit grant for the seeded organization, so discovery can be tried without a
 * payment. It is a ledger `grant` entry (never a `purchase`), labeled as a
 * development grant, written through CreditsService with the usual row lock, and idempotent by
 * key: running the seed again grants nothing more. Refuses to run in production.
 */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CoreModule, CreditsModule, CreditsService } from "@leadforge/core";

export const DEV_CREDIT_GRANT_UNITS = 1000;

@Module({})
class CreditSeedModule {
  static forRoot(): DynamicModule {
    return { module: CreditSeedModule, imports: [CoreModule.forRoot(process.env), CreditsModule] };
  }
}

export async function seedDevCreditGrant(
  organizationId: string,
  actorUserId: string,
): Promise<string> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to grant development credits in production");
  const app = await NestFactory.createApplicationContext(CreditSeedModule.forRoot(), {
    logger: ["error", "warn"],
  });
  try {
    const credits = app.get(CreditsService, { strict: false });
    const result = await credits.grant(organizationId, {
      units: DEV_CREDIT_GRANT_UNITS,
      key: `seed:dev-grant:${organizationId}`,
      description: "Development grant from the seed script. Not a purchase.",
      actorUserId,
    });
    const balance = await credits.balance(organizationId);
    return `${result.replayed ? "Development grant already present" : `Granted ${DEV_CREDIT_GRANT_UNITS} development credits`}; balance ${balance.balance}`;
  } finally {
    await app.close();
  }
}
