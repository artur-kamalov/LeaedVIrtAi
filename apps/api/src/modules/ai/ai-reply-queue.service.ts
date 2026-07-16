import { Inject, Injectable } from "@nestjs/common";
import { SpanKind, withSpan } from "@leadvirt/observability";
import type { Prisma } from "@leadvirt/db";
import {
  automaticReplyAdmissionState,
  type AiReplyQueueEventRejectionReason,
  type AutomaticReplyAdmissionResult,
} from "@leadvirt/runtime-queue";
import type { AiReplyEnqueueRequest } from "@leadvirt/types";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { RuntimeQueueService } from "./runtime-queue.service.js";

export type AiReplyQueueReason = AiReplyQueueEventRejectionReason;

export type AiReplyQueueResult =
  | { queued: true; jobId: string }
  | { queued: false; reason: AiReplyQueueReason };

@Injectable()
export class AiReplyQueueService {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RuntimeQueueService) private readonly runtimeQueue: RuntimeQueueService,
  ) {}

  get enabled() {
    return this.config.aiReplyMode === "queue";
  }

  admit(
    data: Pick<AiReplyEnqueueRequest, "tenantId" | "conversationId">,
  ): Promise<AutomaticReplyAdmissionResult> {
    return this.prisma.$transaction((tx) => automaticReplyAdmissionState(tx, data));
  }

  async enqueue(data: AiReplyEnqueueRequest): Promise<AiReplyQueueResult> {
    const jobId = `ai-reply:${data.conversationId}:${data.triggerMessageId}`;

    try {
      return await withSpan(
        "queue.publish ai.reply",
        {
          kind: SpanKind.PRODUCER,
          attributes: {
            "messaging.system": "bullmq",
            "messaging.destination.name": "ai.reply",
            "leadvirt.tenant_id": data.tenantId,
            "leadvirt.conversation_id": data.conversationId,
            "leadvirt.source": data.source,
          },
        },
        async () => {
          const result = await this.createEventWithTransaction(data);
          if (!result.created) return { queued: false, reason: result.reason };
          this.dispatchPersisted(result.event.id);
          return { queued: true, jobId };
        },
      );
    } catch (error) {
      throw error instanceof Error ? error : new Error("Unable to persist AI reply request");
    }
  }

  async createEvent(tx: Prisma.TransactionClient, data: AiReplyEnqueueRequest) {
    return this.runtimeQueue.createAiReplyEvent(tx, data);
  }

  dispatchPersisted(eventId: string) {
    this.runtimeQueue.dispatch(eventId);
  }

  private createEventWithTransaction(data: AiReplyEnqueueRequest) {
    return this.prisma.$transaction((tx) => this.runtimeQueue.createAiReplyEvent(tx, data));
  }
}
