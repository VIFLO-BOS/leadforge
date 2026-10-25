import type { INestApplication } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { PrismaService } from "@leadforge/db-postgres";
import { MongoService } from "@leadforge/db-mongo";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  ORGANIZATION_HEADER,
  type MeResponse,
} from "@leadforge/contracts";
import { QueueNames, type SendEmailJob } from "@leadforge/core";
import { createApp } from "../src/bootstrap.js";

export const API = "/api/v1";

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
  mailQueue: Queue;
  close(): Promise<void>;
  resetState(): Promise<void>;
  /** Finds the most recent mail job addressed to `to` and extracts the token from its link. */
  tokenFromMail(to: string, pathPart: string): Promise<string>;
  agent(): TestAgent;
}

export async function createHarness(): Promise<Harness> {
  const redisUrl = process.env.REDIS_URL!;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const mailQueue = new Queue(QueueNames.mail, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });
  const app = await createApp(process.env);
  const prisma = app.get(PrismaService);

  const resetState = async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE sessions, email_tokens, invitations, memberships, notification_preferences, api_keys, contact_submissions,
       credit_ledger, entitlements, payments, refunds, invoices, subscriptions, billing_audit, billing_customers, usage_daily, organizations, users
       RESTART IDENTITY CASCADE`,
    );
    await app.get(MongoService).database.dropDatabase();
    await redis.flushdb();
    await mailQueue.obliterate({ force: true }).catch(() => undefined);
  };

  return {
    app,
    prisma,
    redis,
    mailQueue,
    resetState,
    agent: () => request.agent(app.getHttpServer()),
    async tokenFromMail(to, pathPart) {
      const jobs = await mailQueue.getJobs([
        "waiting",
        "delayed",
        "prioritized",
        "completed",
        "active",
      ]);
      const matching = jobs
        .filter(
          (j) =>
            (j.data as SendEmailJob).message.to === to &&
            (j.data as SendEmailJob).message.text.includes(pathPart),
        )
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      const job = matching[0];
      if (!job) throw new Error(`No mail to ${to} containing ${pathPart}`);
      const text = (job.data as SendEmailJob).message.text;
      const match = text.match(
        new RegExp(
          `${pathPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\s]*?(?:token=|/)([A-Za-z0-9_%-]+)`,
        ),
      );
      if (!match?.[1]) throw new Error(`Could not extract token from mail: ${text}`);
      return decodeURIComponent(match[1]);
    },
    async close() {
      await app.close();
      await mailQueue.close();
      await redis.quit();
    },
  };
}

export function csrfFrom(agent: TestAgent): string {
  const jar = (
    agent as unknown as {
      jar: {
        getCookies: (opts: {
          domain: string;
          path: string;
          secure: boolean;
          script: boolean;
        }) => Array<{ name: string; value: string }>;
      };
    }
  ).jar;
  const cookies = jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: true });
  const csrf = cookies.find((c) => c.name === CSRF_COOKIE);
  if (!csrf) throw new Error("No CSRF cookie in jar");
  return csrf.value;
}

export async function registerUser(
  agent: TestAgent,
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }> = {},
): Promise<MeResponse> {
  const body = {
    email: overrides.email ?? `user-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: overrides.password ?? "Str0ng-Passw0rd-Example!",
    name: overrides.name ?? "Test Person",
    organizationName: overrides.organizationName ?? "Test Org",
    country: "NG",
  };
  const res = await agent.post(`${API}/auth/register`).send(body).expect(201);
  return res.body.data as MeResponse;
}

export async function verifyEmail(h: Harness, agent: TestAgent, email: string): Promise<void> {
  const token = await h.tokenFromMail(email, "/verify-email");
  await agent
    .post(`${API}/auth/verify-email`)
    .set(CSRF_HEADER, csrfFrom(agent))
    .send({ token })
    .expect(200);
}

export function orgHeaders(agent: TestAgent, organizationId: string): Record<string, string> {
  return { [ORGANIZATION_HEADER]: organizationId, [CSRF_HEADER]: csrfFrom(agent) };
}
