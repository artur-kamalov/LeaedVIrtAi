import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type {
  OperationStatusReadInput,
  OperationStatusReader,
  OperationStatusReadResult,
} from "@leadvirt/integrations";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { OperatorOperationsService } from "../../apps/api/src/modules/operator-operations/operator-operations.service.js";

const prisma = new PrismaService();
const retentionExpiresAt = new Date(Date.now() + 24 * 60 * 60_000);

class StatusReader implements OperationStatusReader {
  readonly calls = new Map<string, number>();

  readStatus(input: OperationStatusReadInput): Promise<OperationStatusReadResult> {
    this.calls.set(input.operationKind, (this.calls.get(input.operationKind) ?? 0) + 1);
    if (input.operationKind === "lead.update") {
      return Promise.resolve({
        supported: true,
        authoritative: true,
        outcome: "SUCCEEDED",
        evidenceCode: "PROVIDER_CONFIRMED",
        evidence: { privateProviderReceipt: "PRIVATE_PROVIDER_EVIDENCE" },
      });
    }
    if (input.operationKind === "channel.message.delivery") {
      return Promise.resolve({
        supported: true,
        authoritative: true,
        outcome: "FAILED",
        evidenceCode: "PROVIDER_REJECTED",
      });
    }
    if (input.operationKind === "crm.ambiguous") {
      return Promise.resolve({
        supported: true,
        authoritative: false,
        outcome: "UNKNOWN",
        evidenceCode: "PROVIDER_PENDING",
      });
    }
    return Promise.resolve({ supported: false });
  }
}

function status(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : null;
}

async function rejectsStatus(action: () => Promise<unknown>, expected: number) {
  let actual: number | null = null;
  try {
    await action();
  } catch (error) {
    actual = status(error);
  }
  assert.equal(actual, expected);
}

async function cleanup(tenantIds: string[], userIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const tenantId of tenantIds) {
      for (const table of [
        "KnowledgeV2IdempotencyRecord",
        "ChannelDeliveryOperation",
        "ExternalOperation",
        "RuntimeOutbox",
        "KnowledgeOutbox",
        "AuditLog",
        "Message",
        "Conversation",
        "Channel",
        "Membership",
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
      }
      await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    }
    for (const userId of userIds) {
      await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', userId);
    }
  });
}

async function main() {
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  try {
    await prisma.$connect();
    const stamp = randomUUID();
    const tenant = await prisma.tenant.create({
      data: { name: "Operator operations smoke", slug: `operator-operations-${stamp}` },
    });
    const otherTenant = await prisma.tenant.create({
      data: { name: "Other operator tenant", slug: `operator-other-${stamp}` },
    });
    tenantIds.push(tenant.id, otherTenant.id);
    const owner = await prisma.user.create({
      data: { email: `operator-owner-${stamp}@example.test`, name: "Operator owner" },
    });
    const viewer = await prisma.user.create({
      data: { email: `operator-viewer-${stamp}@example.test`, name: "Operator viewer" },
    });
    userIds.push(owner.id, viewer.id);
    await prisma.membership.createMany({
      data: [
        { tenantId: tenant.id, userId: owner.id, role: "OWNER" },
        { tenantId: tenant.id, userId: viewer.id, role: "VIEWER" },
      ],
    });
    const context: RequestContext = {
      tenantId: tenant.id,
      userId: owner.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user: owner,
    };
    const viewerContext: RequestContext = { ...context, userId: viewer.id, role: "VIEWER", user: viewer };
    const reader = new StatusReader();
    const service = new OperatorOperationsService(
      prisma,
      new KnowledgeV2IdempotencyService(prisma),
      reader,
    );

    const unsupportedId = `external-unsupported-${stamp}`;
    const ambiguousId = `external-ambiguous-${stamp}`;
    const toolId = `tool-${stamp}`;
    const crossTenantId = `cross-tenant-${stamp}`;
    await prisma.externalOperation.createMany({
      data: [
        {
          id: unsupportedId,
          tenantId: tenant.id,
          operationKind: "crm.unsupported",
          requestHash: "PRIVATE_REQUEST_HASH_UNSUPPORTED",
          status: "UNKNOWN",
          externalReference: "PRIVATE_EXTERNAL_REFERENCE_UNSUPPORTED",
          providerIdempotencyKey: "PRIVATE_PROVIDER_KEY_UNSUPPORTED",
          errorCode: "unsafe provider error with PRIVATE_CONTENT",
          errorMessage: "PRIVATE_RAW_ERROR_UNSUPPORTED",
          retentionExpiresAt,
        },
        {
          id: ambiguousId,
          tenantId: tenant.id,
          operationKind: "crm.ambiguous",
          requestHash: "PRIVATE_REQUEST_HASH_AMBIGUOUS",
          status: "UNKNOWN",
          externalReference: "PRIVATE_EXTERNAL_REFERENCE_AMBIGUOUS",
          retentionExpiresAt,
        },
        {
          id: toolId,
          tenantId: tenant.id,
          operationKind: "lead.update",
          requestHash: "PRIVATE_TOOL_REQUEST_HASH",
          status: "UNKNOWN",
          externalReference: "PRIVATE_TOOL_REFERENCE",
          retentionExpiresAt,
        },
        {
          id: crossTenantId,
          tenantId: otherTenant.id,
          operationKind: "crm.ambiguous",
          requestHash: "PRIVATE_OTHER_TENANT_HASH",
          status: "UNKNOWN",
          retentionExpiresAt,
        },
      ],
    });

    const channel = await prisma.channel.create({
      data: { tenantId: tenant.id, type: "TELEGRAM", status: "ACTIVE", name: "Operator channel" },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channelId: channel.id, externalConversationId: "PRIVATE_CHAT" },
    });
    const message = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        text: "PRIVATE_MESSAGE_BODY",
        status: "QUEUED",
      },
    });
    const channelOperationId = `channel-${stamp}`;
    await prisma.channelDeliveryOperation.create({
      data: {
        id: channelOperationId,
        tenantId: tenant.id,
        messageId: message.id,
        conversationId: conversation.id,
        channelId: channel.id,
        provider: "TELEGRAM",
        channelKey: "PRIVATE_CHANNEL_KEY",
        recipientKey: "PRIVATE_RECIPIENT_KEY",
        requestHash: "PRIVATE_CHANNEL_REQUEST_HASH",
        status: "UNKNOWN",
        providerIdempotencyKey: "PRIVATE_CHANNEL_PROVIDER_KEY",
        providerMessageId: "PRIVATE_PROVIDER_MESSAGE_ID",
        errorMessage: "PRIVATE_CHANNEL_ERROR",
        retentionExpiresAt,
      },
    });

    const runtimeId = `runtime-${stamp}`;
    const unsafeRuntimeId = `runtime-unsafe-${stamp}`;
    await prisma.runtimeOutbox.createMany({
      data: [
        {
          id: runtimeId,
          tenantId: tenant.id,
          aggregateType: "knowledge-source",
          aggregateId: `source-${stamp}`,
          aggregateVersion: 1,
          generation: 1,
          eventType: "knowledge.source.sync.requested",
          dedupeKey: `runtime-safe-${stamp}`,
          payloadRef: "PRIVATE_PAYLOAD_REFERENCE",
          payload: { secret: "PRIVATE_RUNTIME_PAYLOAD", token: "PRIVATE_RUNTIME_TOKEN" },
          status: "DEAD_LETTER",
          attemptCount: 3,
          lastErrorCode: "OPERATOR_PROVEN_NOT_EXECUTED",
          lastErrorMessage: "PRIVATE_RUNTIME_ERROR",
        },
        {
          id: unsafeRuntimeId,
          tenantId: tenant.id,
          aggregateType: "message",
          aggregateId: message.id,
          aggregateVersion: 1,
          eventType: "channels.send-message.requested",
          dedupeKey: `runtime-unsafe-${stamp}`,
          payload: { text: "PRIVATE_OUTBOUND_MESSAGE" },
          status: "DEAD_LETTER",
          lastErrorCode: "OPERATOR_PROVEN_NOT_EXECUTED",
        },
      ],
    });
    const knowledgeId = `knowledge-outbox-${stamp}`;
    await prisma.knowledgeOutbox.create({
      data: {
        id: knowledgeId,
        tenantId: tenant.id,
        aggregateType: "tenant_knowledge",
        aggregateId: `knowledge-${stamp}`,
        aggregateVersion: 1,
        eventType: "knowledge.publication.requested",
        dedupeKey: `knowledge-safe-${stamp}`,
        payload: { secret: "PRIVATE_KNOWLEDGE_PAYLOAD", targetKey: "workspace" },
        status: "DEAD_LETTER",
        attemptCount: 2,
        lastErrorCode: "OPERATOR_PROVEN_NOT_EXECUTED",
      },
    });

    const listed = await service.list(context, { limit: 100 });
    assert(listed.items.some((item) => item.id === unsupportedId));
    assert(listed.items.some((item) => item.id === toolId && item.kind === "TOOL_OPERATION"));
    assert(listed.items.some((item) => item.id === channelOperationId));
    assert(listed.items.some((item) => item.id === runtimeId));
    assert(listed.items.some((item) => item.id === knowledgeId));
    assert(!listed.items.some((item) => item.id === crossTenantId));
    const publicJson = JSON.stringify(listed);
    for (const secret of [
      "PRIVATE_REQUEST_HASH",
      "PRIVATE_EXTERNAL_REFERENCE",
      "PRIVATE_PROVIDER_KEY",
      "PRIVATE_RECIPIENT_KEY",
      "PRIVATE_RUNTIME_PAYLOAD",
      "PRIVATE_KNOWLEDGE_PAYLOAD",
      "PRIVATE_RAW_ERROR",
      "PRIVATE_MESSAGE_BODY",
    ]) {
      assert(!publicJson.includes(secret), `Operator list leaked ${secret}.`);
    }
    assert.equal(listed.items.find((item) => item.id === unsupportedId)?.errorCode, "OPERATOR_UPSTREAM_ERROR_REDACTED");
    await rejectsStatus(() => service.list(viewerContext, {}), 403);
    await rejectsStatus(
      () => service.get(context, "EXTERNAL_OPERATION", crossTenantId),
      404,
    );

    const unsupported = await service.get(context, "EXTERNAL_OPERATION", unsupportedId);
    await rejectsStatus(
      () =>
        service.reconcile(
          context,
          "EXTERNAL_OPERATION",
          unsupportedId,
          { reason: "stale operator view" },
          `stale-${stamp}`,
          ['"stale"'],
        ),
      412,
    );
    assert.equal(reader.calls.get("crm.unsupported") ?? 0, 0);
    const unsupportedResult = await service.reconcile(
      context,
      "EXTERNAL_OPERATION",
      unsupportedId,
      { reason: "provider does not expose status" },
      `unsupported-${stamp}`,
      [unsupported.etag],
    );
    assert.equal(unsupportedResult.outcome, "STILL_UNKNOWN");
    assert.equal((await prisma.externalOperation.findUniqueOrThrow({ where: { id: unsupportedId } })).status, "UNKNOWN");
    const unsupportedReplay = await service.reconcile(
      context,
      "EXTERNAL_OPERATION",
      unsupportedId,
      { reason: "provider does not expose status" },
      `unsupported-${stamp}`,
      [unsupported.etag],
    );
    assert.equal(unsupportedReplay.idempotencyReplayed, true);
    assert.equal(reader.calls.get("crm.unsupported"), 1);

    const ambiguous = await service.get(context, "EXTERNAL_OPERATION", ambiguousId);
    const ambiguousResult = await service.reconcile(
      context,
      "EXTERNAL_OPERATION",
      ambiguousId,
      { reason: "provider status is ambiguous" },
      `ambiguous-${stamp}`,
      [ambiguous.etag],
    );
    assert.equal(ambiguousResult.outcome, "STILL_UNKNOWN");
    assert.equal((await prisma.externalOperation.findUniqueOrThrow({ where: { id: ambiguousId } })).status, "UNKNOWN");

    const tool = await service.get(context, "TOOL_OPERATION", toolId);
    const toolResult = await service.reconcile(
      context,
      "TOOL_OPERATION",
      toolId,
      { reason: "provider supplied authoritative receipt" },
      `tool-${stamp}`,
      [tool.etag],
    );
    assert.equal(toolResult.outcome, "AUTHORITATIVE_SUCCEEDED");
    assert.equal((await prisma.externalOperation.findUniqueOrThrow({ where: { id: toolId } })).status, "SUCCEEDED");

    const channelDetail = await service.get(context, "CHANNEL_DELIVERY", channelOperationId);
    const channelResult = await service.reconcile(
      context,
      "CHANNEL_DELIVERY",
      channelOperationId,
      { reason: "provider supplied authoritative rejection" },
      `channel-${stamp}`,
      [channelDetail.etag],
    );
    assert.equal(channelResult.outcome, "AUTHORITATIVE_FAILED");
    assert.equal((await prisma.channelDeliveryOperation.findUniqueOrThrow({ where: { id: channelOperationId } })).status, "FAILED");

    const runtime = await service.get(context, "RUNTIME_OUTBOX", runtimeId);
    const [runtimeFirst, runtimeConcurrent] = await Promise.all([
      service.redrive(
        context,
        "RUNTIME_OUTBOX",
        runtimeId,
        { reason: "confirmed pre-dispatch failure" },
        `runtime-a-${stamp}`,
        [runtime.etag],
      ),
      service.redrive(
        context,
        "RUNTIME_OUTBOX",
        runtimeId,
        { reason: "confirmed pre-dispatch failure" },
        `runtime-b-${stamp}`,
        [runtime.etag],
      ),
    ]);
    assert.equal(runtimeFirst.replacementId, runtimeConcurrent.replacementId);
    assert.equal(
      await prisma.runtimeOutbox.count({
        where: { tenantId: tenant.id, dedupeKey: { startsWith: `runtime-safe-${stamp}:operator-redrive:` } },
      }),
      1,
    );
    const runtimeSource = await prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: runtimeId } });
    const runtimeReplacement = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: { id: runtimeFirst.replacementId },
    });
    assert.equal(runtimeSource.status, "DEAD_LETTER");
    assert.equal(runtimeReplacement.status, "PENDING");
    assert.equal(runtimeReplacement.generation, runtimeSource.generation + 1);
    assert.equal(recordSecret(runtimeReplacement.payload), "PRIVATE_RUNTIME_PAYLOAD");

    const knowledge = await service.get(context, "KNOWLEDGE_OUTBOX", knowledgeId);
    const knowledgeResult = await service.redrive(
      context,
      "KNOWLEDGE_OUTBOX",
      knowledgeId,
      { reason: "confirmed legacy publication never started" },
      `knowledge-${stamp}`,
      [knowledge.etag],
    );
    const knowledgeReplacement = await prisma.knowledgeOutbox.findUniqueOrThrow({
      where: { id: knowledgeResult.replacementId },
    });
    assert.equal(knowledgeReplacement.status, "PENDING");
    assert.equal(knowledgeReplacement.aggregateVersion, 2);
    assert.equal((await prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: knowledgeId } })).status, "DEAD_LETTER");

    const unsafeRuntime = await service.get(context, "RUNTIME_OUTBOX", unsafeRuntimeId);
    await rejectsStatus(
      () =>
        service.redrive(
          context,
          "RUNTIME_OUTBOX",
          unsafeRuntimeId,
          { reason: "must not resend external message" },
          `unsafe-${stamp}`,
          [unsafeRuntime.etag],
        ),
      409,
    );
    await rejectsStatus(
      () =>
        service.redrive(
          context,
          "EXTERNAL_OPERATION",
          ambiguousId,
          { reason: "must not resend unknown effect" },
          `external-redrive-${stamp}`,
          [ambiguous.etag],
        ),
      409,
    );

    await prisma.membership.update({
      where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
      data: { role: "VIEWER" },
    });
    const revokedRuntimeId = `runtime-revoked-${stamp}`;
    await prisma.runtimeOutbox.create({
      data: {
        id: revokedRuntimeId,
        tenantId: tenant.id,
        aggregateType: "knowledge-source",
        aggregateId: `revoked-source-${stamp}`,
        aggregateVersion: 1,
        eventType: "knowledge.source.sync.requested",
        dedupeKey: `runtime-revoked-${stamp}`,
        payload: {},
        status: "DEAD_LETTER",
        lastErrorCode: "OPERATOR_PROVEN_NOT_EXECUTED",
      },
    });
    const revokedContext = { ...context, role: "OWNER" as const };
    const revoked = await service.get(revokedContext, "RUNTIME_OUTBOX", revokedRuntimeId);
    await rejectsStatus(
      () =>
        service.redrive(
          revokedContext,
          "RUNTIME_OUTBOX",
          revokedRuntimeId,
          { reason: "stale owner session" },
          `revoked-${stamp}`,
          [revoked.etag],
        ),
      403,
    );

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, action: { startsWith: "operator.operation." } },
      select: { payload: true },
    });
    const auditJson = JSON.stringify(audits);
    for (const secret of [
      "PRIVATE_PROVIDER_EVIDENCE",
      "PRIVATE_RUNTIME_PAYLOAD",
      "PRIVATE_KNOWLEDGE_PAYLOAD",
      "confirmed pre-dispatch failure",
      "provider does not expose status",
    ]) {
      assert(!auditJson.includes(secret), `Operator audit leaked ${secret}.`);
    }
    assert(audits.length >= 6);

    console.log("operator operations smoke passed (32 assertions)");
  } finally {
    await cleanup(tenantIds, userIds).catch(() => undefined);
    await prisma.$disconnect();
  }
}

function recordSecret(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const secret = (value as Record<string, unknown>).secret;
  return typeof secret === "string" ? secret : null;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
