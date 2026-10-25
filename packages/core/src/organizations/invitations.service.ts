import { Inject, Injectable } from "@nestjs/common";
import {
  ROLE_LABELS,
  type CreateInvitationRequest,
  type InvitationPreview,
  type InvitationSummary,
  type ServerEnv,
} from "@leadforge/contracts";
import { PrismaService } from "@leadforge/db-postgres";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import type { OrganizationScope } from "../common/request/request-context.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { MailTemplates } from "../mail/templates.js";
import { TokenService } from "../auth/token.service.js";
import { UserRepository } from "../auth/repositories/user.repository.js";
import { InvitationRepository } from "./repositories/invitation.repository.js";
import { MembershipRepository } from "./repositories/membership.repository.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<InvitationSummary[]> {
    const rows = await this.invitations.listPending(organizationId);
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: { id: i.invitedBy.id, name: i.invitedBy.name },
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async create(
    scope: OrganizationScope,
    actorUserId: string,
    dto: CreateInvitationRequest,
    ctx: AuditContext,
  ): Promise<InvitationSummary> {
    const existingUser = await this.users.findByEmail(dto.email);
    if (existingUser) {
      const member = await this.memberships.find(scope.organizationId, existingUser.id);
      if (member) throw AppError.conflict("That person is already a member of this organization");
    }

    const inviter = await this.users.findById(actorUserId);
    const org = await this.prisma.organization.findUnique({ where: { id: scope.organizationId } });
    if (!inviter || !org) throw AppError.notFound("Organization");

    const { token, hash } = this.tokens.issueOneTimeToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.invitations.revokePendingForEmail(scope.organizationId, dto.email, tx);
      return this.invitations.create(
        {
          organizationId: scope.organizationId,
          email: dto.email,
          role: dto.role,
          tokenHash: hash,
          invitedByUserId: actorUserId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
        tx,
      );
    });

    const link = `${this.env.APP_URL}/invite/${encodeURIComponent(token)}`;
    await this.queue.enqueueMail({
      message: MailTemplates.invitation(
        dto.email,
        org.name,
        inviter.name,
        ROLE_LABELS[dto.role],
        link,
      ),
      idempotencyKey: `invite:${hash}`,
    });
    await this.audit.record(
      {
        organizationId: scope.organizationId,
        actorUserId,
        actorType: "user",
        action: "org.invitation_created",
        resourceType: "invitation",
        resourceId: invitation.id,
        after: { email: dto.email, role: dto.role },
      },
      ctx,
    );

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedBy: { id: inviter.id, name: inviter.name },
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  async revoke(
    scope: OrganizationScope,
    actorUserId: string,
    invitationId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const invitation = await this.invitations.findPendingById(scope.organizationId, invitationId);
    if (!invitation) throw AppError.notFound("Invitation");
    await this.invitations.revoke(invitation.id);
    await this.audit.record(
      {
        organizationId: scope.organizationId,
        actorUserId,
        actorType: "user",
        action: "org.invitation_revoked",
        resourceType: "invitation",
        resourceId: invitation.id,
      },
      ctx,
    );
  }

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.invitations.findLiveByTokenHash(
      this.tokens.hashOneTimeToken(token),
    );
    if (!invitation)
      throw new AppError("INVALID_TOKEN", "This invitation is invalid, expired or already used");
    return {
      organizationName: invitation.organization.name,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** The signed-in user's email must match the invitation. */
  async accept(
    token: string,
    userId: string,
    ctx: AuditContext,
  ): Promise<{ organizationId: string }> {
    const invitation = await this.invitations.findLiveByTokenHash(
      this.tokens.hashOneTimeToken(token),
    );
    if (!invitation)
      throw new AppError("INVALID_TOKEN", "This invitation is invalid, expired or already used");
    const user = await this.users.findById(userId);
    if (!user) throw new AppError("UNAUTHENTICATED");
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw AppError.forbidden("This invitation was sent to a different email address");
    }
    const existing = await this.memberships.find(invitation.organizationId, userId);
    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await this.memberships.create(
          { organizationId: invitation.organizationId, userId, role: invitation.role },
          tx,
        );
      }
      await this.invitations.accept(invitation.id, tx);
    });
    await this.audit.record(
      {
        organizationId: invitation.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "org.invitation_accepted",
        resourceType: "invitation",
        resourceId: invitation.id,
      },
      ctx,
    );
    return { organizationId: invitation.organizationId };
  }
}
