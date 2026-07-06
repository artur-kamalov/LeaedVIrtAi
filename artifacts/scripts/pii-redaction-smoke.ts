import { detectSensitiveDataTags, detectSensitiveTextTags, redactAndTagSensitiveData, redactSensitiveData, redactSensitiveText } from "@leadvirt/observability";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const botToken = "123456789012:LeadVirtTestToken_abcdef123456";
const text = redactSensitiveText(`Lead email client@example.com phone +7 999 111-22-33 bot ${botToken} date 2026-07-07 14:00`);
assert(!text.includes("client@example.com"), "Expected email redaction.");
assert(!text.includes("+7 999 111-22-33"), "Expected phone redaction.");
assert(!text.includes(botToken), "Expected bot token redaction.");
assert(text.includes("2026-07-07 14:00"), "Expected date/time to remain readable.");
assert(JSON.stringify(detectSensitiveTextTags(text)) === "[]", "Expected redacted text to have no remaining sensitive tags.");
assert(
  JSON.stringify(detectSensitiveTextTags(`Lead email client@example.com phone +7 999 111-22-33 bot ${botToken}`)) === JSON.stringify(["email", "phone", "token"]),
  "Expected text sensitive tags."
);

const redacted = redactSensitiveData({
  customer: {
    email: "lead@mail.ru",
    phone: "+7 (900) 123-45-67",
    note: "Call +7 900 123-45-67 from lead@mail.ru"
  },
  webhookSecret: "super-secret",
  nested: {
    accessToken: "token-value",
    safeId: "lead_123"
  }
});

const payload = JSON.stringify(redacted);
assert(!payload.includes("lead@mail.ru"), "Expected nested email redaction.");
assert(!payload.includes("+7 (900) 123-45-67"), "Expected nested phone redaction.");
assert(!payload.includes("super-secret"), "Expected secret-key redaction.");
assert(!payload.includes("token-value"), "Expected access token redaction.");
assert(payload.includes("lead_123"), "Expected safe ids to remain.");

const tagged = redactAndTagSensitiveData({
  email: "tagged@example.com",
  phone: "+7 900 000-00-00",
  apiKey: "sk-test-secret",
  bot: botToken
});
assert(JSON.stringify(tagged.tags) === JSON.stringify(["email", "phone", "secret", "token"]), "Expected data sensitive tags.");
assert(tagged.redactedCount === 4, "Expected four sensitive tag categories.");
const taggedPayload = JSON.stringify(tagged.redacted);
assert(!taggedPayload.includes("tagged@example.com"), "Expected tagged email redaction.");
assert(!taggedPayload.includes("+7 900 000-00-00"), "Expected tagged phone redaction.");
assert(!taggedPayload.includes("sk-test-secret"), "Expected tagged secret redaction.");
assert(!taggedPayload.includes(botToken), "Expected tagged token redaction.");

console.log(JSON.stringify({ ok: true, tags: tagged.tags }));
