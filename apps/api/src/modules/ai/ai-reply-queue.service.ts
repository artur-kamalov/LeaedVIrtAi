import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { SpanKind, withSpan } from "@leadvirt/observability";
import { Queue, type ConnectionOptions } from "bullmq";
import type { AiReplyJobData } from "@leadvirt/types";
import { AppConfigService } from "../../config/app-config.service.js";

export interface AiReplyQueueResult {
  queued: boolean;
  jobId?: string;
  reason?: string;
}

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    maxRetriesPerRequest: null
  };

  if (parsed.username) {
    connection.username = decodeURIComponent(parsed.username);
  }

  if (parsed.password) {
    connection.password = decodeURIComponent(parsed.password);
  }

  return connection;
}

@Injectable()
export class AiReplyQueueService implements OnModuleDestroy {
  private queue?: Queue<AiReplyJobData>;

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  get enabled() {
    return this.config.aiReplyMode === "queue";
  }

  async enqueue(data: AiReplyJobData): Promise<AiReplyQueueResult> {
    if (!this.enabled) {
      return { queued: false, reason: "AI_REPLY_MODE is sync" };
    }

    const jobId = `ai-reply:${data.conversationId}:${data.triggerMessageId}`;

    try {
      return await withSpan("queue.publish ai.reply", {
        kind: SpanKind.PRODUCER,
        attributes: {
          "messaging.system": "bullmq",
          "messaging.destination.name": "ai.reply",
          "leadvirt.tenant_id": data.tenantId,
          "leadvirt.conversation_id": data.conversationId,
          "leadvirt.source": data.source
        }
      }, async () => {
        const queue = this.getQueue();
        const job = await queue.add("generate-reply", data, {
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 }
        });
        return { queued: true, jobId: job.id ?? jobId };
      });
    } catch (error) {
      return {
        queued: false,
        reason: error instanceof Error ? error.message : "Unable to enqueue AI reply job"
      };
    }
  }

  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
    }
  }

  private getQueue() {
    this.queue ??= new Queue<AiReplyJobData>("ai.reply", {
      connection: connectionFromRedisUrl(this.config.redisUrl)
    });
    return this.queue;
  }
}
