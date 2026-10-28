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
  // Log the port actually bound (API_PORT), not API_URL, which names the public address.
  const address = app.getHttpServer().address() as
    { port?: number; address?: string } | string | null;
  const port = typeof address === "object" && address?.port ? address.port : env.API_PORT;
  const local = `http://localhost:${port}`;
  logger.log(
    { port, publicUrl: env.API_URL },
    `LeadForge API listening on port ${port} (${local}; docs: ${env.NODE_ENV === "production" ? "disabled" : `${local}/api/docs`})`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
