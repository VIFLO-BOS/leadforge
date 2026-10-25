import "reflect-metadata";
import { Logger } from "nestjs-pino";
import { ENV } from "@leadforge/core";
import type { ServerEnv } from "@leadforge/contracts";
import { createApp } from "./bootstrap.js";

async function main(): Promise<void> {
  const app = await createApp();
  const env = app.get<ServerEnv>(ENV);
  const logger = app.get(Logger);
  await app.listen(env.API_PORT);
  logger.log(
    `LeadForge API listening on ${env.API_URL} (docs: ${env.NODE_ENV === "production" ? "disabled" : `${env.API_URL}/api/docs`})`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
