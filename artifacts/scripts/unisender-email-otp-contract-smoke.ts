import { EmailOtpDeliveryService } from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFeatureFlag = process.env.AUTH_EMAIL_OTP_ENABLED;
  const originalEmailProvider = process.env.EMAIL_PROVIDER;
  const originalOtpProvider = process.env.EMAIL_OTP_PROVIDER;
  process.env.AUTH_EMAIL_OTP_ENABLED = "true";
  process.env.EMAIL_PROVIDER = "manual";
  process.env.EMAIL_OTP_PROVIDER = "unisender";
  process.env.UNISENDER_API_KEY = "contract-test-secret";
  process.env.UNISENDER_LIST_ID = "321";
  process.env.UNISENDER_SENDER_NAME = "LeadVirt.ai";
  process.env.UNISENDER_SENDER_EMAIL = "verified@leadvirt.com";

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedForm: URLSearchParams | null = null;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedForm = new URLSearchParams(String(init?.body ?? ""));
    return new Response(JSON.stringify({ result: [{ id: "provider-message-1", email: "owner@example.com" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const service = new EmailOtpDeliveryService();
    assert(service.config().enabled, "OTP delivery must not depend on the password-reset email provider.");
    const result = await service.send({
      challengeId: "a".repeat(48),
      email: "owner@example.com",
      code: "482105",
      locale: "fr",
    });

    assert(result.providerMessageId === "provider-message-1", "Provider message id was not returned.");
    assert(!capturedUrl.includes("contract-test-secret"), "UniSender API key must not be placed in the URL.");
    assert(capturedForm?.get("api_key") === "contract-test-secret", "UniSender API key is missing from the POST body.");
    assert(capturedForm?.get("sender_email") === "verified@leadvirt.com", "Verified sender email is missing.");
    assert(capturedForm?.get("list_id") === "321", "Dedicated authentication list id is missing.");
    assert(capturedForm?.get("track_read") === "0" && capturedForm.get("track_links") === "0", "OTP tracking must stay disabled.");
    assert(capturedForm?.get("lang") === "fr", "Email locale was not forwarded.");
    assert(capturedForm?.get("body")?.includes("482105"), "Localized email body does not contain the OTP code.");
    assert(capturedForm?.get("ref_key") === "a".repeat(48), "Challenge id was not used as the idempotency key.");

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ result: [{ index: 0, email: "owner@example.com", errors: [{ code: "retry_later", message: "Provider detail" }] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    let providerError: unknown;
    try {
      await service.send({ challengeId: "b".repeat(48), email: "owner@example.com", code: "195204", locale: "en" });
    } catch (error) {
      providerError = error;
    }
    assert(providerError instanceof Error, "UniSender recipient errors must reject delivery.");
    assert(providerError.message === "Email delivery is temporarily unavailable.", "Provider details must not leak through auth errors.");

    process.env.NODE_ENV = "production";
    delete process.env.AUTH_EMAIL_OTP_ENABLED;
    assert(new EmailOtpDeliveryService().config().enabled === false, "Production email OTP must require an explicit enable flag.");
    console.log(JSON.stringify({ ok: true, checks: 13 }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFeatureFlag === undefined) delete process.env.AUTH_EMAIL_OTP_ENABLED;
    else process.env.AUTH_EMAIL_OTP_ENABLED = originalFeatureFlag;
    if (originalEmailProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = originalEmailProvider;
    if (originalOtpProvider === undefined) delete process.env.EMAIL_OTP_PROVIDER;
    else process.env.EMAIL_OTP_PROVIDER = originalOtpProvider;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
