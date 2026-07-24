export const KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_DAYS = 90;
export const KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_MS =
  KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_DAYS * 24 * 60 * 60_000;
export const KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_POLICY_ID =
  "leadvirt.business-information.price-effective-window.explicit-or-owner-approval-90d.v1";

export function knowledgeOwnerVerificationEffectiveUntil(input: {
  verifiedAt: Date;
  effectiveUntil: Date | null;
}) {
  const policyExpiry = new Date(
    input.verifiedAt.getTime() + KNOWLEDGE_OWNER_VERIFICATION_FRESHNESS_MS,
  );
  if (!input.effectiveUntil || input.effectiveUntil <= input.verifiedAt) return policyExpiry;
  return new Date(Math.min(input.effectiveUntil.getTime(), policyExpiry.getTime()));
}
