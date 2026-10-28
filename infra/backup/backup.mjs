#!/usr/bin/env node
// Logical backup of LeadForge's two databases (docs/OPERATIONS.md, "Backup and restore").
//
//   node infra/backup/backup.mjs --out backups/2026-10-26 \
//     [--mode docker|native] [--pg-db leadforge] [--mongo-db leadforge]
//     [--pg-container leadforge-postgres] [--mongo-container leadforge-mongo] [--pg-user leadforge]
//     native mode: --pg-url $PG_URL --mongo-uri $MONGO_URI (or the PG_URL / MONGO_URI env vars)
//
// Writes postgres-<db>.dump (pg_dump custom format, compressed), mongo-<db>.archive.gz
// (mongodump --archive --gzip) and manifest.json (exact row and document counts taken just before
// the dump, sizes, SHA-256). Redis is not backed up: it holds only queues, caches, rate-limit
// counters and short-lived revocation keys, all rebuilt or repaired after a restore.
// The backup holds personal data (business contacts, user emails): store it encrypted, with access
// limited to operators, and expire it on the retention schedule in docs/OPERATIONS.md.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  mongoConn,
  mongoCounts,
  parseArgs,
  pgConn,
  pgCounts,
  run,
  sha256File,
  tool,
} from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), {
  out: "",
  mode: "docker",
  pgDb: "leadforge",
  mongoDb: "leadforge",
  pgContainer: "leadforge-postgres",
  mongoContainer: "leadforge-mongo",
  pgUser: process.env.PGUSER ?? "leadforge",
  pgUrl: process.env.PG_URL ?? "",
  mongoUri: process.env.MONGO_URI ?? "",
});
if (!opts.out) throw new Error("--out <directory> is required");
mkdirSync(opts.out, { recursive: true });

const started = Date.now();
const pgFile = path.join(opts.out, `postgres-${opts.pgDb}.dump`);
const mongoFile = path.join(opts.out, `mongo-${opts.mongoDb}.archive.gz`);

// Counts first: the dump is at least as new as the counts, and restore verification compares them.
const counts = {
  postgres: await pgCounts(opts, opts.pgDb),
  mongo: await mongoCounts(opts, opts.mongoDb),
};

const t0 = Date.now();
await run(
  tool(opts, "pg", "pg_dump", [
    ...pgConn(opts, opts.pgDb),
    "-Fc",
    "-Z",
    "6",
    "--no-owner",
    "--no-privileges",
  ]),
  { toFile: pgFile },
);
const pgSeconds = (Date.now() - t0) / 1000;
const t1 = Date.now();
await run(
  tool(opts, "mongo", "mongodump", [
    ...(opts.mode === "native" ? ["--uri", mongoConn(opts)[0]] : []),
    "--db",
    opts.mongoDb,
    "--archive",
    "--gzip",
    "--quiet",
  ]),
  { toFile: mongoFile },
);
const mongoSeconds = (Date.now() - t1) / 1000;

const manifest = {
  format: 1,
  createdAt: new Date().toISOString(),
  mode: opts.mode,
  postgres: {
    database: opts.pgDb,
    file: path.basename(pgFile),
    bytes: statSync(pgFile).size,
    sha256: await sha256File(pgFile),
    seconds: pgSeconds,
    rows: counts.postgres,
  },
  mongo: {
    database: opts.mongoDb,
    file: path.basename(mongoFile),
    bytes: statSync(mongoFile).size,
    sha256: await sha256File(mongoFile),
    seconds: mongoSeconds,
    documents: counts.mongo,
  },
  seconds: (Date.now() - started) / 1000,
};
writeFileSync(path.join(opts.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const rows = Object.values(counts.postgres).reduce((a, b) => a + b, 0);
const docs = Object.values(counts.mongo).reduce((a, b) => a + b, 0);
process.stdout.write(
  `Backup written to ${opts.out}\n  postgres ${opts.pgDb}: ${Object.keys(counts.postgres).length} tables, ${rows} rows, ${manifest.postgres.bytes} bytes, ${pgSeconds.toFixed(1)} s\n  mongo ${opts.mongoDb}: ${Object.keys(counts.mongo).length} collections, ${docs} documents, ${manifest.mongo.bytes} bytes, ${mongoSeconds.toFixed(1)} s\n`,
);
