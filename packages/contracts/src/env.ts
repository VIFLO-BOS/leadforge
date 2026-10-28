import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * Server environment. Validated at process start by the API and worker.
 * The process refuses to boot when a value is missing or malformed.
 */
export const ServerEnv = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    DATABASE_URL: z.string().min(1),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /**
     * BullMQ key prefix. Producers and workers must share it; separate stacks on one Redis (for
     * example two developers, or a test run) use different prefixes so they never take each
     * other's jobs. Default "leadforge".
     */
    QUEUE_PREFIX: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/, "Use 1 to 64 letters, digits, _ . : or -")
      .default("leadforge"),

    /**
     * Signs access tokens. Required by the API (it refuses to boot without it, with the same hint);
     * leave it unset for the worker, which only needs nothing from it: the process that fetches
     * third-party websites then holds no key that could mint sessions.
     */
    JWT_PRIVATE_KEY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1, "Run pnpm gen:keys").optional(),
    ),
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

    /** Google Places API (New) key. Absent means the source shows as not configured. */
    GOOGLE_PLACES_API_KEY: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

    /**
     * Development and test only: the Google Places adapter replays hand-built fixture
     * responses instead of calling Google. Refused when NODE_ENV=production.
     */
    GOOGLE_PLACES_FIXTURE_MODE: booleanString.default(false),

    /**
     * Overture Maps Places sync. The worker checks the STAC catalogue on this interval (default
     * daily) and loads a release once, when a new one appears (releases are monthly).
     */
    OVERTURE_STAC_URL: z.string().url().default("https://stac.overturemaps.org/catalog.json"),
    /** Register the repeatable sync in the worker. Defaults to on in production, off elsewhere. */
    OVERTURE_SYNC_SCHEDULE: z.preprocess(
      (v) => (v === "" ? undefined : v),
      booleanString.optional(),
    ),
    OVERTURE_SYNC_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(24 * 60 * 60 * 1000),
    /**
     * Development and test only, refused in production: load places from a local Parquet file
     * instead of the release on S3 (the raw Overture schema or the flattened research extract),
     * with division boundaries from OVERTURE_LOCAL_DIVISIONS_PATH.
     */
    OVERTURE_LOCAL_PLACES_PATH: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
    OVERTURE_LOCAL_DIVISIONS_PATH: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
    /** Release label for a local file that does not carry one, e.g. 2026-10-21.0. */
    OVERTURE_LOCAL_RELEASE: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
      .refine(
        (v) => v === undefined || /^\d{4}-\d{2}-\d{2}\.\d+$/.test(v),
        "Use the release format yyyy-mm-dd.x",
      ),
    /** Places per discovery page read from the Overture staging catalogue. */
    OVERTURE_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),

    /** A discovery job that runs longer than this is stopped and settled. Default 2 hours. */
    DISCOVERY_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(2 * 60 * 60 * 1000),
    /** Page retries back off exponentially from this delay (default 30 s) ... */
    DISCOVERY_RETRY_BASE_MS: z.coerce.number().int().min(1).default(30_000),
    /** ... up to this cap (default 10 min). */
    DISCOVERY_RETRY_MAX_MS: z.coerce
      .number()
      .int()
      .min(1)
      .default(10 * 60 * 1000),
    /** Attempts per page fetch (first try plus retries). */
    DISCOVERY_PAGE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
    /** Discovery job creation limit per organization per hour. */
    DISCOVERY_JOBS_PER_HOUR: z.coerce.number().int().min(1).default(30),

    /**
     * User agent for every website fetch (robots.txt is matched on its first word). Defaults to
     * `LeadForgeBot/1.0 (+<APP_URL>/legal/data-collection)`.
     */
    SAFE_FETCH_USER_AGENT: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
      .refine(
        (v) => v === undefined || /^[A-Za-z][A-Za-z0-9_-]{1,40}\/\S+/.test(v),
        "Start with a product token such as LeadForgeBot/1.0",
      ),
    /** Website fetches per second per host (default 0.5: one request every 2 seconds). */
    SAFE_FETCH_HOST_RPS: z.coerce.number().positive().max(100).default(0.5),
    /** Website fetches per second across all hosts (default 10). */
    SAFE_FETCH_GLOBAL_RPS: z.coerce.number().positive().max(1000).default(10),
    /** Connect plus read deadline per request (default 10 s). */
    SAFE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    /** Delay before retrying an unreachable home page (doubles once; default 2 s). */
    SAFE_FETCH_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
    /**
     * Development and test only, refused in production: `host=ip:port,...` serves exact host
     * names from a local address (for example a local test site for a smoke run). The deny list
     * still applies to every other host.
     */
    SAFE_FETCH_HOST_OVERRIDES: z.string().optional().default(""),

    /**
     * Object storage for export files (Phase 5). `local` writes under OBJECT_STORAGE_LOCAL_DIR
     * (default: <os temp dir>/leadforge-object-storage), which the API and worker must share, so
     * it suits development and single-host installs. `s3` talks to any S3-compatible service
     * (AWS S3, MinIO, Cloudflare R2) with Signature Version 4 presigned requests.
     */
    OBJECT_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    OBJECT_STORAGE_LOCAL_DIR: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
    /** S3 endpoint, e.g. https://s3.eu-west-1.amazonaws.com or http://127.0.0.1:9000 (MinIO). Default: AWS for the region. */
    OBJECT_STORAGE_ENDPOINT: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    OBJECT_STORAGE_REGION: z.string().trim().min(1).default("us-east-1"),
    OBJECT_STORAGE_BUCKET: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(3).max(63).optional(),
    ),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).optional(),
    ),
    /** Path-style URLs (https://endpoint/bucket/key); MinIO and most S3-compatible services need it. Default true. */
    OBJECT_STORAGE_FORCE_PATH_STYLE: booleanString.default(true),

    /**
     * HMAC key for signed export download links. When unset it is derived from CSRF_SECRET
     * (HMAC with a fixed label), so rotating CSRF_SECRET also invalidates open links.
     */
    EXPORT_SIGNING_SECRET: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(32).optional(),
    ),
    /** Lifetime of a signed download link (default 15 minutes). */
    EXPORT_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
    /** Export files are deleted this long after they are built (default 7 days). */
    EXPORT_FILE_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(168),
    /** Async export row cap when the organization has no `export_row_cap` entitlement (Phase 6 plans set it). */
    EXPORT_DEFAULT_ROW_CAP: z.coerce.number().int().min(1).max(1_000_000).default(10_000),

    /**
     * Phase 6 billing (Paystack). Without PAYSTACK_SECRET_KEY billing reports "not configured" and
     * checkout returns BILLING_NOT_CONFIGURED; nothing is ever faked. sk_test_ keys run Paystack's
     * test mode; sk_live_ keys take real money. The key also signs webhooks (HMAC-SHA512).
     */
    PAYSTACK_SECRET_KEY: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
      .refine(
        (v) => v === undefined || /^sk_(test|live)_[A-Za-z0-9]{8,}$/.test(v),
        "Use a Paystack secret key (sk_test_... or sk_live_...)",
      ),
    /** Optional comma-separated IPs allowed to call the webhook (Paystack publishes its webhook IPs). Empty: any IP; the signature is always required. */
    PAYSTACK_WEBHOOK_IP_ALLOWLIST: z
      .string()
      .optional()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** Paystack API origin. Development and tests may point it at a local fixture server; production must use the default. */
    PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),
    /** Where Paystack returns the browser after checkout (it appends ?trxref=&reference=). Default: <APP_URL>/app/billing/return. */
    BILLING_CALLBACK_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    /** Reconciliation verifies pending payments older than this with Paystack (default 20 minutes). */
    BILLING_PENDING_VERIFY_AFTER_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(20),
    /** A payment still unpaid this long after checkout is marked abandoned (default 24 hours). */
    BILLING_PENDING_ABANDON_AFTER_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(24),
    /** A past_due subscription expires (back to the free tier) after this many days without a successful renewal (default 7). */
    BILLING_PAST_DUE_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
    /** Member cap of the free tier (no subscription). Default 5. */
    BILLING_FREE_MAX_MEMBERS: z.coerce.number().int().min(1).max(10_000).default(5),

    WORKER_QUEUES: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    /**
     * Number of reverse proxies in front of the API that append to X-Forwarded-For (Express
     * `trust proxy`). The client address used for rate limits, audit events, sessions and the
     * webhook IP allowlist is read this many hops from the right; anything further left is
     * client-supplied and ignored. Count every hop: a load balancer, plus the web app when the
     * browser reaches the API through its /api rewrite. Default 1.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    /**
     * Requests per minute per signed-in user (or per client address when signed out) across the
     * whole API. Sensitive routes keep their own tighter limits (sign-in 10 per minute per address,
     * exports 10 per hour, uploads 30 per hour). Default 600. Raised only for load tests.
     */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(1_000_000).default(600),

    /**
     * Bearer token for the Prometheus endpoints (API `GET /metrics`, worker metrics server).
     * Without it the API serves /metrics only to loopback callers outside production, and not at
     * all in production; the worker binds its server to WORKER_METRICS_HOST only.
     */
    METRICS_TOKEN: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(24, "Use at least 24 characters").optional(),
    ),
    /** Worker metrics server port (0 turns it off). Default 9464. */
    WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
    /** Worker metrics server bind address. Default 127.0.0.1 (internal only). */
    WORKER_METRICS_HOST: z.string().trim().min(1).default("127.0.0.1"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.GOOGLE_PLACES_FIXTURE_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_PLACES_FIXTURE_MODE"],
        message:
          "Fixture mode is for development and tests only and cannot be enabled in production",
      });
    }
    if (env.NODE_ENV === "production" && env.SAFE_FETCH_HOST_OVERRIDES.trim().length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["SAFE_FETCH_HOST_OVERRIDES"],
        message: "Host overrides bypass the SSRF deny list and are for development and tests only",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      (env.OVERTURE_LOCAL_PLACES_PATH || env.OVERTURE_LOCAL_DIVISIONS_PATH)
    ) {
      ctx.addIssue({
        code: "custom",
        path: [
          env.OVERTURE_LOCAL_PLACES_PATH
            ? "OVERTURE_LOCAL_PLACES_PATH"
            : "OVERTURE_LOCAL_DIVISIONS_PATH",
        ],
        message:
          "Local Overture files are for development and tests only; production syncs the published release",
      });
    }
    if (Boolean(env.OVERTURE_LOCAL_PLACES_PATH) !== Boolean(env.OVERTURE_LOCAL_DIVISIONS_PATH)) {
      ctx.addIssue({
        code: "custom",
        path: ["OVERTURE_LOCAL_DIVISIONS_PATH"],
        message:
          "Set both OVERTURE_LOCAL_PLACES_PATH and OVERTURE_LOCAL_DIVISIONS_PATH, or neither",
      });
    }
    if (env.OBJECT_STORAGE_DRIVER === "s3") {
      for (const key of [
        "OBJECT_STORAGE_BUCKET",
        "OBJECT_STORAGE_ACCESS_KEY_ID",
        "OBJECT_STORAGE_SECRET_ACCESS_KEY",
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when OBJECT_STORAGE_DRIVER=s3",
          });
      }
    }
    if (
      env.NODE_ENV === "production" &&
      env.PAYSTACK_BASE_URL.replace(/\/$/, "") !== "https://api.paystack.co"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYSTACK_BASE_URL"],
        message:
          "Production talks to https://api.paystack.co; other origins are for local fixture servers in development and tests",
      });
    }
    if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Production serves cookies over HTTPS only; set COOKIE_SECURE=true",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      env.WORKER_METRICS_PORT > 0 &&
      !env.METRICS_TOKEN &&
      !isLoopbackHost(env.WORKER_METRICS_HOST)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["METRICS_TOKEN"],
        message:
          "Set METRICS_TOKEN when the worker metrics server listens on a non-loopback address in production",
      });
    }
    if (env.DISCOVERY_RETRY_MAX_MS < env.DISCOVERY_RETRY_BASE_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["DISCOVERY_RETRY_MAX_MS"],
        message: "Must be at least DISCOVERY_RETRY_BASE_MS",
      });
    }
  });
export type ServerEnv = z.infer<typeof ServerEnv>;

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnv.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
