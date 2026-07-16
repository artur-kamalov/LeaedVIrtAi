import type { KnowledgeCapabilityAutonomyV1 } from "./capability-snapshot-v1.js";

export const KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1 = "knowledge-capability-autonomy-v1";

export type KnowledgeCapabilityEffectV1 =
  | "ANSWER"
  | "COLLECT_INFORMATION"
  | "PROPOSE_ACTION"
  | "COMMIT_ACTION";

export type KnowledgeCapabilityAutonomyDecisionReasonV1 =
  | "ALLOWED"
  | "BINDING_MISSING"
  | "AUTONOMY_INSUFFICIENT"
  | "CONFIRMATION_REQUIRED"
  | "AUTONOMOUS_ACTION_NOT_APPROVED";

export interface KnowledgeCapabilityAutonomyDecisionV1 {
  policyVersion: typeof KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1;
  allowed: boolean;
  requiredAutonomy: KnowledgeCapabilityAutonomyV1;
  reason: KnowledgeCapabilityAutonomyDecisionReasonV1;
}

const autonomyRank: Record<KnowledgeCapabilityAutonomyV1, number> = {
  ANSWER_ONLY: 0,
  COLLECT_INFORMATION: 1,
  PROPOSE_ACTION: 2,
  ACT_WITH_CONFIRMATION: 3,
  AUTONOMOUS_ACTION: 4,
};

const requiredAutonomy: Record<KnowledgeCapabilityEffectV1, KnowledgeCapabilityAutonomyV1> = {
  ANSWER: "ANSWER_ONLY",
  COLLECT_INFORMATION: "COLLECT_INFORMATION",
  PROPOSE_ACTION: "PROPOSE_ACTION",
  COMMIT_ACTION: "ACT_WITH_CONFIRMATION",
};

export function authorizeKnowledgeCapabilityEffectV1(input: {
  allowedAutonomy?: KnowledgeCapabilityAutonomyV1 | null;
  effect: KnowledgeCapabilityEffectV1;
  confirmationValid?: boolean;
  autonomousActionApproved?: boolean;
}): KnowledgeCapabilityAutonomyDecisionV1 {
  const required = requiredAutonomy[input.effect];
  if (!input.allowedAutonomy) {
    return {
      policyVersion: KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1,
      allowed: false,
      requiredAutonomy: required,
      reason: "BINDING_MISSING",
    };
  }
  if (input.effect !== "COMMIT_ACTION") {
    const allowed = autonomyRank[input.allowedAutonomy] >= autonomyRank[required];
    return {
      policyVersion: KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1,
      allowed,
      requiredAutonomy: required,
      reason: allowed ? "ALLOWED" : "AUTONOMY_INSUFFICIENT",
    };
  }
  if (input.allowedAutonomy === "ACT_WITH_CONFIRMATION") {
    return {
      policyVersion: KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1,
      allowed: input.confirmationValid === true,
      requiredAutonomy: required,
      reason: input.confirmationValid === true ? "ALLOWED" : "CONFIRMATION_REQUIRED",
    };
  }
  if (input.allowedAutonomy === "AUTONOMOUS_ACTION") {
    return {
      policyVersion: KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1,
      allowed: input.autonomousActionApproved === true,
      requiredAutonomy: "AUTONOMOUS_ACTION",
      reason:
        input.autonomousActionApproved === true
          ? "ALLOWED"
          : "AUTONOMOUS_ACTION_NOT_APPROVED",
    };
  }
  return {
    policyVersion: KNOWLEDGE_CAPABILITY_AUTONOMY_POLICY_V1,
    allowed: false,
    requiredAutonomy: required,
    reason: "AUTONOMY_INSUFFICIENT",
  };
}

export function knowledgeCapabilityToolEffectV1(toolType: string): KnowledgeCapabilityEffectV1 {
  if (toolType === "lead.update" || toolType === "lead.note.create") {
    return "COLLECT_INFORMATION";
  }
  if (toolType === "booking.proposal.create") return "PROPOSE_ACTION";
  return "COMMIT_ACTION";
}
