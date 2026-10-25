import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Params } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import type { RequestWithContext } from "../request/request-context.js";

/**
 * Structured JSON logging. Every request line carries requestId, userId and
 * organizationId. Personal data fields are redacted.
 */
export function buildLoggerParams(env: ServerEnv): Params {
  const isDev = env.NODE_ENV === "development";
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      autoLogging: { ignore: (req) => (req.url ?? "").startsWith("/api/v1/health") },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers["x-request-id"];
        const id =
          typeof header === "string" && /^[\w.-]{8,128}$/.test(header) ? header : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customProps: (req) => {
        const r = req as RequestWithContext;
        return {
          userId: r.user?.id,
          organizationId: r.org?.organizationId,
        };
      },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
          "req.body.password",
          "req.body.email",
          "req.body.token",
        ],
        censor: "[redacted]",
      },
      serializers: {
        req: (req: IncomingMessage & { id?: string; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      transport: isDev
        ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
        : undefined,
    },
  };
}
