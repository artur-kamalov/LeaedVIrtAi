import assert from "node:assert/strict";
import {
  buildDefaultKnowledgeCapabilityDefinitionsV1,
  evaluateKnowledgeCapabilitySnapshotV1,
} from "./capability-snapshot-v1.js";
import {
  KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1,
  KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1,
  projectKnowledgeOperationalCapabilitiesV1,
} from "./capability-runtime-evidence-v1.js";
import {
  KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1,
  knowledgeV2LiveToolDefinitionV1,
} from "./v2-live-tool-registry.js";

const tenantId = "tenant-capability-runtime-smoke";
const evaluatedAt = new Date("2026-07-15T12:00:00.000Z");

function projection(permissionGeneration: number | null, connectionObservedAt = evaluatedAt) {
  return projectKnowledgeOperationalCapabilitiesV1({
    tenantId,
    evaluatedAt,
    authorizationState:
      permissionGeneration === null
        ? null
        : {
            tenantId,
            permissionGeneration,
            updatedAt: new Date("2026-07-15T11:59:00.000Z"),
          },
    connections: [
      {
        id: "calendar-demo-row",
        provider: "GOOGLE_CALENDAR",
        status: "CONNECTED",
        permissionVersion: 9,
        serverVerifiedCapabilities: ["calendar.read", "calendar.write"],
        credentialsConfigured: true,
        healthy: true,
        observedAt: connectionObservedAt,
        healthExpiresAt: new Date(evaluatedAt.getTime() + 60_000),
      },
    ],
  });
}

assert.equal(KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1.length, 6);
assert.equal(KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1.length, 4);
assert.equal(KNOWLEDGE_V2_LIVE_TOOL_DEFINITIONS_V1.length, 2);
assert.equal(knowledgeV2LiveToolDefinitionV1("ORDER_STATE")?.toolKey, "order.status.read");
assert.deepEqual(knowledgeV2LiveToolDefinitionV1("ORDER_STATE")?.capabilityToolKeys, [
  "order.lookup",
]);
assert.deepEqual(knowledgeV2LiveToolDefinitionV1("BOOKING_STATE")?.capabilityToolKeys, []);

const generationSeven = projection(7);
assert.equal(generationSeven.permissionGeneration, 7);
assert.equal(generationSeven.decisions.length, 10);
assert.deepEqual(
  generationSeven.decisions
    .filter((decision) => decision.kind === "TOOL" && decision.available)
    .map((decision) => decision.requirementKey),
  ["order.lookup"],
);
assert.deepEqual(
  generationSeven.decisions
    .filter((decision) => decision.kind === "PERMISSION" && decision.available)
    .map((decision) => decision.requirementKey),
  ["customer_state.read"],
);
assert.deepEqual(generationSeven.executableBindings, [
  {
    requirementToolKey: "order.lookup",
    executorToolKey: "order.status.read",
    executorVersion: "1",
    operationalCategory: "ORDER_STATE",
    permissionGeneration: 7,
  },
]);
assert.equal(
  generationSeven.decisions.find((decision) => decision.requirementKey === "calendar.booking")
    ?.reason,
  "UNSUPPORTED_EXECUTOR",
);

const noAuthorization = projection(null);
assert.equal(noAuthorization.permissionGeneration, null);
assert.deepEqual(noAuthorization.executableBindings, []);
assert.equal(
  noAuthorization.decisions.find((decision) => decision.requirementKey === "customer_state.read")
    ?.reason,
  "AUTHORIZATION_STATE_MISSING",
);

const generationEight = projection(8);
assert.notEqual(generationSeven.dependencySetHash, generationEight.dependencySetHash);
assert.notEqual(generationSeven.bindingHash, generationEight.bindingHash);
const unrelatedSyncTimestamp = projection(7, new Date(evaluatedAt.getTime() + 30_000));
assert.equal(generationSeven.dependencySetHash, unrelatedSyncTimestamp.dependencySetHash);
assert.equal(generationSeven.bindingHash, unrelatedSyncTimestamp.bindingHash);
assert.notEqual(
  generationSeven.evidence.find((item) => item.evidenceId === "permission:customer_state.read")?.ref
    .versionHash,
  generationEight.evidence.find((item) => item.evidenceId === "permission:customer_state.read")?.ref
    .versionHash,
);

const supportDefinition = buildDefaultKnowledgeCapabilityDefinitionsV1({
  enabled: { GENERAL_FAQ: false, ORDER_ACCOUNT_SUPPORT: true },
}).find((definition) => definition.capabilityType === "ORDER_ACCOUNT_SUPPORT")!;
const supportRuntimeDefinition = {
  ...supportDefinition,
  requirements: supportDefinition.requirements.filter((requirement) =>
    ["account_lookup_tool", "customer_state_permission"].includes(requirement.requirementKey),
  ),
};
const supportSeven = evaluateKnowledgeCapabilitySnapshotV1({
  schemaVersion: 1,
  evaluatedAt: evaluatedAt.toISOString(),
  capabilities: [supportRuntimeDefinition],
  evidence: generationSeven.evidence,
});
assert.equal(supportSeven.capabilities[0]?.status, "READY");
assert.deepEqual(
  supportSeven.capabilities[0]?.requirements.map((requirement) => requirement.status),
  ["SATISFIED", "SATISFIED"],
);
const supportEight = evaluateKnowledgeCapabilitySnapshotV1({
  schemaVersion: 1,
  evaluatedAt: evaluatedAt.toISOString(),
  capabilities: [supportRuntimeDefinition],
  evidence: generationEight.evidence,
});
assert.notEqual(
  supportSeven.requirementEvaluationSetHash,
  supportEight.requirementEvaluationSetHash,
);

const bookingDefinition = buildDefaultKnowledgeCapabilityDefinitionsV1({
  enabled: { GENERAL_FAQ: false, APPOINTMENT_BOOKING: true },
}).find((definition) => definition.capabilityType === "APPOINTMENT_BOOKING")!;
const bookingToolDefinition = {
  ...bookingDefinition,
  requirements: bookingDefinition.requirements.filter(
    (requirement) => requirement.requirementKey === "booking_tool",
  ),
};
const booking = evaluateKnowledgeCapabilitySnapshotV1({
  schemaVersion: 1,
  evaluatedAt: evaluatedAt.toISOString(),
  capabilities: [bookingToolDefinition],
  evidence: generationSeven.evidence,
});
assert.equal(booking.capabilities[0]?.status, "BLOCKED");
assert.equal(booking.capabilities[0]?.requirements[0]?.reasonCode, "THRESHOLD_NOT_MET");
assert.deepEqual(booking.capabilities[0]?.requirements[0]?.evidenceIds, ["tool:calendar.booking"]);

console.log(
  JSON.stringify({
    operationalDefinitions: KNOWLEDGE_OPERATIONAL_CAPABILITY_DEFINITIONS_V1.length,
    permissionDefinitions: KNOWLEDGE_OPERATIONAL_PERMISSION_DEFINITIONS_V1.length,
    executableBindings: generationSeven.executableBindings.length,
    generationBoundEvaluation: true,
    unsupportedToolsFailClosed: true,
  }),
);
