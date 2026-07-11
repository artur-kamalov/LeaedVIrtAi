import { EmailOtpDeliveryService, type SmtpTransportFactory } from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  process.env.NODE_ENV = "production";
  process.env.AUTH_EMAIL_OTP_ENABLED = "true";
  process.env.EMAIL_PROVIDER = "manual";
  process.env.EMAIL_OTP_PROVIDER = "smtp";
  process.env.EMAIL_FROM = "LeadVirt.ai <noreply@leadvirt.com>";
  process.env.SMTP_HOST = "smtp.beget.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  process.env.SMTP_USER = "noreply@leadvirt.com";
  process.env.SMTP_PASSWORD = "smtp-contract-secret";

  let capturedOptions: Parameters<SmtpTransportFactory>[0] | undefined;
  let capturedMessage: Record<string, unknown> | undefined;
  let closed = false;
  const factory: SmtpTransportFactory = (options) => {
    capturedOptions = options;
    return {
      sendMail: async (message) => {
        capturedMessage = message;
        return { messageId: "smtp-message-1" };
      },
      close: () => {
        closed = true;
      },
    };
  };

  const service = new EmailOtpDeliveryService(factory);
  assert(service.config().enabled, "SMTP OTP must be enabled with complete production configuration.");
  const result = await service.send({
    challengeId: "c".repeat(48),
    email: "owner@example.com",
    code: "482105",
    locale: "de",
  });

  assert(result.providerMessageId === "smtp-message-1", "SMTP message id was not returned.");
  assert(capturedOptions?.host === "smtp.beget.com", "SMTP host was not forwarded.");
  assert(capturedOptions.port === 465 && capturedOptions.secure, "SMTP implicit TLS configuration is incorrect.");
  assert(capturedOptions.auth.user === "noreply@leadvirt.com", "SMTP username was not forwarded.");
  assert(capturedOptions.auth.pass === "smtp-contract-secret", "SMTP password was not forwarded to transport auth.");
  assert(capturedOptions.tls.rejectUnauthorized, "SMTP TLS certificate validation must stay enabled.");
  assert(capturedOptions.connectionTimeout <= 10_000, "SMTP connection timeout is too long for an auth request.");
  assert(capturedMessage?.to === "owner@example.com", "SMTP recipient is incorrect.");
  assert(
    JSON.stringify(capturedMessage.from) === JSON.stringify({ name: "LeadVirt.ai", address: "noreply@leadvirt.com" }),
    "SMTP sender is incorrect.",
  );
  assert(String(capturedMessage.subject).includes("LeadVirt.ai"), "SMTP subject is missing product identity.");
  assert(String(capturedMessage.html).includes("482105"), "SMTP HTML body is missing the OTP code.");
  assert(String(capturedMessage.text).includes("482105"), "SMTP text body is missing the OTP code.");
  assert(capturedMessage.disableFileAccess === true && capturedMessage.disableUrlAccess === true, "SMTP message access controls are disabled.");
  assert(!JSON.stringify(capturedMessage).includes("smtp-contract-secret"), "SMTP password leaked into message content.");
  assert(closed, "SMTP transport was not closed after delivery.");

  let failureClosed = false;
  const failureFactory: SmtpTransportFactory = () => ({
    sendMail: async () => {
      throw new Error("Authentication details from provider");
    },
    close: () => {
      failureClosed = true;
    },
  });
  let deliveryError: unknown;
  try {
    await new EmailOtpDeliveryService(failureFactory).send({
      challengeId: "d".repeat(48),
      email: "owner@example.com",
      code: "195204",
      locale: "en",
    });
  } catch (error) {
    deliveryError = error;
  }
  assert(deliveryError instanceof Error, "SMTP provider errors must reject delivery.");
  assert(deliveryError.message === "Email delivery is temporarily unavailable.", "SMTP provider details leaked through the auth error.");
  assert(failureClosed, "SMTP transport was not closed after a delivery error.");

  delete process.env.SMTP_PASSWORD;
  assert(new EmailOtpDeliveryService(factory).config().enabled === false, "SMTP OTP must fail closed without a password.");
  console.log(JSON.stringify({ ok: true, checks: 19 }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
