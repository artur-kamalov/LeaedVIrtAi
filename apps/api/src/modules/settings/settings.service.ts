import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { SettingsAccount } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { hashPassword } from "../auth/passwords.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";
import type { CreateApiKeyDto } from "./dto/create-api-key.dto.js";
import type { InviteTeamMemberDto } from "./dto/invite-team-member.dto.js";
import type { UpdateAccountSettingsDto } from "./dto/update-account-settings.dto.js";
import type { UpdateNotificationsDto } from "./dto/update-notifications.dto.js";
import type { UpdateTeamMemberDto } from "./dto/update-team-member.dto.js";

const defaultNotifications = {
  new_lead: true,
  no_reply: true,
  booking: true,
  daily: false,
  tg_summary: true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function apiKeyHash(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  account(context: RequestContext): SettingsAccount {
    return {
      tenant: context.tenant,
      owner: context.user,
      businessName: context.tenant.name,
      timezone: context.tenant.timezone
    };
  }

  async updateAccount(context: RequestContext, dto: UpdateAccountSettingsDto): Promise<SettingsAccount> {
    const tenant = await this.prisma.tenant.update({
      where: { id: context.tenantId },
      data: {
        name: dto.businessName ?? context.tenant.name,
        timezone: dto.timezone ?? context.tenant.timezone,
        businessType: dto.businessType ?? context.tenant.businessType
      },
      select: { id: true, name: true, slug: true, status: true, businessType: true, timezone: true }
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "settings.account_updated",
        entityType: "tenant",
        entityId: context.tenantId,
        payload: dto as Prisma.InputJsonObject
      }
    });
    return {
      tenant,
      owner: context.user,
      businessName: tenant.name,
      timezone: tenant.timezone
    };
  }

  async team(context: RequestContext) {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: context.tenantId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" }
    });
    return memberships.map((membership) => this.mapMembership(membership));
  }

  async inviteTeamMember(context: RequestContext, dto: InviteTeamMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const fallbackName = email.split("@")[0] ?? email;
    const user = await this.prisma.user.upsert({
      where: { email },
      update: dto.name ? { name: dto.name } : {},
      create: {
        email,
        name: dto.name ?? fallbackName
      }
    });

    const membership = await this.prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: user.id } },
      update: { role: dto.role },
      create: {
        tenantId: context.tenantId,
        userId: user.id,
        role: dto.role
      },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } }
    });

    await this.audit(context, "settings.team_member_invited", "membership", membership.id, {
      email,
      role: dto.role
    });
    return this.mapMembership(membership);
  }

  async updateTeamMember(context: RequestContext, membershipId: string, dto: UpdateTeamMemberDto) {
    const membership = await this.loadMembership(context.tenantId, membershipId);
    if (membership.role === "OWNER" && dto.role !== "OWNER") {
      await this.ensureAnotherOwner(context.tenantId, membership.id);
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { role: dto.role },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } }
    });

    await this.audit(context, "settings.team_member_role_updated", "membership", updated.id, {
      role: dto.role
    });
    return this.mapMembership(updated);
  }

  async removeTeamMember(context: RequestContext, membershipId: string) {
    const membership = await this.loadMembership(context.tenantId, membershipId);
    if (membership.userId === context.userId) {
      throw new BadRequestException("Нельзя удалить собственный доступ.");
    }
    if (membership.role === "OWNER") {
      await this.ensureAnotherOwner(context.tenantId, membership.id);
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });
    await this.audit(context, "settings.team_member_removed", "membership", membership.id, {
      userId: membership.userId,
      role: membership.role
    });
    return { id: membership.id, removed: true };
  }

  async resetTeamMemberPassword(context: RequestContext, membershipId: string) {
    const membership = await this.loadMembership(context.tenantId, membershipId);
    if (membership.userId === context.userId) {
      throw new BadRequestException("Для собственного аккаунта используйте смену пароля в разделе Безопасность.");
    }

    const temporaryPassword = `lv-${randomBytes(12).toString("base64url")}`;

    await this.prisma.user.update({
      where: { id: membership.userId },
      data: { passwordHash: hashPassword(temporaryPassword), passwordChangeRequired: true }
    });

    const revoked = await this.prisma.authSession.updateMany({
      where: {
        tenantId: context.tenantId,
        userId: membership.userId,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    await this.audit(context, "settings.team_member_password_reset", "membership", membership.id, {
      userId: membership.userId,
      role: membership.role,
      revokedSessions: revoked.count
    });

    return {
      membershipId: membership.id,
      userId: membership.userId,
      temporaryPassword,
      revokedSessions: revoked.count
    };
  }

  async security(context: RequestContext) {
    return {
      authMode: context.authMode,
      productionAuthReadyFor: ["Local credentials", "HTTP-only sessions"],
      tenantScoped: true,
      currentRole: context.role,
      passwordChangeRequired: context.user.passwordChangeRequired,
      twoFactor: await this.authService.twoFactorStatus(context),
      sessions: await this.authService.listSessions(context)
    };
  }

  async billing(context: RequestContext) {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { tenantId: context.tenantId, revokedAt: null },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true }
    });
    return {
      billingMode: "manual",
      apiKeys: apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString()
      }))
    };
  }

  async notifications(context: RequestContext) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { settings: true }
    });
    const settings = settingsRecord(tenant?.settings);
    const notifications = settingsRecord(settings.notifications);
    return {
      ...defaultNotifications,
      ...Object.fromEntries(
        Object.entries(notifications).filter((entry): entry is [keyof typeof defaultNotifications, boolean] => typeof entry[1] === "boolean")
      )
    };
  }

  async updateNotifications(context: RequestContext, dto: UpdateNotificationsDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { settings: true }
    });
    const currentSettings = settingsRecord(tenant?.settings);
    const currentNotifications = settingsRecord(currentSettings.notifications);
    const notifications = {
      ...defaultNotifications,
      ...currentNotifications,
      ...dto
    };

    await this.prisma.tenant.update({
      where: { id: context.tenantId },
      data: {
        settings: {
          ...currentSettings,
          notifications
        }
      }
    });
    await this.audit(context, "settings.notifications_updated", "tenant", context.tenantId, {
      notifications
    });
    return notifications;
  }

  async createApiKey(context: RequestContext, dto: CreateApiKeyDto) {
    const secret = `lv_${randomBytes(24).toString("base64url")}`;
    const keyPrefix = secret.slice(0, 10);
    const scopes = dto.scopes
      ? dto.scopes
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : ["public.widget:read", "leads:read"];

    const key = await this.prisma.apiKey.create({
      data: {
        tenantId: context.tenantId,
        name: dto.name,
        keyPrefix,
        keyHash: apiKeyHash(secret),
        scopes
      }
    });

    await this.audit(context, "settings.api_key_created", "api_key", key.id, {
      name: key.name,
      keyPrefix
    });

    return {
      ...this.mapApiKey(key),
      secret
    };
  }

  async revokeApiKey(context: RequestContext, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId: context.tenantId, revokedAt: null }
    });
    if (!key) {
      throw new NotFoundException("API key was not found.");
    }

    const revoked = await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() }
    });

    await this.audit(context, "settings.api_key_revoked", "api_key", revoked.id, {
      keyPrefix: revoked.keyPrefix
    });
    return { id: revoked.id, revoked: true };
  }

  private async loadMembership(tenantId: string, id: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id, tenantId },
      select: { id: true, tenantId: true, userId: true, role: true }
    });
    if (!membership) {
      throw new NotFoundException("Team member was not found.");
    }
    return membership;
  }

  private async ensureAnotherOwner(tenantId: string, membershipId: string) {
    const owners = await this.prisma.membership.count({
      where: {
        tenantId,
        role: "OWNER",
        id: { not: membershipId }
      }
    });
    if (owners < 1) {
      throw new BadRequestException("Нужен хотя бы один владелец workspace.");
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
      user: membership.user
    };
  }

  private mapApiKey(key: {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString()
    };
  }

  private async audit(context: RequestContext, action: string, entityType: string, entityId: string, payload: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        payload
      }
    });
  }
}
