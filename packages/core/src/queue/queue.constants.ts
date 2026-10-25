import type { MailMessage } from "../mail/mail.service.js";

export const QueueNames = {
  mail: "mail",
  discovery: "discovery",
  enrichment: "enrichment",
  websiteAnalysis: "website-analysis",
  dedup: "dedup",
  exports: "exports",
  billing: "billing",
} as const;
export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export interface SendEmailJob {
  message: MailMessage;
  /** Stable key so re-enqueues do not send twice. */
  idempotencyKey: string;
}

export interface QueueJobMap {
  [QueueNames.mail]: { "send-email": SendEmailJob };
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 14 },
} as const;
