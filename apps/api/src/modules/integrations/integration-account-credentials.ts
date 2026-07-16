import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
} from "@leadvirt/integrations";

const credentialFields = new Set([
  "accesstoken",
  "apikey",
  "apisecret",
  "apitoken",
  "apppassword",
  "authorizationcode",
  "clientsecret",
  "confirmationcode",
  "credentials",
  "outgoingsecret",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "token",
  "verifytoken",
  "webhooksecret",
]);

const providerCredentialFields: Readonly<Record<string, ReadonlySet<string>>> = {
  BITRIX24: new Set(["webhookurl"]),
};

const reservedResponseFields = new Set(["credentialsConfigured"]);

type PartitionedValue = {
  publicValue: unknown;
  credentials: Record<string, unknown>;
};

function credentialPath(path: readonly string[]) {
  return path.map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
}

function isCredentialField(provider: string, key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  return (
    credentialFields.has(normalized) ||
    /(?:apikey|authorizationcode|credentials|password|privatekey|secret|token)$/u.test(
      normalized,
    ) ||
    providerCredentialFields[provider]?.has(normalized) === true
  );
}

function normalizedCredential(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (typeof value === "object") return Object.keys(value).length > 0 ? value : undefined;
  return value;
}

function partitionValue(
  provider: string,
  value: unknown,
  path: readonly string[],
): PartitionedValue {
  if (Array.isArray(value)) {
    const credentials: Record<string, unknown> = {};
    const publicValue = value.map((item, index) => {
      const partitioned = partitionValue(provider, item, [...path, String(index)]);
      Object.assign(credentials, partitioned.credentials);
      return partitioned.publicValue;
    });
    return { publicValue, credentials };
  }

  if (typeof value !== "object" || value === null) {
    return { publicValue: value, credentials: {} };
  }

  const publicValue: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (reservedResponseFields.has(key)) continue;
    if (isCredentialField(provider, key)) {
      const normalized = normalizedCredential(child);
      if (normalized !== undefined) credentials[credentialPath([...path, key])] = normalized;
      continue;
    }

    const partitioned = partitionValue(provider, child, [...path, key]);
    publicValue[key] = partitioned.publicValue;
    Object.assign(credentials, partitioned.credentials);
  }
  return { publicValue, credentials };
}

export function partitionIntegrationAccountSettings(
  provider: string,
  settings: Record<string, unknown>,
) {
  const partitioned = partitionValue(provider, settings, []);
  return {
    publicSettings: partitioned.publicValue as Record<string, unknown>,
    credentials: partitioned.credentials,
  };
}

export function mergeIntegrationAccountCredentials(
  encryptedCredentials: string | null,
  ...patches: ReadonlyArray<Record<string, unknown>>
) {
  const patch: Record<string, unknown> = {};
  for (const entry of patches) Object.assign(patch, entry);
  if (Object.keys(patch).length === 0) return encryptedCredentials;
  const existing = encryptedCredentials ? decryptIntegrationCredentials(encryptedCredentials) : {};
  return encryptIntegrationCredentials({ ...existing, ...patch });
}
