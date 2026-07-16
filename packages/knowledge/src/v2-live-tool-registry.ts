import type { KnowledgeOperationalLiveCategory } from "./v2-retriever.js";
import { KNOWLEDGE_LIVE_TOOL_POLICY_VERSION } from "./v2-retriever.js";

export const KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION = "knowledge-v2-live-tool-registry-v1";

export interface KnowledgeV2LiveToolDefinitionV1 {
  schemaVersion: 1;
  operationalCategory: KnowledgeOperationalLiveCategory;
  toolKey: string;
  toolVersion: string;
  safeName: string;
  resultType: string;
  resourceType: "BOOKING" | "ORDER";
  readOnly: true;
  authorizationMode: "AUTHENTICATED_CUSTOMER_SELF";
  providerConnectionRequired: false;
  capabilityToolKeys: readonly string[];
  capabilityPermissionKeys: readonly string[];
  policyVersion: typeof KNOWLEDGE_LIVE_TOOL_POLICY_VERSION;
}

export const KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1 = [
  {
    schemaVersion: 1,
    operationalCategory: "BOOKING_STATE",
    toolKey: "booking.status.read",
    toolVersion: "1",
    safeName: "Current booking status",
    resultType: "booking.status",
    resourceType: "BOOKING",
    readOnly: true,
    authorizationMode: "AUTHENTICATED_CUSTOMER_SELF",
    providerConnectionRequired: false,
    capabilityToolKeys: [],
    capabilityPermissionKeys: [],
    policyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
  },
  {
    schemaVersion: 1,
    operationalCategory: "ORDER_STATE",
    toolKey: "order.status.read",
    toolVersion: "1",
    safeName: "Current order status",
    resultType: "order.status",
    resourceType: "ORDER",
    readOnly: true,
    authorizationMode: "AUTHENTICATED_CUSTOMER_SELF",
    providerConnectionRequired: false,
    capabilityToolKeys: ["order.lookup"],
    capabilityPermissionKeys: ["customer_state.read"],
    policyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
  },
] as const satisfies readonly KnowledgeV2LiveToolDefinitionV1[];

const definitionsByCategory = new Map<
  KnowledgeOperationalLiveCategory,
  KnowledgeV2LiveToolDefinitionV1
>(
  KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1.map((definition) => [
    definition.operationalCategory,
    definition,
  ]),
);

export function knowledgeV2LiveToolDefinitionV1(
  operationalCategory: KnowledgeOperationalLiveCategory,
) {
  return definitionsByCategory.get(operationalCategory) ?? null;
}
