import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * Server environment. Validated at process start by the API and worker.
 * The process refuses to boot when a value is missing or malformed.
 */
export const ServerEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z.string().min(1),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_PRIVATE_KEY: z.string().min(1, "Run pnpm gen:keys"),
  JWT_PUBLIC_KEY: z.string().min(1, "Run pnpm gen:keys"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(60 * 60 * 24 * 30),
  COOKIE_DOMAIN: z.string().min(1).default("localhost"),
  COOKIE_SECURE: booleanString.default(false),
  CSRF_SECRET: z.string().min(32),

  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),

  WORKER_QUEUES: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnv.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
