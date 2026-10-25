import { MongoClient } from "mongodb";
import { syncCollections } from "../sync.js";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri || !dbName) throw new Error("MONGODB_URI and MONGODB_DB are required");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await syncCollections(client.db(dbName));
    process.stdout.write(
      `Mongo sync complete. created=${result.created.length} updated=${result.updated.length} indexes=${result.indexesEnsured}\n`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
