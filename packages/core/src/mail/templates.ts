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
