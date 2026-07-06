import { redactAndTagSensitiveData } from "@leadvirt/observability";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const promptAndEvalArtifact = {
  caseId: "pii_eval_redaction",
  userMessage: "Please call me at +7 999 111-22-33 or client@example.com.",
  expected: {
    mustRetrieveTerms: ["price", "available slot"]
  },
  observed: {
    reply: "I will ask a manager to call +7 999 111-22-33.",
    retrievedContext: "VIP customer email client@example.com. Internal token 123456789012:LeadVirtTestToken_abcdef123456.",
    metadata: {
      webhookSecret: "secret-should-not-leak",
      toolCalls: [
        {
          type: "lead.note.create",
          input: {
            note: "Customer client@example.com wants a callback."
          }
        }
      ]
    }
  }
};

const scan = redactAndTagSensitiveData(promptAndEvalArtifact);
const payload = JSON.stringify(scan.redacted);

assert(JSON.stringify(scan.tags) === JSON.stringify(["email", "phone", "secret", "token"]), "Expected prompt/eval sensitive tags.");
assert(!payload.includes("client@example.com"), "Expected email redaction in eval artifact.");
assert(!payload.includes("+7 999 111-22-33"), "Expected phone redaction in eval artifact.");
assert(!payload.includes("secret-should-not-leak"), "Expected secret redaction in eval artifact.");
assert(!payload.includes("123456789012:LeadVirtTestToken_abcdef123456"), "Expected token redaction in eval artifact.");
assert(payload.includes("[redacted-email]"), "Expected redacted email marker.");
assert(payload.includes("[redacted-phone]"), "Expected redacted phone marker.");
assert(payload.includes("[redacted-secret]"), "Expected redacted secret marker.");
assert(payload.includes("[redacted-token]"), "Expected redacted token marker.");

console.log(JSON.stringify({ ok: true, tags: scan.tags }));
