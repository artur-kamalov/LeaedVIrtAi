import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { MembershipRole } from "@leadvirt/db";
import type { ChannelType } from "@leadvirt/types";
import type { CreateChannelDto } from "./dto/create-channel.dto.js";
import type { UpdateChannelDto } from "./dto/update-channel.dto.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changesWebhookOutbound(settings: unknown) {
  if (!isRecord(settings) || !isRecord(settings.webhook)) return false;
  return Object.prototype.hasOwnProperty.call(settings.webhook, "outbound");
}

function canManageChannelCredentials(role: MembershipRole) {
  return role === "OWNER" || role === "ADMIN";
}

function assertWebhookOutboundAccess(role: MembershipRole, settings: unknown) {
  if (!changesWebhookOutbound(settings) || canManageChannelCredentials(role)) return;
  throw new ForbiddenException(
    "Only workspace owners and admins can configure outbound webhook delivery.",
  );
}

export function assertGenericChannelCreateAllowed(role: MembershipRole, dto: CreateChannelDto) {
  if (dto.type === "TELEGRAM") {
    throw new BadRequestException(
      "Connect Telegram from Integrations so its webhook is managed safely.",
    );
  }
  if (dto.type === "WEBHOOK") assertWebhookOutboundAccess(role, dto.settings);
}

export function assertGenericChannelUpdateAllowed(
  role: MembershipRole,
  type: ChannelType,
  dto: UpdateChannelDto,
) {
  if (type === "TELEGRAM" && (dto.status !== undefined || dto.settings !== undefined)) {
    throw new BadRequestException(
      "Use the Telegram integration connect or disconnect flow to change its connection.",
    );
  }
  if (type === "WEBHOOK") assertWebhookOutboundAccess(role, dto.settings);
}
