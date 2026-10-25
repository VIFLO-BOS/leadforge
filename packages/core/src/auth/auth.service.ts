import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import {
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type ServerEnv,
  type SessionSummary,
} from "@leadforge/contracts";
import { newId, PrismaService, type Prisma, type Session, type User } from "@leadforge/db-postgres";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { MailTemplates } from "../mail/templates.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { CsrfService } from "./csrf.service.js";
import { UserRepository } from "./repositories/user.repository.js";
import { SessionRepository } from "./repositories/session.repository.js";
import { EmailTokenRepository } from "./repositories/email-token.repository.js";

export interface IssuedTokens {
  access: string;
  refresh: string;
  csrf: string;
  sessionId: string;
}

export interface ClientContext extends AuditContext {
  userAgent?: string | null;
  ip?: string | null;
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_LIMIT_PER_HOUR = 3;

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly prisma: PrismaService,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly emailTokens: EmailTokenRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly csrf: CsrfService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
  ) {}

  async register(
    dto: RegisterRequest,
    ctx: ClientContext,
  ): Promise<{ me: MeResponse; tokens: IssuedTokens }> {
    const weakness = this.passwords.weakness(dto.password, { email: dto.email, name: dto.name });
    if (weakness) throw AppError.validation([{ path: "password", message: weakness }]);

    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      // Do not reveal registration status to the caller beyond a generic conflict.
      throw new AppError("CONFLICT", "An account with this email already exists. Try signing in.");
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const { user, tokens } = await this.prisma.$transaction(async (tx) => {
      const user = await this.users.create({ email: dto.email, passwordHash, name: dto.name }, tx);
      await this.organizations.createForNewUser(
        { name: dto.organizationName, country: dto.country, userId: user.id, email: user.email },
        tx,
      );
      const tokens = await this.issueSession(user, ctx, tx);
      return { user, tokens };
    });

    await this.audit.record(
      {
        organizationId: null,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
      },
      ctx,
    );
    await this.sendVerificationEmail(user);

    return { me: await this.me(user.id), tokens };
  }

  async login(
    dto: LoginRequest,
    ctx: ClientContext,
  ): Promise<{ me: MeResponse; tokens: IssuedTokens }> {
    const user = await this.users.findByEmail(dto.email);
    const ok = user ? await this.passwords.verify(user.passwordHash, dto.password) : false;
    if (!user || !ok) {
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: user?.id ?? null,
          actorType: "user",
          action: "auth.login_failed",
          resourceType: "user",
          resourceId: user?.id ?? null,
        },
        ctx,
      );
      throw new AppError("INVALID_CREDENTIALS");
    }
    const tokens = await this.issueSession(user, ctx);
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.login",
        resourceType: "session",
        resourceId: tokens.sessionId,
      },
      ctx,
    );
    return { me: await this.me(user.id), tokens };
  }

  async logout(sessionId: string, userId: string, ctx: ClientContext): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: userId,
        actorType: "user",
        action: "auth.logout",
        resourceType: "session",
        resourceId: sessionId,
      },
      ctx,
    );
  }

  /**
   * Rotates the refresh token. Presenting a revoked token from a family revokes the
   * whole family (stolen-token reuse detection).
   */
  async refresh(refreshToken: string, ctx: ClientContext): Promise<IssuedTokens> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw new AppError("UNAUTHENTICATED");

    const session = await this.sessions.findById(parsed.sessionId);
    if (!session) throw new AppError("UNAUTHENTICATED");

    if (session.revokedAt) {
      await this.sessions.revokeFamily(session.familyId);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: session.userId,
          actorType: "user",
          action: "auth.refresh_reuse_detected",
          resourceType: "session",
          resourceId: session.id,
        },
        ctx,
      );
      this.logger.warn(
        { sessionId: session.id, familyId: session.familyId },
        "Refresh token reuse detected",
      );
      throw new AppError("UNAUTHENTICATED");
    }

    if (session.expiresAt <= new Date() || session.refreshTokenHash !== parsed.hash) {
      throw new AppError("UNAUTHENTICATED");
    }

    const user = await this.users.findById(session.userId);
    if (!user) throw new AppError("UNAUTHENTICATED");

    return this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(session.id, tx);
      return this.issueSession(user, ctx, tx, session.familyId);
    });
  }

  /** Re-issues tokens for the current session (used after email verification so the claim updates). */
  async reissueForSession(sessionId: string, ctx: ClientContext): Promise<IssuedTokens | null> {
    const session = await this.sessions.findActiveById(sessionId);
    if (!session) return null;
    const user = await this.users.findById(session.userId);
    if (!user) return null;
    return this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(session.id, tx);
      return this.issueSession(user, ctx, tx, session.familyId);
    });
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("UNAUTHENTICATED");
    const organizations = await this.organizations.listForUser(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
      organizations,
    };
  }

  async verifyEmail(token: string, ctx: ClientContext): Promise<User> {
    const record = await this.emailTokens.findLive(
      this.tokens.hashOneTimeToken(token),
      "verify_email",
    );
    if (!record) throw new AppError("INVALID_TOKEN");
    const user = await this.prisma.$transaction(async (tx) => {
      await this.emailTokens.consume(record.id, tx);
      return this.users.markEmailVerified(record.userId, tx);
    });
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.email_verified",
        resourceType: "user",
        resourceId: user.id,
      },
      ctx,
    );
    return user;
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("UNAUTHENTICATED");
    if (user.emailVerifiedAt) return;
    const recent = await this.emailTokens.countRecent(userId, "verify_email", 60 * 60 * 1000);
    if (recent >= RESEND_LIMIT_PER_HOUR)
      throw new AppError("RATE_LIMITED", "Verification email limit reached. Try again in an hour.");
    await this.sendVerificationEmail(user);
  }

  async forgotPassword(email: string, ctx: ClientContext): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return; // Always 202; do not reveal account existence.
    const recent = await this.emailTokens.countRecent(user.id, "reset_password", 60 * 60 * 1000);
    if (recent >= RESEND_LIMIT_PER_HOUR) return;
    const { token, hash } = this.tokens.issueOneTimeToken();
    await this.emailTokens.issue(
      user.id,
      "reset_password",
      hash,
      new Date(Date.now() + RESET_TTL_MS),
    );
    const link = `${this.env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.queue.enqueueMail({
      message: MailTemplates.resetPassword(user.email, user.name, link),
      idempotencyKey: `reset:${hash}`,
    });
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.password_reset_requested",
        resourceType: "user",
        resourceId: user.id,
      },
      ctx,
    );
  }

  async resetPassword(token: string, password: string, ctx: ClientContext): Promise<void> {
    const record = await this.emailTokens.findLive(
      this.tokens.hashOneTimeToken(token),
      "reset_password",
    );
    if (!record) throw new AppError("INVALID_TOKEN");
    const user = await this.users.findById(record.userId);
    if (!user) throw new AppError("INVALID_TOKEN");
    const weakness = this.passwords.weakness(password, { email: user.email, name: user.name });
    if (weakness) throw AppError.validation([{ path: "password", message: weakness }]);

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await this.emailTokens.consume(record.id, tx);
      await this.users.updatePassword(user.id, passwordHash, tx);
      await this.sessions.revokeAllForUser(user.id, undefined, tx);
      if (!user.emailVerifiedAt) await this.users.markEmailVerified(user.id, tx); // proven mailbox control
    });
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.password_reset",
        resourceType: "user",
        resourceId: user.id,
      },
      ctx,
    );
    await this.queue.enqueueMail({
      message: MailTemplates.passwordChanged(user.email, user.name),
      idempotencyKey: `pwchanged:${record.id}`,
    });
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.sessions.listActiveForUser(userId);
    return rows.map((s) => toSessionSummary(s, currentSessionId));
  }

  async revokeSession(userId: string, sessionId: string, ctx: ClientContext): Promise<void> {
    const session = await this.sessions.findActiveById(sessionId);
    if (!session || session.userId !== userId) throw AppError.notFound("Session");
    await this.sessions.revoke(sessionId);
    await this.audit.record(
      {
        organizationId: null,
        actorUserId: userId,
        actorType: "user",
        action: "auth.session_revoked",
        resourceType: "session",
        resourceId: sessionId,
      },
      ctx,
    );
  }

  private async issueSession(
    user: User,
    ctx: ClientContext,
    tx: Prisma.TransactionClient = this.prisma,
    familyId: string = newId(),
  ): Promise<IssuedTokens> {
    const sessionId = newId();
    const { token: refresh, hash } = this.tokens.issueRefreshToken(sessionId);
    await this.sessions.create(
      {
        id: sessionId,
        userId: user.id,
        familyId,
        refreshTokenHash: hash,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        ip: ctx.ip ?? null,
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_SECONDS * 1000),
      },
      tx,
    );
    const access = await this.tokens.signAccessToken({
      sub: user.id,
      sid: sessionId,
      ev: !!user.emailVerifiedAt,
    });
    return { access, refresh, csrf: this.csrf.tokenFor(sessionId), sessionId };
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const { token, hash } = this.tokens.issueOneTimeToken();
    await this.emailTokens.issue(
      user.id,
      "verify_email",
      hash,
      new Date(Date.now() + VERIFY_TTL_MS),
    );
    const link = `${this.env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.queue.enqueueMail({
      message: MailTemplates.verifyEmail(user.email, user.name, link),
      idempotencyKey: `verify:${hash}`,
    });
  }
}

function toSessionSummary(s: Session, currentSessionId: string): SessionSummary {
  return {
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentSessionId,
  };
}
