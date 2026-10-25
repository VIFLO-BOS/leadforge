import { generateKeyPairSync } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.APP_URL ??= "http://localhost:3000";
process.env.API_URL ??= "http://localhost:4000";
process.env.DATABASE_URL ??=
  "postgresql://leadforge:leadforge@localhost:5432/leadforge?schema=public";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB = "leadforge_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
if (!/\/\d+$/.test(process.env.REDIS_URL))
  process.env.REDIS_URL = `${process.env.REDIS_URL.replace(/\/$/, "")}/9`;
process.env.CSRF_SECRET ??= "test-csrf-secret-0123456789abcdef0123456789";
process.env.SMTP_URL ??= "smtp://localhost:1025";
process.env.MAIL_FROM ??= "LeadForge Test <test@leadforge.local>";
process.env.COOKIE_SECURE = "false";

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const enc = (k: typeof publicKey) =>
    Buffer.from(JSON.stringify(k.export({ format: "jwk" }))).toString("base64url");
  process.env.JWT_PRIVATE_KEY = enc(privateKey);
  process.env.JWT_PUBLIC_KEY = enc(publicKey);
}
