import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  EncryptedFileKnowledgeObjectStore,
} from "@leadvirt/knowledge";
import { parseRuntimeQueueEnvelope } from "@leadvirt/runtime-queue";
import type { Response } from "express";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { BusinessImportRuntimeService } from "../../apps/api/src/modules/business-profile/business-import-runtime.service.js";
import { BusinessProfileController } from "../../apps/api/src/modules/business-profile/business-profile.controller.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import type { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { canonicalKnowledgeV2Hash } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function responseHeaders() {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(",") : String(value));
      return response;
    },
  } as unknown as Response;
  return { headers, response };
}

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  return typeof body === "object" && body !== null && "code" in body ? body.code : null;
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-business-profile-v2-"));
  let tenantId: string | null = null;
  let userId: string | null = null;
  try {
    const store = new EncryptedFileKnowledgeObjectStore({
      rootPath: objectRoot,
      activeKey: { id: "canonical-smoke-v1", key: randomBytes(32) },
      maxPlaintextBytes: 1024 * 1024,
    });
    const runtime = {
      runtime: () => ({ store, objectEncryptionKeyId: "canonical-smoke-v1" }),
    } as unknown as BusinessImportRuntimeService;
    const user = await prisma.user.create({
      data: { email: `canonical-profile-${suffix}@example.test`, name: "Canonical Owner" },
    });
    userId = user.id;
    const tenant = await prisma.tenant.create({
      data: {
        name: "Legacy tenant name",
        slug: `canonical-profile-${suffix}`,
        timezone: "UTC",
        settings: { profile: { description: "Legacy settings description" } },
      },
    });
    tenantId = tenant.id;
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    await prisma.onboardingState.create({
      data: {
        tenantId,
        currentStep: "business",
        completedSteps: [],
        data: {
          businessType: "legacy-type",
          timezone: "UTC",
          companyInfo: {
            name: "Legacy JSON name",
            description: "Legacy JSON description",
            faq: "Legacy FAQ",
            policies: "Legacy policies",
            services: [
              {
                id: "legacy-only",
                name: "Legacy-only service",
                description: "Must not become authoritative",
                price: "EUR 1",
                duration: "1 minute",
              },
            ],
          },
        },
      },
    });
    const identity = await prisma.businessIdentity.create({
      data: {
        id: `identity-${suffix}`,
        tenantId,
        displayName: "Canonical Studio",
        businessType: "wellness",
        description: "Canonical description",
        defaultLocale: "en",
        timezone: "Europe/Paris",
        defaultCurrency: "EUR",
      },
    });
    const editedOffering = await prisma.businessOffering.create({
      data: {
        id: `offering-edit-${suffix}`,
        tenantId,
        name: "Canonical consultation",
        description: "Canonical consultation description",
        category: "Consultations",
        parentCategory: "Professional services",
        locale: "en",
        bookingNotes: "Bring prior records",
        prices: {
          create: [
              {
                id: `price-advanced-${suffix}`,
                type: "FIXED",
              amount: "45",
              currency: "EUR",
              unit: "session",
              taxNote: "VAT included",
              effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            },
              {
                id: `price-historic-${suffix}`,
                type: "FIXED",
              amount: "40",
              currency: "EUR",
              effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
              effectiveUntil: new Date("2025-12-31T00:00:00.000Z"),
            },
          ],
        },
        duration: {
          create: {
            id: `duration-${suffix}`,
            minimumMinutes: 45,
            preparationMinutes: 15,
            bufferMinutes: 5,
          },
        },
      },
    });
    const preservedOffering = await prisma.businessOffering.create({
      data: {
        id: `offering-preserve-${suffix}`,
        tenantId,
        name: "Imported service not sent by the compatibility client",
        description: "Must remain active",
        category: "Imported category",
        locale: "de",
        bookingNotes: "V2-only note",
      },
    });
    const seedDelta = new TextEncoder().encode(JSON.stringify({ schema: "seed.v1" }));
    const seedObjectKey = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: "business-information-revisions",
      purpose: "extracted",
      identity: `seed-${suffix}`,
    });
    const seedWrite = await store.put(seedObjectKey, seedDelta);
    const seedLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "REVISION_DELTA",
        objectStorageKey: seedObjectKey,
        encryptionKeyRef: seedWrite.encryptionKeyRef,
        retentionClass: "BUSINESS_INFORMATION_REVISION",
      },
    });
    const seedHash = canonicalKnowledgeV2Hash({ seed: suffix });
    const revision = await prisma.businessInformationRevision.create({
      data: {
        tenantId,
        revision: 1,
        canonicalHash: seedHash,
        origin: "LEGACY_BACKFILL",
        deltaObjectKey: seedObjectKey,
        deltaEncryptionKeyRef: seedWrite.encryptionKeyRef,
        deltaObjectLedgerId: seedLedger.id,
        deltaHash: canonicalKnowledgeV2Hash({ delta: "seed" }),
        affectedResources: [],
        createdByUserId: userId,
      },
    });
    await prisma.businessInformationState.create({
      data: {
        tenantId,
        revision: 1,
        currentRevisionId: revision.id,
        canonicalHash: seedHash,
        etag: 1,
        updatedByUserId: userId,
      },
    });
    await prisma.businessInformationAttribution.create({
      data: {
        tenantId,
        resourceType: "OFFERING",
        resourceKey: editedOffering.id,
        offeringId: editedOffering.id,
        fieldPath: "/name",
        currentValueHash: canonicalKnowledgeV2Hash({ value: editedOffering.name }),
        authority: "LEGACY_BACKFILL",
        businessRevisionId: revision.id,
        businessRevision: revision.revision,
        businessRevisionHash: revision.canonicalHash,
      },
    });

    const context: RequestContext = {
      tenantId,
      userId,
      role: "OWNER",
      authMode: "email",
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        businessType: tenant.businessType,
        timezone: tenant.timezone,
      },
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        passwordChangeRequired: user.passwordChangeRequired,
      },
    };
    const service = new BusinessProfileService(
      prisma as unknown as PrismaService,
      { dispatchOnboardingSync: async () => undefined } as unknown as KnowledgeService,
      new KnowledgeV2IdempotencyService(prisma as unknown as PrismaService),
      runtime,
    );
    const controller = new BusinessProfileController(service);
    const initialHeaders = responseHeaders();
    const initial = await controller.get(context, initialHeaders.response);
    assert(initial.data.profile.name === "Canonical Studio", "GET trusted legacy identity data.");
    assert(initial.data.profile.services.length === 2, "GET did not use canonical offerings.");
    assert(
      initial.data.profile.services.find((item) => item.id === editedOffering.id)?.price ===
        "EUR 45 / session",
      "GET did not render the canonical advanced price safely.",
    );
    assert(initialHeaders.headers.get("etag") === initial.data.etag, "GET omitted its ETag.");

    const editable = initial.data.profile.services.find((item) => item.id === editedOffering.id)!;
    const profileMutation = {
      profile: {
        name: "Canonical Studio Updated",
        faq: "Updated FAQ retained in compatibility storage",
        services: [
          {
            ...editable,
            name: "Canonical consultation updated",
            duration: "60 minutes",
          },
          {
            id: "new-manual-service",
            name: "Manual service",
            description: "Created through the compatibility editor",
            price: "EUR 75",
            duration: "30 minutes",
          },
        ],
      },
    };
    const patchHeaders = responseHeaders();
    const patched = await controller.patch(
      context,
      profileMutation,
      `canonical-profile-patch-${suffix}`,
      initial.data.etag,
      patchHeaders.response,
    );
    assert(patched.data.version === 2, "PATCH did not advance the aggregate ETag version.");
    assert(patched.data.profile.services.length === 3, "PATCH erased an omitted canonical service.");
    assert(
      patchHeaders.headers.get("etag") === patched.data.etag,
      "PATCH omitted the new ETag.",
    );
    const [state, identityAfter, editedAfter, preservedAfter, newOffering, revisions] =
      await Promise.all([
        prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
        prisma.businessIdentity.findUniqueOrThrow({ where: { tenantId } }),
        prisma.businessOffering.findUniqueOrThrow({
          where: { id: editedOffering.id },
          include: { prices: true, duration: true },
        }),
        prisma.businessOffering.findUniqueOrThrow({ where: { id: preservedOffering.id } }),
        prisma.businessOffering.findFirstOrThrow({
          where: { tenantId, name: "Manual service" },
          include: { prices: true, duration: true },
        }),
        prisma.businessInformationRevision.findMany({
          where: { tenantId },
          orderBy: { revision: "asc" },
        }),
      ]);
    assert(state.revision === 2 && revisions.length === 2, "PATCH wrote the wrong revision chain.");
    assert(identityAfter.rowVersion === 2, "PATCH did not advance identity rowVersion.");
    assert(editedAfter.rowVersion === 2, "PATCH did not advance offering rowVersion.");
    assert(editedAfter.prices.length === 2, "PATCH erased additional canonical prices.");
    assert(
      editedAfter.prices.some(
        (price) => price.unit === "session" && price.taxNote === "VAT included",
      ),
      "PATCH erased advanced price fields.",
    );
    assert(
      editedAfter.duration?.minimumMinutes === 60 &&
        editedAfter.duration.preparationMinutes === 15 &&
        editedAfter.duration.bufferMinutes === 5 &&
        editedAfter.duration.rowVersion === 2,
      "PATCH did not preserve v2-only duration fields.",
    );
    assert(preservedAfter.active, "PATCH archived an omitted canonical offering.");
    assert(
      newOffering.prices[0]?.amount?.toString() === "75" &&
        newOffering.duration?.minimumMinutes === 30,
      "PATCH did not create typed price and duration rows.",
    );
    const latestRevision = revisions[1]!;
    const projectionOutbox = await prisma.runtimeOutbox.findFirstOrThrow({
      where: {
        tenantId,
        aggregateType: "BusinessInformationRevision",
        aggregateId: latestRevision.id,
        aggregateVersion: latestRevision.revision,
        eventType: "business.information.project.requested",
      },
    });
    const projectionEnvelope = parseRuntimeQueueEnvelope(projectionOutbox.payload);
    assert(
      projectionEnvelope.jobName === "project-revision" &&
        projectionEnvelope.jobId ===
          `business-information-project:${latestRevision.id}:${latestRevision.revision}` &&
        projectionOutbox.generation === latestRevision.revision,
      "PATCH did not atomically enqueue the exact manual revision projection.",
    );
    const latestLedger = await prisma.businessImportObjectLedger.findFirstOrThrow({
      where: { tenantId, objectStorageKey: latestRevision.deltaObjectKey },
    });
    const storedDelta = JSON.parse(
      Buffer.from(
        await store.get(latestRevision.deltaObjectKey, latestRevision.deltaEncryptionKeyRef),
      ).toString("utf8"),
    ) as Record<string, unknown>;
    assert(latestLedger.objectKind === "REVISION_DELTA", "PATCH omitted the object ledger.");
    assert(
      storedDelta.schema === "leadvirt.business-information-revision-delta.v1",
      "PATCH did not store the encrypted lossless revision delta.",
    );
    const currentAttributions = await prisma.businessInformationAttribution.findMany({
      where: { tenantId, businessRevisionId: latestRevision.id, supersededAt: null },
    });
    assert(currentAttributions.length >= 10, "PATCH omitted manual field attribution.");
    assert(
      currentAttributions.every(
        (item) =>
          item.authority === "MANUAL" &&
          item.importId === null &&
          item.sourceId === null &&
          item.applicationId === null,
      ),
      "Manual attribution claimed imported provenance.",
    );
    const supersededName = await prisma.businessInformationAttribution.findFirstOrThrow({
      where: {
        tenantId,
        resourceType: "OFFERING",
        resourceKey: editedOffering.id,
        fieldPath: "/name",
        businessRevisionId: revision.id,
      },
    });
    assert(supersededName.supersededAt !== null, "PATCH left two current field attributions.");
    const onboarding = await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } });
    const companyInfo = (onboarding.data as Record<string, unknown>).companyInfo as Record<
      string,
      unknown
    >;
    assert(
      companyInfo.faq === "Updated FAQ retained in compatibility storage",
      "PATCH lost a legacy-only free-text field.",
    );
    assert(
      (companyInfo.services as unknown[]).length === 3,
      "PATCH wrote a lossy service compatibility projection.",
    );
    assert(
      (await prisma.businessKnowledgeSource.count({ where: { tenantId } })) === 0 &&
        (await prisma.knowledgeOutbox.count({ where: { tenantId } })) === 0,
      "PATCH published or queued legacy Knowledge directly.",
    );

    const replay = await service.patch(
      context,
      profileMutation,
      `canonical-profile-patch-${suffix}`,
      initial.data.etag,
    );
    assert(replay.etag === patched.data.etag, "Idempotent replay changed the response.");
    assert(
      (await prisma.businessInformationRevision.count({ where: { tenantId } })) === 2,
      "Idempotent replay created another revision.",
    );
    assert(
      (await prisma.runtimeOutbox.count({
        where: { tenantId, eventType: "business.information.project.requested" },
      })) === 1,
      "Idempotent replay created another projection event.",
    );
    let staleError: unknown;
    try {
      await service.patch(
        context,
        { profile: { faq: "stale write" } },
        `canonical-profile-stale-${suffix}`,
        initial.data.etag,
      );
    } catch (error) {
      staleError = error;
    }
    assert(staleError instanceof HttpException, "A stale canonical PATCH was accepted.");

    let settingsError: unknown;
    try {
      await service.updateSettingsAccount(
        context,
        { businessName: "Legacy settings overwrite" },
        patched.data.etag,
      );
    } catch (error) {
      settingsError = error;
    }
    assert(
      errorCode(settingsError) === "BUSINESS_INFORMATION_LEGACY_WRITE_BLOCKED",
      "Settings overwrote canonical identity after cutover.",
    );
    const account = await service.updateSettingsAccount(context, { phone: "+33123456789" });
    assert(
      account.businessName === "Canonical Studio Updated" && account.phone === "+33123456789",
      "Non-canonical settings stopped working after cutover.",
    );
    let onboardingError: unknown;
    try {
      await prisma.$transaction((tx) =>
        service.updateOnboardingInTransaction(
          tx,
          context,
          { data: { companyInfo: { name: "Legacy onboarding overwrite" } } },
          patched.data.etag,
        ),
      );
    } catch (error) {
      onboardingError = error;
    }
    assert(
      errorCode(onboardingError) === "BUSINESS_INFORMATION_LEGACY_WRITE_BLOCKED",
      "Onboarding overwrote canonical identity after cutover.",
    );

    console.log(`business profile canonical cutover smoke passed (${checks} checks)`);
  } finally {
    if (tenantId || userId) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        if (tenantId) await tx.tenant.deleteMany({ where: { id: tenantId } });
        if (userId) await tx.user.deleteMany({ where: { id: userId } });
      });
    }
    await prisma.$disconnect();
    await rm(objectRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
