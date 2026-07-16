import assert from "node:assert/strict";
import {
  authorizeKnowledgeCapabilityEffectV1,
  knowledgeCapabilityToolEffectV1,
} from "./capability-autonomy-v1.js";

assert.equal(
  authorizeKnowledgeCapabilityEffectV1({ allowedAutonomy: "ANSWER_ONLY", effect: "ANSWER" })
    .allowed,
  true,
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "ANSWER_ONLY",
    effect: "COLLECT_INFORMATION",
  }).allowed,
  false,
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "PROPOSE_ACTION",
    effect: "PROPOSE_ACTION",
  }).allowed,
  true,
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "ACT_WITH_CONFIRMATION",
    effect: "COMMIT_ACTION",
  }).reason,
  "CONFIRMATION_REQUIRED",
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "ACT_WITH_CONFIRMATION",
    effect: "COMMIT_ACTION",
    confirmationValid: true,
  }).allowed,
  true,
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "AUTONOMOUS_ACTION",
    effect: "COMMIT_ACTION",
  }).reason,
  "AUTONOMOUS_ACTION_NOT_APPROVED",
);
assert.equal(
  authorizeKnowledgeCapabilityEffectV1({
    allowedAutonomy: "AUTONOMOUS_ACTION",
    effect: "COMMIT_ACTION",
    autonomousActionApproved: true,
  }).allowed,
  true,
);
assert.equal(knowledgeCapabilityToolEffectV1("booking.proposal.create"), "PROPOSE_ACTION");
assert.equal(knowledgeCapabilityToolEffectV1("lead.status.change"), "COMMIT_ACTION");

console.log(JSON.stringify({ policyMatrix: true, confirmationFailClosed: true }));
