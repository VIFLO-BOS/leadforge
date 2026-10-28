import type { MailMessage } from "./mail.service.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;color:#111113;background:#fafafa;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e8;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="font-size:12px;color:#6b6b74;margin-top:24px">LeadForge. If you did not expect this email you can ignore it.</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#1f8a5b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#6b6b74;word-break:break-all">Or paste this link: ${escapeHtml(href)}</p>`;
}

export const MailTemplates = {
  verifyEmail(to: string, name: string, link: string): MailMessage {
    return {
      to,
      subject: "Verify your LeadForge email",
      text: `Hi ${name},\n\nConfirm your email address to start using LeadForge:\n${link}\n\nThis link expires in 24 hours.`,
      html: layout(
        "Confirm your email",
        `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to start using LeadForge. This link expires in 24 hours.</p>${button(link, "Verify email")}`,
      ),
    };
  },

  resetPassword(to: string, name: string, link: string): MailMessage {
    return {
      to,
      subject: "Reset your LeadForge password",
      text: `Hi ${name},\n\nReset your password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
      html: layout(
        "Reset your password",
        `<p>Hi ${escapeHtml(name)},</p><p>Use the link below to choose a new password. It is valid for 1 hour.</p>${button(link, "Reset password")}`,
      ),
    };
  },

  invitation(
    to: string,
    organizationName: string,
    inviterName: string,
    roleLabel: string,
    link: string,
  ): MailMessage {
    return {
      to,
      subject: `${inviterName} invited you to ${organizationName} on LeadForge`,
      text: `${inviterName} invited you to join ${organizationName} on LeadForge as ${roleLabel}.\n\nAccept the invitation:\n${link}\n\nThe invitation expires in 7 days.`,
      html: layout(
        `Join ${organizationName}`,
        `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong> on LeadForge as <strong>${escapeHtml(roleLabel)}</strong>.</p><p>The invitation expires in 7 days.</p>${button(link, "Accept invitation")}`,
      ),
    };
  },

  discoveryJobFailed(
    to: string,
    name: string,
    jobName: string,
    reason: string,
    link: string,
  ): MailMessage {
    return {
      to,
      subject: `Discovery job "${jobName}" failed`,
      text: `Hi ${name},

Your LeadForge discovery job "${jobName}" failed: ${reason}

Credits were charged only for records produced before it stopped; the rest of the hold was returned.

Open the job:
${link}`,
      html: layout(
        "Discovery job failed",
        `<p>Hi ${escapeHtml(name)},</p><p>Your discovery job <strong>${escapeHtml(jobName)}</strong> failed: ${escapeHtml(reason)}</p><p>Credits were charged only for records produced before it stopped; the rest of the hold was returned.</p>${button(link, "Open the job")}`,
      ),
    };
  },

  /** One lead (businessName) or several (count) assigned to the recipient. */
  leadAssigned(
    to: string,
    name: string,
    assignedBy: string,
    count: number,
    businessName: string | null,
    link: string,
  ): MailMessage {
    const what =
      count === 1 ? (businessName ? `the lead "${businessName}"` : "a lead") : `${count} leads`;
    return {
      to,
      subject:
        count === 1
          ? "A lead was assigned to you on LeadForge"
          : `${count} leads were assigned to you on LeadForge`,
      text: `Hi ${name},

${assignedBy} assigned ${what} to you.

Open your pipeline:
${link}

You can turn off assignment emails in Settings, Notifications.`,
      html: layout(
        "Lead assigned",
        `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(assignedBy)} assigned ${escapeHtml(what)} to you.</p>${button(link, "Open your pipeline")}<p>You can turn off assignment emails in Settings, Notifications.</p>`,
      ),
    };
  },

  /**
   * Phase 6 billing emails (receipt, failed payment, subscription change, refund, alert). Amounts
   * arrive already formatted from integer minor units.
   */
  billingNotice(
    to: string,
    name: string,
    input: {
      subject: string;
      heading: string;
      paragraphs: string[];
      link: string;
      linkLabel: string;
    },
  ): MailMessage {
    return {
      to,
      subject: input.subject,
      text: `Hi ${name},\n\n${input.paragraphs.join("\n\n")}\n\n${input.linkLabel}:\n${input.link}\n\nYou can turn off billing emails in Settings, Notifications.`,
      html: layout(
        input.heading,
        `<p>Hi ${escapeHtml(name)},</p>${input.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${button(input.link, input.linkLabel)}<p>You can turn off billing emails in Settings, Notifications.</p>`,
      ),
    };
  },

  /**
   * Stage 10 organization notices to owners and admins (deletion scheduled, reminder, cancelled,
   * purged). Service notices about the account itself: sent whatever the notification preferences.
   */
  organizationNotice(
    to: string,
    name: string,
    input: {
      subject: string;
      heading: string;
      paragraphs: string[];
      link: string | null;
      linkLabel: string;
    },
  ): MailMessage {
    const greeting = name ? `Hi ${name},` : "Hello,";
    return {
      to,
      subject: input.subject,
      text: [
        greeting,
        ...input.paragraphs,
        ...(input.link ? [`${input.linkLabel}:\n${input.link}`] : []),
        "You receive this notice because you are an owner or administrator of the organization.",
      ].join("\n\n"),
      html: layout(
        input.heading,
        `<p>${escapeHtml(greeting)}</p>${input.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${input.link ? button(input.link, input.linkLabel) : ""}<p>You receive this notice because you are an owner or administrator of the organization.</p>`,
      ),
    };
  },

  passwordChanged(to: string, name: string): MailMessage {
    return {
      to,
      subject: "Your LeadForge password was changed",
      text: `Hi ${name},\n\nYour password was just changed and all other sessions were signed out. If this was not you, reset your password immediately.`,
      html: layout(
        "Password changed",
        `<p>Hi ${escapeHtml(name)},</p><p>Your password was just changed and all other sessions were signed out. If this was not you, reset your password immediately.</p>`,
      ),
    };
  },
};
