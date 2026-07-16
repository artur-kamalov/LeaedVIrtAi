import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import {
  createAiReplyQueueEvent,
  createRuntimeQueueEvent,
  RuntimeOutboxDispatcher,
} from "@leadvirt/runtime-queue";
import type { AiReplyEnqueueRequest, ChannelSendMessageJobData } from "@leadvirt/types";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class RuntimeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly dispatcher: RuntimeOutboxDispatcher;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PrismaService) prisma: PrismaService,
  ) {
    this.dispatcher = new RuntimeOutboxDispatcher(prisma, config.redisUrl, "api.runtime-outbox.v1");
  }

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.dispatcher.drain().catch(() => undefined), 5000);
    this.timer.unref();
    void this.dispatcher.drain().catch(() => undefined);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.dispatcher.close();
  }

  async createAiReplyEvent(tx: Prisma.TransactionClient, data: AiReplyEnqueueRequest) {
    return createAiReplyQueueEvent(tx, data);
  }

  createChannelDeliveryEvent(
    tx: Prisma.TransactionClient,
    data: ChannelSendMessageJobData & { requestedByUserId?: string },
  ) {
    const jobId = `channel-send-${data.messageId}`;
    return createRuntimeQueueEvent(tx, {
      tenantId: data.tenantId,
      aggregateType: "message",
      aggregateId: data.messageId,
      aggregateVersion: 1,
      eventType: "channels.send-message.requested",
      dedupeKey: `channels.send-message:${data.messageId}:v1`,
      deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
      envelope: {
        queueName: "channels.sendMessage",
        jobName: "send-message",
        jobId,
        data: data as unknown as Record<string, unknown>,
        attempts: 3,
        backoffMs: 1000,
      },
    });
  }

  dispatch(eventId: string) {
    void this.dispatcher.dispatch(eventId).catch(() => undefined);
  }
}
