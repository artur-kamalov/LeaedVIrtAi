CREATE INDEX IF NOT EXISTS "BusinessImportEvidence_excerpt_ledger_idx"
ON "BusinessImportCandidateEvidence"("tenantId", "excerptObjectLedgerId");
