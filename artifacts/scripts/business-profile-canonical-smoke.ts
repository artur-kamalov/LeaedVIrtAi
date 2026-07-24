import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import { loadEnvFile } from "@leadvirt/config";
import { Prisma, prisma } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  EncryptedFileKnowledgeObjectStore,
} from "@leadvirt/knowledge";
import { parseRuntimeQueueEnvelope } from "@leadvirt/runtime-queue";
import type { Response } from "express";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { BusinessImportRuntimeService } from "../../apps/api/src/modules/business-profile/business-import-runtime.service.js";
import { BusinessImportSourceLifecycleService } from "../../apps/api/src/modules/business-profile/business-import-source-lifecycle.service.js";
import { businessImportSourceEtag } from "../../apps/api/src/modules/business-profile/business-import-http.js";
import { BusinessProfileController } from "../../apps/api/src/modules/business-profile/business-profile.controller.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import type { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { canonicalKnowledgeV2Hash } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { sweepBusinessImportPendingObjects } from "../../apps/worker/src/business-import/business-import-object-sweeper.js";

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
  let foreignTenantId: string | null = null;
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
    const idempotency = new KnowledgeV2IdempotencyService(prisma as unknown as PrismaService);
    const service = new BusinessProfileService(
      prisma as unknown as PrismaService,
      { dispatchOnboardingSync: async () => undefined } as unknown as KnowledgeService,
      idempotency,
      runtime,
    );
    const sourceLifecycle = new BusinessImportSourceLifecycleService(
      prisma as unknown as PrismaService,
      idempotency,
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
    assert(
      patched.data.profile.services.length === 3,
      "PATCH erased an omitted canonical service.",
    );
    assert(patchHeaders.headers.get("etag") === patched.data.etag, "PATCH omitted the new ETag.");
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

    const stateBeforeArchive = await prisma.businessInformationState.findUniqueOrThrow({
      where: { tenantId },
    });
    const sourceA = await prisma.businessImportSource.create({
      data: {
        tenantId,
        lineageKey: `archive-source-a-${suffix}`,
        displayName: "Catalog A",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    const sourceB = await prisma.businessImportSource.create({
      data: {
        tenantId,
        lineageKey: `archive-source-b-${suffix}`,
        displayName: "Catalog B",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    const importData = (sourceId: string, name: string) => ({
      tenantId,
      sourceId,
      purpose: "SERVICES" as const,
      catalogMode: "ADD" as const,
      format: "CSV" as const,
      state: "CANCELLED" as const,
      displayName: name,
      originalFilename: `${name.toLowerCase().replace(/\s+/gu, "-")}.csv`,
      declaredMimeType: "text/csv",
      expectedByteSize: 100n,
      uploadTokenHash: randomBytes(32).toString("hex"),
      baseBusinessRevisionId: stateBeforeArchive.currentRevisionId,
      baseInformationRevision: stateBeforeArchive.revision,
      baseInformationHash: stateBeforeArchive.canonicalHash,
      selectedCategories: ["OFFERINGS"],
      schemaVersion: "leadvirt.services.v1",
      expiresAt: new Date("2100-01-01T00:00:00.000Z"),
      cancelledAt: new Date(),
      cancelledByUserId: userId!,
      createdByUserId: userId!,
    });
    const importA = await prisma.businessImport.create({
      data: importData(sourceA.id, "Catalog A"),
    });
    const importB = await prisma.businessImport.create({
      data: importData(sourceB.id, "Catalog B"),
    });
    const activeSourceA = await prisma.businessImportSource.update({
      where: { id: sourceA.id },
      data: { latestImportId: importA.id },
    });
    await prisma.businessImportSource.update({
      where: { id: sourceB.id },
      data: { latestImportId: importB.id },
    });
    const importedOnlyBinding = await prisma.businessOfferingSourceBinding.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        offeringId: preservedOffering.id,
        externalKey: "catalog-a-imported-only",
        firstSeenImportId: importA.id,
        lastSeenImportId: importA.id,
        lastSeenSourceValueHash: canonicalKnowledgeV2Hash({ value: "imported-only" }),
      },
    });
    const manuallyEditedBinding = await prisma.businessOfferingSourceBinding.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        offeringId: editedOffering.id,
        externalKey: "catalog-a-manually-edited",
        firstSeenImportId: importA.id,
        lastSeenImportId: importA.id,
        lastSeenSourceValueHash: canonicalKnowledgeV2Hash({ value: "manually-edited" }),
      },
    });
    const otherSourceBinding = await prisma.businessOfferingSourceBinding.create({
      data: {
        tenantId,
        sourceId: sourceB.id,
        offeringId: newOffering.id,
        externalKey: "catalog-b-service",
        firstSeenImportId: importB.id,
        lastSeenImportId: importB.id,
        lastSeenSourceValueHash: canonicalKnowledgeV2Hash({ value: "other-source" }),
      },
    });
    const sharedSourceBinding = await prisma.businessOfferingSourceBinding.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        offeringId: newOffering.id,
        externalKey: "catalog-a-shared-service",
        firstSeenImportId: importA.id,
        lastSeenImportId: importA.id,
        lastSeenSourceValueHash: canonicalKnowledgeV2Hash({ value: "shared-source" }),
      },
    });
    const rawObjectKey = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: sourceA.id,
      purpose: "raw",
      identity: `archive-source-${suffix}`,
    });
    const rawBytes = new TextEncoder().encode("catalog raw file");
    const rawWrite = await store.put(rawObjectKey, rawBytes);
    const rawLedger = await prisma.businessImportObjectLedger.create({
      data: {
        tenantId,
        objectKind: "RAW_ARTIFACT",
        objectStorageKey: rawObjectKey,
        encryptionKeyRef: rawWrite.encryptionKeyRef,
        retentionClass: "BUSINESS_IMPORT_RAW",
        retainUntil: new Date("2100-01-01T00:00:00.000Z"),
      },
    });
    const rawArtifact = await prisma.businessImportArtifact.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        objectStorageKey: rawObjectKey,
        encryptionKeyRef: rawWrite.encryptionKeyRef,
        objectLedgerId: rawLedger.id,
        sha256: canonicalKnowledgeV2Hash({ raw: "catalog raw file" }),
        byteSize: BigInt(rawBytes.byteLength),
        declaredMimeType: "text/csv",
        originalFilename: "catalog-a.csv",
      },
    });
    await prisma.businessImport.update({
      where: { id: importA.id },
      data: {
        artifactId: rawArtifact.id,
        artifactSha256: rawArtifact.sha256,
        parserVersion: "canonical-smoke-parser-v1",
        mapperVersion: "canonical-smoke-mapper-v1",
      },
    });
    const createImportObject = async (
      kind: "PARSED_MANIFEST" | "EVIDENCE_EXCERPT" | "APPLICATION_PREVIEW",
      identity: string,
      retentionClass: string,
    ) => {
      const objectKey = createDeterministicKnowledgeObjectKey({
        tenantId,
        sourceId: sourceA.id,
        purpose: "extracted",
        identity: `${kind}:${identity}:${suffix}`,
      });
      const write = await store.put(objectKey, new TextEncoder().encode(`${kind}:${identity}`));
      const ledger = await prisma.businessImportObjectLedger.create({
        data: {
          tenantId,
          objectKind: kind,
          objectStorageKey: objectKey,
          encryptionKeyRef: write.encryptionKeyRef,
          retentionClass,
          retainUntil: new Date("2100-01-01T00:00:00.000Z"),
        },
      });
      return { objectKey, write, ledger };
    };
    const parsedManifestObject = await createImportObject(
      "PARSED_MANIFEST",
      "catalog-a-manifest",
      "BUSINESS_IMPORT_PARSED_MANIFEST",
    );
    const parsedManifestHash = canonicalKnowledgeV2Hash({
      schema: "canonical-smoke-import-manifest.v1",
      sourceId: sourceA.id,
    });
    const parsedRevision = await prisma.businessImportParsedRevision.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        importId: importA.id,
        importGeneration: importA.generation,
        artifactId: rawArtifact.id,
        artifactSha256: rawArtifact.sha256,
        manifestObjectLedgerId: parsedManifestObject.ledger.id,
        manifestObjectKey: parsedManifestObject.objectKey,
        manifestEncryptionKeyRef: parsedManifestObject.write.encryptionKeyRef,
        manifestHash: parsedManifestHash,
        parserVersion: "canonical-smoke-parser-v1",
        mapperVersion: "canonical-smoke-mapper-v1",
        schemaVersion: "leadvirt.services.v1",
        extractionContractVersion: "canonical-smoke-extraction-v1",
      },
    });
    await prisma.businessImport.update({
      where: { id: importA.id },
      data: {
        parsedRevisionId: parsedRevision.id,
        parsedManifestObjectKey: parsedManifestObject.objectKey,
        parsedManifestEncryptionKeyRef: parsedManifestObject.write.encryptionKeyRef,
        parsedManifestObjectLedgerId: parsedManifestObject.ledger.id,
        parsedManifestObjectKind: "PARSED_MANIFEST",
        parsedManifestHash,
      },
    });
    const importedFields = [
      {
        offeringId: editedOffering.id,
        fieldPath: "/bookingNotes",
        value: editedAfter.bookingNotes,
        candidateKey: "retained-manual-booking-notes",
      },
      {
        offeringId: newOffering.id,
        fieldPath: "/archivedAt",
        value: newOffering.archivedAt?.toISOString() ?? null,
        candidateKey: "retained-shared-archived-at",
      },
    ];
    const importedCandidates = [];
    for (const field of importedFields) {
      const evidenceId = randomUUID();
      const normalizedValue = {
        schema: "canonical-smoke-imported-field.v1",
        offeringId: field.offeringId,
        fieldPath: field.fieldPath,
        value: field.value,
      };
      const normalizedValueHash = canonicalKnowledgeV2Hash(normalizedValue);
      const candidate = await prisma.businessImportCandidate.create({
        data: {
          tenantId,
          sourceId: sourceA.id,
          importId: importA.id,
          candidateKey: field.candidateKey,
          targetCategory: "OFFERINGS",
          semanticTargetKey: `offering:${field.offeringId}`,
          action: "UPDATE",
          normalizedValue,
          normalizedValueHash,
          targetOfferingId: field.offeringId,
          risk: "LOW",
          confidence: "CONFIRMED_FORMAT",
          decision: "APPLIED",
          decidedByUserId: userId,
          decidedAt: new Date(),
          appliedAt: new Date(),
        },
      });
      await prisma.businessImportCandidateRevision.create({
        data: {
          tenantId,
          sourceId: sourceA.id,
          importId: importA.id,
          candidateId: candidate.id,
          version: candidate.version,
          parsedRevisionId: parsedRevision.id,
          importGeneration: importA.generation,
          artifactId: rawArtifact.id,
          artifactSha256: rawArtifact.sha256,
          parsedManifestHash,
          targetCategory: "OFFERINGS",
          semanticTargetKey: candidate.semanticTargetKey,
          action: "UPDATE",
          normalizedValue,
          normalizedValueHash,
          fieldProvenance: Object.fromEntries(
            [
              "/active",
              "/archivedAt",
              "/bookingNotes",
              "/category",
              "/description",
              "/duration/maximumMinutes",
              "/duration/minimumMinutes",
              "/externalId",
              "/kind",
              "/language",
              "/locationExternalId",
              "/name",
              "/price/amount",
              "/price/currency",
              "/price/from",
              "/price/taxNote",
              "/price/to",
              "/price/type",
              "/price/unit",
              "/validFrom",
              "/validUntil",
            ].map((path) => [
              path,
              path === field.fieldPath
                ? { authority: "IMPORTED", evidenceId }
                : { authority: "SYSTEM" },
            ]),
          ),
          targetOfferingId: field.offeringId,
          risk: "LOW",
          confidence: "CONFIRMED_FORMAT",
        },
      });
      const excerptObject = await createImportObject(
        "EVIDENCE_EXCERPT",
        field.candidateKey,
        "BUSINESS_IMPORT_EVIDENCE",
      );
      const sourceValueHash = canonicalKnowledgeV2Hash(field.value);
      const evidence = await prisma.businessImportCandidateEvidence.create({
        data: {
          id: evidenceId,
          tenantId,
          sourceId: sourceA.id,
          importId: importA.id,
          candidateId: candidate.id,
          candidateVersion: candidate.version,
          candidateValueHash: normalizedValueHash,
          artifactId: rawArtifact.id,
          artifactSha256: rawArtifact.sha256,
          importGeneration: importA.generation,
          parsedRevisionId: parsedRevision.id,
          parsedManifestHash,
          evidenceRecordHash: canonicalKnowledgeV2Hash({
            candidateId: candidate.id,
            fieldPath: field.fieldPath,
          }),
          locator: { row: importedCandidates.length + 1, fieldPath: field.fieldPath },
          sourceValueHash,
          excerptHash: canonicalKnowledgeV2Hash({
            fieldPath: field.fieldPath,
            value: field.value,
          }),
          excerptObjectKey: excerptObject.objectKey,
          excerptEncryptionKeyRef: excerptObject.write.encryptionKeyRef,
          excerptObjectLedgerId: excerptObject.ledger.id,
          parserVersion: "canonical-smoke-parser-v1",
          extractionContractVersion: "canonical-smoke-extraction-v1",
        },
      });
      importedCandidates.push({ field, candidate, normalizedValueHash, evidence });
    }
    const previewObject = await createImportObject(
      "APPLICATION_PREVIEW",
      "catalog-a-application",
      "BUSINESS_IMPORT_APPLICATION_PREVIEW",
    );
    const importedApplication = await prisma.businessImportApplication.create({
      data: {
        tenantId,
        sourceId: sourceA.id,
        importId: importA.id,
        state: "PROJECTING",
        previewManifestHash: canonicalKnowledgeV2Hash({ preview: sourceA.id }),
        previewObjectLedgerId: previewObject.ledger.id,
        previewObjectKey: previewObject.objectKey,
        previewEncryptionKeyRef: previewObject.write.encryptionKeyRef,
        candidateManifestHash: canonicalKnowledgeV2Hash({
          candidates: importedCandidates.map((item) => item.candidate.id),
        }),
        idempotencyKeyHash: canonicalKnowledgeV2Hash({
          idempotencyKey: `canonical-smoke-${suffix}`,
        }),
        idempotencyRequestHash: canonicalKnowledgeV2Hash({
          request: `canonical-smoke-${suffix}`,
        }),
        baseInformationRevision: revision.revision,
        baseInformationHash: revision.canonicalHash,
        baseBusinessRevisionId: revision.id,
        resultingInformationRevision: latestRevision.revision,
        resultingInformationHash: latestRevision.canonicalHash,
        businessRevisionId: latestRevision.id,
        affectedResourceVersions: importedCandidates.map((item) => ({
          offeringId: item.field.offeringId,
          fieldPath: item.field.fieldPath,
        })),
        projectionOutboxDedupeKey: projectionOutbox.dedupeKey,
        projectionOutboxId: projectionOutbox.id,
        createdByUserId: userId,
      },
    });
    const importedSourceAttributions = [];
    for (const item of importedCandidates) {
      await prisma.businessImportApplicationCandidate.create({
        data: {
          tenantId,
          sourceId: sourceA.id,
          importId: importA.id,
          applicationId: importedApplication.id,
          candidateId: item.candidate.id,
          candidateVersion: item.candidate.version,
          candidateValueHash: item.normalizedValueHash,
          action: "UPDATE",
          targetCategory: "OFFERINGS",
          risk: "LOW",
          requiresApproval: false,
          requiredPermission: "",
        },
      });
      importedSourceAttributions.push(
        await prisma.businessInformationAttribution.create({
          data: {
            tenantId,
            resourceType: "OFFERING",
            resourceKey: item.field.offeringId,
            offeringId: item.field.offeringId,
            fieldPath: item.field.fieldPath,
            currentValueHash: canonicalKnowledgeV2Hash(item.field.value),
            sourceValueHash: item.evidence.sourceValueHash,
            authority: "IMPORTED",
            confidence: "CONFIRMED_FORMAT",
            sourceId: sourceA.id,
            importId: importA.id,
            candidateId: item.candidate.id,
            candidateVersion: item.candidate.version,
            candidateValueHash: item.normalizedValueHash,
            evidenceId: item.evidence.id,
            artifactId: rawArtifact.id,
            artifactSha256: rawArtifact.sha256,
            importGeneration: importA.generation,
            parsedRevisionId: parsedRevision.id,
            parsedManifestHash,
            applicationId: importedApplication.id,
            businessRevisionId: latestRevision.id,
            businessRevision: latestRevision.revision,
            businessRevisionHash: latestRevision.canonicalHash,
            parserVersion: "canonical-smoke-parser-v1",
            mapperVersion: "canonical-smoke-mapper-v1",
            schemaVersion: "leadvirt.services.v1",
          },
        }),
      );
    }
    const staleCatalogAttributions = await Promise.all(
      [
        { fieldPath: "/active", value: true },
        { fieldPath: "/archivedAt", value: null },
      ].map((field) =>
        prisma.businessInformationAttribution.create({
          data: {
            tenantId,
            resourceType: "OFFERING",
            resourceKey: preservedOffering.id,
            offeringId: preservedOffering.id,
            fieldPath: field.fieldPath,
            currentValueHash: canonicalKnowledgeV2Hash(field.value),
            authority: "SYSTEM",
            businessRevisionId: stateBeforeArchive.currentRevisionId!,
            businessRevision: stateBeforeArchive.revision,
            businessRevisionHash: stateBeforeArchive.canonicalHash,
          },
        }),
      ),
    );
    const preservedCatalogManualAttribution = await prisma.businessInformationAttribution.create({
      data: {
        tenantId,
        resourceType: "OFFERING",
        resourceKey: preservedOffering.id,
        offeringId: preservedOffering.id,
        fieldPath: "/description",
        currentValueHash: canonicalKnowledgeV2Hash(preservedOffering.description),
        authority: "MANUAL",
        businessRevisionId: stateBeforeArchive.currentRevisionId!,
        businessRevision: stateBeforeArchive.revision,
        businessRevisionHash: stateBeforeArchive.canonicalHash,
      },
    });
    const sourceBeforeRace = await prisma.businessImportSource.findUniqueOrThrow({
      where: { id: sourceB.id },
    });
    let raceImportId: string | null = null;
    let raceSettled = false;
    let raceOutcome: Promise<{ ok: true } | { ok: false; error: unknown }> | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT TRUE AS "locked"
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${"business-import-catalog:" + tenantId}, 0)
          )
        ) AS catalog_lock
      `;
      raceOutcome = sourceLifecycle
        .archive(
          context,
          sourceB.id,
          `archive-race-${suffix}`,
          businessImportSourceEtag(sourceBeforeRace.id, sourceBeforeRace.etag),
        )
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      void raceOutcome.then(() => {
        raceSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert(!raceSettled, "Catalog archive did not wait for the catalog mutation lock.");
      const raceImport = await tx.businessImport.create({
        data: {
          ...importData(sourceB.id, "Catalog B race"),
          state: "CREATED",
          cancelledAt: null,
          cancelledByUserId: null,
        },
      });
      raceImportId = raceImport.id;
      await tx.businessImportSource.update({
        where: { id: sourceB.id },
        data: {
          latestImportId: raceImport.id,
          etag: { increment: 1 },
          updatedByUserId: userId,
        },
      });
    });
    assert(raceOutcome && raceImportId, "Catalog archive race was not exercised.");
    const raceResult = await raceOutcome;
    assert(
      !raceResult.ok &&
        errorCode(raceResult.error) === "BUSINESS_IMPORT_REVISION_CONFLICT" &&
        (
          await prisma.businessImportSource.findUniqueOrThrow({
            where: { id: sourceB.id },
          })
        ).status === "ACTIVE",
      "A concurrent import left its catalog archived.",
    );
    const raceBlockedPreview = await sourceLifecycle.preview(context, sourceB.id);
    assert(
      !raceBlockedPreview.canArchive &&
        raceBlockedPreview.activeImports.items[0]?.id === raceImportId &&
        raceBlockedPreview.activeImports.items[0]?.href ===
          `/app/knowledge/imports/${raceImportId}`,
      "The catalog race did not surface its active import as the archive blocker.",
    );
    await prisma.businessImport.update({
      where: { id: raceImportId },
      data: {
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: userId,
      },
    });

    await prisma.businessImport.update({
      where: { id: importA.id },
      data: {
        state: "CREATED",
        cancelledAt: null,
        cancelledByUserId: null,
      },
    });
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role: "MANAGER" },
    });
    let managerArchiveError: unknown;
    try {
      await sourceLifecycle.preview({ ...context, role: "MANAGER" }, sourceA.id);
    } catch (error) {
      managerArchiveError = error;
    }
    assert(
      errorCode(managerArchiveError) === "BUSINESS_IMPORT_PERMISSION_DENIED",
      "A manager could preview a destructive catalog archive.",
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role: "OWNER" },
    });
    const blockedPreview = await sourceLifecycle.preview(context, sourceA.id);
    assert(
      !blockedPreview.canArchive &&
        blockedPreview.activeImports.count === 1 &&
        blockedPreview.activeImports.items[0]?.id === importA.id &&
        blockedPreview.activeImports.items[0]?.href === `/app/knowledge/imports/${importA.id}`,
      "Catalog archive preview did not expose the active-import blocker.",
    );
    await prisma.businessImport.update({
      where: { id: importA.id },
      data: {
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: userId,
      },
    });
    const archivePreview = await sourceLifecycle.preview(context, sourceA.id);
    assert(
      archivePreview.canArchive &&
        archivePreview.impact.removeOfferings === 0 &&
        archivePreview.impact.retainedOfferings === 3 &&
        archivePreview.impact.sharedOfferings === 1 &&
        archivePreview.impact.manualOfferings === 3 &&
        archivePreview.impact.detachedOfferingBindings === 3 &&
        archivePreview.impact.objectsScheduledForDeletion === 5,
      "Catalog archive preview reported incorrect ownership or cleanup effects.",
    );

    const archiveKey = `archive-catalog-${suffix}`;
    const archiveReceipt = await sourceLifecycle.archive(
      context,
      sourceA.id,
      archiveKey,
      businessImportSourceEtag(activeSourceA.id, activeSourceA.etag),
    );
    assert(archiveReceipt.status === "ARCHIVED", "Catalog source was not archived.");
    assert(
      archiveReceipt.archivedOfferings === 0 &&
        archiveReceipt.retainedOfferings === 3 &&
        archiveReceipt.sharedOfferings === 1 &&
        archiveReceipt.manualOfferings === 3 &&
        archiveReceipt.detachedOfferingBindings === 3 &&
        archiveReceipt.objectsScheduledForDeletion === 5,
      "Catalog archive reported incorrect offering effects.",
    );
    assert(
      !archiveReceipt.projectionQueued &&
        archiveReceipt.businessInformationRevision === null &&
        archiveReceipt.businessInformationRevisionId === null,
      "All-retained catalog archive invented a business-information revision.",
    );
    const [
      archivedSource,
      importedOnlyAfterArchive,
      manualAfterArchive,
      importedBindingAfterArchive,
      manualBindingAfterArchive,
      otherBindingAfterArchive,
      sharedBindingAfterArchive,
      rawLedgerAfterArchive,
      stateAfterArchive,
      currentArchiveAttributions,
      staleCatalogAttributionsAfterArchive,
      importedSourceAttributionsAfterArchive,
      retainedReconciledAttributions,
      archivedSourceCurrentAttributionCount,
      preservedManualAttributions,
      importedEvidenceLedgersAfterArchive,
    ] = await Promise.all([
      prisma.businessImportSource.findUniqueOrThrow({ where: { id: sourceA.id } }),
      prisma.businessOffering.findUniqueOrThrow({ where: { id: preservedOffering.id } }),
      prisma.businessOffering.findUniqueOrThrow({ where: { id: editedOffering.id } }),
      prisma.businessOfferingSourceBinding.findUniqueOrThrow({
        where: { id: importedOnlyBinding.id },
      }),
      prisma.businessOfferingSourceBinding.findUniqueOrThrow({
        where: { id: manuallyEditedBinding.id },
      }),
      prisma.businessOfferingSourceBinding.findUniqueOrThrow({
        where: { id: otherSourceBinding.id },
      }),
      prisma.businessOfferingSourceBinding.findUniqueOrThrow({
        where: { id: sharedSourceBinding.id },
      }),
      prisma.businessImportObjectLedger.findUniqueOrThrow({
        where: { id: rawLedger.id },
      }),
      prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.businessInformationAttribution.findMany({
        where: {
          tenantId,
          resourceType: "OFFERING",
          resourceKey: preservedOffering.id,
          fieldPath: { in: ["/active", "/archivedAt"] },
          supersededAt: null,
        },
        orderBy: { fieldPath: "asc" },
      }),
      prisma.businessInformationAttribution.findMany({
        where: { id: { in: staleCatalogAttributions.map((item) => item.id) } },
        orderBy: { fieldPath: "asc" },
      }),
      prisma.businessInformationAttribution.findMany({
        where: { id: { in: importedSourceAttributions.map((item) => item.id) } },
        orderBy: { fieldPath: "asc" },
      }),
      prisma.businessInformationAttribution.findMany({
        where: {
          tenantId,
          resourceType: "OFFERING",
          OR: importedFields.map((field) => ({
            resourceKey: field.offeringId,
            fieldPath: field.fieldPath,
          })),
          supersededAt: null,
        },
        orderBy: [{ resourceKey: "asc" }, { fieldPath: "asc" }],
      }),
      prisma.businessInformationAttribution.count({
        where: { tenantId, sourceId: sourceA.id, supersededAt: null },
      }),
      prisma.businessInformationAttribution.findMany({
        where: {
          id: {
            in: [
              ...currentAttributions.map((item) => item.id),
              preservedCatalogManualAttribution.id,
            ],
          },
          supersededAt: null,
        },
      }),
      prisma.businessImportObjectLedger.findMany({
        where: {
          id: { in: importedCandidates.map((item) => item.evidence.excerptObjectLedgerId) },
        },
      }),
    ]);
    assert(
      archivedSource.status === "ARCHIVED" && archivedSource.archivedAt !== null,
      "Catalog archive did not preserve a reversible source tombstone.",
    );
    assert(
      importedOnlyAfterArchive.active && importedOnlyAfterArchive.archivedAt === null,
      "All-retained catalog archive changed canonical offering content.",
    );
    assert(manualAfterArchive.active, "Manually attributed offering was archived.");
    assert(
      !importedBindingAfterArchive.active &&
        !manualBindingAfterArchive.active &&
        otherBindingAfterArchive.active &&
        !sharedBindingAfterArchive.active,
      "Catalog archive crossed a source-lineage boundary.",
    );
    assert(
      rawLedgerAfterArchive.deletionState === "TOMBSTONED" &&
        rawLedgerAfterArchive.retainUntil?.toISOString() === "2100-01-01T00:00:00.000Z" &&
        rawLedgerAfterArchive.tombstoneReason === "BUSINESS_IMPORT_SOURCE_ARCHIVED",
      "Catalog archive did not preserve retention metadata on its source tombstone.",
    );
    assert(
      (
        await prisma.businessImportArtifact.findUniqueOrThrow({
          where: { id: rawArtifact.id },
        })
      ).sha256 === rawArtifact.sha256,
      "Catalog archive removed artifact audit metadata or hashes.",
    );
    assert(
      stateAfterArchive.revision === stateBeforeArchive.revision &&
        stateAfterArchive.currentRevisionId === stateBeforeArchive.currentRevisionId &&
        stateAfterArchive.canonicalHash === stateBeforeArchive.canonicalHash,
      "All-retained catalog archive advanced canonical state.",
    );
    assert(
      staleCatalogAttributionsAfterArchive.every((item) => item.supersededAt === null),
      "All-retained catalog archive superseded unchanged lifecycle provenance.",
    );
    const archiveAttributionByPath = new Map(
      currentArchiveAttributions.map((item) => [item.fieldPath, item]),
    );
    assert(
      currentArchiveAttributions.length === 2 &&
        currentArchiveAttributions.every(
          (item) =>
            item.authority === "SYSTEM" &&
            item.businessRevisionId === stateBeforeArchive.currentRevisionId &&
            item.businessRevision === stateBeforeArchive.revision &&
            item.businessRevisionHash === stateAfterArchive.canonicalHash,
        ) &&
        archiveAttributionByPath.get("/active")?.currentValueHash ===
          canonicalKnowledgeV2Hash(true) &&
        archiveAttributionByPath.get("/archivedAt")?.currentValueHash ===
          canonicalKnowledgeV2Hash(null),
      "All-retained catalog archive changed lifecycle provenance.",
    );
    assert(
      importedSourceAttributionsAfterArchive.every((item) => item.supersededAt !== null) &&
        archivedSourceCurrentAttributionCount === 0,
      "Catalog archive left imported attribution from the archived source current.",
    );
    const reconciledByField = new Map(
      retainedReconciledAttributions.map((item) => [`${item.resourceKey}:${item.fieldPath}`, item]),
    );
    assert(
      retainedReconciledAttributions.length === importedFields.length &&
        importedFields.every((field) => {
          const attribution = reconciledByField.get(`${field.offeringId}:${field.fieldPath}`);
          return (
            attribution?.authority === "SYSTEM" &&
            attribution.sourceId === null &&
            attribution.evidenceId === null &&
            attribution.currentValueHash === canonicalKnowledgeV2Hash(field.value) &&
            attribution.businessRevisionId === stateBeforeArchive.currentRevisionId &&
            attribution.businessRevision === stateBeforeArchive.revision
          );
        }),
      "Retained offerings were left without source-independent canonical provenance.",
    );
    assert(
      preservedManualAttributions.length === currentAttributions.length + 1,
      "Catalog archive superseded unrelated manual attribution.",
    );
    assert(
      importedEvidenceLedgersAfterArchive.every(
        (ledger) =>
          ledger.deletionState === "TOMBSTONED" &&
          ledger.tombstoneReason === "BUSINESS_IMPORT_SOURCE_ARCHIVED",
      ),
      "Catalog archive did not detach current evidence before tombstoning imported excerpts.",
    );
    const archiveReplay = await sourceLifecycle.archive(
      context,
      sourceA.id,
      archiveKey,
      businessImportSourceEtag(activeSourceA.id, activeSourceA.etag),
    );
    assert(
      archiveReplay.businessInformationRevisionId ===
        archiveReceipt.businessInformationRevisionId &&
        (await prisma.businessInformationRevision.count({ where: { tenantId } })) === 2,
      "Catalog archive idempotent replay created another revision.",
    );
    await sweepBusinessImportPendingObjects({
      prisma,
      objectStore: store,
      now: () => new Date(Date.now() + 1_000),
      id: randomUUID,
      batchSize: 100,
      staleDeletingMs: 15 * 60_000,
    });
    assert(
      (
        await prisma.businessImportObjectLedger.findUniqueOrThrow({
          where: { id: rawLedger.id },
        })
      ).deletionState === "DELETED",
      "The object sweeper did not purge a source-archive tombstone.",
    );
    let purgedRaw = false;
    try {
      await store.get(rawObjectKey, rawWrite.encryptionKeyRef);
    } catch {
      purgedRaw = true;
    }
    assert(purgedRaw, "The source raw object remained after the asynchronous sweep.");

    const ownedOnlyOffering = await prisma.businessOffering.create({
      data: {
        id: `offering-owned-only-${suffix}`,
        tenantId,
        name: "Catalog-owned service",
        description: "Archived with its only catalog",
        locale: "en",
      },
    });
    const ownedOnlySource = await prisma.businessImportSource.create({
      data: {
        tenantId,
        lineageKey: `archive-source-owned-only-${suffix}`,
        displayName: "Owned-only catalog",
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    const ownedOnlyImport = await prisma.businessImport.create({
      data: importData(ownedOnlySource.id, "Owned-only catalog"),
    });
    const activeOwnedOnlySource = await prisma.businessImportSource.update({
      where: { id: ownedOnlySource.id },
      data: { latestImportId: ownedOnlyImport.id },
    });
    await prisma.businessOfferingSourceBinding.create({
      data: {
        tenantId,
        sourceId: ownedOnlySource.id,
        offeringId: ownedOnlyOffering.id,
        externalKey: "owned-only-service",
        firstSeenImportId: ownedOnlyImport.id,
        lastSeenImportId: ownedOnlyImport.id,
        lastSeenSourceValueHash: canonicalKnowledgeV2Hash({ value: "owned-only" }),
      },
    });
    const ownedOnlyPreview = await sourceLifecycle.preview(context, ownedOnlySource.id);
    assert(
      ownedOnlyPreview.canArchive &&
        ownedOnlyPreview.impact.removeOfferings === 1 &&
        ownedOnlyPreview.impact.retainedOfferings === 0,
      "Owned-only catalog archive preview lost its canonical mutation.",
    );
    const ownedOnlyReceipt = await sourceLifecycle.archive(
      context,
      ownedOnlySource.id,
      `archive-owned-only-${suffix}`,
      businessImportSourceEtag(activeOwnedOnlySource.id, activeOwnedOnlySource.etag),
    );
    const [
      ownedOnlyOfferingAfterArchive,
      ownedOnlyStateAfterArchive,
      ownedOnlyAttributions,
      ownedOnlySourceAfterArchive,
    ] = await Promise.all([
      prisma.businessOffering.findUniqueOrThrow({ where: { id: ownedOnlyOffering.id } }),
      prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.businessInformationAttribution.findMany({
        where: {
          tenantId,
          resourceType: "OFFERING",
          resourceKey: ownedOnlyOffering.id,
          fieldPath: { in: ["/active", "/archivedAt"] },
          supersededAt: null,
        },
      }),
      prisma.businessImportSource.findUniqueOrThrow({ where: { id: ownedOnlySource.id } }),
    ]);
    const ownedOnlyAttributionByPath = new Map(
      ownedOnlyAttributions.map((item) => [item.fieldPath, item]),
    );
    assert(
      ownedOnlyReceipt.projectionQueued &&
        ownedOnlyReceipt.businessInformationRevision === 3 &&
        ownedOnlyStateAfterArchive.revision === 3 &&
        ownedOnlyStateAfterArchive.currentRevisionId ===
          ownedOnlyReceipt.businessInformationRevisionId &&
        !ownedOnlyOfferingAfterArchive.active &&
        ownedOnlyOfferingAfterArchive.archivedAt !== null &&
        ownedOnlySourceAfterArchive.status === "ARCHIVED",
      "Owned-only catalog archive did not advance canonical state exactly once.",
    );
    assert(
      ownedOnlyAttributions.length === 2 &&
        ownedOnlyAttributions.every(
          (item) =>
            item.authority === "SYSTEM" &&
            item.businessRevisionId === ownedOnlyReceipt.businessInformationRevisionId,
        ) &&
        ownedOnlyAttributionByPath.get("/active")?.currentValueHash ===
          canonicalKnowledgeV2Hash(false) &&
        ownedOnlyAttributionByPath.get("/archivedAt")?.currentValueHash ===
          canonicalKnowledgeV2Hash(ownedOnlyOfferingAfterArchive.archivedAt?.toISOString()),
      "Owned-only catalog archive did not write canonical lifecycle provenance.",
    );

    const foreignTenant = await prisma.tenant.create({
      data: {
        name: "Foreign tenant",
        slug: `canonical-profile-foreign-${suffix}`,
        timezone: "UTC",
      },
    });
    foreignTenantId = foreignTenant.id;
    await prisma.membership.create({
      data: { tenantId: foreignTenant.id, userId, role: "OWNER" },
    });
    const foreignSource = await prisma.businessImportSource.create({
      data: {
        tenantId: foreignTenant.id,
        lineageKey: `foreign-source-${suffix}`,
        displayName: "Foreign catalog",
        createdByUserId: userId,
      },
    });
    let foreignArchiveError: unknown;
    try {
      await sourceLifecycle.archive(
        context,
        foreignSource.id,
        `archive-foreign-${suffix}`,
        businessImportSourceEtag(foreignSource.id, foreignSource.etag),
      );
    } catch (error) {
      foreignArchiveError = error;
    }
    assert(
      errorCode(foreignArchiveError) === "BUSINESS_IMPORT_SOURCE_NOT_FOUND" &&
        (
          await prisma.businessImportSource.findUniqueOrThrow({
            where: { id: foreignSource.id },
          })
        ).status === "ACTIVE",
      "Catalog archive was not tenant-scoped.",
    );

    console.log(`business profile canonical cutover smoke passed (${checks} checks)`);
  } finally {
    if (tenantId || foreignTenantId || userId) {
      await prisma.$transaction(async (tx) => {
        const tenantIds = [tenantId, foreignTenantId].filter((id): id is string => id !== null);
        const tenantScopedTables = await tx.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
          SELECT DISTINCT columns.table_name AS "tableName"
          FROM information_schema.columns AS columns
          WHERE columns.table_schema = current_schema()
            AND columns.column_name = 'tenantId'
          ORDER BY columns.table_name
        `);
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        for (const table of tenantScopedTables) {
          if (!/^[A-Za-z0-9_]+$/u.test(table.tableName)) {
            throw new Error(`Unexpected tenant-scoped table name: ${table.tableName}`);
          }
          for (const scopedTenantId of tenantIds) {
            await tx.$executeRawUnsafe(
              `DELETE FROM "${table.tableName}" WHERE "tenantId" = $1`,
              scopedTenantId,
            );
          }
        }
        if (tenantIds.length > 0) {
          await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
        }
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
