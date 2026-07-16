BEGIN;

DROP INDEX "KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key";

CREATE INDEX "KnowledgeV2PublicationValidation_tenantId_candidateId_candi_key"
  ON "KnowledgeV2PublicationValidation"(
    "tenantId",
    "candidateId",
    "candidateVersion",
    "validationPolicyVersion"
  );

COMMIT;
