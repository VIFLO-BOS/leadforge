import { Inject, Injectable } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * SMTP transport. The API never calls deliver() directly; it enqueues a mail job
 * and the worker delivers it (see QueueService.enqueueMail).
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter;

  constructor(@Inject(ENV) private readonly env: ServerEnv) {
    this.transporter = nodemailer.createTransport(env.SMTP_URL);
  }

  async deliver(message: MailMessage): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: this.env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { messageId: String(info.messageId) };
  }

  async verifyTransport(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
