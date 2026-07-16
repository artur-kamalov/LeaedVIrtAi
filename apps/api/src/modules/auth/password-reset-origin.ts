import { ServiceUnavailableException } from "@nestjs/common";

type PasswordResetOriginEnvironment = {
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NODE_ENV?: string;
};

function configurationError(): never {
  throw new ServiceUnavailableException("Password reset link origin is not configured.");
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function parseOrigin(value: string | undefined, requireHttps: boolean) {
  if (!value?.trim()) configurationError();

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    configurationError();
  }

  if (
    (requireHttps
      ? parsed.protocol !== "https:"
      : !["http:", "https:"].includes(parsed.protocol)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (requireHttps && isLocalHostname(parsed.hostname))
  ) {
    configurationError();
  }

  return parsed.origin;
}

export function passwordResetOrigin(environment: PasswordResetOriginEnvironment = process.env) {
  const production = environment.NODE_ENV === "production";
  const appOrigin = parseOrigin(
    environment.APP_URL ?? (production ? undefined : "http://localhost:3001"),
    production,
  );

  if (!production) return appOrigin;

  const expectedOrigin = parseOrigin(environment.NEXT_PUBLIC_APP_URL, true);
  if (appOrigin !== expectedOrigin) configurationError();
  return appOrigin;
}
