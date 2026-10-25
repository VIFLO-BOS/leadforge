import { Module, type DynamicModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { parseServerEnv, type ServerEnv } from "@leadforge/contracts";
import { PrismaModule } from "@leadforge/db-postgres";
import { MongoModule } from "@leadforge/db-mongo";
import { ENV, EnvModule } from "./config/env.module.js";
import { buildLoggerParams } from "./common/logging/logger.config.js";
import { RedisModule } from "./redis/redis.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { MailModule } from "./mail/mail.module.js";
import { HealthModule } from "./health/health.module.js";

/**
 * Infrastructure shared by the API and the worker: env, logging, databases, Redis,
 * queues, audit, mail, health. Feature modules are imported by each app on top.
 */
@Module({})
export class CoreModule {
  static forRoot(source: NodeJS.ProcessEnv = process.env): DynamicModule {
    const env = parseServerEnv(source);
    return {
      module: CoreModule,
      imports: [
        EnvModule.forRoot(source),
        LoggerModule.forRootAsync({
          inject: [ENV],
          useFactory: (e: ServerEnv) => buildLoggerParams(e),
        }),
        PrismaModule,
        MongoModule.forRoot({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB }),
        RedisModule,
        QueueModule,
        AuditModule,
        MailModule,
        HealthModule,
      ],
      exports: [
        EnvModule,
        PrismaModule,
        MongoModule,
        RedisModule,
        QueueModule,
        AuditModule,
        MailModule,
        HealthModule,
      ],
    };
  }
}
