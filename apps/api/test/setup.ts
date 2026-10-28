import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.APP_URL ??= "http://localhost:3000";
process.env.API_URL ??= "http://localhost:4000";

// Tests truncate tables and clear collections, so they must never point at development data.
// Postgres: whatever DATABASE_URL names, the test run uses "<name>_test" (created and
// migrated by global-setup.ts). Mongo: the local replica set and the leadforge_test database.
//
// Defaults use 127.0.0.1 for Postgres and Redis (works in CI and on machines where `localhost`
// resolves to ::1 first). Mongo keeps its localhost default, because a native Windows MongoDB
// can also listen on 127.0.0.1:27017; set TEST_MONGODB_URI (or MONGODB_URI) to point the tests
// at the Docker replica set another way. See docs/DEVELOPMENT.md, "Testing notes".
{
  const url = new URL(
    process.env.DATABASE_URL ??
      "postgresql://leadforge:leadforge@127.0.0.1:5432/leadforge?schema=public",
  );
  const name = url.pathname.replace(/^\//, "") || "leadforge";
  if (!name.endsWith("_test")) url.pathname = `/${name}_test`;
  process.env.DATABASE_URL = url.toString();
}
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI ??
  process.env.MONGODB_URI ??
  "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true";
if (/mongodb\+srv:|mongodb\.net/i.test(process.env.MONGODB_URI)) {
  throw new Error(
    "Refusing to run tests against a hosted MongoDB cluster; use the local Docker replica set",
  );
}
process.env.MONGODB_DB = "leadforge_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
if (!/\/\d+$/.test(process.env.REDIS_URL))
  process.env.REDIS_URL = `${process.env.REDIS_URL.replace(/\/$/, "")}/9`;
process.env.CSRF_SECRET ??= "test-csrf-secret-0123456789abcdef0123456789";
process.env.SMTP_URL ??= "smtp://localhost:1025";
process.env.MAIL_FROM ??= "LeadForge Test <test@leadforge.local>";
process.env.COOKIE_SECURE = "false";
delete process.env.GOOGLE_PLACES_API_KEY;
// Billing: never a real Paystack key or origin in tests; billing suites point a harness at the
// local fixture server (test/paystack-fake.ts) explicitly.
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.PAYSTACK_WEBHOOK_IP_ALLOWLIST;
delete process.env.PAYSTACK_BASE_URL;
delete process.env.BILLING_CALLBACK_URL;
// Export files go to a test-only local directory, never a development store or S3.
process.env.OBJECT_STORAGE_DRIVER = "local";
process.env.OBJECT_STORAGE_LOCAL_DIR = path.join(tmpdir(), "leadforge-object-storage-test");
// Test queues live under their own BullMQ prefix (and Redis db 9), apart from any dev stack.
process.env.QUEUE_PREFIX = "leadforge-test";
// Overture: no schedule, no local files, no STAC calls in tests; the catalogue is seeded from fixtures.
delete process.env.OVERTURE_LOCAL_PLACES_PATH;
delete process.env.OVERTURE_LOCAL_DIVISIONS_PATH;
process.env.OVERTURE_SYNC_SCHEDULE = "false";
// Website fetching in tests only reaches local test servers through explicit host overrides.
delete process.env.SAFE_FETCH_HOST_OVERRIDES;
process.env.SAFE_FETCH_USER_AGENT =
  "LeadForgeBot/1.0 (+http://localhost:3000/legal/data-collection)";

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const enc = (k: typeof publicKey) =>
    Buffer.from(JSON.stringify(k.export({ format: "jwk" }))).toString("base64url");
  process.env.JWT_PRIVATE_KEY = enc(privateKey);
  process.env.JWT_PUBLIC_KEY = enc(publicKey);
}
