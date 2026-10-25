import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { MailService, QueueNames, type SendEmailJob } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

@Injectable()
export class MailProcessor implements QueueProcessor {
  readonly queueName = QueueNames.mail;
  readonly concurrency = 4;

  constructor(
    private readonly mail: MailService,
    private readonly logger: Logger,
  ) {}

  async process(job: Job<SendEmailJob>): Promise<void> {
    if (job.name !== "send-email") throw new Error(`Unknown mail job ${job.name}`);
    const { messageId } = await this.mail.deliver(job.data.message);
    this.logger.log(
      { jobId: job.id, messageId, to: redact(job.data.message.to) },
      "Email delivered",
    );
  }
}

function redact(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 1)}***@${domain}`;
}
