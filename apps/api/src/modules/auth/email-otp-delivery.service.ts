import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { EmailOtpLocale } from "./dto/request-email-otp.dto.js";

type EmailCopy = {
  subject: string;
  eyebrow: string;
  title: string;
  description: string;
  expiry: string;
  warning: string;
};

const emailCopy: Record<EmailOtpLocale, EmailCopy> = {
  en: {
    subject: "Your LeadVirt.ai sign-in code",
    eyebrow: "Secure sign-in",
    title: "Confirm your email",
    description: "Enter this code in LeadVirt.ai to continue:",
    expiry: "The code expires in 10 minutes.",
    warning: "If you did not request this code, you can ignore this email. Never share the code with anyone.",
  },
  es: {
    subject: "Tu código de acceso a LeadVirt.ai",
    eyebrow: "Acceso seguro",
    title: "Confirma tu correo electrónico",
    description: "Introduce este código en LeadVirt.ai para continuar:",
    expiry: "El código caduca en 10 minutos.",
    warning: "Si no solicitaste este código, ignora este correo. No compartas el código con nadie.",
  },
  fr: {
    subject: "Votre code de connexion LeadVirt.ai",
    eyebrow: "Connexion sécurisée",
    title: "Confirmez votre adresse e-mail",
    description: "Saisissez ce code dans LeadVirt.ai pour continuer :",
    expiry: "Le code expire dans 10 minutes.",
    warning: "Si vous n'avez pas demandé ce code, ignorez cet e-mail. Ne partagez jamais ce code.",
  },
  de: {
    subject: "Ihr LeadVirt.ai-Anmeldecode",
    eyebrow: "Sichere Anmeldung",
    title: "E-Mail-Adresse bestätigen",
    description: "Geben Sie diesen Code in LeadVirt.ai ein:",
    expiry: "Der Code läuft in 10 Minuten ab.",
    warning: "Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail. Geben Sie den Code niemals weiter.",
  },
  pt: {
    subject: "Seu código de acesso ao LeadVirt.ai",
    eyebrow: "Acesso seguro",
    title: "Confirme seu e-mail",
    description: "Digite este código no LeadVirt.ai para continuar:",
    expiry: "O código expira em 10 minutos.",
    warning: "Se você não solicitou este código, ignore este e-mail. Nunca compartilhe o código.",
  },
  ru: {
    subject: "Код для входа в LeadVirt.ai",
    eyebrow: "Безопасный вход",
    title: "Подтвердите email",
    description: "Введите этот код в LeadVirt.ai, чтобы продолжить:",
    expiry: "Код действует 10 минут.",
    warning: "Если вы не запрашивали код, проигнорируйте письмо. Никому не сообщайте этот код.",
  },
};

type UniSenderResponse = {
  error?: unknown;
  code?: unknown;
  result?: unknown;
};

type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  tls: { servername: string; rejectUnauthorized: true };
};

type SmtpMessage = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  disableFileAccess: true;
  disableUrlAccess: true;
};

type SmtpTransportClient = {
  sendMail(message: SmtpMessage): Promise<{ messageId?: unknown }>;
  close(): void;
};

export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransportClient;
export const EMAIL_OTP_SMTP_TRANSPORT_FACTORY = Symbol("EMAIL_OTP_SMTP_TRANSPORT_FACTORY");

const defaultSmtpTransportFactory: SmtpTransportFactory = (options) => {
  const transporter = nodemailer.createTransport(options);
  return {
    sendMail: async (message) => transporter.sendMail(message),
    close: () => transporter.close(),
  };
};

function envFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function provider() {
  return (process.env.EMAIL_OTP_PROVIDER ?? "mock").trim().toLowerCase();
}

function emailFromEnvironment() {
  const emailFrom = process.env.EMAIL_FROM?.trim() ?? "";
  const angleMatch = emailFrom.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  const fallbackEmail = angleMatch?.[2]?.trim() || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom) ? emailFrom : "");
  const fallbackName = angleMatch?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "LeadVirt.ai";
  return { email: fallbackEmail, name: fallbackName };
}

function senderFromEnvironment(email: string | undefined, name: string | undefined) {
  const fallback = emailFromEnvironment();
  return {
    email: email?.trim() || fallback.email,
    name: name?.trim() || fallback.name,
  };
}

function uniSenderConfiguration() {
  const sender = senderFromEnvironment(process.env.UNISENDER_SENDER_EMAIL, process.env.UNISENDER_SENDER_NAME);
  const listId = process.env.UNISENDER_LIST_ID?.trim() ?? "";
  const senderReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender.email);
  const listReady = /^\d+$/.test(listId) && Number(listId) > 0;
  return {
    apiKey: process.env.UNISENDER_API_KEY?.trim() ?? "",
    apiUrl: (process.env.UNISENDER_API_URL ?? "https://api.unisender.com/ru/api/sendEmail").trim(),
    listId,
    sender,
    ready: Boolean(process.env.UNISENDER_API_KEY?.trim() && senderReady && listReady),
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function smtpConfiguration() {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const port = positiveInteger(process.env.SMTP_PORT, 465);
  const user = process.env.SMTP_USER?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  const sender = senderFromEnvironment(process.env.SMTP_FROM_EMAIL, process.env.SMTP_FROM_NAME);
  const senderReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender.email);
  return {
    host,
    port,
    secure: envFlag(process.env.SMTP_SECURE) ?? port === 465,
    user,
    password,
    sender,
    connectionTimeout: positiveInteger(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10_000),
    greetingTimeout: positiveInteger(process.env.SMTP_GREETING_TIMEOUT_MS, 10_000),
    socketTimeout: positiveInteger(process.env.SMTP_SOCKET_TIMEOUT_MS, 15_000),
    ready: Boolean(host && user && password && senderReady),
  };
}

function featureEnabled() {
  const explicit = envFlag(process.env.AUTH_EMAIL_OTP_ENABLED);
  if (explicit !== null) return explicit;
  return process.env.NODE_ENV !== "production";
}

function htmlBody(copy: EmailCopy, code: string) {
  return `
<div style="margin:0;padding:32px 16px;background:#09090b;color:#f4f4f5;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;border:1px solid #27272a;border-radius:8px;background:#18181b;overflow:hidden">
    <div style="padding:28px 32px 12px;font-size:12px;font-weight:700;letter-spacing:0;color:#34d399;text-transform:uppercase">${copy.eyebrow}</div>
    <div style="padding:0 32px 32px">
      <div style="font-size:26px;line-height:1.25;font-weight:700;color:#fafafa">${copy.title}</div>
      <p style="margin:14px 0 22px;font-size:15px;line-height:1.6;color:#a1a1aa">${copy.description}</p>
      <div style="padding:18px 20px;border:1px solid #3f3f46;border-radius:8px;background:#09090b;text-align:center;font-size:34px;font-weight:700;letter-spacing:8px;color:#34d399">${code}</div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#d4d4d8">${copy.expiry}</p>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#71717a">${copy.warning}</p>
    </div>
  </div>
</div>`.trim();
}

function textBody(copy: EmailCopy, code: string) {
  return `${copy.title}\n\n${copy.description}\n\n${code}\n\n${copy.expiry}\n${copy.warning}`;
}

function firstDeliveryResult(payload: UniSenderResponse) {
  if (!Array.isArray(payload.result)) return null;
  const first: unknown = (payload.result as unknown[])[0];
  return typeof first === "object" && first !== null ? (first as { id?: unknown; errors?: unknown }) : null;
}

@Injectable()
export class EmailOtpDeliveryService {
  private readonly smtpTransportFactory: SmtpTransportFactory;

  constructor(
    @Optional()
    @Inject(EMAIL_OTP_SMTP_TRANSPORT_FACTORY)
    smtpTransportFactory?: SmtpTransportFactory,
  ) {
    this.smtpTransportFactory = smtpTransportFactory ?? defaultSmtpTransportFactory;
  }

  config() {
    const mode = provider();
    const mockReady = mode === "mock" && process.env.NODE_ENV !== "production";
    const providerReady =
      (mode === "unisender" && uniSenderConfiguration().ready) ||
      (mode === "smtp" && smtpConfiguration().ready);
    return {
      enabled: featureEnabled() && (mockReady || providerReady),
    };
  }

  deliveryMode() {
    return provider();
  }

  canExposeCode() {
    return process.env.NODE_ENV !== "production" && provider() === "mock";
  }

  async send(input: { challengeId: string; email: string; code: string; locale: EmailOtpLocale }) {
    if (!this.config().enabled) {
      throw new ServiceUnavailableException("Email sign-in is not configured.");
    }

    if (provider() === "mock") {
      return { providerMessageId: `mock:${input.challengeId}` };
    }

    if (provider() === "smtp") {
      const config = smtpConfiguration();
      const copy = emailCopy[input.locale];
      const transport = this.smtpTransportFactory({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: config.connectionTimeout,
        greetingTimeout: config.greetingTimeout,
        socketTimeout: config.socketTimeout,
        tls: { servername: config.host, rejectUnauthorized: true },
      });
      try {
        const result = await transport.sendMail({
          from: { name: config.sender.name, address: config.sender.email },
          to: input.email,
          subject: copy.subject,
          text: textBody(copy, input.code),
          html: htmlBody(copy, input.code),
          headers: { "X-LeadVirt-Purpose": "email_otp" },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (typeof result.messageId !== "string" || !result.messageId) {
          throw new Error("SMTP did not return a message id.");
        }
        return { providerMessageId: result.messageId };
      } catch {
        throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
      } finally {
        try {
          transport.close();
        } catch {
          // Cleanup must not change an already accepted SMTP delivery result.
        }
      }
    }

    const config = uniSenderConfiguration();
    const copy = emailCopy[input.locale];
    const form = new URLSearchParams({
      format: "json",
      api_key: config.apiKey,
      email: input.email,
      sender_name: config.sender.name,
      sender_email: config.sender.email,
      subject: copy.subject,
      body: htmlBody(copy, input.code),
      list_id: config.listId,
      lang: input.locale,
      track_read: "0",
      track_links: "0",
      error_checking: "1",
      ref_key: input.challengeId,
      "metadata[purpose]": "email_otp",
    });

    let payload: UniSenderResponse;
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = (await response.json()) as UniSenderResponse;
    } catch {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
    }

    const result = firstDeliveryResult(payload);
    const hasErrors = Array.isArray(result?.errors) && result.errors.length > 0;
    const messageId = result?.id;
    if (payload.error || (typeof messageId !== "string" && typeof messageId !== "number") || hasErrors) {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
    }

    return { providerMessageId: typeof messageId === "number" ? messageId.toString() : messageId };
  }
}
