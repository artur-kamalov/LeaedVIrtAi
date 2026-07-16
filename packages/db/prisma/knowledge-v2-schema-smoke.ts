import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function mustReject(operation: () => Promise<unknown>) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      name: "Knowledge V2 Verify",
      slug: "knowledge-v2-verify-" + Date.now(),
    },
  });

  await prisma.knowledgeV2Settings.create({
    data: {
      tenantId: tenant.id,
      modelProcessorPolicy: {
        schemaVersion: 1,
        policyVersion: "model-v1",
        approved: true,
        promptPolicyVersion: "grounded-v1",
        groundedAnswer: {},
      },
    },
  });
  const invalidModelProcessorPolicyBlocked = await mustReject(() =>
    prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.id },
      data: { modelProcessorPolicy: { schemaVersion: 1, approved: false } },
    }),
  );
  const entity = await prisma.knowledgeV2Entity.create({
    data: {
      tenantId: tenant.id,
      entityType: "BUSINESS",
      entityKey: "business/default",
    },
  });
  const fact = await prisma.knowledgeV2Fact.create({
    data: {
      tenantId: tenant.id,
      entityId: entity.id,
      entityType: "BUSINESS",
      factKey: "business/name",
      fieldType: "TEXT",
      latestVersionNumber: 1,
    },
  });
  const factVersion = await prisma.knowledgeV2FactVersion.create({
    data: {
      tenantId: tenant.id,
      factId: fact.id,
      versionNumber: 1,
      normalizedValue: { value: "LeadVirt" },
      immutableHash: "fact-hash-1",
    },
  });
  const otherFact = await prisma.knowledgeV2Fact.create({
    data: {
      tenantId: tenant.id,
      entityType: "BUSINESS",
      factKey: "business/legal-name",
      fieldType: "TEXT",
      latestVersionNumber: 1,
    },
  });
  const otherFactVersion = await prisma.knowledgeV2FactVersion.create({
    data: {
      tenantId: tenant.id,
      factId: otherFact.id,
      versionNumber: 1,
      normalizedValue: { value: "LeadVirt SAS" },
      immutableHash: "other-fact-hash-1",
    },
  });
  const factCrossParentSupersessionBlocked = await mustReject(() =>
    prisma.knowledgeV2FactVersion.create({
      data: {
        tenantId: tenant.id,
        factId: fact.id,
        versionNumber: 2,
        normalizedValue: { value: "Invalid lineage" },
        immutableHash: "fact-cross-parent-hash",
        supersedesVersionId: otherFactVersion.id,
      },
    }),
  );
  const secondFactVersion = await prisma.knowledgeV2FactVersion.create({
    data: {
      tenantId: tenant.id,
      factId: fact.id,
      versionNumber: 2,
      normalizedValue: { value: "LeadVirt 2" },
      immutableHash: "fact-hash-2",
      supersedesVersionId: factVersion.id,
    },
  });
  const rule = await prisma.knowledgeV2GuidanceRule.create({
    data: {
      tenantId: tenant.id,
      ruleKey: "response/default",
      title: "Default response",
      ruleType: "RESPONSE",
      latestVersionNumber: 1,
    },
  });
  const ruleVersion = await prisma.knowledgeV2GuidanceRuleVersion.create({
    data: {
      tenantId: tenant.id,
      guidanceRuleId: rule.id,
      versionNumber: 1,
      title: "Default response",
      ruleType: "RESPONSE",
      conditionAst: { kind: "ALL", conditions: [] },
      instruction: "Answer from verified facts.",
      tieBreakKey: "response/default",
      immutableHash: "rule-hash-1",
    },
  });
  const otherRule = await prisma.knowledgeV2GuidanceRule.create({
    data: {
      tenantId: tenant.id,
      ruleKey: "response/other",
      title: "Other response",
      ruleType: "RESPONSE",
      latestVersionNumber: 1,
    },
  });
  const otherRuleVersion = await prisma.knowledgeV2GuidanceRuleVersion.create({
    data: {
      tenantId: tenant.id,
      guidanceRuleId: otherRule.id,
      versionNumber: 1,
      title: "Other response",
      ruleType: "RESPONSE",
      conditionAst: { kind: "ALL", conditions: [] },
      instruction: "Use another response.",
      tieBreakKey: "response/other",
      immutableHash: "other-rule-hash-1",
    },
  });
  const ruleCrossParentSupersessionBlocked = await mustReject(() =>
    prisma.knowledgeV2GuidanceRuleVersion.create({
      data: {
        tenantId: tenant.id,
        guidanceRuleId: rule.id,
        versionNumber: 2,
        title: "Invalid lineage",
        ruleType: "RESPONSE",
        conditionAst: { kind: "ALL", conditions: [] },
        instruction: "This must not be stored.",
        tieBreakKey: "response/invalid",
        immutableHash: "rule-cross-parent-hash",
        supersedesVersionId: otherRuleVersion.id,
      },
    }),
  );
  await prisma.knowledgeV2GuidanceRuleVersion.create({
    data: {
      tenantId: tenant.id,
      guidanceRuleId: rule.id,
      versionNumber: 2,
      title: "Default response v2",
      ruleType: "RESPONSE",
      conditionAst: { kind: "ALL", conditions: [] },
      instruction: "Answer only from verified facts.",
      tieBreakKey: "response/default",
      immutableHash: "rule-hash-2",
      supersedesVersionId: ruleVersion.id,
    },
  });

  const evidence = await prisma.knowledgeV2Evidence.create({
    data: {
      tenantId: tenant.id,
      kind: "MANUAL",
      factVersionId: factVersion.id,
      label: "Manual fact",
    },
  });
  const validation = await prisma.knowledgeV2PublicationValidation.create({
    data: {
      tenantId: tenant.id,
      candidateId: "workspace",
      candidateVersion: 1,
      candidateManifestHash: "manifest-1",
      candidateItems: [],
      status: "PASSED",
      evaluatedAt: new Date(),
    },
  });
  const publication = await prisma.knowledgePublication.create({
    data: {
      tenantId: tenant.id,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      sequence: 1,
      status: "READY",
      manifestHash: "manifest-1",
      pipelineVersion: "knowledge-v2",
      retrievalPolicyVersion: "knowledge-v2",
      promptPolicyVersion: "knowledge-v2",
    },
  });
  await prisma.knowledgeV2PublicationValidation.update({
    where: { id: validation.id },
    data: { publicationId: publication.id },
  });
  await prisma.knowledgePublicationItem.createMany({
    data: [
      {
        tenantId: tenant.id,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "FACT_VERSION",
        itemId: factVersion.id,
        itemVersionHash: factVersion.immutableHash,
        factVersionId: factVersion.id,
      },
      {
        tenantId: tenant.id,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "GUIDANCE_RULE_VERSION",
        itemId: ruleVersion.id,
        itemVersionHash: ruleVersion.immutableHash,
        guidanceRuleVersionId: ruleVersion.id,
      },
    ],
  });

  const evidenceUpdateBlocked = await mustReject(() =>
    prisma.knowledgeV2Evidence.update({
      where: { id: evidence.id },
      data: { label: "Changed evidence" },
    }),
  );
  const evidenceDeleteBlocked = await mustReject(() =>
    prisma.knowledgeV2Evidence.delete({ where: { id: evidence.id } }),
  );
  const publicationManifestUpdateBlocked = await mustReject(() =>
    prisma.knowledgePublication.update({
      where: { id: publication.id },
      data: { manifestHash: "changed-manifest" },
    }),
  );
  const publicationItemUpdateBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.update({
      where: {
        publicationId_itemType_itemId: {
          publicationId: publication.id,
          itemType: "FACT_VERSION",
          itemId: factVersion.id,
        },
      },
      data: { authorizationFingerprint: "changed-authorization" },
    }),
  );
  const publicationItemDeleteBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.delete({
      where: {
        publicationId_itemType_itemId: {
          publicationId: publication.id,
          itemType: "FACT_VERSION",
          itemId: factVersion.id,
        },
      },
    }),
  );
  const evidenceOwnerBlocked = await mustReject(() =>
    prisma.knowledgeV2Evidence.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        factVersionId: factVersion.id,
        guidanceRuleVersionId: ruleVersion.id,
        label: "Invalid evidence",
      },
    }),
  );
  const documentItemBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "DOCUMENT_REVISION",
        itemId: "document-1",
        itemVersionHash: "document-hash-1",
      },
    }),
  );
  let lifecycleTransitionSucceeded = true;
  try {
    await prisma.knowledgePublication.update({
      where: { id: publication.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
  } catch {
    lifecycleTransitionSucceeded = false;
  }
  const activeItemInsertBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "SOURCE_PERMISSION_SNAPSHOT",
        itemId: "late-active-permission",
        itemVersionHash: "late-active-permission-hash",
        authorizationFingerprint: "late-active-permission-fingerprint",
      },
    }),
  );
  const publishedEvidenceInsertBlocked = await mustReject(() =>
    prisma.knowledgeV2Evidence.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        factVersionId: factVersion.id,
        label: "Late evidence",
      },
    }),
  );
  let unpublishedEvidenceInsertSucceeded = true;
  try {
    await prisma.knowledgeV2Evidence.create({
      data: {
        tenantId: tenant.id,
        kind: "MANUAL",
        factVersionId: secondFactVersion.id,
        label: "Unpublished evidence",
      },
    });
  } catch {
    unpublishedEvidenceInsertSucceeded = false;
  }

  const factUpdateBlocked = await mustReject(() =>
    prisma.knowledgeV2FactVersion.update({
      where: { id: factVersion.id },
      data: { displayValue: "changed" },
    }),
  );
  const ruleDeleteBlocked = await mustReject(() =>
    prisma.knowledgeV2GuidanceRuleVersion.delete({ where: { id: ruleVersion.id } }),
  );
  const secondPublication = await prisma.knowledgePublication.create({
    data: {
      tenantId: tenant.id,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      sequence: 2,
      status: "READY",
      manifestHash: "manifest-2",
      pipelineVersion: "knowledge-v2",
      retrievalPolicyVersion: "knowledge-v2",
      promptPolicyVersion: "knowledge-v2",
    },
  });
  const hashMismatchBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: secondPublication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "FACT_VERSION",
        itemId: factVersion.id,
        itemVersionHash: "wrong-hash",
        factVersionId: factVersion.id,
      },
    }),
  );
  await prisma.knowledgePublication.update({
    where: { id: secondPublication.id },
    data: { status: "PUBLISHING" },
  });
  const publishingItemInsertBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: secondPublication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "SOURCE_PERMISSION_SNAPSHOT",
        itemId: "late-publishing-permission",
        itemVersionHash: "late-publishing-permission-hash",
        authorizationFingerprint: "late-publishing-permission-fingerprint",
      },
    }),
  );
  const legacyPublication = await prisma.knowledgePublication.create({
    data: {
      tenantId: tenant.id,
      targetKey: "workspace-v2",
      corpusKind: "LEGACY_V1",
      sequence: 3,
      status: "READY",
      manifestHash: "legacy-manifest",
    },
  });
  const crossCorpusBaseBlocked = await mustReject(() =>
    prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 4,
        status: "READY",
        manifestHash: "manifest-4",
        basePublicationId: legacyPublication.id,
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
      },
    }),
  );
  const failedPublication = await prisma.knowledgePublication.create({
    data: {
      tenantId: tenant.id,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      sequence: 5,
      status: "FAILED",
      manifestHash: "failed-manifest",
      pipelineVersion: "knowledge-v2",
      retrievalPolicyVersion: "knowledge-v2",
      promptPolicyVersion: "knowledge-v2",
      failedAt: new Date(),
    },
  });
  const failedItemInsertBlocked = await mustReject(() =>
    prisma.knowledgePublicationItem.create({
      data: {
        tenantId: tenant.id,
        publicationId: failedPublication.id,
        corpusKind: "STRUCTURED_V2",
        itemType: "SOURCE_PERMISSION_SNAPSHOT",
        itemId: "late-failed-permission",
        itemVersionHash: "late-failed-permission-hash",
        authorizationFingerprint: "late-failed-permission-fingerprint",
      },
    }),
  );

  let tenantCascadeSucceeded = true;
  try {
    await prisma.tenant.delete({ where: { id: tenant.id } });
  } catch {
    tenantCascadeSucceeded = false;
  }

  const result = {
    invalidModelProcessorPolicyBlocked,
    factCrossParentSupersessionBlocked,
    ruleCrossParentSupersessionBlocked,
    factUpdateBlocked,
    ruleDeleteBlocked,
    evidenceUpdateBlocked,
    evidenceDeleteBlocked,
    publishedEvidenceInsertBlocked,
    unpublishedEvidenceInsertSucceeded,
    evidenceOwnerBlocked,
    publicationManifestUpdateBlocked,
    publicationItemUpdateBlocked,
    publicationItemDeleteBlocked,
    lifecycleTransitionSucceeded,
    activeItemInsertBlocked,
    publishingItemInsertBlocked,
    failedItemInsertBlocked,
    documentItemBlocked,
    hashMismatchBlocked,
    crossCorpusBaseBlocked,
    tenantCascadeSucceeded,
  };
  console.log(JSON.stringify(result));

  if (Object.values(result).some((value) => !value)) {
    throw new Error("Knowledge v2 schema reliability checks failed.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
