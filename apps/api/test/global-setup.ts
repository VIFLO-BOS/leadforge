import { execSync } from "node:child_process";
import { createRequire } from "node:module";
// Test-only bootstrap: creates the dedicated test database before any app or repository exists.
// eslint-disable-next-line no-restricted-imports
import { PrismaClient } from "@prisma/client";
import "./setup.js";

/**
 * Runs once per vitest invocation: ensures the dedicated test database exists and has
 * every migration applied. Keeps tests away from the developer's database.
 */
export default async function globalSetup(): Promise<void> {
  const testUrl = new URL(process.env.DATABASE_URL!);
  const dbName = testUrl.pathname.replace(/^\//, "");
  const adminUrl = new URL(testUrl.toString());
  adminUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const rows = await admin.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"`,
      dbName,
    );
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  const require = createRequire(import.meta.url);
  const prismaBin = require.resolve("prisma/build/index.js", {
    paths: [require.resolve("@leadforge/db-postgres/package.json")],
  });
  const schema = require
    .resolve("@leadforge/db-postgres/package.json")
    .replace(/package\.json$/, "prisma/schema.prisma");
  execSync(`node "${prismaBin}" migrate deploy --schema "${schema}"`, {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
