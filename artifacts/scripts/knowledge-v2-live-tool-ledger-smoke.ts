import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  authenticatedCustomerChannelBindingHash,
  authenticatedCustomerIdentityAttestationHash,
  authenticatedCustomerSubjectHash,
  createKnowledgeV2QueryHashKeyring,
  createPrismaKnowledgeV2LiveTools,
  EncryptedFileKnowledgeObjectStore,
  knowledgeLiveToolAuthorizationScopeHash,
  knowledgeLiveToolQueryHash,
  type KnowledgeOperationalLiveCategory,
  type KnowledgeRuntimeAuthorizationContext,
} from "@leadvirt/knowledge";

loadEnvFile();
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
process.env.CUSTOMER_IDENTITY_HMAC_KEY ??= "leadvirt-live-tool-ledger-smoke";

let checks = 0;

function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

async function expectDatabaseRejection(
  action: () => Promise<unknown>,
  expected: RegExp,
  message: string,
) {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  check(failure !== undefined && expected.test(String(failure)), message);
}

async function main() {
  const rootPath = await mkdtemp(join(tmpdir(), "leadvirt-live-tool-ledger-"));
  const encryptionKeyId = "live-tool-smoke-v1";
  const objectStore = new EncryptedFileKnowledgeObjectStore({
    rootPath,
    activeKey: { id: encryptionKeyId, key: randomBytes(32) },
  });
  const oldQueryKeyId = "live-tool-query-key-v1";
  const newQueryKeyId = "live-tool-query-key-v2";
  const oldQueryKey = new Uint8Array(32).fill(31);
  const newQueryKey = new Uint8Array(32).fill(47);
  const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
    activeKeyId: oldQueryKeyId,
    keys: { [oldQueryKeyId]: oldQueryKey },
  });
  const rotatedQueryHashKeyring = createKnowledgeV2QueryHashKeyring({
    activeKeyId: newQueryKeyId,
    keys: { [oldQueryKeyId]: oldQueryKey, [newQueryKeyId]: newQueryKey },
  });
  const removedQueryHashKeyring = createKnowledgeV2QueryHashKeyring({
    activeKeyId: newQueryKeyId,
    keys: { [newQueryKeyId]: newQueryKey },
  });
  let clock = new Date(Date.now() - 5_000);
  const { gateway, ledger } = createPrismaKnowledgeV2LiveTools({
    prisma,
    objectStore,
    encryptionKeyId,
    queryHashKeyring,
    now: () => clock,
  });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Knowledge live-tool ledger smoke",
        slug: `knowledge-live-tool-${suffix}`,
        status: "ACTIVE",
      },
    });
    tenantId = tenant.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Authenticated customer channel",
        externalId: `900000${Date.now()}`,
        publicKey: `knowledge-live-tool-${suffix}`,
      },
    });
    const alternateChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Alternate authenticated customer channel",
        externalId: `800000${Date.now()}`,
        publicKey: `knowledge-live-tool-alternate-${suffix}`,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "Live-tool customer",
        channelType: "TELEGRAM",
      },
    });
    const telegramCustomerId = `${Date.now()}`;
    const externalConversationId = `telegram:${telegramCustomerId}`;
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId,
        aiEnabled: true,
        aiGeneration: 1,
        aiReplySequence: 1,
        aiReplyFence: 1,
      },
    });
    const inboundMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        externalMessageId: "telegram:1",
        text: "What is the current status?",
      },
    });
    const telegramPayload = {
      update_id: Date.now(),
      message: {
        message_id: 1,
        date: Math.floor(clock.getTime() / 1_000),
        from: { id: Number(telegramCustomerId), is_bot: false, first_name: "Live-tool" },
        chat: { id: Number(telegramCustomerId), type: "private" },
        text: "What is the current status?",
      },
    };
    const eventPayloadHash = createHash("sha256")
      .update(JSON.stringify(telegramPayload))
      .digest("hex");
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        tenantId: tenant.id,
        provider: `telegram:${channel.id}`,
        externalEventId: `telegram:update:${telegramPayload.update_id}`,
        payloadHash: eventPayloadHash,
        payload: telegramPayload,
        status: "PROCESSED",
        errorMessage: null,
        receivedAt: clock,
        processedAt: new Date(clock.getTime() + 1),
      },
    });
    const subjectHash = authenticatedCustomerSubjectHash({
      tenantId: tenant.id,
      channelId: channel.id,
      provider: "TELEGRAM",
      externalSubjectId: telegramCustomerId,
    });
    const channelBindingHash = authenticatedCustomerChannelBindingHash({
      tenantId: tenant.id,
      channelId: channel.id,
      channelType: channel.type,
      channelExternalId: channel.externalId ?? "",
      channelPublicKey: channel.publicKey ?? "",
    });
    const attestationHash = authenticatedCustomerIdentityAttestationHash({
      tenantId: tenant.id,
      version: 1,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: inboundMessage.id,
      webhookEventId: webhookEvent.id,
      provider: "TELEGRAM",
      authenticationMethod: "TELEGRAM_WEBHOOK_SECRET",
      subjectSource: "TELEGRAM_MESSAGE_FROM_ID",
      conversationType: "PRIVATE",
      subjectHash,
      channelBindingHash,
      eventPayloadHash,
      authenticatedAt: webhookEvent.receivedAt,
    });
    const customerIdentity = await prisma.authenticatedCustomerIdentity.create({
      data: {
        tenantId: tenant.id,
        version: 1,
        channelId: channel.id,
        conversationId: conversation.id,
        messageId: inboundMessage.id,
        webhookEventId: webhookEvent.id,
        provider: "TELEGRAM",
        authenticationMethod: "TELEGRAM_WEBHOOK_SECRET",
        subjectSource: "TELEGRAM_MESSAGE_FROM_ID",
        conversationType: "PRIVATE",
        subjectHash,
        channelBindingHash,
        eventPayloadHash,
        attestationHash,
        authenticatedAt: webhookEvent.receivedAt,
      },
    });
    const customerIdentityReference = {
      id: customerIdentity.id,
      version: 1 as const,
      subjectHash: customerIdentity.subjectHash,
      attestationHash: customerIdentity.attestationHash,
    };
    const run = await prisma.aiReplyRun.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        inboundMessageId: inboundMessage.id,
        idempotencyKey: `live-tool-run-${suffix}`,
        inputHash: `sha256:${suffix}`,
        generation: 1,
        sequence: 1,
        status: "RUNNING",
        attemptCount: 1,
        deadlineAt: new Date(clock.getTime() + 10 * 60_000),
      },
    });
    await Promise.all([
      prisma.order.create({
        data: {
          tenantId: tenant.id,
          leadId: lead.id,
          title: "Ledger smoke order",
          status: "PAID",
        },
      }),
      prisma.booking.create({
        data: {
          tenantId: tenant.id,
          leadId: lead.id,
          title: "Ledger smoke booking",
          startsAt: new Date(clock.getTime() + 24 * 60 * 60_000),
          status: "COMPLETED",
        },
      }),
    ]);

    const executionContextId = `langgraph:${run.id}`;
    const authorization = {
      locale: "en",
      channelType: "TELEGRAM",
      audience: "AUTHENTICATED_CUSTOMER",
      classifications: ["PUBLIC", "CUSTOMER_PERSONAL"],
      queryClassification: "CUSTOMER_PERSONAL",
      channelIds: [channel.id],
      executionContextId,
      customerIdentity: customerIdentityReference,
    } satisfies KnowledgeRuntimeAuthorizationContext;

    const executionInput = (
      query: string,
      operationalCategory: KnowledgeOperationalLiveCategory,
      selectedAuthorization: KnowledgeRuntimeAuthorizationContext = authorization,
    ) => ({
      tenantId: tenant.id,
      executionContextId,
      query,
      queryHash: knowledgeLiveToolQueryHash({
        tenantId: tenant.id,
        query,
        queryHashKeyring,
      }),
      operationalCategory,
      authorizationScopeHash: knowledgeLiveToolAuthorizationScopeHash({
        tenantId: tenant.id,
        authorization: selectedAuthorization,
      }),
      authorization: selectedAuthorization,
      now: clock,
    });
    const resolveInput = (
      executionId: string,
      query: string,
      operationalCategory: KnowledgeOperationalLiveCategory,
    ) => ({
      executionId,
      tenantId: tenant.id,
      executionContextId,
      query,
      queryHash: knowledgeLiveToolQueryHash({
        tenantId: tenant.id,
        query,
        queryHashKeyring,
      }),
      operationalCategory,
      authorizationScopeHash: knowledgeLiveToolAuthorizationScopeHash({
        tenantId: tenant.id,
        authorization,
      }),
      now: clock,
    });

    const orderQuery = "What is my order status?";
    const bookingQuery = "What is my booking status?";
    const missingBeforeExecution = await ledger.resolve(
      resolveInput(`live:${"0".repeat(64)}`, orderQuery, "ORDER_STATE"),
    );
    check(missingBeforeExecution === null, "Resolver accepted a result before execution.");

    const orderReferences = await gateway.execute(executionInput(orderQuery, "ORDER_STATE"));
    const bookingReferences = await gateway.execute(executionInput(bookingQuery, "BOOKING_STATE"));
    check(orderReferences.length === 1, "Authenticated order-state execution was not committed.");
    check(
      bookingReferences.length === 1,
      "Authenticated booking-state execution was not committed.",
    );
    const orderReference = orderReferences[0];
    const bookingReference = bookingReferences[0];
    check(orderReference && bookingReference, "Live-tool references were not returned.");

    const [orderResult, bookingResult] = await Promise.all([
      ledger.resolve(resolveInput(orderReference.executionId, orderQuery, "ORDER_STATE")),
      ledger.resolve(resolveInput(bookingReference.executionId, bookingQuery, "BOOKING_STATE")),
    ]);
    check(
      orderResult?.exactValue === "PAID" && orderResult.content.includes("PAID"),
      "Order resolver did not return the exact trusted result.",
    );
    check(
      bookingResult?.exactValue === "COMPLETED" && bookingResult.content.includes("COMPLETED"),
      "Booking resolver did not return the exact trusted result.",
    );
    const { ledger: rotatedLedger } = createPrismaKnowledgeV2LiveTools({
      prisma,
      objectStore,
      encryptionKeyId,
      queryHashKeyring: rotatedQueryHashKeyring,
      now: () => clock,
    });
    check(
      (
        await rotatedLedger.resolve(
          resolveInput(orderReference.executionId, orderQuery, "ORDER_STATE"),
        )
      )?.exactValue === "PAID",
      "Verify-only query HMAC rotation rejected an existing live result.",
    );
    const { ledger: removedKeyLedger } = createPrismaKnowledgeV2LiveTools({
      prisma,
      objectStore,
      encryptionKeyId,
      queryHashKeyring: removedQueryHashKeyring,
      now: () => clock,
    });
    check(
      (await removedKeyLedger.resolve(
        resolveInput(orderReference.executionId, orderQuery, "ORDER_STATE"),
      )) === null,
      "A removed query HMAC key still authorized an existing live result.",
    );

    const rows = await prisma.knowledgeV2LiveToolExecution.findMany({
      where: { tenantId: tenant.id },
      orderBy: { operationalCategory: "asc" },
    });
    check(rows.length === 2, "Expected exactly two committed live-tool executions.");
    check(
      rows.every(
        (row) =>
          row.queryHashKeyId === oldQueryKeyId &&
          row.queryHashVersion === "knowledge-query-hmac-sha256-v1",
      ),
      "Committed live-tool executions lost query HMAC metadata.",
    );
    check(
      rows.every(
        (row) =>
          row.customerIdentityId === customerIdentity.id && row.customerIdentityVersion === 1,
      ),
      "Committed live-tool executions were not bound to the authenticated customer identity.",
    );
    for (const row of rows) {
      const metadata = JSON.stringify(row);
      check(
        !metadata.includes("PAID") &&
          !metadata.includes("COMPLETED") &&
          !metadata.includes("Current order status:") &&
          !metadata.includes("Current booking status:"),
        "Database metadata contains plaintext live-tool payload data.",
      );
      const encrypted = await readFile(join(rootPath, ...row.payloadObjectKey.split("/")));
      check(
        !encrypted.includes(Buffer.from("PAID")) &&
          !encrypted.includes(Buffer.from("COMPLETED")) &&
          !encrypted.includes(Buffer.from("Current order status:")) &&
          !encrypted.includes(Buffer.from("Current booking status:")),
        "Object store persisted a plaintext live-tool payload.",
      );
    }

    clock = new Date(clock.getTime() + 1);
    const replay = await gateway.execute(executionInput(orderQuery, "ORDER_STATE"));
    check(
      replay.length === 1 && replay[0]?.executionId === orderReference.executionId,
      "Identical live-tool replay was not deterministic.",
    );
    check(
      (await prisma.knowledgeV2LiveToolExecution.count({ where: { tenantId: tenant.id } })) === 2,
      "Identical replay created a duplicate execution.",
    );

    const publicAuthorization = {
      ...authorization,
      audience: "PUBLIC",
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const wrongContextAuthorization = {
      ...authorization,
      executionContextId: `langgraph:wrong-${run.id}`,
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const wrongClassificationAuthorization = {
      ...authorization,
      classifications: ["PUBLIC"],
      queryClassification: "PUBLIC",
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const missingIdentityAuthorization = {
      ...authorization,
      customerIdentity: undefined,
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const wrongIdentityAuthorization = {
      ...authorization,
      customerIdentity: {
        ...customerIdentityReference,
        id: `wrong-${customerIdentityReference.id}`,
      },
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const forgedIdentityAuthorization = {
      ...authorization,
      customerIdentity: {
        ...customerIdentityReference,
        attestationHash: `${customerIdentityReference.attestationHash.startsWith("0") ? "1" : "0"}${customerIdentityReference.attestationHash.slice(1)}`,
      },
    } satisfies KnowledgeRuntimeAuthorizationContext;
    const [
      unsupportedResult,
      publicResult,
      wrongQueryHashResult,
      wrongContextResult,
      wrongClassificationResult,
      missingIdentityResult,
      wrongIdentityResult,
      forgedIdentityResult,
    ] = await Promise.all([
      gateway.execute(executionInput("Current availability", "AVAILABILITY")),
      gateway.execute(executionInput("Public order status", "ORDER_STATE", publicAuthorization)),
      gateway.execute({
        ...executionInput(orderQuery, "ORDER_STATE"),
        queryHash: {
          ...executionInput(orderQuery, "ORDER_STATE").queryHash,
          hash: "f".repeat(64),
        },
      }),
      gateway.execute(executionInput(orderQuery, "ORDER_STATE", wrongContextAuthorization)),
      gateway.execute(executionInput(orderQuery, "ORDER_STATE", wrongClassificationAuthorization)),
      gateway.execute(executionInput(orderQuery, "ORDER_STATE", missingIdentityAuthorization)),
      gateway.execute(executionInput(orderQuery, "ORDER_STATE", wrongIdentityAuthorization)),
      gateway.execute(executionInput(orderQuery, "ORDER_STATE", forgedIdentityAuthorization)),
    ]);
    check(unsupportedResult.length === 0, "Unsupported live category created an execution.");
    check(publicResult.length === 0, "Public audience created a private live-tool execution.");
    check(wrongQueryHashResult.length === 0, "Gateway accepted a forged query hash.");
    check(wrongContextResult.length === 0, "Gateway accepted a mismatched execution context.");
    check(
      wrongClassificationResult.length === 0,
      "Gateway accepted an authorization without customer-personal admission.",
    );
    check(missingIdentityResult.length === 0, "Gateway accepted missing customer identity proof.");
    check(wrongIdentityResult.length === 0, "Gateway accepted the wrong customer identity proof.");
    check(forgedIdentityResult.length === 0, "Gateway accepted forged customer identity proof.");
    check(
      (await prisma.knowledgeV2LiveToolExecution.count({ where: { tenantId: tenant.id } })) === 2,
      "Rejected live-tool requests persisted execution rows.",
    );

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        payload: {
          ...telegramPayload,
          message: {
            ...telegramPayload.message,
            from: { ...telegramPayload.message.from, id: Number(telegramCustomerId) + 1 },
            chat: { ...telegramPayload.message.chat, id: Number(telegramCustomerId) + 1 },
          },
        },
      },
    });
    check(
      (await ledger.resolve(
        resolveInput(orderReference.executionId, orderQuery, "ORDER_STATE"),
      )) === null,
      "Resolver accepted identity after the stored Telegram sender payload changed.",
    );
    check(
      (await gateway.execute(executionInput(orderQuery, "ORDER_STATE"))).length === 0,
      "Gateway accepted identity after the stored Telegram sender payload changed.",
    );
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { payload: telegramPayload },
    });

    const baseOrderResolve = resolveInput(orderReference.executionId, orderQuery, "ORDER_STATE");
    const rejectedBindings = await Promise.all([
      ledger.resolve({ ...baseOrderResolve, tenantId: `wrong-${tenant.id}` }),
      ledger.resolve({
        ...baseOrderResolve,
        queryHash: { ...baseOrderResolve.queryHash, hash: "1".repeat(64) },
      }),
      ledger.resolve({ ...baseOrderResolve, operationalCategory: "BOOKING_STATE" }),
      ledger.resolve({ ...baseOrderResolve, executionContextId: `langgraph:wrong-${run.id}` }),
      ledger.resolve({ ...baseOrderResolve, authorizationScopeHash: "2".repeat(64) }),
    ]);
    check(
      rejectedBindings.every((value) => value === null),
      "Resolver accepted a result under the wrong tenant, query, category, context, or scope.",
    );

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiReplySequence: 2, aiReplyFence: 2 },
    });
    check(
      (await ledger.resolve(baseOrderResolve)) === null,
      "Conversation execution-state change did not invalidate the result.",
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiReplySequence: 1, aiReplyFence: 1 },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { externalConversationId: `${externalConversationId}-changed` },
    });
    check(
      (await ledger.resolve(baseOrderResolve)) === null,
      "Subject identity change did not invalidate the result.",
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { externalConversationId },
    });
    await expectDatabaseRejection(
      () =>
        prisma.conversation.update({
          where: { id: conversation.id },
          data: { channelId: alternateChannel.id },
        }),
      /foreign key constraint/iu,
      "Database allowed a conversation to escape its authenticated channel binding.",
    );
    await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    check(
      (await ledger.resolve(baseOrderResolve)) === null,
      "Deleted customer subject remained authorized.",
    );
    await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: null } });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "CLOSED" },
    });
    check(
      (await ledger.resolve(baseOrderResolve)) === null,
      "Closed conversation remained authorized.",
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "OPEN" },
    });
    const activeClock = clock;
    clock = new Date(clock.getTime() + 30_001);
    check(
      (await ledger.resolve({ ...baseOrderResolve, now: activeClock })) === null,
      "Expired live-tool result remained resolvable.",
    );
    clock = activeClock;

    const authorizationState = await prisma.tenantOperationalAuthorizationState.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    let markAuthorizationLocked!: () => void;
    const authorizationLocked = new Promise<void>((resolve) => {
      markAuthorizationLocked = resolve;
    });
    let releaseAuthorization!: () => void;
    const authorizationRelease = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const lockedResolution = prisma.$transaction(
      async (tx) => {
        const result = await ledger.resolve({ ...baseOrderResolve, transaction: tx });
        markAuthorizationLocked();
        await authorizationRelease;
        return result;
      },
      { timeout: 10_000 },
    );
    await authorizationLocked;
    let revocationCommitted = false;
    const revocation = prisma.channel
      .update({
        where: { id: channel.id },
        data: { settings: { liveToolSmokeRevocation: suffix } },
      })
      .then((result) => {
        revocationCommitted = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    check(!revocationCommitted, "Authorization revocation bypassed the final transaction lock.");
    releaseAuthorization();
    check(
      (await lockedResolution)?.exactValue === "PAID",
      "Transaction-bound resolver rejected evidence before the queued revocation committed.",
    );
    await revocation;
    const revokedAuthorizationState =
      await prisma.tenantOperationalAuthorizationState.findUniqueOrThrow({
        where: { tenantId: tenant.id },
      });
    check(
      revokedAuthorizationState.permissionGeneration ===
        authorizationState.permissionGeneration + 1,
      "Authorization-relevant channel change did not advance the permission generation once.",
    );
    check(
      (await ledger.resolve(baseOrderResolve)) === null,
      "Permission-generation change did not invalidate the result.",
    );
    await expectDatabaseRejection(
      () =>
        prisma.tenantOperationalAuthorizationState.update({
          where: { tenantId: tenant.id },
          data: { permissionGeneration: authorizationState.permissionGeneration },
        }),
      /advance exactly once/iu,
      "Database allowed the authorization generation to roll back.",
    );
    await expectDatabaseRejection(
      () =>
        prisma.tenantOperationalAuthorizationState.update({
          where: { tenantId: tenant.id },
          data: { permissionGeneration: { increment: 2 } },
        }),
      /advance exactly once/iu,
      "Database allowed the authorization generation to skip forward.",
    );
    await expectDatabaseRejection(
      () =>
        prisma.tenantOperationalAuthorizationState.delete({
          where: { tenantId: tenant.id },
        }),
      /cannot be deleted directly/iu,
      "Database allowed direct authorization-state deletion.",
    );
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: "SUSPENDED" },
    });
    check(
      (await gateway.execute(executionInput(orderQuery, "ORDER_STATE"))).length === 0,
      "Suspended tenant created live-tool evidence.",
    );
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: "ACTIVE" },
    });

    const refreshedOrderReferences = await gateway.execute(
      executionInput(orderQuery, "ORDER_STATE"),
    );
    const refreshedBookingReferences = await gateway.execute(
      executionInput(bookingQuery, "BOOKING_STATE"),
    );
    const refreshedOrderReference = refreshedOrderReferences[0];
    const refreshedBookingReference = refreshedBookingReferences[0];
    check(
      refreshedOrderReferences.length === 1 &&
        refreshedOrderReference?.executionId !== orderReference.executionId,
      "Revoked order evidence was not replaced under the new permission generation.",
    );
    check(
      refreshedBookingReferences.length === 1 &&
        refreshedBookingReference?.executionId !== bookingReference.executionId,
      "Revoked booking evidence was not replaced under the new permission generation.",
    );
    check(
      refreshedOrderReference && refreshedBookingReference,
      "Refreshed live-tool references were not returned.",
    );
    const refreshedRows = await prisma.knowledgeV2LiveToolExecution.findMany({
      where: { tenantId: tenant.id },
    });
    check(refreshedRows.length === 4, "Expected revoked and refreshed immutable ledger rows.");
    const orderRow = refreshedRows.find((row) => row.id === refreshedOrderReference.executionId);
    const bookingRow = refreshedRows.find(
      (row) => row.id === refreshedBookingReference.executionId,
    );
    check(orderRow && bookingRow, "Committed payload metadata could not be located.");
    const orderPayloadPath = join(rootPath, ...orderRow.payloadObjectKey.split("/"));
    const orderPayload = await readFile(orderPayloadPath);
    const finalPayloadIndex = orderPayload.length - 1;
    const finalPayloadByte = orderPayload[finalPayloadIndex];
    check(finalPayloadByte !== undefined, "Encrypted payload was unexpectedly empty.");
    orderPayload[finalPayloadIndex] = finalPayloadByte ^ 0xff;
    await writeFile(orderPayloadPath, orderPayload);
    check(
      (await ledger.resolve(
        resolveInput(refreshedOrderReference.executionId, orderQuery, "ORDER_STATE"),
      )) === null,
      "Tampered encrypted payload remained resolvable.",
    );
    await objectStore.delete(bookingRow.payloadObjectKey);
    check(
      (await ledger.resolve(
        resolveInput(refreshedBookingReference.executionId, bookingQuery, "BOOKING_STATE"),
      )) === null,
      "Missing encrypted payload remained resolvable.",
    );

    const originalCommit = ledger.commit.bind(ledger);
    let insertedConcurrentOrder = false;
    ledger.commit = async (input) => {
      if (!insertedConcurrentOrder) {
        insertedConcurrentOrder = true;
        await prisma.order.create({
          data: {
            tenantId: tenant.id,
            leadId: lead.id,
            title: "Concurrent second order",
            status: "FULFILLED",
          },
        });
      }
      return originalCommit(input);
    };
    let ambiguous: Awaited<ReturnType<typeof gateway.execute>>;
    try {
      ambiguous = await gateway.execute(
        executionInput("What is the latest order status?", "ORDER_STATE"),
      );
    } finally {
      ledger.commit = originalCommit;
    }
    check(insertedConcurrentOrder, "Concurrent ambiguity fixture did not reach commit.");
    check(ambiguous.length === 0, "Ambiguous operational state created an execution.");
    check(
      (await prisma.knowledgeV2LiveToolExecution.count({ where: { tenantId: tenant.id } })) === 4,
      "Ambiguous operational state persisted a ledger row.",
    );

    const legacyExecutionKey = createHash("sha256")
      .update(`legacy-null-proof:${suffix}`)
      .digest("hex");
    const legacyExecutionId = `live:${legacyExecutionKey}`;
    await prisma.knowledgeV2LiveToolExecution.create({
      data: {
        ...orderRow,
        id: legacyExecutionId,
        executionKey: legacyExecutionKey,
        toolPolicyVersion: "knowledge-live-tool-v1",
        queryHashKeyId: null,
        queryHashVersion: null,
        customerIdentityId: null,
        customerIdentityVersion: null,
        payloadObjectKey: `${orderRow.payloadObjectKey}.legacy-${suffix}`,
      },
    });
    check(
      (await ledger.resolve(resolveInput(legacyExecutionId, orderQuery, "ORDER_STATE"))) === null,
      "Resolver accepted a legacy live-tool row without query metadata or identity proof.",
    );

    await expectDatabaseRejection(
      () =>
        prisma.authenticatedCustomerIdentity.update({
          where: { id: customerIdentity.id },
          data: { attestationHash: "f".repeat(64) },
        }),
      /immutable/iu,
      "Database allowed an authenticated customer identity mutation.",
    );
    await expectDatabaseRejection(
      () =>
        prisma.authenticatedCustomerIdentity.delete({
          where: { id: customerIdentity.id },
        }),
      /cannot be deleted directly/iu,
      "Database allowed direct authenticated customer identity deletion.",
    );

    await expectDatabaseRejection(
      () =>
        prisma.knowledgeV2LiveToolExecution.update({
          where: { id: refreshedOrderReference.executionId },
          data: { safeName: "Mutated" },
        }),
      /immutable/iu,
      "Database allowed an immutable live-tool execution update.",
    );
    await expectDatabaseRejection(
      () =>
        prisma.knowledgeV2LiveToolExecution.delete({
          where: { id: refreshedOrderReference.executionId },
        }),
      /cannot be deleted directly/iu,
      "Database allowed a direct live-tool execution delete.",
    );

    await prisma.tenant.delete({ where: { id: tenant.id } });
    tenantId = null;
    check(
      (await prisma.knowledgeV2LiveToolExecution.count({ where: { tenantId: tenant.id } })) === 0,
      "Tenant cascade did not clean up live-tool executions.",
    );

    console.log(JSON.stringify({ ok: true, checks }));
  } finally {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await rm(rootPath, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
