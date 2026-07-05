import { BadRequestException } from "@nestjs/common";

export type AuthIdentifier =
  | {
      kind: "email";
      email: string;
      phone: null;
      storageEmail: string;
      publicIdentifier: string;
      nameSeed: string;
    }
  | {
      kind: "phone";
      email: null;
      phone: string;
      storageEmail: string;
      publicIdentifier: string;
      nameSeed: string;
    };

const phoneIdentityEmailDomain = "phone.leadvirt.internal";
const ruEmailDomains = new Set([
  "yandex.ru",
  "ya.ru",
  "mail.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "internet.ru",
  "rambler.ru",
  "lenta.ru",
  "autorambler.ru",
  "myrambler.ru",
  "ro.ru",
  "vk.com",
  "vk.ru",
  "ok.ru"
]);

function splitDomains(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function identifierPolicy() {
  const value = process.env.AUTH_IDENTIFIER_POLICY?.trim().toLowerCase();
  if (value === "global" || value === "any" || value === "off" || value === "disabled") return "global";
  return "ru";
}

function allowedExtraDomains() {
  return new Set([
    "leadvirt.ai",
    ...splitDomains(process.env.AUTH_EXTRA_ALLOWED_EMAIL_DOMAINS),
    ...splitDomains(process.env.AUTH_STAFF_EMAIL_DOMAINS)
  ]);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function emailDomain(email: string) {
  const atIndex = email.lastIndexOf("@");
  return atIndex >= 0 ? email.slice(atIndex + 1) : "";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAllowedRuEmailDomain(domain: string) {
  return ruEmailDomains.has(domain) || domain.endsWith(".ru");
}

function normalizeRuPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

function phoneStorageEmail(phone: string) {
  return `phone-${phone.replace(/\D/g, "")}@${phoneIdentityEmailDomain}`;
}

export function parseAuthIdentifier(rawValue: string): AuthIdentifier {
  const value = rawValue.trim();
  if (!value) {
    throw new BadRequestException("Укажите российскую почту или номер телефона РФ.");
  }

  const phone = normalizeRuPhone(value);
  if (phone) {
    return {
      kind: "phone",
      email: null,
      phone,
      storageEmail: phoneStorageEmail(phone),
      publicIdentifier: phone,
      nameSeed: phone.replace(/\D/g, "")
    };
  }

  if (!isEmail(value)) {
    throw new BadRequestException("Используйте российскую почту или номер телефона РФ.");
  }

  const email = normalizeEmail(value);
  const domain = emailDomain(email);
  const allowed = identifierPolicy() === "global" || isAllowedRuEmailDomain(domain) || allowedExtraDomains().has(domain);
  if (!allowed) {
    throw new BadRequestException("Для RU-версии используйте российскую почту или номер телефона РФ.");
  }

  return {
    kind: "email",
    email,
    phone: null,
    storageEmail: email,
    publicIdentifier: email,
    nameSeed: email.split("@")[0] || "user"
  };
}

export function authIdentifierWhere(identifier: AuthIdentifier) {
  return identifier.kind === "phone" ? { phone: identifier.phone } : { email: identifier.email };
}
