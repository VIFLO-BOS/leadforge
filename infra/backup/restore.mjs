#!/usr/bin/env node
// Restores a backup made by backup.mjs into target databases and verifies it
// (docs/OPERATIONS.md, "Backup and restore").
//
//   node infra/backup/restore.mjs --from backups/2026-10-26 --pg-target leadforge_restore --mongo-target leadforge_restore
//     [--mode docker|native] [--pg-container ...] [--mongo-container ...] [--pg-user ...]
//     native mode: --pg-url $PG_URL --mongo-uri $MONGO_URI
//     [--replace]         allow restoring over a database that already has tables or collections
//     [--keep-sessions]   skip the post-restore session revocation (drills on scratch databases only)
//
// Safety: it refuses to write into a non-empty database unless --replace is given, and refuses
// the backup's own source database names unless CONFIRM_RESTORE equals that name as well.
// After loading it compares exact row and document counts with the manifest and exits 1 on any
// difference. Then it revokes every session and unused email link in the restored PostgreSQL
// database: sessions and links revoked after the backup was taken must not come back to life.
import { readFileSync } from "node:fs";
import path from "node:path";
import { mongoConn, mongoCounts, parseArgs, pgConn, pgCounts, run, tool } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), {
  from: "",
  pgTarget: "",
  mongoTarget: "",
  mode: "docker",
  pgContainer: "leadforge-postgres",
  mongoContainer: "leadforge-mongo",
  pgUser: process.env.PGUSER ?? "leadforge",
  pgUrl: process.env.PG_URL ?? "",
  mongoUri: process.env.MONGO_URI ?? "",
  replace: false,
  keepSessions: false,
});
if (!opts.from || !opts.pgTarget || !opts.mongoTarget)
  throw new Error("--from, --pg-target and --mongo-target are required");
for (const name of [opts.pgTarget, opts.mongoTarget])
  if (!/^[A-Za-z0-9_]{1,63}$/.test(name)) throw new Error(`Invalid database name ${name}`);
const manifest = JSON.parse(readFileSync(path.join(opts.from, "manifest.json"), "utf8"));
for (const [target, source] of [
  [opts.pgTarget, manifest.postgres.database],
  [opts.mongoTarget, manifest.mongo.database],
]) {
  if (target === source && process.env.CONFIRM_RESTORE !== target) {
    throw new Error(
      `Refusing to restore over the source database ${source}; set CONFIRM_RESTORE=${source} and --replace to do it deliberately`,
    );
  }
}

const started = Date.now();

// PostgreSQL: create the target, or check it is empty.
const existing = await run(
  tool(opts, "pg", "psql", [
    ...pgConn(opts, "postgres"),
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${opts.pgTarget}'`,
  ]),
);
if (existing.trim() === "1") {
  const tables = await pgCounts(opts, opts.pgTarget);
  if (Object.keys(tables).length > 0 && !opts.replace)
    throw new Error(
      `PostgreSQL database ${opts.pgTarget} is not empty; pass --replace to overwrite it`,
    );
} else {
  await run(
    tool(opts, "pg", "psql", [
      ...pgConn(opts, "postgres"),
      "-tAc",
      `CREATE DATABASE "${opts.pgTarget}"`,
    ]),
  );
}
const t0 = Date.now();
await run(
  tool(
    opts,
    "pg",
    "pg_restore",
    [
      ...pgConn(opts, opts.pgTarget),
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      ...(opts.replace ? ["--clean", "--if-exists"] : []),
    ],
    { stdin: true },
  ),
  {
    fromFile: path.join(opts.from, manifest.postgres.file),
  },
);
const pgSeconds = (Date.now() - t0) / 1000;

// MongoDB: refuse a non-empty target unless replacing, then restore under the new name.
const before = await mongoCounts(opts, opts.mongoTarget);
if (Object.keys(before).length > 0 && !opts.replace)
  throw new Error(
    `MongoDB database ${opts.mongoTarget} is not empty; pass --replace to overwrite it`,
  );
const t1 = Date.now();
await run(
  tool(
    opts,
    "mongo",
    "mongorestore",
    [
      ...(opts.mode === "native" ? ["--uri", mongoConn(opts)[0]] : []),
      "--archive",
      "--gzip",
      "--nsFrom",
      `${manifest.mongo.database}.*`,
      "--nsTo",
      `${opts.mongoTarget}.*`,
      "--drop",
      "--quiet",
    ],
    { stdin: true },
  ),
  { fromFile: path.join(opts.from, manifest.mongo.file) },
);
const mongoSeconds = (Date.now() - t1) / 1000;

// Verify exact counts against the manifest.
const pgAfter = await pgCounts(opts, opts.pgTarget);
const mongoAfter = await mongoCounts(opts, opts.mongoTarget);
const diffs = [];
for (const [t, n] of Object.entries(manifest.postgres.rows))
  if (pgAfter[t] !== n)
    diffs.push(`postgres ${t}: backup ${n}, restored ${pgAfter[t] ?? "missing"}`);
for (const t of Object.keys(pgAfter))
  if (!(t in manifest.postgres.rows)) diffs.push(`postgres ${t}: not in the backup`);
for (const [c, n] of Object.entries(manifest.mongo.documents))
  if (mongoAfter[c] !== n)
    diffs.push(`mongo ${c}: backup ${n}, restored ${mongoAfter[c] ?? "missing"}`);

let revoked = "skipped (--keep-sessions)";
if (!opts.keepSessions) {
  const out = await run(
    tool(opts, "pg", "psql", [
      ...pgConn(opts, opts.pgTarget),
      "-tA",
      "-c",
      "WITH s AS (UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL RETURNING 1), t AS (UPDATE email_tokens SET consumed_at = now() WHERE consumed_at IS NULL RETURNING 1) SELECT (SELECT count(*) FROM s) || ' sessions, ' || (SELECT count(*) FROM t) || ' email links'",
    ]),
  );
  revoked = out.trim();
}

const rows = Object.values(pgAfter).reduce((a, b) => a + b, 0);
const docs = Object.values(mongoAfter).reduce((a, b) => a + b, 0);
process.stdout.write(
  `Restored ${opts.from}\n  postgres -> ${opts.pgTarget}: ${Object.keys(pgAfter).length} tables, ${rows} rows, ${pgSeconds.toFixed(1)} s\n  mongo -> ${opts.mongoTarget}: ${Object.keys(mongoAfter).length} collections, ${docs} documents, ${mongoSeconds.toFixed(1)} s\n  revoked: ${revoked}\n  total ${((Date.now() - started) / 1000).toFixed(1)} s\n`,
);
if (diffs.length) {
  process.stderr.write(`Count mismatches:\n  ${diffs.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write("Counts match the backup manifest.\n");
