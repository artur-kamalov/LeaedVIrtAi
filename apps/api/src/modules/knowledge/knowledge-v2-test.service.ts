import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  compareKnowledgeCanonicalText,
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
  KNOWLEDGE_V2_QUERY_HASH_PURPOSES,
  equalKnowledgeV2QueryHashBindings,
  parseKnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashBinding,
  type KnowledgeV2QueryHashKeyring,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2ActorView,
  KnowledgeV2ArchiveTestCaseRequest,
  KnowledgeV2CreateTestCaseRequest,
  KnowledgeV2JsonValue,
  KnowledgeV2MutationResult,
  KnowledgeV2TestCaseListQuery,
  KnowledgeV2TestCaseInputView,
  KnowledgeV2TestCaseMutationResult,
  KnowledgeV2TestCasePage,
  KnowledgeV2TestCaseView,
  KnowledgeV2TestCaseVersionView,
  KnowledgeV2TestExpectationInput,
  KnowledgeV2TestExpectationView,
  KnowledgeV2UpdateTestCaseRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  assertIfMatch,
  knowledgeV2Error,
  requireIdempotencyKey,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import {
  KnowledgeV2IdempotencyService,
  type KnowledgeV2IdempotencyResult,
} from "./knowledge-v2-idempotency.service.js";
import { KNOWLEDGE_V2_QUERY_HASH_KEYRING } from "./knowledge.tokens.js";
import {
  canonicalKnowledgeV2Locale,
  canonicalKnowledgeV2Scope,
  knowledgeV2ScopeView,
} from "./knowledge-v2-scope.js";

const testCaseInclude = {
  currentVersion: {
    include: { expectations: { orderBy: { ordinal: "asc" } } },
  },
} satisfies Prisma.KnowledgeV2TestCaseInclude;

type TestCaseRecord = Prisma.KnowledgeV2TestCaseGetPayload<{ include: typeof testCaseInclude }>;
type TestCaseVersionRecord = NonNullable<TestCaseRecord["currentVersion"]>;
type TestExpectationRecord = TestCaseVersionRecord["expectations"][number];
type ActorMap = ReadonlyMap<string, KnowledgeV2ActorView>;

interface RestrictedReferencePayload {
  version: 1;
  key: string;
  encryptionKeyRef: string;
}

interface CanonicalExpectation {
  kind: KnowledgeV2TestExpectationInput["kind"];
  factId: string | null;
  guidanceRuleId: string | null;
  evidenceReferenceId: string | null;
  semanticKey: string | null;
  expectedValueHash: string | null;
  restrictedExpectedRef: string | null;
}

interface VersionMaterial {
  queryHash: string;
  queryHashKeyId: string;
  queryHashVersion: string;
  restrictedInputRef: string;
  expectedBehavior: TestCaseVersionRecord["expectedBehavior"];
  locale: string;
  channelType: TestCaseVersionRecord["channelType"];
  audience: TestCaseVersionRecord["audience"];
  scope: Prisma.InputJsonObject | null;
  sliceKeys: string[];
  datasetVersion: string;
  riskLevel: TestCaseVersionRecord["riskLevel"];
  expectations: CanonicalExpectation[];
}

interface PreparedRestrictedValue {
  contentHash: string;
  reference: string;
}

interface PreparedRestrictedQueryValue extends PreparedRestrictedValue {
  binding: KnowledgeV2QueryHashBinding;
}

interface RestrictedTextInput {
  hash: string;
  value: string;
}

interface RestrictedQueryInput extends RestrictedTextInput {
  binding: KnowledgeV2QueryHashBinding;
}

interface PreparedExpectations {
  items: CanonicalExpectation[];
  restrictedValues: Array<RestrictedTextInput | null>;
}

const restrictedReferencePrefix = "lvobj:v1:";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const safeSemanticKey = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const maximumRestrictedBytes = 32 * 1024;
const maximumTenantCases = 5_000;

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort(compareKnowledgeCanonicalText);
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function optionalJson(value: Prisma.InputJsonObject | null) {
  return value === null ? Prisma.DbNull : value;
}

function actorMapForContext(context: RequestContext): ActorMap {
  return new Map([
    [
      context.userId,
      {
        id: context.userId,
        displayName: context.user.name?.trim() || "Workspace member",
      },
    ],
  ]);
}

function mutationResult<T>(result: KnowledgeV2IdempotencyResult<T>): KnowledgeV2MutationResult<T> {
  return { resource: result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
}

function encodeRestrictedReference(input: { key: string; encryptionKeyRef: string }) {
  const payload: RestrictedReferencePayload = {
    version: 1,
    key: input.key,
    encryptionKeyRef: input.encryptionKeyRef,
  };
  return `${restrictedReferencePrefix}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

@Injectable()
export class KnowledgeV2TestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(KNOWLEDGE_V2_QUERY_HASH_KEYRING)
    private readonly queryHashes: KnowledgeV2QueryHashKeyring,
  ) {}

  async listTestCases(
    context: RequestContext,
    query: KnowledgeV2TestCaseListQuery,
  ): Promise<KnowledgeV2TestCasePage> {
    this.assertReader(context);
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const limit = query.limit ?? 25;
    const filters: Prisma.KnowledgeV2TestCaseWhereInput[] = [];
    if (query.query) {
      filters.push({
        OR: [
          { safeLabel: { contains: query.query, mode: "insensitive" } },
          { caseKey: { contains: query.query, mode: "insensitive" } },
        ],
      });
    }
    if (cursor) {
      filters.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.knowledgeV2TestCase.findMany({
      where: {
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        ...(query.status ? { status: query.status } : { status: { not: "ARCHIVED" } }),
        ...(query.origin ? { origin: query.origin } : {}),
        ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
        ...(query.critical !== undefined ? { critical: query.critical } : {}),
        ...(query.locale
          ? { currentVersion: { locale: canonicalKnowledgeV2Locale(query.locale) } }
          : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      include: testCaseInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const pageRows = rows.slice(0, limit);
    const actors = await this.actorMap(
      context,
      pageRows.flatMap((row) => [
        row.createdByUserId,
        row.archivedByUserId,
        row.currentVersion?.createdByUserId,
      ]),
    );
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.testCaseView(context, row, actors)),
      pageInfo: {
        limit,
        hasNextPage: rows.length > limit,
        nextCursor:
          rows.length > limit && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getTestCase(context: RequestContext, testCaseId: string): Promise<KnowledgeV2TestCaseView> {
    this.assertReader(context);
    const record = await this.prisma.knowledgeV2TestCase.findFirst({
      where: { id: testCaseId, tenantId: context.tenantId, corpusKind: "STRUCTURED_V2" },
      include: testCaseInclude,
    });
    if (!record) throw this.notFound();
    const actors = await this.actorMap(context, [
      record.createdByUserId,
      record.archivedByUserId,
      record.currentVersion?.createdByUserId,
    ]);
    return this.testCaseView(context, record, actors);
  }

  async getTestCaseInput(
    context: RequestContext,
    testCaseId: string,
  ): Promise<KnowledgeV2TestCaseInputView> {
    this.assertEditor(context);
    const record = await this.prisma.knowledgeV2TestCase.findFirst({
      where: {
        id: testCaseId,
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        status: { not: "ARCHIVED" },
      },
      include: testCaseInclude,
    });
    if (!record?.currentVersion) throw this.notFound();
    const version = record.currentVersion;
    const question = await this.readRestrictedQuery(
      context.tenantId,
      version.restrictedInputRef,
      this.queryBinding(version),
    );
    const mayReadExpected = context.role === "OWNER" || context.role === "ADMIN";
    const expectations = await Promise.all(
      version.expectations.map(async (expectation) => ({
        ordinal: expectation.ordinal,
        ...(mayReadExpected && expectation.restrictedExpectedRef && expectation.expectedValueHash
          ? {
              restrictedExpectedValue: await this.readRestrictedValue(
                expectation.restrictedExpectedRef,
                expectation.expectedValueHash,
              ),
            }
          : {}),
      })),
    );
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "knowledge.v2.test_case.input_read",
        entityType: "knowledge_v2",
        entityId: record.id,
        payload: {
          testCaseId: record.id,
          versionId: version.id,
          queryHash: version.queryHash,
          queryHashKeyId: version.queryHashKeyId,
          queryHashVersion: version.queryHashVersion,
          expectedValueHashes: mayReadExpected
            ? version.expectations.flatMap((item) =>
                item.expectedValueHash ? [item.expectedValueHash] : [],
              )
            : [],
          expectedValuesDisclosed: mayReadExpected,
        },
      },
    });
    return { testCaseId: record.id, versionId: version.id, question, expectations };
  }

  async getTestCaseRuntimeInput(tenantId: string, testCaseId: string, versionId: string) {
    const version = await this.prisma.knowledgeV2TestCaseVersion.findFirst({
      where: {
        id: versionId,
        tenantId,
        testCaseId,
        corpusKind: "STRUCTURED_V2",
        testCase: { status: "ACTIVE" },
      },
    });
    if (!version) throw this.notFound();
    const binding = this.queryBinding(version);
    return {
      testCaseId,
      versionId: version.id,
      question: await this.readRestrictedQuery(tenantId, version.restrictedInputRef, binding),
      queryHashBinding: binding,
    };
  }

  async createTestCase(
    context: RequestContext,
    input: KnowledgeV2CreateTestCaseRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2TestCaseMutationResult> {
    this.assertEditor(context);
    const safeIdempotencyKey = requireIdempotencyKey(idempotencyKey);
    const question = this.restrictedQuery(context.tenantId, input.question, "question");
    const preparedExpectations = this.prepareExpectations(input.expectations);
    const result = await this.idempotency.execute<KnowledgeV2TestCaseView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/test-cases",
        key: safeIdempotencyKey,
        request: this.sanitizedMutationRequest(input, question, preparedExpectations),
      },
      async (tx) => {
        await this.lockTenant(tx, context.tenantId);
        const count = await tx.knowledgeV2TestCase.count({ where: { tenantId: context.tenantId } });
        if (count >= maximumTenantCases) {
          throw knowledgeV2Error(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "KNOWLEDGE_QUOTA_TEST_CASE_LIMIT_REACHED",
            "The workspace test-case limit has been reached.",
          );
        }
        await this.assertExpectationReferences(tx, context.tenantId, preparedExpectations.items);
        const storedQuestion = await this.storeRestrictedQuery(
          context.tenantId,
          safeIdempotencyKey,
          "create",
          "question",
          question,
        );
        const expectations = await this.storeExpectationValues(
          context.tenantId,
          safeIdempotencyKey,
          "create",
          preparedExpectations,
        );
        const material = this.createVersionMaterial(input, storedQuestion, expectations);
        const id = randomUUID();
        const testCase = await tx.knowledgeV2TestCase.create({
          data: {
            id,
            tenantId: context.tenantId,
            caseKey: `tenant:${id}`,
            safeLabel: input.safeLabel.trim(),
            origin: "TENANT",
            status: "DRAFT",
            riskLevel: material.riskLevel,
            critical: input.critical,
            latestVersionNumber: 0,
            createdByUserId: context.userId,
          },
        });
        const version = await this.createVersion(tx, context, testCase.id, 1, material, null);
        await tx.knowledgeV2TestCase.update({
          where: { id: testCase.id },
          data: {
            currentVersionId: version.id,
            latestVersionNumber: 1,
            status: input.status ?? "DRAFT",
          },
        });
        await this.bumpDraftGeneration(tx, context.tenantId);
        await this.audit(tx, context, "knowledge.v2.test_case.created", testCase.id, {
          caseKey: testCase.caseKey,
          safeLabelHash: canonicalKnowledgeV2Hash(input.safeLabel.trim()),
          queryHash: material.queryHash,
          queryHashKeyId: material.queryHashKeyId,
          queryHashVersion: material.queryHashVersion,
          versionHash: version.immutableHash,
          expectationCount: material.expectations.length,
          critical: input.critical,
          riskLevel: material.riskLevel,
        });
        const record = await this.getRecord(tx, context.tenantId, testCase.id);
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: this.testCaseView(context, record, actorMapForContext(context)),
          responseRef: testCase.id,
        };
      },
    );
    return mutationResult(result);
  }

  async updateTestCase(
    context: RequestContext,
    testCaseId: string,
    input: KnowledgeV2UpdateTestCaseRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2TestCaseMutationResult> {
    this.assertEditor(context);
    this.assertUpdateInput(input);
    const safeIdempotencyKey = requireIdempotencyKey(idempotencyKey);
    const operation = `update-${testCaseId}`;
    const question =
      input.question === undefined
        ? undefined
        : this.restrictedQuery(context.tenantId, input.question, "question");
    const preparedExpectations =
      input.expectations === undefined ? undefined : this.prepareExpectations(input.expectations);
    const result = await this.idempotency.execute<KnowledgeV2TestCaseView>(
      {
        tenantId: context.tenantId,
        endpoint: "PATCH:/knowledge/v2/test-cases/:testCaseId",
        key: safeIdempotencyKey,
        request: {
          testCaseId,
          body: this.sanitizedMutationRequest(input, question, preparedExpectations),
          ifMatch,
        },
      },
      async (tx) => {
        await this.lockTestCase(tx, context.tenantId, testCaseId);
        const current = await this.getRecord(tx, context.tenantId, testCaseId);
        this.assertTenantMutable(current);
        assertIfMatch(
          ifMatch,
          strongKnowledgeV2Etag("test-case", current.id, current.etag),
          current.etag,
          ["safeLabel", "status", "riskLevel", "critical", "currentVersionId"],
        );
        const previous = current.currentVersion;
        if (!previous || previous.versionNumber !== current.latestVersionNumber) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_TEST_CASE_VERSION_INVALID",
            "The current test-case version is unavailable.",
          );
        }
        const previousQueryBinding = this.queryBinding(previous);
        if (question === undefined) {
          await this.readRestrictedQuery(
            context.tenantId,
            previous.restrictedInputRef,
            previousQueryBinding,
          );
        }
        if (preparedExpectations !== undefined) {
          await this.assertExpectationReferences(tx, context.tenantId, preparedExpectations.items);
        }
        const storedQuestion =
          question === undefined
            ? undefined
            : equalKnowledgeV2QueryHashBindings(question.binding, previousQueryBinding)
              ? {
                  contentHash: question.hash,
                  reference: previous.restrictedInputRef,
                  binding: question.binding,
                }
              : await this.storeRestrictedQuery(
                  context.tenantId,
                  safeIdempotencyKey,
                  operation,
                  "question",
                  question,
                );
        const expectations =
          preparedExpectations === undefined
            ? undefined
            : await this.storeExpectationValues(
                context.tenantId,
                safeIdempotencyKey,
                operation,
                preparedExpectations,
                previous.expectations,
              );
        const material = this.mergeVersionMaterial(
          input,
          current,
          previous,
          storedQuestion,
          expectations,
        );
        const materialChanged = material.immutableHash !== previous.immutableHash;
        const nextSafeLabel = input.safeLabel?.trim() ?? current.safeLabel;
        const nextStatus = input.status ?? current.status;
        const nextCritical = input.critical ?? current.critical;
        const metadataChanged =
          nextSafeLabel !== current.safeLabel ||
          nextStatus !== current.status ||
          nextCritical !== current.critical;
        if (!materialChanged && !metadataChanged) {
          return {
            httpStatus: HttpStatus.OK,
            responseBody: this.testCaseView(context, current, actorMapForContext(context)),
            responseRef: current.id,
          };
        }
        let currentVersionId = previous.id;
        let latestVersionNumber = current.latestVersionNumber;
        if (materialChanged) {
          const version = await this.createVersion(
            tx,
            context,
            current.id,
            current.latestVersionNumber + 1,
            material,
            previous.id,
          );
          currentVersionId = version.id;
          latestVersionNumber = version.versionNumber;
        }
        await tx.knowledgeV2TestCase.update({
          where: { id: current.id },
          data: {
            safeLabel: nextSafeLabel,
            status: nextStatus,
            riskLevel: material.riskLevel,
            critical: nextCritical,
            currentVersionId,
            latestVersionNumber,
            etag: { increment: 1 },
          },
        });
        if (materialChanged || nextStatus !== current.status || nextCritical !== current.critical) {
          await this.bumpDraftGeneration(tx, context.tenantId);
        }
        await this.audit(tx, context, "knowledge.v2.test_case.updated", current.id, {
          changedFields: Object.keys(input),
          materialChanged,
          versionNumber: latestVersionNumber,
          versionHash: material.immutableHash,
          queryHash: material.queryHash,
          queryHashKeyId: material.queryHashKeyId,
          queryHashVersion: material.queryHashVersion,
          safeLabelHash: canonicalKnowledgeV2Hash(nextSafeLabel),
        });
        const record = await this.getRecord(tx, context.tenantId, current.id);
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.testCaseView(context, record, actorMapForContext(context)),
          responseRef: current.id,
        };
      },
    );
    return mutationResult(result);
  }

  async archiveTestCase(
    context: RequestContext,
    testCaseId: string,
    input: KnowledgeV2ArchiveTestCaseRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2TestCaseMutationResult> {
    this.assertEditor(context);
    const result = await this.idempotency.execute<KnowledgeV2TestCaseView>(
      {
        tenantId: context.tenantId,
        endpoint: "POST:/knowledge/v2/test-cases/:testCaseId/archive",
        key: idempotencyKey,
        request: { testCaseId, body: input, ifMatch },
      },
      async (tx) => {
        await this.lockTestCase(tx, context.tenantId, testCaseId);
        const current = await this.getRecord(tx, context.tenantId, testCaseId);
        this.assertTenantMutable(current);
        assertIfMatch(
          ifMatch,
          strongKnowledgeV2Etag("test-case", current.id, current.etag),
          current.etag,
          ["status", "archivedAt"],
        );
        const archivedAt = new Date();
        await tx.knowledgeV2TestCase.update({
          where: { id: current.id },
          data: {
            status: "ARCHIVED",
            archivedAt,
            archivedByUserId: context.userId,
            etag: { increment: 1 },
          },
        });
        await this.bumpDraftGeneration(tx, context.tenantId);
        await this.audit(tx, context, "knowledge.v2.test_case.archived", current.id, {
          reasonHash: canonicalKnowledgeV2Hash(input.reason.trim()),
          versionNumber: current.latestVersionNumber,
        });
        const record = await this.getRecord(tx, context.tenantId, current.id);
        return {
          httpStatus: HttpStatus.OK,
          responseBody: this.testCaseView(context, record, actorMapForContext(context)),
          responseRef: current.id,
        };
      },
    );
    return mutationResult(result);
  }

  private createVersionMaterial(
    input: KnowledgeV2CreateTestCaseRequest,
    question: PreparedRestrictedQueryValue,
    expectations: CanonicalExpectation[],
  ): VersionMaterial {
    const material: VersionMaterial = {
      queryHash: question.binding.hash,
      queryHashKeyId: question.binding.keyId,
      queryHashVersion: question.binding.version,
      restrictedInputRef: question.reference,
      expectedBehavior: input.expectedBehavior,
      locale: canonicalKnowledgeV2Locale(input.locale),
      channelType: input.channelType,
      audience: input.audience,
      scope: canonicalKnowledgeV2Scope(input.scope),
      sliceKeys: sortedUnique(input.sliceKeys),
      datasetVersion: input.datasetVersion,
      riskLevel: input.riskLevel,
      expectations,
    };
    return material;
  }

  private mergeVersionMaterial(
    input: KnowledgeV2UpdateTestCaseRequest,
    current: TestCaseRecord,
    previous: TestCaseVersionRecord,
    question: PreparedRestrictedQueryValue | undefined,
    preparedExpectations: CanonicalExpectation[] | undefined,
  ): VersionMaterial & { immutableHash: string } {
    const expectations =
      preparedExpectations === undefined
        ? previous.expectations.map((item) => this.expectationMaterial(item))
        : this.reuseRestrictedExpectationReferences(preparedExpectations, previous.expectations);
    const previousQueryBinding = this.queryBinding(previous);
    const reuseQuestion = Boolean(
      question && equalKnowledgeV2QueryHashBindings(question.binding, previousQueryBinding),
    );
    const material: VersionMaterial = {
      queryHash: question?.binding.hash ?? previousQueryBinding.hash,
      queryHashKeyId: question?.binding.keyId ?? previousQueryBinding.keyId,
      queryHashVersion: question?.binding.version ?? previousQueryBinding.version,
      restrictedInputRef:
        question === undefined || reuseQuestion ? previous.restrictedInputRef : question.reference,
      expectedBehavior: input.expectedBehavior ?? previous.expectedBehavior,
      locale:
        input.locale === undefined ? previous.locale : canonicalKnowledgeV2Locale(input.locale),
      channelType: input.channelType ?? previous.channelType,
      audience: input.audience ?? previous.audience,
      scope:
        input.scope === undefined
          ? previous.scope === null
            ? null
            : canonicalKnowledgeV2Scope(knowledgeV2ScopeView(previous.scope))
          : canonicalKnowledgeV2Scope(input.scope),
      sliceKeys: input.sliceKeys === undefined ? previous.sliceKeys : sortedUnique(input.sliceKeys),
      datasetVersion: input.datasetVersion ?? previous.datasetVersion,
      riskLevel: input.riskLevel ?? current.riskLevel,
      expectations,
    };
    return { ...material, immutableHash: this.versionHash(material) };
  }

  private canonicalExpectations(input: CanonicalExpectation[]) {
    const result = input.map((expectation) => this.expectationMaterial(expectation));
    const signatures = result.map((expectation) => canonicalKnowledgeV2Hash(expectation));
    if (new Set(signatures).size !== signatures.length) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_DUPLICATE",
        "Duplicate test expectations are not allowed.",
        { field: "expectations" },
      );
    }
    return result;
  }

  private expectationMaterial(
    input: CanonicalExpectation | TestExpectationRecord,
  ): CanonicalExpectation {
    const expectation: CanonicalExpectation = {
      kind: input.kind,
      factId: input.factId ?? null,
      guidanceRuleId: input.guidanceRuleId ?? null,
      evidenceReferenceId: input.evidenceReferenceId ?? null,
      semanticKey: input.semanticKey ?? null,
      expectedValueHash: input.expectedValueHash?.toLowerCase() ?? null,
      restrictedExpectedRef: input.restrictedExpectedRef ?? null,
    };
    this.assertExpectationShape(expectation);
    return expectation;
  }

  private reuseRestrictedExpectationReferences(
    prepared: CanonicalExpectation[],
    previous: TestExpectationRecord[],
  ) {
    return this.canonicalExpectations(
      prepared.map((expectation, index) => {
        const prior = previous[index];
        if (
          !prior?.restrictedExpectedRef ||
          !expectation.restrictedExpectedRef ||
          prior.kind !== expectation.kind ||
          prior.factId !== expectation.factId ||
          prior.guidanceRuleId !== expectation.guidanceRuleId ||
          prior.evidenceReferenceId !== expectation.evidenceReferenceId ||
          prior.semanticKey !== expectation.semanticKey ||
          prior.expectedValueHash !== expectation.expectedValueHash
        ) {
          return expectation;
        }
        return { ...expectation, restrictedExpectedRef: prior.restrictedExpectedRef };
      }),
    );
  }

  private assertExpectationShape(expectation: CanonicalExpectation) {
    const fact = ["REQUIRED_FACT", "FORBIDDEN_FACT"].includes(expectation.kind);
    const guidance = ["REQUIRED_GUIDANCE", "FORBIDDEN_GUIDANCE"].includes(expectation.kind);
    const evidence = expectation.kind === "REQUIRED_EVIDENCE";
    const semantic = ["FORBIDDEN_CLAIM", "REQUIRED_TOOL", "FORBIDDEN_TOOL"].includes(
      expectation.kind,
    );
    const validTarget =
      (fact &&
        expectation.factId &&
        !expectation.guidanceRuleId &&
        !expectation.evidenceReferenceId &&
        !expectation.semanticKey) ||
      (guidance &&
        expectation.guidanceRuleId &&
        !expectation.factId &&
        !expectation.evidenceReferenceId &&
        !expectation.semanticKey) ||
      (evidence &&
        expectation.evidenceReferenceId &&
        !expectation.factId &&
        !expectation.guidanceRuleId &&
        !expectation.semanticKey) ||
      (semantic &&
        expectation.semanticKey &&
        !expectation.factId &&
        !expectation.guidanceRuleId &&
        !expectation.evidenceReferenceId);
    if (
      !validTarget ||
      (expectation.semanticKey && !safeSemanticKey.test(expectation.semanticKey))
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_TARGET_INVALID",
        "A test expectation must reference exactly one allowed target.",
        { field: "expectations" },
      );
    }
    if (
      (expectation.restrictedExpectedRef && !expectation.expectedValueHash) ||
      (expectation.expectedValueHash && !sha256Pattern.test(expectation.expectedValueHash))
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_RESTRICTED_PAIR_INVALID",
        "A restricted expected value requires both its reference and SHA-256 hash.",
        { field: "expectations" },
      );
    }
  }

  private prepareExpectations(input: KnowledgeV2TestExpectationInput[]): PreparedExpectations {
    const items: CanonicalExpectation[] = [];
    const restrictedValues: Array<RestrictedTextInput | null> = [];
    for (const [index, expectation] of input.entries()) {
      if (expectation.restrictedExpectedValue != null && expectation.expectedValueHash) {
        throw knowledgeV2Error(
          HttpStatus.BAD_REQUEST,
          "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_RESTRICTED_PAIR_INVALID",
          "Provide either a restricted expected value or its precomputed hash, not both.",
          { field: `expectations.${index}` },
        );
      }
      const restrictedValue =
        expectation.restrictedExpectedValue == null
          ? null
          : this.restrictedText(
              expectation.restrictedExpectedValue,
              `expectations.${index}.restrictedExpectedValue`,
            );
      restrictedValues.push(restrictedValue);
      items.push(
        this.expectationMaterial({
          kind: expectation.kind,
          factId: expectation.factId ?? null,
          guidanceRuleId: expectation.guidanceRuleId ?? null,
          evidenceReferenceId: expectation.evidenceReferenceId ?? null,
          semanticKey: expectation.semanticKey ?? null,
          expectedValueHash:
            restrictedValue?.hash ?? expectation.expectedValueHash?.toLowerCase() ?? null,
          restrictedExpectedRef: null,
        }),
      );
    }
    return { items: this.canonicalExpectations(items), restrictedValues };
  }

  private async storeExpectationValues(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    prepared: PreparedExpectations,
    previous: TestExpectationRecord[] = [],
  ) {
    const items: CanonicalExpectation[] = [];
    for (const [index, expectation] of prepared.items.entries()) {
      const restrictedValue = prepared.restrictedValues[index];
      if (!restrictedValue) {
        items.push(expectation);
        continue;
      }
      const prior = previous[index];
      if (
        prior?.restrictedExpectedRef &&
        prior.kind === expectation.kind &&
        prior.factId === expectation.factId &&
        prior.guidanceRuleId === expectation.guidanceRuleId &&
        prior.evidenceReferenceId === expectation.evidenceReferenceId &&
        prior.semanticKey === expectation.semanticKey &&
        prior.expectedValueHash === expectation.expectedValueHash
      ) {
        items.push({ ...expectation, restrictedExpectedRef: prior.restrictedExpectedRef });
        continue;
      }
      const stored = await this.storeRestrictedValue(
        tenantId,
        idempotencyKey,
        operation,
        `expectation-${index}`,
        restrictedValue,
      );
      items.push({ ...expectation, restrictedExpectedRef: stored.reference });
    }
    return this.canonicalExpectations(items);
  }

  private async storeRestrictedValue(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    slot: string,
    input: RestrictedTextInput,
  ): Promise<PreparedRestrictedValue> {
    const bytes = new TextEncoder().encode(input.value);
    const { store, keyId } = this.restrictedStore();
    const key = createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId: `knowledge-v2-test-${operation}`,
      purpose: "raw",
      identity: `${keyId}:${idempotencyKey}:${slot}`,
    });
    try {
      const written = await store.put(key, bytes);
      return { contentHash: input.hash, reference: encodeRestrictedReference(written) };
    } catch (error) {
      if (error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_EXISTS") {
        try {
          const existing = await store.get(key, keyId);
          const actual = Buffer.from(sha256(existing), "hex");
          const expected = Buffer.from(input.hash, "hex");
          if (actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)) {
            return {
              contentHash: input.hash,
              reference: encodeRestrictedReference({ key, encryptionKeyRef: keyId }),
            };
          }
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with different restricted input.",
          );
        } catch (readError) {
          if (readError instanceof KnowledgeObjectStoreError) {
            throw this.restrictedStorageUnavailable();
          }
          throw readError;
        }
      }
      if (error instanceof KnowledgeObjectStoreError) throw this.restrictedStorageUnavailable();
      throw error;
    }
  }

  private async storeRestrictedQuery(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    slot: string,
    input: RestrictedQueryInput,
  ): Promise<PreparedRestrictedQueryValue> {
    return {
      ...(await this.storeRestrictedValue(tenantId, idempotencyKey, operation, slot, input)),
      binding: input.binding,
    };
  }

  private restrictedText(value: string, field: string): RestrictedTextInput {
    const bytes = new TextEncoder().encode(value);
    if (!value.trim() || bytes.byteLength === 0 || bytes.byteLength > maximumRestrictedBytes) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_VALIDATION_RESTRICTED_INPUT_SIZE_INVALID",
        "The restricted text must be non-empty and no larger than 32 KiB.",
        { field },
      );
    }
    return { value, hash: sha256(bytes) };
  }

  private restrictedQuery(tenantId: string, value: string, field: string): RestrictedQueryInput {
    const restricted = this.restrictedText(value, field);
    return {
      ...restricted,
      binding: this.queryHashes.hash({
        tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
        value,
      }),
    };
  }

  private sanitizedMutationRequest(
    input: KnowledgeV2CreateTestCaseRequest | KnowledgeV2UpdateTestCaseRequest,
    question: RestrictedQueryInput | undefined,
    expectations: PreparedExpectations | undefined,
  ) {
    const { question: rawQuestion, expectations: rawExpectations, ...safeInput } = input;
    void rawQuestion;
    void rawExpectations;
    return {
      ...safeInput,
      ...(question
        ? {
            queryHash: question.binding.hash,
            queryHashKeyId: question.binding.keyId,
            queryHashVersion: question.binding.version,
          }
        : {}),
      ...(expectations
        ? {
            expectations: expectations.items.map(
              ({ restrictedExpectedRef, ...expectation }, index) => {
                void restrictedExpectedRef;
                return {
                  ...expectation,
                  hasRestrictedExpectedValue: Boolean(expectations.restrictedValues[index]),
                };
              },
            ),
          }
        : {}),
    };
  }

  private restrictedStore() {
    const rootPath = this.config.knowledgeObjectStorePath;
    const keyValue = this.config.knowledgeArtifactEncryptionKey;
    const keyId = this.config.knowledgeArtifactEncryptionKeyId;
    if (!rootPath || !keyValue || !keyId) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
        "Restricted knowledge storage is unavailable.",
      );
    }
    try {
      return {
        keyId,
        store: new EncryptedFileKnowledgeObjectStore({
          rootPath,
          activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(keyValue) },
          maxPlaintextBytes: maximumRestrictedBytes,
        }),
      };
    } catch {
      throw this.restrictedStorageUnavailable();
    }
  }

  private async readRestrictedValue(reference: string, expectedHash: string) {
    if (!sha256Pattern.test(expectedHash)) throw this.restrictedStorageUnavailable();
    let payload: RestrictedReferencePayload;
    try {
      if (!reference.startsWith(restrictedReferencePrefix)) throw new Error("invalid reference");
      payload = JSON.parse(
        Buffer.from(reference.slice(restrictedReferencePrefix.length), "base64url").toString(
          "utf8",
        ),
      ) as RestrictedReferencePayload;
      if (
        payload.version !== 1 ||
        typeof payload.key !== "string" ||
        !payload.key ||
        typeof payload.encryptionKeyRef !== "string" ||
        !payload.encryptionKeyRef
      ) {
        throw new Error("invalid reference");
      }
    } catch {
      throw this.restrictedStorageUnavailable();
    }
    try {
      const { store } = this.restrictedStore();
      const bytes = await store.get(payload.key, payload.encryptionKeyRef);
      const actual = Buffer.from(sha256(bytes), "hex");
      const expected = Buffer.from(expectedHash, "hex");
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new Error("hash mismatch");
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw this.restrictedStorageUnavailable();
    }
  }

  private async readRestrictedQuery(
    tenantId: string,
    reference: string,
    binding: KnowledgeV2QueryHashBinding,
  ) {
    let payload: RestrictedReferencePayload;
    try {
      if (!reference.startsWith(restrictedReferencePrefix)) throw new Error("invalid reference");
      payload = JSON.parse(
        Buffer.from(reference.slice(restrictedReferencePrefix.length), "base64url").toString(
          "utf8",
        ),
      ) as RestrictedReferencePayload;
      if (
        payload.version !== 1 ||
        typeof payload.key !== "string" ||
        !payload.key ||
        typeof payload.encryptionKeyRef !== "string" ||
        !payload.encryptionKeyRef
      ) {
        throw new Error("invalid reference");
      }
    } catch {
      throw this.restrictedStorageUnavailable();
    }
    let value: string;
    try {
      const { store } = this.restrictedStore();
      value = new TextDecoder("utf-8", { fatal: true }).decode(
        await store.get(payload.key, payload.encryptionKeyRef),
      );
    } catch {
      throw this.restrictedStorageUnavailable();
    }
    if (
      !this.queryHashes.verify({
        tenantId,
        purpose: KNOWLEDGE_V2_QUERY_HASH_PURPOSES.TEST_QUERY,
        value,
        binding,
      })
    ) {
      throw this.queryHashUnavailable();
    }
    return value;
  }

  private queryBinding(value: {
    queryHash: string;
    queryHashKeyId: string | null;
    queryHashVersion: string | null;
  }) {
    const binding = parseKnowledgeV2QueryHashBinding({
      hash: value.queryHash,
      keyId: value.queryHashKeyId,
      version: value.queryHashVersion,
    });
    if (!binding) {
      throw this.queryHashUnavailable();
    }
    return binding;
  }

  private queryHashUnavailable() {
    return knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_TEST_QUERY_HASH_UNAVAILABLE",
      "The test query integrity binding is unavailable.",
    );
  }

  private restrictedStorageUnavailable() {
    return knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE",
      "Restricted knowledge storage is unavailable.",
    );
  }

  private async assertExpectationReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    expectations: CanonicalExpectation[],
  ) {
    const factIds = sortedUnique(
      expectations.flatMap((item) => (item.factId ? [item.factId] : [])),
    );
    const guidanceIds = sortedUnique(
      expectations.flatMap((item) => (item.guidanceRuleId ? [item.guidanceRuleId] : [])),
    );
    const evidenceIds = sortedUnique(
      expectations.flatMap((item) => (item.evidenceReferenceId ? [item.evidenceReferenceId] : [])),
    );
    const [facts, guidance, evidence] = await Promise.all([
      tx.knowledgeV2Fact.findMany({
        where: { tenantId, id: { in: factIds }, deletedAt: null },
        select: { id: true },
      }),
      tx.knowledgeV2GuidanceRule.findMany({
        where: { tenantId, id: { in: guidanceIds }, deletedAt: null },
        select: { id: true },
      }),
      tx.knowledgeV2EvidenceReference.findMany({
        where: { tenantId, id: { in: evidenceIds }, corpusKind: "STRUCTURED_V2" },
        select: { id: true },
      }),
    ]);
    if (
      facts.length !== factIds.length ||
      guidance.length !== guidanceIds.length ||
      evidence.length !== evidenceIds.length
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_TEST_EXPECTATION_REFERENCE_INVALID",
        "One or more test expectation references are unavailable.",
        { field: "expectations" },
      );
    }
  }

  private async createVersion(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    testCaseId: string,
    versionNumber: number,
    material: VersionMaterial,
    supersedesVersionId: string | null,
  ) {
    const immutableHash = this.versionHash(material);
    const version = await tx.knowledgeV2TestCaseVersion.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        testCaseId,
        versionNumber,
        queryHash: material.queryHash,
        queryHashKeyId: material.queryHashKeyId,
        queryHashVersion: material.queryHashVersion,
        restrictedInputRef: material.restrictedInputRef,
        expectedBehavior: material.expectedBehavior,
        locale: material.locale,
        channelType: material.channelType,
        audience: material.audience,
        scope: optionalJson(material.scope),
        sliceKeys: material.sliceKeys,
        datasetVersion: material.datasetVersion,
        riskLevel: material.riskLevel,
        supersedesVersionId,
        immutableHash,
        createdByUserId: context.userId,
      },
    });
    if (material.expectations.length > 0) {
      await tx.knowledgeV2TestExpectation.createMany({
        data: material.expectations.map((expectation, ordinal) => ({
          id: randomUUID(),
          tenantId: context.tenantId,
          testCaseVersionId: version.id,
          ordinal,
          kind: expectation.kind,
          factId: expectation.factId,
          guidanceRuleId: expectation.guidanceRuleId,
          evidenceReferenceId: expectation.evidenceReferenceId,
          semanticKey: expectation.semanticKey,
          expectedValueHash: expectation.expectedValueHash,
          restrictedExpectedRef: expectation.restrictedExpectedRef,
        })),
      });
    }
    return { ...version, immutableHash };
  }

  private versionHash(material: VersionMaterial) {
    return canonicalKnowledgeV2Hash({
      queryHash: material.queryHash,
      queryHashKeyId: material.queryHashKeyId,
      queryHashVersion: material.queryHashVersion,
      restrictedInputRef: material.restrictedInputRef,
      expectedBehavior: material.expectedBehavior,
      locale: material.locale,
      channelType: material.channelType,
      audience: material.audience,
      scope: material.scope,
      sliceKeys: material.sliceKeys,
      datasetVersion: material.datasetVersion,
      riskLevel: material.riskLevel,
      expectations: material.expectations,
    });
  }

  private testCaseView(
    context: RequestContext,
    record: TestCaseRecord,
    actors: ActorMap,
  ): KnowledgeV2TestCaseView {
    return {
      id: record.id,
      corpusKind: "STRUCTURED_V2",
      caseKey: record.caseKey,
      safeLabel: record.safeLabel,
      origin: record.origin,
      status: record.status,
      riskLevel: record.riskLevel,
      critical: record.critical,
      currentVersion: record.currentVersion
        ? this.versionView(record.currentVersion, actors)
        : null,
      latestVersionNumber: record.latestVersionNumber,
      createdBy: record.createdByUserId ? (actors.get(record.createdByUserId) ?? null) : null,
      archivedBy: record.archivedByUserId ? (actors.get(record.archivedByUserId) ?? null) : null,
      archivedAt: dateValue(record.archivedAt),
      etag: strongKnowledgeV2Etag("test-case", record.id, record.etag),
      allowedActions:
        record.origin === "TENANT" &&
        record.status !== "ARCHIVED" &&
        (context.role === "OWNER" || context.role === "ADMIN")
          ? ["EDIT", "ARCHIVE"]
          : [],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private versionView(
    version: TestCaseVersionRecord,
    actors: ActorMap,
  ): KnowledgeV2TestCaseVersionView {
    const binding = this.queryBinding(version);
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      queryHash: binding.hash,
      queryHashKeyId: binding.keyId,
      queryHashVersion: binding.version,
      hasRestrictedInput: true,
      expectedBehavior: version.expectedBehavior,
      locale: version.locale,
      channelType: version.channelType,
      audience: version.audience,
      scope: (version.scope as KnowledgeV2JsonValue | null) ?? null,
      sliceKeys: version.sliceKeys,
      datasetVersion: version.datasetVersion,
      riskLevel: version.riskLevel,
      supersedesVersionId: version.supersedesVersionId,
      immutableHash: version.immutableHash,
      createdBy: version.createdByUserId ? (actors.get(version.createdByUserId) ?? null) : null,
      expectations: version.expectations.map((item) => this.expectationView(item)),
      createdAt: version.createdAt.toISOString(),
    };
  }

  private expectationView(expectation: TestExpectationRecord): KnowledgeV2TestExpectationView {
    return {
      id: expectation.id,
      ordinal: expectation.ordinal,
      kind: expectation.kind,
      factId: expectation.factId,
      guidanceRuleId: expectation.guidanceRuleId,
      evidenceReferenceId: expectation.evidenceReferenceId,
      semanticKey: expectation.semanticKey,
      expectedValueHash: expectation.expectedValueHash,
      hasRestrictedExpectedValue: Boolean(expectation.restrictedExpectedRef),
      createdAt: expectation.createdAt.toISOString(),
    };
  }

  private async getRecord(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const record = await tx.knowledgeV2TestCase.findFirst({
      where: { id, tenantId, corpusKind: "STRUCTURED_V2" },
      include: testCaseInclude,
    });
    if (!record) throw this.notFound();
    return record;
  }

  private async lockTestCase(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2TestCase"
      WHERE "tenantId" = ${tenantId} AND "id" = ${id}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw this.notFound();
  }

  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw this.notFound();
  }

  private async actorMap(context: RequestContext, actorIds: Array<string | null | undefined>) {
    const result = new Map(actorMapForContext(context));
    const ids = [...new Set(actorIds.filter((id): id is string => Boolean(id)))].filter(
      (id) => id !== context.userId,
    );
    if (ids.length === 0) return result;
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: context.tenantId, userId: { in: ids } },
      select: { user: { select: { id: true, name: true } } },
    });
    for (const membership of memberships) {
      result.set(membership.user.id, {
        id: membership.user.id,
        displayName: membership.user.name?.trim() || "Workspace member",
      });
    }
    return result;
  }

  private async bumpDraftGeneration(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId, draftGeneration: 1 },
      update: { draftGeneration: { increment: 1 } },
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "knowledge_v2",
        entityId,
        payload,
      },
    });
  }

  private assertUpdateInput(input: KnowledgeV2UpdateTestCaseRequest) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_UPDATE_EMPTY",
        "Provide at least one test-case field to update.",
      );
    }
  }

  private assertTenantMutable(record: TestCaseRecord) {
    if (record.origin !== "TENANT") {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_TEST_CASE_READ_ONLY",
        "Only tenant-owned test cases can be changed here.",
      );
    }
    if (record.status === "ARCHIVED") {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_TEST_CASE_ARCHIVED",
        "Archived test cases cannot be changed.",
      );
    }
  }

  private assertReader(context: RequestContext) {
    if (!new Set(["OWNER", "ADMIN", "MANAGER"]).has(context.role)) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ACTION_DENIED",
        "This role cannot view knowledge test cases.",
      );
    }
  }

  private assertEditor(context: RequestContext) {
    if (context.role !== "OWNER" && context.role !== "ADMIN") {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_ACTION_DENIED",
        "Only an owner or administrator can change knowledge test cases.",
      );
    }
  }

  private notFound() {
    return knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND",
      "The test case was not found.",
    );
  }
}
