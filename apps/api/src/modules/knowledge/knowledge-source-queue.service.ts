import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import {
  createRuntimeQueueEvent,
  RuntimeOutboxDispatcher,
  type KnowledgeSourceJobData,
} from "@leadvirt/runtime-queue";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class KnowledgeSourceQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly dispatcher: RuntimeOutboxDispatcher;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PrismaService) prisma: PrismaService,
  ) {
    this.dispatcher = new RuntimeOutboxDispatcher(
      prisma,
      config.redisUrl,
      "api.knowledge-source-outbox.v1",
    );
  }

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.dispatcher.drain().catch(() => undefined), 5_000);
    this.timer.unref();
    void this.dispatcher.drain().catch(() => undefined);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.dispatcher.close();
  }

  createEvent(tx: Prisma.TransactionClient, data: KnowledgeSourceJobData) {
    const eventType = `knowledge.source.${data.operation.toLowerCase()}.requested`;
    return createRuntimeQueueEvent(tx, {
      tenantId: data.tenantId,
      aggregateType: "knowledge-source",
      aggregateId: data.sourceId,
      aggregateVersion: data.generation,
      generation: data.generation,
      eventType,
      dedupeKey: `${eventType}:${data.sourceId}:${data.generation}`,
      deadlineAt: new Date(
        Date.now() + (data.operation === "DELETE" ? 24 * 60 * 60_000 : 30 * 60_000),
      ),
      envelope: {
        queueName: "knowledge.ingest",
        jobName: data.operation.toLowerCase(),
        jobId: `knowledge-source:${data.knowledgeJobId}`,
        data: data as unknown as Record<string, unknown>,
        attempts: 5,
        backoffMs: 2_000,
      },
    });
  }

  dispatch(eventId: string) {
    void this.dispatcher.dispatch(eventId).catch(() => undefined);
  }
}
