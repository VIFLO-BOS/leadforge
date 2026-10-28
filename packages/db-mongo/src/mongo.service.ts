import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";

export const MONGO_OPTIONS = Symbol("MONGO_OPTIONS");

export interface MongoOptions {
  uri: string;
  dbName: string;
}

/**
 * Single MongoDB client for the process. Only repository classes (this package and the
 * repositories folders in packages/core) may call collection(); everything else goes through them.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly client: MongoClient;
  private readonly db: Db;

  constructor(@Inject(MONGO_OPTIONS) options: MongoOptions) {
    this.client = new MongoClient(options.uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      // Wire compression when the server supports it (MongoDB and Atlas do): much less data on slow
      // links (the Overture sync moves ~160k place documents). Negotiated; plain if unsupported.
      compressors: ["zlib"],
    });
    // Handles can be created before connecting; repositories grab theirs at construction.
    this.db = this.client.db(options.dbName);
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  get database(): Db {
    return this.db;
  }

  collection<T extends Document>(name: string): Collection<T> {
    return this.database.collection<T>(name);
  }

  async ping(): Promise<void> {
    await this.database.command({ ping: 1 });
  }

  getClient(): MongoClient {
    return this.client;
  }
}
