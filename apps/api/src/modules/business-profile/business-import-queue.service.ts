import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@leadvirt/db";
import {
  createRuntimeQueueEvent,
  RuntimeOutboxDispatcher,
  type BusinessInformationRevisionProjectionJobData,
  type BusinessImportParseJobData,
} from "@leadvirt/runtime-queue";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class BusinessImportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly dispatcher: RuntimeOutboxDispatcher;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PrismaService) prisma: PrismaService,
  ) {
    this.dispatcher = new RuntimeOutboxDispatcher(
      prisma,
      config.redisUrl,
      "api.business-import-outbox.v1",
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

  createParseEvent(tx: Prisma.TransactionClient, data: BusinessImportParseJobData) {
    const jobId = `business-import:${data.importId}:${data.generation}`;
    return createRuntimeQueueEvent(tx, {
      tenantId: data.tenantId,
      aggregateType: "business-import",
      aggregateId: data.importId,
      aggregateVersion: data.generation,
      generation: data.generation,
      eventType: "business.import.parse.requested",
      dedupeKey: jobId,
      deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
      envelope: {
        queueName: "business.import",
        jobName: "parse",
        jobId,
        data: data as unknown as Record<string, unknown>,
        attempts: 5,
        backoffMs: 2_000,
      },
    });
  }

  createRevisionProjectionEvent(
    tx: Prisma.TransactionClient,
    data: BusinessInformationRevisionProjectionJobData,
    traceId?: string | null,
  ) {
    const jobId = `business-information-project:${data.businessRevisionId}:${data.businessRevision}`;
    return createRuntimeQueueEvent(tx, {
      tenantId: data.tenantId,
      aggregateType: "BusinessInformationRevision",
      aggregateId: data.businessRevisionId,
      aggregateVersion: data.businessRevision,
      generation: data.generation,
      eventType: "business.information.project.requested",
      dedupeKey: jobId,
      deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
      ...(traceId !== undefined ? { traceId } : {}),
      envelope: {
        queueName: "business.import",
        jobName: "project-revision",
        jobId,
        data: data as unknown as Record<string, unknown>,
        attempts: 10,
        backoffMs: 2_000,
      },
    });
  }

  dispatch(eventId: string) {
    void this.dispatcher.dispatch(eventId).catch(() => undefined);
  }
}
