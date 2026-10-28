// Shared helpers for infra/backup (docs/OPERATIONS.md, "Backup and restore").
// Node 22+, no dependencies. Two modes:
//   docker  (default) runs the tools inside the database containers with `docker exec`
//           (local Docker Compose stack, or any host where the containers run);
//   native  runs pg_dump/pg_restore/psql and mongodump/mongorestore/mongosh from PATH against
//           PG_URL / MONGO_URI (managed databases). Connection strings are never printed.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument ${a}`);
    const [key, inline] = a.slice(2).split("=", 2);
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(camel in defaults)) throw new Error(`Unknown option --${key}`);
    if (typeof defaults[camel] === "boolean")
      out[camel] = inline === undefined ? true : inline === "true";
    else out[camel] = inline ?? argv[++i];
  }
  return out;
}

/** Builds the command for a database tool in docker or native mode. */
export function tool(opts, kind, name, args, { stdin = false } = {}) {
  if (opts.mode === "native") return { cmd: name, args };
  const container = kind === "pg" ? opts.pgContainer : opts.mongoContainer;
  return { cmd: "docker", args: ["exec", ...(stdin ? ["-i"] : []), container, name, ...args] };
}

/** Runs a command; resolves stdout as text (or streams stdout to `toFile`, stdin from `fromFile`). */
export function run({ cmd, args }, { toFile, fromFile, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: [fromFile ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    // When writing a file, wait for it to be flushed as well as for the process to exit.
    const flushed = toFile
      ? new Promise((ok, ko) =>
          child.stdout.pipe(createWriteStream(toFile)).on("finish", ok).on("error", ko),
        )
      : (child.stdout.on("data", (d) => (out += d)), Promise.resolve());
    child.stderr.on("data", (d) => (err += d));
    if (fromFile) createReadStream(fromFile).pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) flushed.then(() => resolve(out), reject);
      else
        reject(
          new Error(
            `${cmd} ${redactArgs(args).join(" ")} exited ${code}${quiet ? "" : `: ${redactText(err).slice(-2000)}`}`,
          ),
        );
    });
  });
}

function redactArgs(args) {
  return args.map((a) =>
    /^(postgres(ql)?|mongodb(\+srv)?):\/\//i.test(a) ? "<connection-string>" : a,
  );
}

function redactText(text) {
  return text.replace(/(postgres(ql)?|mongodb(\+srv)?):\/\/[^\s"']+/gi, "<connection-string>");
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

function pgConn(opts, db) {
  if (opts.mode === "native") {
    if (!opts.pgUrl) throw new Error("--pg-url (or PG_URL) is required in native mode");
    const u = new URL(opts.pgUrl);
    if (db) u.pathname = `/${db}`;
    return ["-d", u.toString()];
  }
  return ["-U", opts.pgUser, "-d", db];
}

/** Exact row count per table in the public schema (excluding Prisma's migration ledger). */
export async function pgCounts(opts, db) {
  const list = await run(
    tool(opts, "pg", "psql", [
      ...pgConn(opts, db),
      "-tAc",
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
    ]),
  );
  const tables = list
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tables.length === 0) return {};
  const sql = tables
    .map((t) => `SELECT '${t}' AS t, count(*) AS n FROM "${t}"`)
    .join(" UNION ALL ");
  const rows = await run(
    tool(opts, "pg", "psql", [...pgConn(opts, db), "-tA", "-F", "\t", "-c", `${sql} ORDER BY 1`]),
  );
  return Object.fromEntries(
    rows
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [t, n] = line.split("\t");
        return [t, Number(n)];
      }),
  );
}

function mongoConn(opts) {
  if (opts.mode === "native") {
    if (!opts.mongoUri) throw new Error("--mongo-uri (or MONGO_URI) is required in native mode");
    return [opts.mongoUri];
  }
  return [];
}

/** Exact document count per collection (views excluded). */
export async function mongoCounts(opts, db) {
  const script = `const d = db.getSiblingDB(${JSON.stringify(db)}); const out = {}; for (const c of d.getCollectionInfos({ type: "collection" }).map((x) => x.name).sort()) out[c] = d.getCollection(c).countDocuments({}); print(JSON.stringify(out));`;
  const text = await run(
    tool(opts, "mongo", "mongosh", [...mongoConn(opts), "--quiet", "--eval", script]),
  );
  return JSON.parse(text.trim().split(/\r?\n/).pop());
}

export { pgConn, mongoConn };
