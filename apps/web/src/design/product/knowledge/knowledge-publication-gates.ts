import type { KnowledgeV2PublicationGateView, KnowledgeV2ResourceType } from "@leadvirt/types";
import type { TranslationKey } from "@/i18n/messages";
import type { KnowledgeNavigationTarget, KnowledgeViewId } from "./knowledge-views";

type Translate = (
  key: TranslationKey,
  variables?: Record<string, string | number | null | undefined>,
) => string;

export type KnowledgeGateGroupKind = "SERVICES" | "IDENTITY" | "ESCALATION" | "GENERIC";

export interface KnowledgeGateGroup {
  key: string;
  kind: KnowledgeGateGroupKind;
  status: KnowledgeV2PublicationGateView["status"];
  gates: KnowledgeV2PublicationGateView[];
  target: KnowledgeNavigationTarget | null;
}

function remediationView(type: KnowledgeV2ResourceType | undefined): KnowledgeViewId | null {
  if (type === "CAPABILITY") return "overview";
  if (type === "FACT" || type === "SETTINGS") return "business";
  if (type === "GUIDANCE_RULE") return "guidance";
  if (
    type === "SOURCE" ||
    type === "ARTIFACT" ||
    type === "DOCUMENT" ||
    type === "REVISION" ||
    type === "CHUNK" ||
    type === "EVIDENCE_REFERENCE" ||
    type === "CITATION"
  ) {
    return "sources";
  }
  if (type === "REVIEW_ITEM" || type === "CONFLICT") return "review";
  if (
    type === "TEST_CASE" ||
    type === "EVALUATION_RUN" ||
    type === "EVALUATION_RESULT" ||
    type === "FEEDBACK" ||
    type === "RETRIEVAL_TRACE"
  ) {
    return "test";
  }
  return null;
}

export function knowledgeGateRemediationTarget(
  gate: KnowledgeV2PublicationGateView,
): KnowledgeNavigationTarget | null {
  const destination = gate.remediation?.destination;
  const resource =
    destination?.resource ?? gate.remediation?.resource ?? gate.resource ?? undefined;
  if (destination) {
    return {
      view: destination.view,
      task: destination.task,
      resourceType: resource?.type,
      resourceId: resource?.id,
      sourceId: destination.sourceId,
      documentId: destination.documentId,
      revisionId: destination.revisionId,
    };
  }
  if (
    gate.code === "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED" &&
    resource?.type === "FACT"
  ) {
    return {
      view: "business",
      task: "verify-fact",
      resourceType: resource.type,
      resourceId: resource.id,
    };
  }
  if (gate.code.includes("BUSINESS_IDENTITY")) {
    return { view: "business", task: "business-identity" };
  }
  if (gate.code.includes("ESCALATION_ROUTE")) {
    return { view: "guidance", task: "operator-handoff" };
  }
  const view = remediationView(resource?.type);
  if (!view) return null;
  return {
    view,
    resourceType: resource?.type,
    resourceId: resource?.id,
  };
}

function gateGroupKind(gate: KnowledgeV2PublicationGateView): KnowledgeGateGroupKind {
  const resource =
    gate.remediation?.destination?.resource ?? gate.remediation?.resource ?? gate.resource;
  if (gate.remediation?.destination?.task === "verify-services" && resource?.type === "FACT") {
    return "SERVICES";
  }
  if (gate.code.includes("BUSINESS_IDENTITY")) return "IDENTITY";
  if (gate.code.includes("ESCALATION_ROUTE")) return "ESCALATION";
  return "GENERIC";
}

export function groupKnowledgePublicationGates(
  gates: KnowledgeV2PublicationGateView[],
): KnowledgeGateGroup[] {
  const groups = new Map<string, KnowledgeGateGroup>();
  for (const gate of gates) {
    const kind = gateGroupKind(gate);
    const target = knowledgeGateRemediationTarget(gate);
    const key =
      kind === "GENERIC"
        ? `${gate.status}:${gate.code}:${target?.view ?? "DETAILS"}:${target?.task ?? ""}`
        : `${gate.status}:${kind}`;
    const existing = groups.get(key);
    if (existing) {
      existing.gates.push(gate);
    } else {
      groups.set(key, { key, kind, status: gate.status, gates: [gate], target });
    }
  }
  return [...groups.values()];
}

export function knowledgeGateGroupCopy(
  group: KnowledgeGateGroup,
  t: Translate,
  formatNumber: (value: number) => string,
) {
  const count = formatNumber(group.gates.length);
  if (group.kind === "SERVICES") {
    return {
      title: t("knowledge.ux.gate.servicesTitle", { count }),
      description: t("knowledge.ux.gate.servicesDescription"),
    };
  }
  if (group.kind === "IDENTITY") {
    return {
      title: t("knowledge.ux.gate.identityTitle"),
      description: t("knowledge.ux.gate.identityDescription"),
    };
  }
  if (group.kind === "ESCALATION") {
    return {
      title: t("knowledge.ux.gate.escalationTitle"),
      description: t("knowledge.ux.gate.escalationDescription"),
    };
  }
  return {
    title: t(
      group.status === "BLOCKED"
        ? "knowledge.ux.gate.genericBlockedTitle"
        : "knowledge.ux.gate.genericWarningTitle",
      { count },
    ),
    description: t(
      group.target
        ? "knowledge.ux.gate.genericBlockedDescription"
        : "knowledge.ux.gate.unknownDetailsTitle",
    ),
  };
}
