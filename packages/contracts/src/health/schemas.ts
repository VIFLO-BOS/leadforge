import { z } from "zod";

export const HealthCheckStatus = z.enum(["up", "down"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(
    z.string(),
    z.object({
      status: HealthCheckStatus,
      latencyMs: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
  version: z.string(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
