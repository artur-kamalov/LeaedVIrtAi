import assert from "node:assert/strict";
import { KnowledgeV2PublicationDispatcherService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication-dispatcher.service.js";
import { renderPrometheusMetrics } from "../../apps/api/src/modules/metrics/metrics.registry.js";

const eventType = "knowledge.v2.publication.activate.requested";
const tenantId = "tenant-private-marker";
const contentMarker = "customer private publication text";

interface StoredEvent {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  schemaVersion: number;
  dedupeKey: string;
  status: string;
  attemptCount: number;
  availableAt: Date;
  deadlineAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  payload: Record<string, unknown>;
  publishedAt: Date | null;
  lastErrorCode: string | null;
}

interface StoredJob {
  id: string;
  tenantId: string;
  publicationId: string;
  idempotencyKey: string;
  generation: number;
  payloadRef: string;
  status: string;
  attemptCount: number;
}

function statusMatches(status: string, condition: unknown) {
  if (typeof condition === "string") return status === condition;
  if (!condition || typeof condition !== "object") return true;
  const value = condition as { in?: string[]; not?: string; notIn?: string[] };
  if (value.in && !value.in.includes(status)) return false;
  if (value.not && status === value.not) return false;
  if (value.notIn?.includes(status)) return false;
  return true;
}

function createEvent(id: string, publicationId: string, payload: Record<string, unknown>) {
  return {
    id,
    tenantId,
    aggregateType: "KnowledgePublication",
    aggregateId: publicationId,
    aggregateVersion: 1,
    eventType,
    schemaVersion: 1,
    dedupeKey: `${eventType}:${publicationId}`,
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date(Date.now() - 1_000),
    deadlineAt: new Date(Date.now() + 60_000),
    lockedAt: null,
    lockedBy: null,
    payload,
    publishedAt: null,
    lastErrorCode: null,
  } satisfies StoredEvent;
}

function main() {
  const events = new Map<string, StoredEvent>();
  const jobs = new Map<string, StoredJob>();
  const inbox = new Map<string, Record<string, unknown>>();
  const activated = new Map<string, Date | null>();
  const publicationSources = new Map<string, "mixed" | "manual">();

  const addValid = (
    eventId: string,
    publicationId: string,
    jobId: string,
    initiallyActivated = false,
    source: "mixed" | "manual" = "mixed",
  ) => {
    const payload = { publicationId, actorUserId: null, operation: "PUBLISH", jobId };
    events.set(eventId, createEvent(eventId, publicationId, payload));
    jobs.set(jobId, {
      id: jobId,
      tenantId,
      publicationId,
      idempotencyKey: `${eventType}:${publicationId}`,
      generation: 1,
      payloadRef: `knowledge-outbox:${eventId}`,
      status: "QUEUED",
      attemptCount: 0,
    });
    activated.set(publicationId, initiallyActivated ? new Date() : null);
    publicationSources.set(publicationId, source);
  };

  addValid("event-success", "publication-success-private", "job-success");
  addValid("event-reconciled", "publication-reconciled-private", "job-reconciled", true);
  addValid("event-blocked", "publication-blocked-private", "job-blocked", false, "manual");
  events.set("event-invalid", createEvent("event-invalid", "publication-invalid-private", {}));

  const telemetryPublication = (publicationId: string) => {
    const activatedAt = activated.get(publicationId) ?? null;
    const manualOnly = publicationSources.get(publicationId) === "manual";
    const createdAt = new Date(Date.now() - 20_000);
    return {
      id: publicationId,
      sequence: 1,
      createdAt,
      activatedAt,
      validation: { createdAt: new Date(Date.now() - 15_000) },
      items: [
        {
          itemType: "FACT_VERSION",
          factVersion: { createdAt: new Date(Date.now() - 30_000) },
          guidanceRuleVersion: null,
          v2DocumentRevision: null,
        },
        ...(manualOnly
          ? []
          : [
              {
                itemType: "DOCUMENT_REVISION",
                factVersion: null,
                guidanceRuleVersion: null,
                v2DocumentRevision: {
                  createdAt: new Date(Date.now() - 40_000),
                  document: { source: { kind: "WEBSITE" } },
                },
              },
            ]),
      ],
      _count: { items: manualOnly ? 1 : 2 },
    };
  };

  const prisma = {
    knowledgeOutbox: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(events.get(where.id) ?? null),
      findUniqueOrThrow: ({ where }: { where: { id: string } }) =>
        Promise.resolve(events.get(where.id)!),
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const event = events.get(String(where.id));
        if (!event || !statusMatches(event.status, where.status))
          return Promise.resolve({ count: 0 });
        if (typeof where.lockedBy === "string" && event.lockedBy !== where.lockedBy) {
          return Promise.resolve({ count: 0 });
        }
        if (data.attemptCount && typeof data.attemptCount === "object") event.attemptCount += 1;
        if (typeof data.status === "string") event.status = data.status;
        if ("lockedAt" in data) event.lockedAt = (data.lockedAt as Date | null) ?? null;
        if ("lockedBy" in data) event.lockedBy = (data.lockedBy as string | null) ?? null;
        if ("publishedAt" in data) event.publishedAt = (data.publishedAt as Date | null) ?? null;
        if ("lastErrorCode" in data) {
          event.lastErrorCode = (data.lastErrorCode as string | null) ?? null;
        }
        if (data.availableAt instanceof Date) event.availableAt = data.availableAt;
        return Promise.resolve({ count: 1 });
      },
    },
    knowledgeJob: {
      findFirst: ({ where }: { where: { id: string } }) =>
        Promise.resolve(jobs.get(where.id) ?? null),
      findFirstOrThrow: ({ where }: { where: { id: string } }) =>
        Promise.resolve(jobs.get(where.id)!),
      updateMany: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const job = jobs.get(where.id);
        if (!job) return Promise.resolve({ count: 0 });
        if (data.attemptCount && typeof data.attemptCount === "object") job.attemptCount += 1;
        if (typeof data.status === "string") job.status = data.status;
        return Promise.resolve({ count: 1 });
      },
    },
    knowledgeJobAttempt: {
      create: () => Promise.resolve({}),
      update: () => Promise.resolve({}),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    knowledgeInbox: {
      upsert: ({
        where,
        update,
        create,
      }: {
        where: { consumer_eventId: { eventId: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const eventId = where.consumer_eventId.eventId;
        inbox.set(eventId, { ...(inbox.get(eventId) ?? create), ...update });
        return Promise.resolve(inbox.get(eventId));
      },
      update: ({
        where,
        data,
      }: {
        where: { consumer_eventId: { eventId: string } };
        data: Record<string, unknown>;
      }) => {
        const eventId = where.consumer_eventId.eventId;
        inbox.set(eventId, { ...(inbox.get(eventId) ?? {}), ...data });
        return Promise.resolve(inbox.get(eventId));
      },
      updateMany: () => Promise.resolve({ count: 1 }),
      findUnique: ({ where }: { where: { consumer_eventId: { eventId: string } } }) =>
        Promise.resolve(inbox.get(where.consumer_eventId.eventId) ?? null),
    },
    knowledgePublication: {
      findFirst: ({
        where,
        select,
      }: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => {
        const publication = telemetryPublication(where.id);
        if ("_count" in select) {
          return Promise.resolve(
            publication.activatedAt
              ? { id: publication.id, sequence: publication.sequence, _count: publication._count }
              : null,
          );
        }
        return Promise.resolve(publication);
      },
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    activeKnowledgePublication: {
      findUnique: () => Promise.resolve({ publicationId: "different-active-publication" }),
    },
    $transaction: <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
  };

  const publications = {
    activationEvaluationState: () => Promise.resolve("PASSED"),
    activatePublication: (input: { publicationId: string }) => {
      if (input.publicationId === "publication-blocked-private") {
        throw {
          getResponse: () => ({ code: "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED" }),
        };
      }
      activated.set(input.publicationId, new Date());
      return Promise.resolve({
        publicationId: input.publicationId,
        sequence: 1,
        itemCount: 2,
        etag: "opaque-etag",
      });
    },
  };

  return { events, prisma, publications };
}

async function run() {
  const { events, prisma, publications } = main();
  const dispatcher = new KnowledgeV2PublicationDispatcherService(
    prisma as never,
    publications as never,
  );

  await dispatcher.dispatch("event-success");
  await dispatcher.dispatch("event-success");
  await dispatcher.dispatch("event-reconciled");
  await dispatcher.dispatch("event-reconciled");
  await dispatcher.dispatch("event-invalid");
  await dispatcher.dispatch("event-invalid");
  await dispatcher.dispatch("event-blocked").catch(() => undefined);
  await dispatcher.dispatch("event-blocked");

  assert.equal(events.get("event-success")?.status, "PUBLISHED");
  assert.equal(events.get("event-reconciled")?.status, "PUBLISHED");
  assert.equal(events.get("event-invalid")?.status, "DEAD_LETTER");
  assert.equal(events.get("event-blocked")?.status, "DEAD_LETTER");

  const metrics = renderPrometheusMetrics();
  assert.match(
    metrics,
    /leadvirt_knowledge_publication_outcomes_total\{result="succeeded",operation="publish",item_kind="none",source_kind="other"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_publication_outcomes_total\{result="failed",operation="unknown",item_kind="none",source_kind="other"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_publication_outcomes_total\{result="blocked",operation="publish",item_kind="none",source_kind="manual"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_publication_duration_seconds_count\{result="succeeded",operation="publish",item_kind="none",source_kind="other"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_time_to_queryable_seconds_count\{result="succeeded",operation="candidate",item_kind="none",source_kind="other"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_time_to_queryable_seconds_count\{result="succeeded",operation="publication",item_kind="none",source_kind="other"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_time_to_queryable_seconds_count\{result="succeeded",operation="item",item_kind="fact",source_kind="manual"\} 1/u,
  );
  assert.match(
    metrics,
    /leadvirt_knowledge_time_to_queryable_seconds_count\{result="succeeded",operation="item",item_kind="document",source_kind="website"\} 1/u,
  );
  for (const forbidden of [
    tenantId,
    contentMarker,
    "publication-success-private",
    "publication-blocked-private",
    "job-success",
    "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED",
  ]) {
    assert.doesNotMatch(metrics, new RegExp(forbidden, "u"));
  }

  console.log(JSON.stringify({ ok: true, checks: 18 }));
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
