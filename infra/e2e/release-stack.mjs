#!/usr/bin/env node
/*
 * Release end-to-end stack (Stage 9). Brings up LeadForge on dedicated e2e databases with local
 * stand-ins for every outside service, runs the release Playwright suite, and tears it all down.
 *
 *   node infra/e2e/release-stack.mjs run  [options] [-- <playwright args>]   up, run the suite, down
 *   node infra/e2e/release-stack.mjs up   [options]     start and keep running (Ctrl+C or `down` stops it)
 *   node infra/e2e/release-stack.mjs down              stop a stack started with `up`
 *   node infra/e2e/release-stack.mjs drop              drop the e2e databases and flush the e2e Redis db
 *
 * Options: --build-backend (turbo build of the API and worker first), --reuse-web-build (skip
 * `next build` when .next-e2e-release was built for the same API address), --keep-data (do not
 * recreate the databases), --drop (drop the e2e databases after `run`).
 *
 * What it starts:
 *   PostgreSQL database leadforge_e2e (dropped, recreated, migrated), MongoDB database
 *   leadforge_e2e (dropped, validators and indexes synced), Redis db 5 (flushed), the seed
 *   (apps/api/dist/scripts/seed-e2e.js), the Paystack fixture on 4310, a test website on 4320,
 *   the API on 4100, the worker (metrics off, queue prefix leadforge-e2e) and the web app on 3300
 *   built into apps/web/.next-e2e-release. Mail goes to Mailpit (SMTP 1025, API 8025).
 *
 * Safety: it refuses any database whose name does not end in _e2e, a hosted MongoDB, Redis
 * databases 0, 3, 4 and 9, and the ports 3000, 3100, 4000 and 4200; it checks its own ports are
 * free first. It never reads the root .env: the JWT keys and CSRF secret are generated per run.
 *
 * Environment (all optional): E2E_DATABASE_URL (default
 * postgresql://leadforge:leadforge@127.0.0.1:5432/leadforge_e2e), E2E_MONGODB_URI (default
 * mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true), E2E_MONGODB_DB (leadforge_e2e),
 * E2E_REDIS_URL (redis://127.0.0.1:6379/5), E2E_SMTP_URL (smtp://127.0.0.1:1025), E2E_MAILPIT_URL
 * (http://127.0.0.1:8025), E2E_LOG_DIR (<tmp>/leadforge-e2e-release/logs), E2E_WEB_PORT,
 * E2E_API_PORT, E2E_PAYSTACK_PORT, E2E_SITE_PORT.
 */
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startPaystackFixture, startTestSite } from "./fixtures.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWindows = process.platform === "win32";
const [command = "run", ...rest] = process.argv.slice(2);
const dashDash = rest.indexOf("--");
const flags = new Set(dashDash >= 0 ? rest.slice(0, dashDash) : rest);
const playwrightArgs = dashDash >= 0 ? rest.slice(dashDash + 1) : [];

const FORBIDDEN_PORTS = [3000, 3100, 4000, 4200];
const FORBIDDEN_REDIS_DBS = [0, 3, 4, 9];
const PORTS = {
  web: Number(process.env.E2E_WEB_PORT ?? 3300),
  api: Number(process.env.E2E_API_PORT ?? 4100),
  paystack: Number(process.env.E2E_PAYSTACK_PORT ?? 4310),
  site: Number(process.env.E2E_SITE_PORT ?? 4320),
};
const WEB_DIST = ".next-e2e-release";
const QUEUE_PREFIX = "leadforge-e2e";
const stateDir = join(tmpdir(), "leadforge-e2e-release");
const stateFile = join(stateDir, "state.json");
const stopFile = join(stateDir, "stop");
const logDir = resolve(process.env.E2E_LOG_DIR ?? join(stateDir, "logs"));
const objectStorageDir = join(stateDir, "object-storage");

mkdirSync(logDir, { recursive: true });
const stackLog = createWriteStream(join(logDir, "stack.log"), { flags: "a" });
function log(message) {
  const line = `[release-stack ${new Date().toISOString().slice(11, 19)}] ${message}`;
  process.stdout.write(`${line}\n`);
  stackLog.write(`${line}\n`);
}
function fail(message) {
  log(`ERROR: ${message}`);
  throw new Error(message);
}

const requireFrom = (pkg) => createRequire(join(repo, pkg, "package.json"));

// ---------------------------------------------------------------- configuration and refusals

function databaseUrl() {
  const url = new URL(
    process.env.E2E_DATABASE_URL ??
      "postgresql://leadforge:leadforge@127.0.0.1:5432/leadforge_e2e?schema=public",
  );
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_e2e"))
    fail(
      `Refusing PostgreSQL database "${name}": the release stack only uses databases ending in _e2e`,
    );
  return url;
}

function mongoConfig() {
  const uri =
    process.env.E2E_MONGODB_URI ??
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";
  if (/mongodb\+srv:|mongodb\.net/i.test(uri))
    fail("Refusing a hosted MongoDB cluster: the release stack only uses a local or CI MongoDB");
  const db = process.env.E2E_MONGODB_DB ?? "leadforge_e2e";
  if (!db.endsWith("_e2e"))
    fail(`Refusing MongoDB database "${db}": the release stack only uses databases ending in _e2e`);
  return { uri, db };
}

function redisUrl() {
  const url = new URL(process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/5");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  const db = Number(url.pathname.replace(/^\//, "") || "0");
  if (!Number.isInteger(db) || FORBIDDEN_REDIS_DBS.includes(db))
    fail(
      `Refusing Redis database ${db}: databases ${FORBIDDEN_REDIS_DBS.join(", ")} belong to development, agents and tests`,
    );
  return url;
}

function checkPortsConfig() {
  for (const [name, port] of Object.entries(PORTS)) {
    if (FORBIDDEN_PORTS.includes(port))
      fail(
        `Refusing port ${port} for ${name}: ${FORBIDDEN_PORTS.join(", ")} are reserved for development servers`,
      );
  }
}

function portAnswers(port, host) {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (open) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(800, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function assertPortsFree() {
  for (const [name, port] of Object.entries(PORTS)) {
    for (const host of ["127.0.0.1", "::1"]) {
      if (await portAnswers(port, host))
        fail(
          `Port ${port} (${name}) is already in use on ${host}. Stop whatever listens there, or run \`node infra/e2e/release-stack.mjs down\`.`,
        );
    }
  }
}

/** Env for the API, worker and seed: generated secrets plus local e2e services. Never the root .env. */
function stackEnv({ pg, mongo, redis, paystack, site }) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = (key) =>
    Buffer.from(JSON.stringify(key.export({ format: "jwk" }))).toString("base64url");
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    APP_URL: `http://localhost:${PORTS.web}`,
    API_URL: `http://localhost:${PORTS.api}`,
    API_PORT: String(PORTS.api),
    DATABASE_URL: pg.toString(),
    MONGODB_URI: mongo.uri,
    MONGODB_DB: mongo.db,
    REDIS_URL: redis.toString(),
    QUEUE_PREFIX,
    JWT_PRIVATE_KEY: jwk(privateKey),
    JWT_PUBLIC_KEY: jwk(publicKey),
    // Storage states are reused across browser contexts, so access tokens must outlive the run
    // (a refresh in one context would rotate the token family under the others).
    JWT_ACCESS_TTL_SECONDS: "86400",
    COOKIE_DOMAIN: "localhost",
    COOKIE_SECURE: "false",
    CSRF_SECRET: randomBytes(32).toString("hex"),
    SMTP_URL: process.env.E2E_SMTP_URL ?? "smtp://127.0.0.1:1025",
    MAIL_FROM: "LeadForge E2E <e2e@leadforge.local>",
    PAYSTACK_SECRET_KEY: paystack.secret,
    PAYSTACK_BASE_URL: paystack.url,
    BILLING_CATALOGUE_PATH: join(repo, "infra", "e2e", "billing-catalogue.e2e.json"),
    // Two seats on the free tier: the seeded organizations (owner and sales rep) are full, so an
    // invitation shows the member cap message.
    BILLING_FREE_MAX_MEMBERS: "2",
    SAFE_FETCH_HOST_OVERRIDES: site.overrides,
    SAFE_FETCH_HOST_RPS: "5",
    SAFE_FETCH_RETRY_DELAY_MS: "200",
    DISCOVERY_RETRY_BASE_MS: "300",
    DISCOVERY_RETRY_MAX_MS: "1500",
    // One browser drives every request of a run from one address and one user per project.
    RATE_LIMIT_PER_MINUTE: "100000",
    WORKER_METRICS_PORT: "0",
    WORKER_QUEUES: "",
    OVERTURE_SYNC_SCHEDULE: "false",
    OBJECT_STORAGE_DRIVER: "local",
    OBJECT_STORAGE_LOCAL_DIR: objectStorageDir,
    TRUST_PROXY_HOPS: "1",
  };
  return env;
}

// ---------------------------------------------------------------- processes

const children = [];

function startProcess(name, args, { cwd, env }) {
  // The child writes straight to its log file, so it never depends on this process draining a pipe.
  const fd = openSync(join(logDir, `${name}.log`), "w");
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    detached: !isWindows,
    windowsHide: true,
  });
  closeSync(fd);
  child.on("exit", (code, signal) => log(`${name} exited (${signal ?? code})`));
  children.push({ name, child });
  log(`${name} started (pid ${child.pid}); log ${join(logDir, `${name}.log`)}`);
  return child;
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWindows) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

/** Runs a one-off step to completion without blocking the event loop (the stack keeps logging). */
async function runStep(name, args, { cwd = repo, env }) {
  log(`${name}…`);
  const out = join(logDir, `${name}.log`);
  const fd = openSync(out, "w");
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  const code = await new Promise((done) => child.on("exit", (c) => done(c ?? 1)));
  const text = readFileSync(out, "utf8");
  if (code !== 0)
    fail(`${name} failed (exit ${code}); see ${out}\n${text.split("\n").slice(-15).join("\n")}`);
  return text;
}

async function waitFor(name, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline)
      fail(`${name} did not become ready within ${Math.round(timeoutMs / 1000)} s; see ${logDir}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const httpOk = (url) => async () => (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok;
const logHas = (name, text) => async () =>
  readFileSync(join(logDir, `${name}.log`), "utf8").includes(text);

// ---------------------------------------------------------------- data

async function resetPostgres(pg) {
  const { PrismaClient } = requireFrom("packages/db-postgres")("@prisma/client");
  const name = pg.pathname.replace(/^\//, "");
  const admin = new URL(pg.toString());
  admin.pathname = "/postgres";
  admin.search = "";
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await client.$disconnect();
  }
}

async function dropPostgres(pg) {
  const { PrismaClient } = requireFrom("packages/db-postgres")("@prisma/client");
  const admin = new URL(pg.toString());
  admin.pathname = "/postgres";
  admin.search = "";
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    await client.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${pg.pathname.replace(/^\//, "")}" WITH (FORCE)`,
    );
  } finally {
    await client.$disconnect();
  }
}

async function dropMongo(mongo) {
  const { MongoClient } = requireFrom("packages/db-mongo")("mongodb");
  const client = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    await client.db(mongo.db).dropDatabase();
  } finally {
    await client.close();
  }
}

async function flushRedis(redis) {
  const Redis = requireFrom("packages/core")("ioredis");
  const client = new (Redis.default ?? Redis)(redis.toString(), {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  try {
    await client.connect();
    await client.flushdb();
  } finally {
    client.disconnect();
  }
}

async function prismaMigrate(env) {
  const prismaBin = requireFrom("packages/db-postgres").resolve("prisma/build/index.js");
  await runStep(
    "postgres-migrate",
    [
      prismaBin,
      "migrate",
      "deploy",
      "--schema",
      join(repo, "packages", "db-postgres", "prisma", "schema.prisma"),
    ],
    { env },
  );
}

function assertBuilt() {
  const needed = [
    "apps/api/dist/main.js",
    "apps/api/dist/scripts/seed-e2e.js",
    "apps/worker/dist/main.js",
    "packages/db-mongo/dist/scripts/sync.js",
  ];
  const missing = needed.filter((p) => !existsSync(join(repo, p)));
  if (missing.length)
    fail(
      `Build the backend first (pnpm exec turbo run build --filter=@leadforge/api --filter=@leadforge/worker, or pass --build-backend). Missing: ${missing.join(", ")}`,
    );
}

async function buildWeb() {
  const webDir = join(repo, "apps", "web");
  const marker = join(webDir, WEB_DIST, "e2e-release-build.json");
  const apiUrl = `http://127.0.0.1:${PORTS.api}`;
  if (flags.has("--reuse-web-build") && existsSync(marker)) {
    const built = JSON.parse(readFileSync(marker, "utf8"));
    if (built.apiUrl === apiUrl) {
      log(`Reusing the web build in apps/web/${WEB_DIST} (built ${built.builtAt})`);
      return;
    }
  }
  const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
  await runStep("web-build", [nextBin, "build"], {
    cwd: webDir,
    env: {
      ...process.env,
      NEXT_DIST_DIR: WEB_DIST,
      API_URL: apiUrl,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
  });
  writeFileSync(marker, JSON.stringify({ apiUrl, builtAt: new Date().toISOString() }));
}

// ---------------------------------------------------------------- up and down

async function up() {
  checkPortsConfig();
  const pg = databaseUrl();
  const mongo = mongoConfig();
  const redis = redisUrl();
  await assertPortsFree();
  if (flags.has("--build-backend")) {
    await runStep(
      "backend-build",
      [
        requireFrom(".").resolve("turbo/bin/turbo"),
        "run",
        "build",
        "--filter=@leadforge/api",
        "--filter=@leadforge/worker",
      ],
      { env: process.env },
    );
  }
  assertBuilt();
  mkdirSync(stateDir, { recursive: true });
  rmSync(stopFile, { force: true });

  log(
    `Databases: PostgreSQL ${pg.pathname.slice(1)}, MongoDB ${mongo.db}, Redis db ${redis.pathname.slice(1) || "0"}; queue prefix ${QUEUE_PREFIX}`,
  );
  const site = await startTestSite({ port: PORTS.site });
  log(`Test website on 127.0.0.1:${PORTS.site} (${site.overrides})`);
  const paystack = await startPaystackFixture({
    repo,
    port: PORTS.paystack,
    apiUrl: `http://127.0.0.1:${PORTS.api}`,
    mongoUri: mongo.uri,
    mongoDb: mongo.db,
    redisUrl: redis.toString(),
    queuePrefix: QUEUE_PREFIX,
    log,
  });
  log(`Paystack fixture on ${paystack.url}`);
  const env = stackEnv({ pg, mongo, redis, paystack, site });

  const closeFixtures = async () => {
    await paystack.close().catch(() => {});
    await site.close().catch(() => {});
  };

  try {
    if (!flags.has("--keep-data")) {
      log("Recreating the e2e databases…");
      await resetPostgres(pg);
      await dropMongo(mongo);
      await flushRedis(redis);
      rmSync(objectStorageDir, { recursive: true, force: true });
    }
    await prismaMigrate(env);
    await runStep(
      "mongo-sync",
      [join(repo, "packages", "db-mongo", "dist", "scripts", "sync.js")],
      { env },
    );
    const seeded = await runStep(
      "seed-e2e",
      [join(repo, "apps", "api", "dist", "scripts", "seed-e2e.js")],
      { env },
    );
    log(seeded.trim());

    startProcess("api", ["dist/main.js"], { cwd: join(repo, "apps", "api"), env });
    startProcess("worker", ["dist/main.js"], { cwd: join(repo, "apps", "worker"), env });
    await buildWeb();
    const webDir = join(repo, "apps", "web");
    const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
    startProcess("web", [nextBin, "start", "-p", String(PORTS.web)], {
      cwd: webDir,
      env: {
        ...process.env,
        NEXT_DIST_DIR: WEB_DIST,
        API_URL: `http://127.0.0.1:${PORTS.api}`,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
        PORT: String(PORTS.web),
      },
    });
    await waitFor("API", httpOk(`http://127.0.0.1:${PORTS.api}/api/v1/health/ready`), 120_000);
    await waitFor("worker", logHas("worker", "LeadForge worker started"), 120_000);
    await waitFor("web", httpOk(`http://127.0.0.1:${PORTS.web}/sign-in`), 120_000);
  } catch (err) {
    await teardown(closeFixtures);
    throw err;
  }

  writeFileSync(
    stateFile,
    JSON.stringify(
      {
        launcher: process.pid,
        children: children.map((c) => ({ name: c.name, pid: c.child.pid })),
        ports: PORTS,
        logDir,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log(
    `Stack ready: web http://localhost:${PORTS.web}, API http://localhost:${PORTS.api}, fixtures ${paystack.url}`,
  );
  return { closeFixtures, env };
}

let tornDown = false;
async function teardown(closeFixtures) {
  if (tornDown) return;
  tornDown = true;
  log("Stopping the stack…");
  for (const { child } of [...children].reverse()) killTree(child.pid);
  await closeFixtures?.();
  rmSync(stateFile, { force: true });
  rmSync(stopFile, { force: true });
  log("Stack stopped.");
}

async function down() {
  if (!existsSync(stateFile)) {
    log("No running release stack recorded.");
    return;
  }
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (alive(state.launcher)) {
    writeFileSync(stopFile, "stop");
    const deadline = Date.now() + 60_000;
    while (alive(state.launcher) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 500));
  }
  if (existsSync(stateFile)) {
    for (const c of state.children) killTree(c.pid);
    killTree(state.launcher);
    rmSync(stateFile, { force: true });
  }
  log("Release stack is down.");
}

async function drop() {
  const pg = databaseUrl();
  const mongo = mongoConfig();
  const redis = redisUrl();
  if (existsSync(stateFile)) fail("A release stack is still running; run `down` first");
  await dropPostgres(pg);
  await dropMongo(mongo);
  await flushRedis(redis);
  rmSync(objectStorageDir, { recursive: true, force: true });
  log(
    `Dropped PostgreSQL ${pg.pathname.slice(1)} and MongoDB ${mongo.db}, flushed Redis db ${redis.pathname.slice(1)}.`,
  );
}

function suiteEnv() {
  return {
    ...process.env,
    E2E_RELEASE: "1",
    E2E_BASE_URL: `http://localhost:${PORTS.web}`,
    E2E_FIXTURE_URL: `http://127.0.0.1:${PORTS.paystack}`,
    E2E_MAILPIT_URL: process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025",
  };
}

async function main() {
  if (command === "down") return down();
  if (command === "drop") return drop();
  if (command !== "up" && command !== "run")
    fail(`Unknown command "${command}" (use run, up, down or drop)`);

  const { closeFixtures } = await up();
  const stop = async (code) => {
    await teardown(closeFixtures);
    if (command === "run" && flags.has("--drop"))
      await drop().catch((e) => log(`drop failed: ${e.message}`));
    stackLog.end();
    process.exit(code);
  };
  process.on("SIGINT", () => void stop(130));
  process.on("SIGTERM", () => void stop(143));

  if (command === "up") {
    log(
      `Running. Stop with Ctrl+C or \`node infra/e2e/release-stack.mjs down\`. Suite env: E2E_RELEASE=1 E2E_BASE_URL=http://localhost:${PORTS.web} E2E_FIXTURE_URL=http://127.0.0.1:${PORTS.paystack}`,
    );
    setInterval(() => {
      if (existsSync(stopFile)) void stop(0);
      for (const { name, child } of children) {
        if (child.exitCode !== null) {
          log(`${name} stopped unexpectedly; stopping the stack`);
          void stop(1);
        }
      }
    }, 1000);
    return;
  }

  const webDir = join(repo, "apps", "web");
  const cli = createRequire(join(webDir, "package.json")).resolve("@playwright/test/cli");
  log(
    `Running the release suite: playwright test -c playwright.release.config.ts ${playwrightArgs.join(" ")}`,
  );
  const suite = spawn(
    process.execPath,
    [cli, "test", "-c", "playwright.release.config.ts", ...playwrightArgs],
    { cwd: webDir, env: suiteEnv(), stdio: "inherit" },
  );
  suite.on("exit", (code) => void stop(code ?? 1));
}

main().catch(async (err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  for (const { child } of children) killTree(child.pid);
  process.exit(1);
});
