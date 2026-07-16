import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { automaticReplyChannelFingerprint } from "@leadvirt/runtime-queue";
import {
  decryptIntegrationCredentials,
  readWebhookOutboundConfiguration,
} from "@leadvirt/integrations";
import {
  loadKnowledgeOperationalCapabilityProjectionV1,
  lockKnowledgeCorpusTransition,
} from "@leadvirt/knowledge";
import type {
  Channel,
  ChannelAutomaticReplyReadiness,
  ChannelProvisioningResult,
  ChannelWebhookSecretRotation,
} from "@leadvirt/types";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2PublicationService } from "../knowledge/knowledge-v2-publication.service.js";
import {
  assertGenericChannelCreateAllowed,
  assertGenericChannelUpdateAllowed,
} from "./channel-mutation-policy.js";
import {
  mergeChannelSettings,
  projectChannelSettings,
  setWebhookSecret,
  webhookSecretFromSettings,
} from "./channel-settings.js";
import type { CreateChannelDto } from "./dto/create-channel.dto.js";
import type { UpdateChannelDto } from "./dto/update-channel.dto.js";
import {
  prepareWebhookOutboundStorage,
  validateConfiguredWebhookOutbound,
} from "./webhook-outbound-settings.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function publicKeyPrefix(type: CreateChannelDto["type"]) {
  if (type === "WEBSITE") return "lvw";
  if (type === "TELEGRAM") return "lvtg";
  return "lvwh";
}

function defaultName(type: CreateChannelDto["type"]) {
  if (type === "WEBSITE") return "Website widget";
  if (type === "TELEGRAM") return "Telegram";
  return "Webhook/API";
}

function endpointPath(type: CreateChannelDto["type"], publicKey: string) {
  if (type === "WEBSITE") return `/api/public/widget/${publicKey}/config`;
  if (type === "TELEGRAM") return `/api/public/channels/telegram/${publicKey}/webhook`;
  return `/api/public/channels/webhook/${publicKey}/events`;
}

function generatedSecret() {
  return randomBytes(24).toString("base64url");
}

export interface TelegramWebhookSecretStage {
  webhookSecret: string;
  previousWebhookSecret: string | null;
  previousPendingWebhookSecret: string | null;
  previousPendingBotId: string | null;
  staged: boolean;
}

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2PublicationService)
    private readonly knowledgePublications: KnowledgeV2PublicationService,
  ) {}

  async list(context: RequestContext): Promise<Channel[]> {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return channels.map((channel) => this.mapChannel(channel));
  }

  async create(context: RequestContext, dto: CreateChannelDto): Promise<ChannelProvisioningResult> {
    assertGenericChannelCreateAllowed(context.role, dto);
    const existingType = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: dto.type, deletedAt: null },
      select: { id: true },
    });
    if (existingType) {
      throw new ConflictException("Channel already exists for this workspace and type.");
    }

    const publicKey = await this.resolvePublicKey(dto.type, dto.publicKey);
    const providedSettings = isRecord(dto.settings) ? dto.settings : {};
    const defaultSettings = this.defaultSettings(dto.type, publicKey, providedSettings);
    const preparedWebhook =
      dto.type === "WEBHOOK" ? prepareWebhookOutboundStorage(defaultSettings, null) : null;
    const settings = preparedWebhook?.settings ?? defaultSettings;
    if (dto.type === "WEBHOOK") {
      validateConfiguredWebhookOutbound(settings, preparedWebhook?.credentials);
    }
    const channel = await this.prisma.channel.create({
      data: {
        tenantId: context.tenantId,
        type: dto.type,
        status: dto.status ?? "ACTIVE",
        name: dto.name?.trim() || defaultName(dto.type),
        publicKey,
        settings: settings as Prisma.InputJsonObject,
        ...(preparedWebhook?.encryptedCredentials
          ? { encryptedCredentials: preparedWebhook.encryptedCredentials }
          : {}),
      },
    });

    await Promise.all([
      this.ensureCompanionIntegration(context, dto.type, channel),
      this.prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "channel.created",
          entityType: "channel",
          entityId: channel.id,
          payload: {
            type: channel.type,
            status: channel.status,
            publicKey: channel.publicKey,
            endpointPath: endpointPath(dto.type, publicKey),
          },
        },
      }),
    ]);

    const projected = this.mapChannel(channel);
    if (channel.type !== "WEBHOOK") return projected;

    const oneTimeSecret = webhookSecretFromSettings(channel.settings);
    if (!oneTimeSecret) throw new Error("Created webhook channel has no secret.");
    return { ...projected, oneTimeSecret };
  }

  async update(context: RequestContext, id: string, dto: UpdateChannelDto): Promise<Channel> {
    const channel = await this.prisma.$transaction(async (tx) => {
      await this.lockChannelConversations(tx, context.tenantId, id);
      const current = await this.lockChannel(tx, context.tenantId, id);
      assertGenericChannelUpdateAllowed(context.role, current.type, dto);
      const currentSettings = isRecord(current.settings) ? current.settings : {};
      const mergedSettings = dto.settings
        ? mergeChannelSettings(current.type, currentSettings, dto.settings, generatedSecret)
        : currentSettings;
      const preparedWebhook =
        current.type === "WEBHOOK"
          ? prepareWebhookOutboundStorage(mergedSettings, current.encryptedCredentials)
          : null;
      const nextSettings = preparedWebhook?.settings ?? mergedSettings;
      if (current.type === "WEBHOOK") {
        validateConfiguredWebhookOutbound(nextSettings, preparedWebhook?.credentials);
      }
      const nextStatus = dto.status ?? current.status;
      const nextFingerprint = automaticReplyChannelFingerprint({
        ...current,
        status: nextStatus,
        settings: nextSettings as Prisma.JsonValue,
        ...(preparedWebhook ? { encryptedCredentials: preparedWebhook.encryptedCredentials } : {}),
      });
      const bindingChanged =
        current.automaticRepliesEnabled &&
        (nextStatus !== "ACTIVE" || nextFingerprint !== current.automaticRepliesChannelFingerprint);
      const updated = await tx.channel.update({
        where: { id: current.id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.settings || preparedWebhook
            ? { settings: nextSettings as Prisma.InputJsonObject }
            : {}),
          ...(preparedWebhook
            ? { encryptedCredentials: preparedWebhook.encryptedCredentials }
            : {}),
          ...(bindingChanged
            ? {
                automaticRepliesEnabled: false,
                automaticRepliesGeneration: { increment: 1 },
                automaticRepliesPublicationId: null,
                automaticRepliesPublicationEtag: null,
                automaticRepliesCapabilitySetHash: null,
                automaticRepliesOperationalBindingHash: null,
                automaticRepliesOperationalPermissionGeneration: null,
                automaticRepliesChannelFingerprint: null,
                automaticRepliesActivatedAt: null,
                automaticRepliesActivatedByUserId: null,
              }
            : {}),
        },
      });
      if (bindingChanged) {
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          current.id,
          false,
          "CHANNEL_CONFIGURATION_CHANGED",
        );
      }
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "channel.updated",
          entityType: "channel",
          entityId: updated.id,
          payload: {
            status: dto.status,
            name: dto.name,
            settingsKeys: dto.settings ? Object.keys(dto.settings) : [],
            automaticRepliesRevoked: bindingChanged,
          },
        },
      });
      return updated;
    });
    return this.mapChannel(channel);
  }

  async rotateWebhookSecret(
    context: RequestContext,
    id: string,
  ): Promise<ChannelWebhookSecretRotation> {
    const oneTimeSecret = generatedSecret();
    const channel = await this.prisma.$transaction(async (tx) => {
      await this.lockChannelConversations(tx, context.tenantId, id);
      const current = await this.lockChannel(tx, context.tenantId, id);
      if (current.type !== "WEBHOOK") {
        throw new BadRequestException("Only Webhook/API channels have a rotatable webhook secret.");
      }

      const updated = await tx.channel.update({
        where: { id: current.id },
        data: {
          settings: setWebhookSecret(current.settings, oneTimeSecret) as Prisma.InputJsonObject,
          ...(current.automaticRepliesEnabled
            ? {
                automaticRepliesEnabled: false,
                automaticRepliesGeneration: { increment: 1 },
                automaticRepliesPublicationId: null,
                automaticRepliesPublicationEtag: null,
                automaticRepliesCapabilitySetHash: null,
                automaticRepliesOperationalBindingHash: null,
                automaticRepliesOperationalPermissionGeneration: null,
                automaticRepliesChannelFingerprint: null,
                automaticRepliesActivatedAt: null,
                automaticRepliesActivatedByUserId: null,
              }
            : {}),
        },
      });
      if (current.automaticRepliesEnabled) {
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          current.id,
          false,
          "CHANNEL_CONFIGURATION_CHANGED",
        );
      }
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "channel.webhook_secret.rotated",
          entityType: "channel",
          entityId: current.id,
          payload: { automaticRepliesRevoked: current.automaticRepliesEnabled },
        },
      });
      return updated;
    });

    return { channel: this.mapChannel(channel), oneTimeSecret };
  }

  async getAutomaticReplyReadiness(
    context: RequestContext,
    id: string,
  ): Promise<ChannelAutomaticReplyReadiness> {
    const [channel, knowledge, pointer, selector, operationalProjection] = await Promise.all([
      this.prisma.channel.findFirst({
        where: { id, tenantId: context.tenantId, deletedAt: null },
      }),
      this.knowledgePublications.getReadiness(context),
      this.prisma.activeKnowledgePublication.findUnique({
        where: {
          tenantId_targetKey: { tenantId: context.tenantId, targetKey: "workspace-v2" },
        },
        include: {
          publication: {
            select: {
              status: true,
              corpusKind: true,
              targetKey: true,
              capabilitySetHash: true,
              operationalBindingHash: true,
              operationalPermissionGeneration: true,
            },
          },
        },
      }),
      this.prisma.knowledgeCorpusSelector.findUnique({
        where: { tenantId: context.tenantId },
        select: { corpusKind: true },
      }),
      this.prisma.$transaction((tx) =>
        loadKnowledgeOperationalCapabilityProjectionV1(tx, {
          tenantId: context.tenantId,
        }),
      ),
    ]);
    if (!channel) throw new NotFoundException("Channel was not found.");

    const blockers = this.automaticReplyChannelBlockers(channel);
    if (
      !pointer ||
      selector?.corpusKind !== "STRUCTURED_V2" ||
      pointer.publication.status !== "ACTIVE" ||
      pointer.publication.corpusKind !== "STRUCTURED_V2" ||
      pointer.publication.targetKey !== "workspace-v2" ||
      typeof pointer.publication.capabilitySetHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(pointer.publication.capabilitySetHash) ||
      typeof pointer.publication.operationalBindingHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(pointer.publication.operationalBindingHash) ||
      pointer.publication.operationalPermissionGeneration === null ||
      operationalProjection.permissionGeneration === null ||
      operationalProjection.bindingHash !== pointer.publication.operationalBindingHash ||
      operationalProjection.permissionGeneration !==
        pointer.publication.operationalPermissionGeneration ||
      knowledge.serving.status !== "READY" ||
      knowledge.activePublicationId !== pointer.publicationId
    ) {
      blockers.push({
        code: "KNOWLEDGE_PUBLICATION_NOT_READY",
        message: "Publish verified knowledge before activating automatic replies.",
      });
    }
    if (
      knowledge.serving.capabilities.some(
        (capability) => capability.enabled && capability.blockerCount > 0,
      )
    ) {
      blockers.push({
        code: "KNOWLEDGE_CAPABILITY_BLOCKED",
        message: "Complete the required knowledge before activating automatic replies.",
      });
    }

    const fingerprint = automaticReplyChannelFingerprint(channel);
    const bindingCurrent = Boolean(
      channel.automaticRepliesEnabled &&
      pointer &&
      channel.automaticRepliesPublicationId === pointer.publicationId &&
      channel.automaticRepliesPublicationEtag === pointer.etag &&
      channel.automaticRepliesCapabilitySetHash === pointer.publication.capabilitySetHash &&
      channel.automaticRepliesOperationalBindingHash ===
        pointer.publication.operationalBindingHash &&
      channel.automaticRepliesOperationalPermissionGeneration ===
        pointer.publication.operationalPermissionGeneration &&
      channel.automaticRepliesChannelFingerprint === fingerprint,
    );
    const canActivate = blockers.length === 0;
    if (channel.automaticRepliesEnabled && !bindingCurrent) {
      blockers.push({
        code: "AUTOMATIC_REPLY_BINDING_STALE",
        message: "Knowledge or channel configuration changed. Activate automatic replies again.",
      });
    }

    return {
      channelId: channel.id,
      status: bindingCurrent && canActivate ? "ACTIVE" : canActivate ? "READY" : "BLOCKED",
      enabled: bindingCurrent && canActivate,
      canActivate,
      generation: channel.automaticRepliesGeneration,
      activePublicationId: pointer?.publicationId ?? null,
      activePublicationEtag: pointer?.etag ?? null,
      activeCapabilitySetHash: pointer?.publication.capabilitySetHash ?? null,
      activatedAt: channel.automaticRepliesActivatedAt?.toISOString() ?? null,
      blockers,
    };
  }

  async activateAutomaticReplies(
    context: RequestContext,
    id: string,
  ): Promise<ChannelAutomaticReplyReadiness> {
    const readiness = await this.getAutomaticReplyReadiness(context, id);
    if (
      !readiness.canActivate ||
      !readiness.activePublicationId ||
      !readiness.activePublicationEtag ||
      !readiness.activeCapabilitySetHash
    ) {
      throw new ConflictException({
        code: "AUTOMATIC_REPLIES_NOT_READY",
        message: "Automatic replies cannot be activated yet.",
        blockers: readiness.blockers,
      });
    }

    await this.prisma.$transaction(
      async (tx) => {
        await lockKnowledgeCorpusTransition(tx, context.tenantId);
        await this.lockChannelConversations(tx, context.tenantId, id);
        const channel = await this.lockChannel(tx, context.tenantId, id);
        const selector = await this.lockKnowledgeCorpusSelector(tx, context.tenantId);
        const pointer = await this.lockStructuredPublicationPointer(tx, context.tenantId);
        const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(tx, {
          tenantId: context.tenantId,
          lock: true,
        });
        if (
          selector !== "STRUCTURED_V2" ||
          !pointer ||
          pointer.publicationId !== readiness.activePublicationId ||
          pointer.etag !== readiness.activePublicationEtag ||
          pointer.publication.capabilitySetHash !== readiness.activeCapabilitySetHash ||
          pointer.publication.status !== "ACTIVE" ||
          pointer.publication.corpusKind !== "STRUCTURED_V2" ||
          pointer.publication.targetKey !== "workspace-v2" ||
          operationalProjection.permissionGeneration === null ||
          pointer.publication.operationalBindingHash !== operationalProjection.bindingHash ||
          pointer.publication.operationalPermissionGeneration !==
            operationalProjection.permissionGeneration
        ) {
          throw new ConflictException({
            code: "AUTOMATIC_REPLIES_READINESS_CHANGED",
            message: "Knowledge changed while automatic replies were being activated.",
          });
        }
        await this.knowledgePublications.assertAutomaticReplyServingReady(tx, {
          tenantId: context.tenantId,
          publicationId: pointer.publicationId,
        });
        const channelBlockers = this.automaticReplyChannelBlockers(channel);
        if (channelBlockers.length > 0) {
          throw new ConflictException({
            code: "AUTOMATIC_REPLIES_READINESS_CHANGED",
            message: "Channel readiness changed while automatic replies were being activated.",
            blockers: channelBlockers,
          });
        }

        const fingerprint = automaticReplyChannelFingerprint(channel);
        await tx.channel.update({
          where: { id: channel.id },
          data: {
            automaticRepliesEnabled: true,
            automaticRepliesGeneration: { increment: 1 },
            automaticRepliesPublicationId: pointer.publicationId,
            automaticRepliesPublicationEtag: pointer.etag,
            automaticRepliesCapabilitySetHash: pointer.publication.capabilitySetHash,
            automaticRepliesOperationalBindingHash: pointer.publication.operationalBindingHash,
            automaticRepliesOperationalPermissionGeneration:
              pointer.publication.operationalPermissionGeneration,
            automaticRepliesChannelFingerprint: fingerprint,
            automaticRepliesActivatedAt: new Date(),
            automaticRepliesActivatedByUserId: context.userId,
          },
        });
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          channel.id,
          true,
          "ACTIVATED",
        );
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "channel.automatic_replies.activated",
            entityType: "channel",
            entityId: channel.id,
            payload: {
              publicationId: pointer.publicationId,
              publicationEtag: pointer.etag,
              capabilitySetHash: pointer.publication.capabilitySetHash,
              operationalBindingHash: pointer.publication.operationalBindingHash,
              operationalPermissionGeneration: pointer.publication.operationalPermissionGeneration,
              channelFingerprint: fingerprint,
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getAutomaticReplyReadiness(context, id);
  }

  async deactivateAutomaticReplies(
    context: RequestContext,
    id: string,
  ): Promise<ChannelAutomaticReplyReadiness> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockChannelConversations(tx, context.tenantId, id);
        const channel = await this.lockChannel(tx, context.tenantId, id);
        if (!channel.automaticRepliesEnabled) return;
        await tx.channel.update({
          where: { id: channel.id },
          data: {
            automaticRepliesEnabled: false,
            automaticRepliesGeneration: { increment: 1 },
            automaticRepliesPublicationId: null,
            automaticRepliesPublicationEtag: null,
            automaticRepliesCapabilitySetHash: null,
            automaticRepliesOperationalBindingHash: null,
            automaticRepliesOperationalPermissionGeneration: null,
            automaticRepliesChannelFingerprint: null,
            automaticRepliesActivatedAt: null,
            automaticRepliesActivatedByUserId: null,
          },
        });
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          channel.id,
          false,
          "DEACTIVATED",
        );
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "channel.automatic_replies.deactivated",
            entityType: "channel",
            entityId: channel.id,
            payload: { previousGeneration: channel.automaticRepliesGeneration },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getAutomaticReplyReadiness(context, id);
  }

  async prepareTelegramChannel(
    context: RequestContext,
    options: { rotateWebhookSecret?: boolean } = {},
  ) {
    const existing = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null },
    });
    if (existing?.publicKey) {
      const settings = isRecord(existing.settings) ? existing.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const pendingWebhookSecret =
        typeof telegram.webhookPendingSecret === "string" && telegram.webhookPendingSecret.trim()
          ? telegram.webhookPendingSecret.trim()
          : undefined;
      const activeWebhookSecret =
        typeof telegram.webhookSecret === "string" && telegram.webhookSecret.trim()
          ? telegram.webhookSecret.trim()
          : undefined;
      const webhookSecret =
        !options.rotateWebhookSecret && activeWebhookSecret
          ? activeWebhookSecret
          : !options.rotateWebhookSecret && pendingWebhookSecret
            ? pendingWebhookSecret
            : generatedSecret();
      return {
        id: existing.id,
        publicKey: existing.publicKey,
        webhookSecret,
        encryptedCredentials: existing.encryptedCredentials,
      };
    }

    const publicKey = await this.resolvePublicKey("TELEGRAM", undefined);
    const settings = this.defaultSettings("TELEGRAM", publicKey, {});
    const telegram = asRecord(asRecord(settings).telegram);
    const webhookSecret = String(telegram.webhookSecret);
    const channel = await this.prisma.channel.create({
      data: {
        tenantId: context.tenantId,
        type: "TELEGRAM",
        status: "PENDING",
        name: "Telegram",
        publicKey,
        settings: settings as Prisma.InputJsonObject,
      },
    });
    return { id: channel.id, publicKey, webhookSecret, encryptedCredentials: null };
  }

  async stageTelegramWebhookSecret(
    context: RequestContext,
    input: {
      channelId: string;
      candidateSecret: string;
      candidateBotId: string;
      expectedEncryptedCredentials: string | null;
    },
  ): Promise<TelegramWebhookSecretStage> {
    return this.prisma.$transaction(async (tx) => {
      const channel = await this.lockTelegramChannel(tx, context, input.channelId);
      if (channel.encryptedCredentials !== input.expectedEncryptedCredentials) {
        throw new ConflictException("Telegram connection changed. Try connecting the bot again.");
      }

      const candidateSecret = input.candidateSecret.trim();
      if (!candidateSecret) throw new BadRequestException("Telegram webhook secret is required.");
      const candidateBotId = input.candidateBotId.trim();
      if (!/^[1-9]\d*$/u.test(candidateBotId)) {
        throw new BadRequestException("Telegram bot identity is invalid.");
      }
      const settings = isRecord(channel.settings) ? channel.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const activeSecret =
        typeof telegram.webhookSecret === "string" && telegram.webhookSecret.trim()
          ? telegram.webhookSecret.trim()
          : null;
      const pendingSecret =
        typeof telegram.webhookPendingSecret === "string" && telegram.webhookPendingSecret.trim()
          ? telegram.webhookPendingSecret.trim()
          : null;
      const pendingBotId =
        typeof telegram.webhookPendingBotId === "string" && telegram.webhookPendingBotId.trim()
          ? telegram.webhookPendingBotId.trim()
          : null;
      if (
        candidateSecret === activeSecret &&
        !pendingSecret &&
        (!channel.externalId || channel.externalId === candidateBotId)
      ) {
        return {
          webhookSecret: candidateSecret,
          previousWebhookSecret: activeSecret,
          previousPendingWebhookSecret: pendingSecret,
          previousPendingBotId: pendingBotId,
          staged: false,
        };
      }
      if (candidateSecret !== pendingSecret || candidateBotId !== pendingBotId) {
        await tx.channel.update({
          where: { id: channel.id },
          data: {
            settings: {
              ...settings,
              telegram: {
                ...telegram,
                webhookPublicKey: channel.publicKey,
                webhookPendingSecret: candidateSecret,
                webhookPendingBotId: candidateBotId,
              },
            },
          },
        });
      }
      return {
        webhookSecret: candidateSecret,
        previousWebhookSecret: activeSecret,
        previousPendingWebhookSecret: pendingSecret,
        previousPendingBotId: pendingBotId,
        staged: true,
      };
    });
  }

  async rollbackTelegramWebhookSecret(
    context: RequestContext,
    input: {
      channelId: string;
      candidateSecret: string;
      expectedEncryptedCredentials: string | null;
      previousPendingWebhookSecret: string | null;
      previousPendingBotId: string | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const channel = await this.lockTelegramChannel(tx, context, input.channelId);
      if (channel.encryptedCredentials !== input.expectedEncryptedCredentials) return false;
      const settings = isRecord(channel.settings) ? channel.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      if (telegram.webhookPendingSecret !== input.candidateSecret) return false;
      const telegramWithoutPending = { ...telegram };
      if (input.previousPendingWebhookSecret) {
        telegramWithoutPending.webhookPendingSecret = input.previousPendingWebhookSecret;
      } else {
        delete telegramWithoutPending.webhookPendingSecret;
      }
      if (input.previousPendingBotId) {
        telegramWithoutPending.webhookPendingBotId = input.previousPendingBotId;
      } else {
        delete telegramWithoutPending.webhookPendingBotId;
      }
      await tx.channel.update({
        where: { id: channel.id },
        data: {
          settings: {
            ...settings,
            telegram: telegramWithoutPending,
          },
        },
      });
      return true;
    });
  }

  async finalizeTelegramWebhookSecret(
    context: RequestContext,
    input: {
      channelId: string;
      candidateSecret: string;
      botId: string;
      expectedEncryptedCredentials: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const channel = await this.lockTelegramChannel(tx, context, input.channelId);
      if (channel.encryptedCredentials !== input.expectedEncryptedCredentials) {
        throw new ConflictException("Telegram connection changed. Run the connection check again.");
      }
      const settings = isRecord(channel.settings) ? channel.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const pendingSecret =
        typeof telegram.webhookPendingSecret === "string"
          ? telegram.webhookPendingSecret.trim()
          : "";
      const activeSecret =
        typeof telegram.webhookSecret === "string" ? telegram.webhookSecret.trim() : "";
      const pendingBotId =
        typeof telegram.webhookPendingBotId === "string" ? telegram.webhookPendingBotId.trim() : "";
      if (pendingSecret !== input.candidateSecret && activeSecret !== input.candidateSecret) {
        throw new ConflictException(
          "Telegram webhook secret changed. Run the connection check again.",
        );
      }
      if (pendingSecret === input.candidateSecret && pendingBotId !== input.botId) {
        throw new ConflictException(
          "Telegram webhook identity changed. Run the connection check again.",
        );
      }
      const telegramWithoutPending = { ...telegram };
      delete telegramWithoutPending.webhookPendingSecret;
      delete telegramWithoutPending.webhookPendingBotId;
      await tx.channel.update({
        where: { id: channel.id },
        data: {
          settings: {
            ...settings,
            telegram: {
              ...telegramWithoutPending,
              webhookPublicKey: channel.publicKey,
              webhookSecret: input.candidateSecret,
            },
          },
        },
      });
    });
  }

  async ensureTelegramWebhookSecret(
    context: RequestContext,
    input: { channelId: string; candidateSecret: string; expectedEncryptedCredentials: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Channel"
        WHERE "id" = ${input.channelId}
          AND "tenantId" = ${context.tenantId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException("Telegram channel was not found.");

      const channel = await tx.channel.findFirst({
        where: {
          id: input.channelId,
          tenantId: context.tenantId,
          type: "TELEGRAM",
          deletedAt: null,
        },
      });
      if (!channel) throw new NotFoundException("Telegram channel was not found.");
      if (channel.encryptedCredentials !== input.expectedEncryptedCredentials) {
        throw new ConflictException("Telegram connection changed. Run the connection check again.");
      }

      const settings = isRecord(channel.settings) ? channel.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const existingSecret =
        typeof telegram.webhookSecret === "string" && telegram.webhookSecret.trim()
          ? telegram.webhookSecret.trim()
          : undefined;
      if (existingSecret) return existingSecret;

      const candidateSecret = input.candidateSecret.trim();
      if (!candidateSecret) throw new BadRequestException("Telegram webhook secret is required.");
      await tx.channel.update({
        where: { id: channel.id },
        data: {
          settings: {
            ...settings,
            telegram: {
              ...telegram,
              webhookPublicKey: channel.publicKey,
              webhookSecret: candidateSecret,
            },
          },
        },
      });
      return candidateSecret;
    });
  }

  async activateTelegramChannel(
    context: RequestContext,
    input: {
      channelId: string;
      botId: number;
      botUsername: string;
      encryptedCredentials: string;
      expectedEncryptedCredentials: string | null;
      webhookSecret: string;
      retainPreviousBotWebhookCleanup: boolean;
    },
  ) {
    const channel = await this.prisma.$transaction(async (tx) => {
      await this.lockChannelConversations(tx, context.tenantId, input.channelId);
      const current = await this.lockTelegramChannel(tx, context, input.channelId);
      if (current.encryptedCredentials !== input.expectedEncryptedCredentials) {
        throw new ConflictException("Telegram connection changed. Try connecting the bot again.");
      }
      const settings = isRecord(current.settings) ? current.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const activeSecret =
        typeof telegram.webhookSecret === "string" ? telegram.webhookSecret.trim() : "";
      const pendingSecret =
        typeof telegram.webhookPendingSecret === "string"
          ? telegram.webhookPendingSecret.trim()
          : "";
      const pendingBotId =
        typeof telegram.webhookPendingBotId === "string" ? telegram.webhookPendingBotId.trim() : "";
      if (activeSecret !== input.webhookSecret && pendingSecret !== input.webhookSecret) {
        throw new ConflictException(
          "Telegram webhook secret changed. Try connecting the bot again.",
        );
      }
      if (input.retainPreviousBotWebhookCleanup) {
        if (
          !pendingSecret ||
          pendingSecret !== input.webhookSecret ||
          pendingBotId !== String(input.botId) ||
          pendingSecret === activeSecret
        ) {
          throw new ConflictException(
            "Telegram bot replacement identity changed. Try connecting the bot again.",
          );
        }
      }
      const telegramWithoutPending = { ...telegram };
      delete telegramWithoutPending.webhookPendingSecret;
      delete telegramWithoutPending.webhookPendingBotId;
      if (
        input.retainPreviousBotWebhookCleanup &&
        (typeof telegramWithoutPending.retiredBotEncryptedCredentials === "string" ||
          typeof telegramWithoutPending.retiredBotWebhookSecret === "string" ||
          typeof telegramWithoutPending.retiredBotId === "string")
      ) {
        throw new ConflictException(
          "Previous Telegram bot cleanup is still pending. Run the connection check again.",
        );
      }
      if (input.retainPreviousBotWebhookCleanup && current.encryptedCredentials) {
        telegramWithoutPending.retiredBotEncryptedCredentials = current.encryptedCredentials;
        if (activeSecret) telegramWithoutPending.retiredBotWebhookSecret = activeSecret;
        if (current.externalId) telegramWithoutPending.retiredBotId = current.externalId;
      }
      const updated = await tx.channel.update({
        where: { id: current.id },
        data: {
          status: "ACTIVE",
          name: `@${input.botUsername}`,
          externalId: String(input.botId),
          encryptedCredentials: input.encryptedCredentials,
          lastHealthAt: new Date(),
          settings: {
            ...settings,
            telegram: {
              ...telegramWithoutPending,
              webhookPublicKey: current.publicKey,
              webhookSecret: input.webhookSecret,
              botId: String(input.botId),
              botUsername: input.botUsername,
              webhookConfigured: true,
              autoReply: false,
            },
          },
          ...(current.automaticRepliesEnabled
            ? {
                automaticRepliesEnabled: false,
                automaticRepliesGeneration: { increment: 1 },
                automaticRepliesPublicationId: null,
                automaticRepliesPublicationEtag: null,
                automaticRepliesCapabilitySetHash: null,
                automaticRepliesOperationalBindingHash: null,
                automaticRepliesOperationalPermissionGeneration: null,
                automaticRepliesChannelFingerprint: null,
                automaticRepliesActivatedAt: null,
                automaticRepliesActivatedByUserId: null,
              }
            : {}),
        },
      });
      if (current.automaticRepliesEnabled) {
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          current.id,
          false,
          "TELEGRAM_CONNECTION_CHANGED",
        );
      }
      return updated;
    });
    await this.ensureCompanionIntegration(context, "TELEGRAM", channel);
    return this.mapChannel(channel);
  }

  async clearTelegramRetiredBotWebhook(
    context: RequestContext,
    input: {
      channelId: string;
      retiredEncryptedCredentials: string;
      expectedEncryptedCredentials: string | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const channel = await this.lockTelegramChannel(tx, context, input.channelId);
      if (channel.encryptedCredentials !== input.expectedEncryptedCredentials) return false;
      const settings = isRecord(channel.settings) ? channel.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      if (telegram.retiredBotEncryptedCredentials !== input.retiredEncryptedCredentials) {
        return false;
      }
      const telegramWithoutRetiredBot = { ...telegram };
      delete telegramWithoutRetiredBot.retiredBotEncryptedCredentials;
      delete telegramWithoutRetiredBot.retiredBotWebhookSecret;
      delete telegramWithoutRetiredBot.retiredBotId;
      await tx.channel.update({
        where: { id: channel.id },
        data: {
          settings: {
            ...settings,
            telegram: telegramWithoutRetiredBot,
          },
        },
      });
      return true;
    });
  }

  private async lockTelegramChannel(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    channelId: string,
  ) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Channel"
      WHERE "id" = ${channelId}
        AND "tenantId" = ${context.tenantId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new NotFoundException("Telegram channel was not found.");
    const channel = await tx.channel.findFirst({
      where: {
        id: channelId,
        tenantId: context.tenantId,
        type: "TELEGRAM",
        deletedAt: null,
      },
    });
    if (!channel?.publicKey) throw new NotFoundException("Telegram channel was not found.");
    return channel;
  }

  async disableTelegramChannel(context: RequestContext) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const found = await tx.channel.findFirst({
        where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null },
        select: { id: true },
      });
      if (!found) return null;
      await this.lockChannelConversations(tx, context.tenantId, found.id);
      const channel = await this.lockChannel(tx, context.tenantId, found.id);
      const result = await tx.channel.update({
        where: { id: channel.id },
        data: {
          status: "DISABLED",
          ...(channel.automaticRepliesEnabled
            ? {
                automaticRepliesEnabled: false,
                automaticRepliesGeneration: { increment: 1 },
                automaticRepliesPublicationId: null,
                automaticRepliesPublicationEtag: null,
                automaticRepliesCapabilitySetHash: null,
                automaticRepliesOperationalBindingHash: null,
                automaticRepliesOperationalPermissionGeneration: null,
                automaticRepliesChannelFingerprint: null,
                automaticRepliesActivatedAt: null,
                automaticRepliesActivatedByUserId: null,
              }
            : {}),
        },
      });
      if (channel.automaticRepliesEnabled) {
        await this.fenceChannelAutomaticReplies(
          tx,
          context.tenantId,
          channel.id,
          false,
          "CHANNEL_DISABLED",
        );
      }
      return result;
    });
    if (!updated) return null;
    return this.mapChannel(updated);
  }

  private automaticReplyChannelBlockers(
    channel: Prisma.ChannelGetPayload<object>,
  ): ChannelAutomaticReplyReadiness["blockers"] {
    const blockers: ChannelAutomaticReplyReadiness["blockers"] = [];
    if (channel.status !== "ACTIVE") {
      blockers.push({
        code: "CHANNEL_NOT_ACTIVE",
        message: "Connect and activate the channel first.",
      });
    }
    if (!channel.publicKey) {
      blockers.push({
        code: "CHANNEL_PUBLIC_KEY_MISSING",
        message: "Finish the channel connection before activating automatic replies.",
      });
    }

    if (channel.type === "TELEGRAM") {
      const telegram = asRecord(asRecord(channel.settings).telegram);
      if (
        !channel.encryptedCredentials ||
        !channel.externalId ||
        telegram.webhookConfigured !== true ||
        typeof telegram.webhookSecret !== "string" ||
        !telegram.webhookSecret.trim() ||
        typeof telegram.webhookPendingSecret === "string" ||
        typeof telegram.retiredBotEncryptedCredentials === "string" ||
        typeof telegram.retiredBotWebhookSecret === "string" ||
        typeof telegram.retiredBotId === "string" ||
        !channel.lastHealthAt
      ) {
        blockers.push({
          code: "TELEGRAM_CONNECTION_NOT_VERIFIED",
          message: "Run the Telegram connection check first.",
        });
      }
    } else if (channel.type === "WEBHOOK") {
      const webhook = asRecord(asRecord(channel.settings).webhook);
      if (typeof webhook.secret !== "string" || !webhook.secret.trim()) {
        blockers.push({
          code: "WEBHOOK_SECRET_MISSING",
          message: "Finish the webhook setup first.",
        });
      }
      try {
        readWebhookOutboundConfiguration(
          channel.settings,
          channel.encryptedCredentials
            ? decryptIntegrationCredentials(channel.encryptedCredentials)
            : undefined,
        );
      } catch {
        blockers.push({
          code: "WEBHOOK_OUTBOUND_TARGET_INVALID",
          message: "Configure a valid outbound HTTPS target before activating automatic replies.",
        });
      }
    } else if (channel.type !== "WEBSITE") {
      blockers.push({
        code: "CHANNEL_AUTOMATION_UNSUPPORTED",
        message: "Automatic replies are not supported for this channel yet.",
      });
    }
    return blockers;
  }

  private async lockChannelConversations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    channelId: string,
  ) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Conversation"
      WHERE "tenantId" = ${tenantId}
        AND "channelId" = ${channelId}
        AND "deletedAt" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async lockChannel(tx: Prisma.TransactionClient, tenantId: string, channelId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Channel"
      WHERE "id" = ${channelId}
        AND "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new NotFoundException("Channel was not found.");
    return tx.channel.findFirstOrThrow({
      where: { id: channelId, tenantId, deletedAt: null },
    });
  }

  private async lockStructuredPublicationPointer(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "tenantId"
      FROM "ActiveKnowledgePublication"
      WHERE "tenantId" = ${tenantId}
        AND "targetKey" = 'workspace-v2'
      FOR SHARE
    `);
    return tx.activeKnowledgePublication.findUnique({
      where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
      include: {
        publication: {
          select: {
            status: true,
            corpusKind: true,
            targetKey: true,
            capabilitySetHash: true,
            operationalBindingHash: true,
            operationalPermissionGeneration: true,
          },
        },
      },
    });
  }

  private async lockKnowledgeCorpusSelector(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ corpusKind: string }>>(Prisma.sql`
      SELECT "corpusKind"::text AS "corpusKind"
      FROM "KnowledgeCorpusSelector"
      WHERE "tenantId" = ${tenantId}
      FOR SHARE
    `);
    return rows[0]?.corpusKind ?? null;
  }

  private async fenceChannelAutomaticReplies(
    tx: Prisma.TransactionClient,
    tenantId: string,
    channelId: string,
    enabled: boolean,
    reason: string,
  ) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "RuntimeOutbox"
      SET
        "status" = 'DEAD_LETTER',
        "lastErrorCode" = ${`AUTOMATIC_REPLIES_${reason}`},
        "lastErrorMessage" = NULL,
        "lockedAt" = NULL,
        "lockExpiresAt" = NULL,
        "lockedBy" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = ${tenantId}
        AND "eventType" = 'ai.reply.requested'
        AND "status" IN ('PENDING', 'PUBLISHING', 'FAILED')
        AND "aggregateId" IN (
          SELECT run."inboundMessageId"
          FROM "AiReplyRun" run
          INNER JOIN "Conversation" conversation
            ON conversation."tenantId" = run."tenantId"
           AND conversation."id" = run."conversationId"
          WHERE run."tenantId" = ${tenantId}
            AND conversation."channelId" = ${channelId}
        )
    `);
    await tx.aiReplyRun.updateMany({
      where: {
        tenantId,
        conversation: { channelId },
        status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"] },
      },
      data: {
        status: "SUPERSEDED",
        errorCode: `AUTOMATIC_REPLIES_${reason}`,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET
        "aiEnabled" = CASE
          WHEN ${enabled}
            AND "status" = 'OPEN'
            AND "handoffRequested" = false
          THEN true
          ELSE false
        END,
        "aiGeneration" = "aiGeneration" + 1,
        "aiReplySequence" = "aiReplySequence" + 1,
        "aiReplyFence" = "aiReplySequence" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = ${tenantId}
        AND "channelId" = ${channelId}
        AND "deletedAt" IS NULL
    `);
  }

  private async resolvePublicKey(
    type: CreateChannelDto["type"],
    requestedPublicKey: string | undefined,
  ) {
    if (requestedPublicKey) {
      const publicKey = requestedPublicKey.trim();
      if (publicKey.toLowerCase().startsWith("demo-")) {
        throw new BadRequestException("New workspace channels must not use demo public keys.");
      }
      const existing = await this.prisma.channel.findUnique({
        where: { publicKey },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Channel public key is already in use.");
      return publicKey;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const publicKey = `${publicKeyPrefix(type)}_${randomBytes(8).toString("hex")}`;
      const existing = await this.prisma.channel.findUnique({
        where: { publicKey },
        select: { id: true },
      });
      if (!existing) return publicKey;
    }

    throw new ConflictException("Could not generate a unique channel public key.");
  }

  private defaultSettings(
    type: CreateChannelDto["type"],
    publicKey: string,
    providedSettings: Record<string, unknown>,
  ) {
    if (type === "WEBSITE") {
      const widget = isRecord(providedSettings.widget) ? providedSettings.widget : {};
      return {
        ...providedSettings,
        widget: {
          title: "LeadVirt.ai",
          subtitle: "AI administrator",
          welcomeMessage:
            "Hello! I am the LeadVirt.ai AI administrator. I can answer questions and pass context to the team.",
          primaryColor: "#34d399",
          accentColor: "#10b981",
          position: "bottom-right",
          locale: "ru-RU",
          suggestedReplies: ["Book a demo", "How much does it cost?", "Call a manager"],
          poweredBy: "LeadVirt.ai",
          ...widget,
        },
      };
    }

    if (type === "TELEGRAM") {
      return mergeChannelSettings(
        type,
        {
          telegram: {
            webhookPublicKey: publicKey,
            autoReply: false,
          },
        },
        providedSettings,
        generatedSecret,
      );
    }

    return mergeChannelSettings(
      type,
      {
        webhook: {
          publicKey,
          autoReply: false,
          acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
        },
      },
      providedSettings,
      generatedSecret,
    );
  }

  private async ensureCompanionIntegration(
    context: RequestContext,
    type: CreateChannelDto["type"],
    channel: { id: string; publicKey: string | null },
  ) {
    if (type === "WEBSITE") return;

    const provider = type === "TELEGRAM" ? "TELEGRAM" : "WEBHOOK_API";
    const name = type === "TELEGRAM" ? "Telegram" : "Webhook/API";
    const category = type === "TELEGRAM" ? "Channel" : "Developers";
    const publicKey = channel.publicKey ?? "";
    const now = new Date();

    await this.prisma.integrationAccount.upsert({
      where: { tenantId_provider: { tenantId: context.tenantId, provider } },
      create: {
        tenantId: context.tenantId,
        provider,
        name,
        category,
        status: "CONNECTED",
        connectedAt: now,
        lastSyncAt: now,
        scopes: ["read", "write"],
        settings: {
          syncDirection: "inbound",
          publicKey,
          endpoint: endpointPath(type, publicKey),
          channelId: channel.id,
        },
      },
      update: {
        status: "CONNECTED",
        connectedAt: now,
        lastSyncAt: now,
        settings: {
          syncDirection: "inbound",
          publicKey,
          endpoint: endpointPath(type, publicKey),
          channelId: channel.id,
        },
      },
    });
  }

  private mapChannel(channel: {
    id: string;
    tenantId: string;
    type: Channel["type"];
    status: Channel["status"];
    name: string;
    publicKey: string | null;
    settings: Prisma.JsonValue | null;
    lastHealthAt: Date | null;
    automaticRepliesEnabled: boolean;
    automaticRepliesGeneration: number;
    automaticRepliesPublicationId: string | null;
    automaticRepliesPublicationEtag: number | null;
    automaticRepliesCapabilitySetHash: string | null;
    automaticRepliesOperationalBindingHash: string | null;
    automaticRepliesOperationalPermissionGeneration: number | null;
    automaticRepliesActivatedAt: Date | null;
  }): Channel {
    return {
      id: channel.id,
      tenantId: channel.tenantId,
      type: channel.type,
      status: channel.status,
      name: channel.name,
      publicKey: channel.publicKey,
      settings: projectChannelSettings(channel.type, channel.settings),
      lastHealthAt: channel.lastHealthAt?.toISOString() ?? null,
      automaticRepliesEnabled: channel.automaticRepliesEnabled,
      automaticRepliesGeneration: channel.automaticRepliesGeneration,
      automaticRepliesPublicationId: channel.automaticRepliesPublicationId,
      automaticRepliesPublicationEtag: channel.automaticRepliesPublicationEtag,
      automaticRepliesCapabilitySetHash: channel.automaticRepliesCapabilitySetHash,
      automaticRepliesOperationalBindingHash: channel.automaticRepliesOperationalBindingHash,
      automaticRepliesOperationalPermissionGeneration:
        channel.automaticRepliesOperationalPermissionGeneration,
      automaticRepliesActivatedAt: channel.automaticRepliesActivatedAt?.toISOString() ?? null,
    };
  }
}
