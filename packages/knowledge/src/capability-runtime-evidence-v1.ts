import { createHash } from "node:crypto";
import type { KnowledgeCapabilityEvidenceV1 } from "./capability-snapshot-v1.js";
import {
  KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1,
  KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION,
} from "./v2-live-tool-registry.js";
import { KNOWLEDGE_LIVE_TOOL_POLICY_VERSION } from "./v2-retriever.js";

export const KNOWLEDGE_CAPABILITY_RUNTIME_EVIDENCE_V1 = "knowledge-capability-runtime-evidence-v1";
export const KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1 =
  "knowledge-operational-capability-registry-v1";

type OperationalCapabilitySupportV1 = "SUPPORTED" | "UNSUPPORTED";
type OperationalCapabilityOperationV1 = "READ" | "WRITE";

export interface KnowledgeOperationalCapabilityDefinitionV1 {
  schemaVersion: 1;
  requirementToolKey: string;
  operation: OperationalCapabilityOperationV1;
  support: OperationalCapabilitySupportV1;
  executorToolKey: string | null;
  executorVersion: string | null;
  operationalCategory: string | null;
  providerAlternatives: readonly string[];
  requiredProviderCapabilities: readonly string[];
  requiredPermissionKeys: readonly string[];
  authorizationMode: "NONE" | "AUTHENTICATED_CUSTOMER_SELF";
  confirmationRequired: boolean;
  idempotencyRequired: boolean;
}

export const KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1 = [
  {
    schemaVersion: 1,
    requirementToolKey: "quote.lookup",
    operation: "READ",
    support: "UNSUPPORTED",
    executorToolKey: null,
    executorVersion: null,
    operationalCategory: null,
    providerAlternatives: [],
    requiredProviderCapabilities: [],
    requiredPermissionKeys: [],
    authorizationMode: "NONE",
    confirmationRequired: false,
    idempotencyRequired: false,
  },
  {
    schemaVersion: 1,
    requirementToolKey: "calendar.availability",
    operation: "READ",
    support: "UNSUPPORTED",
    executorToolKey: null,
    executorVersion: null,
    operationalCategory: "AVAILABILITY",
    providerAlternatives: ["GOOGLE_CALENDAR"],
    requiredProviderCapabilities: ["calendar.read"],
    requiredPermissionKeys: [],
    authorizationMode: "NONE",
    confirmationRequired: false,
    idempotencyRequired: false,
  },
  {
    schemaVersion: 1,
    requirementToolKey: "calendar.booking",
    operation: "WRITE",
    support: "UNSUPPORTED",
    executorToolKey: null,
    executorVersion: null,
    operationalCategory: "BOOKING_WRITE",
    providerAlternatives: ["GOOGLE_CALENDAR"],
    requiredProviderCapabilities: ["calendar.write"],
    requiredPermissionKeys: ["calendar.write"],
    authorizationMode: "AUTHENTICATED_CUSTOMER_SELF",
    confirmationRequired: true,
    idempotencyRequired: true,
  },
  {
    schemaVersion: 1,
    requirementToolKey: "account.lookup",
    operation: "READ",
    support: "UNSUPPORTED",
    executorToolKey: null,
    executorVersion: null,
    operationalCategory: "ACCOUNT_STATE",
    providerAlternatives: [],
    requiredProviderCapabilities: [],
    requiredPermissionKeys: ["customer_state.read"],
    authorizationMode: "AUTHENTICATED_CUSTOMER_SELF",
    confirmationRequired: false,
    idempotencyRequired: false,
  },
  {
    schemaVersion: 1,
    requirementToolKey: "order.lookup",
    operation: "READ",
    support: "SUPPORTED",
    executorToolKey: "order.status.read",
    executorVersion: "1",
    operationalCategory: "ORDER_STATE",
    providerAlternatives: [],
    requiredProviderCapabilities: [],
    requiredPermissionKeys: ["customer_state.read"],
    authorizationMode: "AUTHENTICATED_CUSTOMER_SELF",
    confirmationRequired: false,
    idempotencyRequired: false,
  },
  {
    schemaVersion: 1,
    requirementToolKey: "inventory.lookup",
    operation: "READ",
    support: "UNSUPPORTED",
    executorToolKey: null,
    executorVersion: null,
    operationalCategory: "INVENTORY_STATE",
    providerAlternatives: ["SHOPIFY", "SHOP_SCRIPT"],
    requiredProviderCapabilities: ["inventory.read"],
    requiredPermissionKeys: [],
    authorizationMode: "NONE",
    confirmationRequired: false,
    idempotencyRequired: false,
  },
] as const satisfies readonly KnowledgeOperationalCapabilityDefinitionV1[];

export const KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1 = [
  { permissionKey: "lead_data_collection", support: "UNSUPPORTED" },
  { permissionKey: "calendar.write", support: "UNSUPPORTED" },
  { permissionKey: "customer_state.read", support: "SUPPORTED" },
  { permissionKey: "regulated_specialist_handoff", support: "UNSUPPORTED" },
] as const satisfies readonly {
  permissionKey: string;
  support: OperationalCapabilitySupportV1;
}[];

export interface KnowledgeCapabilityAuthorizationStateV1 {
  tenantId: string;
  permissionGeneration: number;
  updatedAt: Date | string;
}

export interface KnowledgeOperationalConnectionStateV1 {
  id: string;
  provider: string;
  status: string;
  permissionVersion: number;
  serverVerifiedCapabilities: readonly string[];
  credentialsConfigured: boolean;
  healthy: boolean;
  observedAt: Date | string;
  healthExpiresAt?: Date | string | null;
}

export type KnowledgeOperationalCapabilityDecisionReasonV1 =
  | "AVAILABLE"
  | "UNSUPPORTED_EXECUTOR"
  | "EXECUTOR_REGISTRY_MISMATCH"
  | "AUTHORIZATION_STATE_MISSING"
  | "PERMISSION_POLICY_UNAVAILABLE"
  | "CONNECTION_UNAVAILABLE";

export interface KnowledgeOperationalCapabilityDecisionV1 {
  requirementKey: string;
  kind: "TOOL" | "PERMISSION";
  available: boolean;
  reason: KnowledgeOperationalCapabilityDecisionReasonV1;
  dependencyHash: string;
}

export interface KnowledgeOperationalCapabilityProjectionV1 {
  schemaVersion: 1;
  registryVersion: typeof KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1;
  registryHash: string;
  liveToolRegistryVersion: typeof KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION;
  liveToolPolicyVersion: typeof KNOWLEDGE_LIVE_TOOL_POLICY_VERSION;
  permissionGeneration: number | null;
  dependencySetHash: string;
  bindingHash: string;
  decisions: KnowledgeOperationalCapabilityDecisionV1[];
  evidence: KnowledgeCapabilityEvidenceV1[];
  executableBindings: {
    requirementToolKey: string;
    executorToolKey: string;
    executorVersion: string;
    operationalCategory: string;
    permissionGeneration: number;
  }[];
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}

function asDate(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validAuthorizationState(
  tenantId: string,
  state: KnowledgeCapabilityAuthorizationStateV1 | null | undefined,
) {
  const updatedAt = asDate(state?.updatedAt);
  if (
    !state ||
    state.tenantId !== tenantId ||
    !Number.isInteger(state.permissionGeneration) ||
    state.permissionGeneration <= 0 ||
    !updatedAt
  ) {
    return null;
  }
  return { ...state, updatedAt };
}

function liveExecutorMatches(definition: KnowledgeOperationalCapabilityDefinitionV1) {
  if (definition.support !== "SUPPORTED") return false;
  return KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1.some(
    (tool) =>
      tool.toolKey === definition.executorToolKey &&
      tool.toolVersion === definition.executorVersion &&
      tool.operationalCategory === definition.operationalCategory &&
      (tool.capabilityToolKeys as readonly string[]).includes(definition.requirementToolKey) &&
      definition.requiredPermissionKeys.every((permission) =>
        (tool.capabilityPermissionKeys as readonly string[]).includes(permission),
      ),
  );
}

function normalizedConnection(connection: KnowledgeOperationalConnectionStateV1) {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    permissionVersion: connection.permissionVersion,
    serverVerifiedCapabilities: [...new Set(connection.serverVerifiedCapabilities)].sort(),
    credentialsConfigured: connection.credentialsConfigured,
    healthy: connection.healthy,
    observedAt: asDate(connection.observedAt)?.toISOString() ?? null,
    healthExpiresAt: asDate(connection.healthExpiresAt)?.toISOString() ?? null,
  };
}

export function projectKnowledgeOperationalCapabilitiesV1(input: {
  tenantId: string;
  evaluatedAt: Date | string;
  authorizationState?: KnowledgeCapabilityAuthorizationStateV1 | null;
  connections?: readonly KnowledgeOperationalConnectionStateV1[];
}): KnowledgeOperationalCapabilityProjectionV1 {
  const evaluatedAt = asDate(input.evaluatedAt);
  if (!input.tenantId.trim() || !evaluatedAt) {
    throw new TypeError("Operational capability projection requires a tenant and evaluation time.");
  }
  const authorizationState = validAuthorizationState(input.tenantId, input.authorizationState);
  const connections = [...(input.connections ?? [])]
    .map(normalizedConnection)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const bindingProviders = new Set<string>(
    KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1.filter(
      (definition) => definition.support === "SUPPORTED" && liveExecutorMatches(definition),
    ).flatMap((definition) => [...definition.providerAlternatives]),
  );
  const bindingConnections = connections
    .filter((connection) => bindingProviders.has(connection.provider))
    .map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      permissionVersion: connection.permissionVersion,
      serverVerifiedCapabilities: connection.serverVerifiedCapabilities,
      credentialsConfigured: connection.credentialsConfigured,
      healthy: connection.healthy,
      healthExpiresAt: connection.healthExpiresAt,
    }));
  const registryHash = hash({
    registryVersion: KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1,
    liveToolRegistryVersion: KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION,
    liveToolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    tools: KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1,
    permissions: KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1,
  });
  const dependencySetHash = hash({
    registryHash,
    tenantId: input.tenantId,
    permissionGeneration: authorizationState?.permissionGeneration ?? null,
    connections: bindingConnections,
  });
  const evidence: KnowledgeCapabilityEvidenceV1[] = [];
  const decisions: KnowledgeOperationalCapabilityDecisionV1[] = [];
  const executableBindings: KnowledgeOperationalCapabilityProjectionV1["executableBindings"] = [];

  for (const definition of KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1) {
    const executorMatches = liveExecutorMatches(definition);
    const matchingConnections = connections.filter((connection) =>
      (definition.providerAlternatives as readonly string[]).includes(connection.provider),
    );
    const connectionAvailable =
      definition.providerAlternatives.length === 0 ||
      matchingConnections.some(
        (connection) =>
          connection.status === "CONNECTED" &&
          connection.permissionVersion > 0 &&
          connection.credentialsConfigured &&
          connection.healthy &&
          (!connection.healthExpiresAt || connection.healthExpiresAt > evaluatedAt.toISOString()) &&
          definition.requiredProviderCapabilities.every((capability) =>
            connection.serverVerifiedCapabilities.includes(capability),
          ),
      );
    const reason: KnowledgeOperationalCapabilityDecisionReasonV1 =
      definition.support !== "SUPPORTED"
        ? "UNSUPPORTED_EXECUTOR"
        : !executorMatches
          ? "EXECUTOR_REGISTRY_MISMATCH"
          : !connectionAvailable
            ? "CONNECTION_UNAVAILABLE"
            : "AVAILABLE";
    const available = reason === "AVAILABLE";
    const dependencyHash = hash({ registryHash, dependencySetHash, definition, reason });
    decisions.push({
      requirementKey: definition.requirementToolKey,
      kind: "TOOL",
      available,
      reason,
      dependencyHash,
    });
    evidence.push({
      schemaVersion: 1,
      evidenceId: `tool:${definition.requirementToolKey}`,
      kind: "TOOL",
      ref: {
        type: "TOOL",
        id: definition.executorToolKey ?? definition.requirementToolKey,
        versionId: definition.executorVersion ?? KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1,
        versionHash: dependencyHash,
      },
      toolKey: definition.requirementToolKey,
      available,
      observedAt: evaluatedAt.toISOString(),
    });
  }

  for (const definition of KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1) {
    const reason: KnowledgeOperationalCapabilityDecisionReasonV1 =
      definition.support !== "SUPPORTED"
        ? "PERMISSION_POLICY_UNAVAILABLE"
        : !authorizationState
          ? "AUTHORIZATION_STATE_MISSING"
          : "AVAILABLE";
    const granted = reason === "AVAILABLE";
    const dependencyHash = hash({
      registryHash,
      dependencySetHash,
      definition,
      permissionGeneration: authorizationState?.permissionGeneration ?? null,
      reason,
    });
    decisions.push({
      requirementKey: definition.permissionKey,
      kind: "PERMISSION",
      available: granted,
      reason,
      dependencyHash,
    });
    evidence.push({
      schemaVersion: 1,
      evidenceId: `permission:${definition.permissionKey}`,
      kind: "PERMISSION",
      ref: {
        type: "PERMISSION",
        id: definition.permissionKey,
        versionId: authorizationState
          ? `generation:${authorizationState.permissionGeneration}`
          : KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1,
        versionHash: dependencyHash,
      },
      permissionKey: definition.permissionKey,
      granted,
      observedAt: (authorizationState?.updatedAt ?? evaluatedAt).toISOString(),
    });
  }

  for (const definition of KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1) {
    const tool = decisions.find(
      (decision) =>
        decision.kind === "TOOL" && decision.requirementKey === definition.requirementToolKey,
    );
    const permissionsReady = definition.requiredPermissionKeys.every(
      (permissionKey) =>
        decisions.find(
          (decision) => decision.kind === "PERMISSION" && decision.requirementKey === permissionKey,
        )?.available === true,
    );
    if (
      tool?.available &&
      permissionsReady &&
      authorizationState &&
      definition.executorToolKey &&
      definition.executorVersion &&
      definition.operationalCategory
    ) {
      executableBindings.push({
        requirementToolKey: definition.requirementToolKey,
        executorToolKey: definition.executorToolKey,
        executorVersion: definition.executorVersion,
        operationalCategory: definition.operationalCategory,
        permissionGeneration: authorizationState.permissionGeneration,
      });
    }
  }

  const sortedDecisions = decisions.sort((left, right) =>
    `${left.kind}:${left.requirementKey}`.localeCompare(
      `${right.kind}:${right.requirementKey}`,
      "en",
    ),
  );
  const bindingHash = hash({
    schemaVersion: 1,
    registryVersion: KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1,
    registryHash,
    liveToolRegistryVersion: KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION,
    liveToolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    permissionGeneration: authorizationState?.permissionGeneration ?? null,
    dependencySetHash,
    decisions: sortedDecisions,
    executableBindings,
  });

  return {
    schemaVersion: 1,
    registryVersion: KNOWLEDGE_OPERATIONAL_CAPABILITY_REGISTRY_V1,
    registryHash,
    liveToolRegistryVersion: KNOWLEDGE_V2_LIVE_TOOL_REGISTRY_VERSION,
    liveToolPolicyVersion: KNOWLEDGE_LIVE_TOOL_POLICY_VERSION,
    permissionGeneration: authorizationState?.permissionGeneration ?? null,
    dependencySetHash,
    bindingHash,
    decisions: sortedDecisions,
    evidence: evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, "en")),
    executableBindings,
  };
}

export function buildKnowledgeCapabilityRuntimeEvidenceV1(
  input: Parameters<typeof projectKnowledgeOperationalCapabilitiesV1>[0],
) {
  return projectKnowledgeOperationalCapabilitiesV1(input).evidence;
}
