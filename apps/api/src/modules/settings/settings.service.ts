import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import type {
  ApiKeyAvailabilityErrorCode,
  LegacyApiKeyCleanupSummary,
  SettingsAccount,
} from "@leadvirt/types";
import type { MembershipRole, Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";
import { BusinessProfileService } from "../business-profile/business-profile.service.js";
import type { InviteTeamMemberDto } from "./dto/invite-team-member.dto.js";
import type { UpdateAccountSettingsDto } from "./dto/update-account-settings.dto.js";
import type { UpdateNotificationsDto } from "./dto/update-notifications.dto.js";
import type { UpdateTeamMemberDto } from "./dto/update-team-member.dto.js";

const defaultNotifications = {
  new_lead: true,
  no_reply: true,
  booking: true,
  daily: false,
  tg_summary: true,
};
const supportedUserLocales = new Set(["en", "es", "fr", "de", "pt", "ru"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export const apiKeysNotAvailableErrorCode =
  "API_KEYS_NOT_AVAILABLE" satisfies ApiKeyAvailabilityErrorCode;

function apiKeysUnavailable() {
  return new NotImplementedException({
    code: apiKeysNotAvailableErrorCode,
    message:
      "Tenant API keys are unavailable because no external API-key authentication boundary is live.",
    retryable: false,
    details: { capability: "TENANT_API_KEYS" },
  });
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(BusinessProfileService) private readonly businessProfile: BusinessProfileService,
  ) {}

  async account(context: RequestContext): Promise<SettingsAccount> {
    return this.businessProfile.getSettingsAccount(context);
  }

  async updateAccount(
    context: RequestContext,
    dto: UpdateAccountSettingsDto,
    ifMatch?: string | string[],
  ): Promise<SettingsAccount> {
    return this.businessProfile.updateSettingsAccount(context, dto, ifMatch);
  }

  async updateLocalePreference(
    context: RequestContext,
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru",
  ) {
    if (!supportedUserLocales.has(locale)) {
      throw new BadRequestException("Unsupported locale.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: context.userId }, data: { locale } });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.locale_updated",
          entityType: "user",
          entityId: context.userId,
          payload: { locale },
        },
      });
    });
    return { locale };
  }

  async team(context: RequestContext) {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: context.tenantId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((membership) => this.mapMembership(membership));
  }

  async inviteTeamMember(context: RequestContext, dto: InviteTeamMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const fallbackName = email.split("@")[0] ?? email;
    return this.withTeamMutation(context, async (tx, actor) => {
      this.assertTeamRoleBoundary(actor.role, undefined, dto.role);

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`settings:team-invite:${email}`}, 0)
        )
      `;
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          deletedAt: true,
        },
      });
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            name: dto.name?.trim() || fallbackName,
          },
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            deletedAt: true,
          },
        }));
      if (user.deletedAt) {
        throw new ConflictException("This account is not available for invitation.");
      }

      const existingMembership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: context.tenantId, userId: user.id } },
        select: { id: true },
      });
      if (existingMembership) {
        throw new ConflictException(
          "This user is already a workspace member. Use the role update action instead.",
        );
      }

      const membership = await tx.membership.create({
        data: {
          tenantId: context.tenantId,
          userId: user.id,
          role: dto.role,
        },
        include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.team_member_invited",
          entityType: "membership",
          entityId: membership.id,
          payload: { email, role: dto.role },
        },
      });

      return this.mapMembership(membership);
    });
  }

  async updateTeamMember(context: RequestContext, membershipId: string, dto: UpdateTeamMemberDto) {
    return this.withTeamMutation(context, async (tx, actor) => {
      const membership = await this.loadMembership(tx, context.tenantId, membershipId);
      this.assertTeamRoleBoundary(actor.role, membership.role, dto.role);
      if (membership.role === "OWNER" && dto.role !== "OWNER") {
        await this.ensureAnotherOwner(tx, context.tenantId, membership.id);
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: dto.role },
        include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.team_member_role_updated",
          entityType: "membership",
          entityId: updated.id,
          payload: { role: dto.role },
        },
      });

      return this.mapMembership(updated);
    });
  }

  async removeTeamMember(context: RequestContext, membershipId: string) {
    return this.withTeamMutation(context, async (tx, actor) => {
      const membership = await this.loadMembership(tx, context.tenantId, membershipId);
      this.assertTeamRoleBoundary(actor.role, membership.role);
      if (membership.userId === context.userId) {
        throw new BadRequestException("You cannot remove your own workspace access.");
      }
      if (membership.role === "OWNER") {
        await this.ensureAnotherOwner(tx, context.tenantId, membership.id);
      }

      await tx.membership.delete({ where: { id: membership.id } });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.team_member_removed",
          entityType: "membership",
          entityId: membership.id,
          payload: { userId: membership.userId, role: membership.role },
        },
      });

      return { id: membership.id, removed: true };
    });
  }

  async security(context: RequestContext) {
    return {
      authMode: context.authMode,
      productionAuthReadyFor: ["Local credentials", "HTTP-only sessions"],
      tenantScoped: true,
      currentRole: context.role,
      passwordChangeRequired: context.user.passwordChangeRequired,
      twoFactor: await this.authService.twoFactorStatus(context),
      sessions: await this.authService.listSessions(context),
    };
  }

  billing() {
    return {
      billingMode: "manual",
      apiKeys: [],
    };
  }

  async apiKeys(context: RequestContext): Promise<LegacyApiKeyCleanupSummary[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { tenantId: context.tenantId, revokedAt: null },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt.toISOString(),
      status: "INERT",
      cleanupOnly: true,
    }));
  }

  async notifications(context: RequestContext) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { settings: true },
    });
    const settings = settingsRecord(tenant?.settings);
    const notifications = settingsRecord(settings.notifications);
    return {
      ...defaultNotifications,
      ...Object.fromEntries(
        Object.entries(notifications).filter(
          (entry): entry is [keyof typeof defaultNotifications, boolean] =>
            typeof entry[1] === "boolean",
        ),
      ),
    };
  }

  async updateNotifications(context: RequestContext, dto: UpdateNotificationsDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, context.tenantId);
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: context.tenantId },
        select: { settings: true },
      });
      const currentSettings = settingsRecord(tenant.settings);
      const currentNotifications = settingsRecord(currentSettings.notifications);
      const notifications = {
        ...defaultNotifications,
        ...currentNotifications,
        ...dto,
      };

      await tx.tenant.update({
        where: { id: context.tenantId },
        data: {
          settings: {
            ...currentSettings,
            notifications,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.notifications_updated",
          entityType: "tenant",
          entityId: context.tenantId,
          payload: { notifications },
        },
      });
      return notifications;
    });
  }

  createApiKey(): never {
    throw apiKeysUnavailable();
  }

  async revokeApiKey(context: RequestContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, context.tenantId);
      const actor = await tx.membership.findUnique({
        where: {
          tenantId_userId: { tenantId: context.tenantId, userId: context.userId },
        },
        select: { role: true },
      });
      if (actor?.role !== "OWNER" && actor?.role !== "ADMIN") {
        throw new ForbiddenException(
          "Only workspace owners and admins can clean up legacy API keys.",
        );
      }

      const key = await tx.apiKey.findFirst({
        where: { id, tenantId: context.tenantId, revokedAt: null },
        select: { id: true, keyPrefix: true },
      });
      if (!key) throw new NotFoundException("API key was not found.");

      const revoked = await tx.apiKey.updateMany({
        where: { id: key.id, tenantId: context.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new NotFoundException("API key was not found.");

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "settings.api_key_revoked",
          entityType: "api_key",
          entityId: key.id,
          payload: { keyPrefix: key.keyPrefix, cleanupOnly: true },
        },
      });
      return { id: key.id, revoked: true };
    });
  }

  private async withTeamMutation<T>(
    context: RequestContext,
    operation: (
      tx: Prisma.TransactionClient,
      actor: { id: string; role: "OWNER" | "ADMIN" },
    ) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, context.tenantId);

      const actor = await tx.membership.findUnique({
        where: {
          tenantId_userId: { tenantId: context.tenantId, userId: context.userId },
        },
        select: { id: true, role: true },
      });
      const actorRole = actor?.role;
      if (!actor || (actorRole !== "OWNER" && actorRole !== "ADMIN")) {
        throw new ForbiddenException("Only workspace owners and admins can manage team members.");
      }

      return operation(tx, { id: actor.id, role: actorRole });
    });
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    const tenants = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    if (tenants.length !== 1) throw new NotFoundException("Workspace was not found.");
  }

  private assertTeamRoleBoundary(
    actorRole: "OWNER" | "ADMIN",
    targetRole?: MembershipRole,
    requestedRole?: MembershipRole,
  ) {
    if (actorRole === "ADMIN" && (targetRole === "OWNER" || requestedRole === "OWNER")) {
      throw new ForbiddenException("Workspace admins cannot grant or manage the owner role.");
    }
  }

  private async loadMembership(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const membership = await tx.membership.findFirst({
      where: { id, tenantId },
      select: { id: true, tenantId: true, userId: true, role: true },
    });
    if (!membership) {
      throw new NotFoundException("Team member was not found.");
    }
    return membership;
  }

  private async ensureAnotherOwner(
    tx: Prisma.TransactionClient,
    tenantId: string,
    membershipId: string,
  ) {
    const owners = await tx.membership.count({
      where: {
        tenantId,
        role: "OWNER",
        id: { not: membershipId },
      },
    });
    if (owners < 1) {
      throw new BadRequestException("The workspace must keep at least one owner.");
    }
  }

  private mapMembership(membership: {
    id: string;
    role: string;
    user: { id: string; email: string; name: string | null; avatarUrl?: string | null };
  }) {
    return {
      id: membership.id,
      role: membership.role,
      user: membership.user,
    };
  }

  private async audit(
    context: RequestContext,
    action: string,
    entityType: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        payload,
      },
    });
  }
}
