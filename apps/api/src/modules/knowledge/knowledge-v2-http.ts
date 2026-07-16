import { HttpException, HttpStatus } from "@nestjs/common";
import { hashKnowledgeValue, stableKnowledgeValue } from "@leadvirt/knowledge";
import type {
  KnowledgeV2ErrorCode,
  KnowledgeV2FieldError,
  KnowledgeV2JsonValue,
} from "@leadvirt/types";

type HeaderValue = string | string[] | undefined;

interface PublicErrorOptions {
  retryable?: boolean;
  field?: string;
  fieldErrors?: KnowledgeV2FieldError[];
  details?: Record<string, KnowledgeV2JsonValue>;
}

export interface KnowledgeV2Cursor {
  createdAt: string;
  id: string;
}

export function knowledgeV2Error(
  status: number,
  code: KnowledgeV2ErrorCode,
  message: string,
  options: PublicErrorOptions = {},
) {
  return new HttpException(
    {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.field ? { field: options.field } : {}),
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
    status,
  );
}

export function canonicalKnowledgeV2Hash(value: unknown) {
  return hashKnowledgeValue(stableKnowledgeValue(value));
}

export function strongKnowledgeV2Etag(resource: string, id: string, version: number | string) {
  return `"kv2-${canonicalKnowledgeV2Hash({ resource, id, version })}"`;
}

export function requireIdempotencyKey(value: HeaderValue) {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  }
  return key;
}

export function requireIfMatch(value: HeaderValue) {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header?.trim()) {
    throw knowledgeV2Error(
      428,
      "KNOWLEDGE_VALIDATION_PRECONDITION_REQUIRED",
      "An If-Match header is required.",
    );
  }
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

export function assertIfMatch(
  value: HeaderValue,
  currentEtag: string,
  currentVersion: number,
  changedFields: string[] = [],
) {
  const candidates = requireIfMatch(value);
  if (candidates.includes(currentEtag)) return;
  throw knowledgeV2Error(
    HttpStatus.PRECONDITION_FAILED,
    "REVISION_CONFLICT",
    "This resource changed after it was loaded.",
    {
      details: {
        currentEtag,
        currentVersion,
        safeDiff: { changedFields },
      },
    },
  );
}

export function encodeKnowledgeV2Cursor(cursor: KnowledgeV2Cursor) {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), "utf8").toString("base64url");
}

export function decodeKnowledgeV2Cursor(value?: string): KnowledgeV2Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.version !== 1 ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 200
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw knowledgeV2Error(
      HttpStatus.BAD_REQUEST,
      "KNOWLEDGE_VALIDATION_CURSOR_INVALID",
      "The pagination cursor is invalid.",
      { field: "cursor" },
    );
  }
}
