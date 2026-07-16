import { HttpException, HttpStatus } from "@nestjs/common";
import { createHash } from "node:crypto";

type HeaderValue = string | string[] | undefined;

export function operatorError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return new HttpException(
    { code, message, retryable: false, ...(details ? { details } : {}) },
    status,
  );
}

export function operatorHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function operatorEtag(kind: string, id: string, generation: number, state: string) {
  return `"op-${operatorHash({ version: 1, kind, id, generation, state })}"`;
}

export function requireOperatorIdempotencyKey(value: HeaderValue) {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw operatorError(
      HttpStatus.BAD_REQUEST,
      "OPERATOR_IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  }
  return key;
}

export function requireOperatorIfMatch(value: HeaderValue) {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header?.trim()) {
    throw operatorError(
      428,
      "OPERATOR_PRECONDITION_REQUIRED",
      "An If-Match header is required.",
    );
  }
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

export function assertOperatorIfMatch(candidates: string[], currentEtag: string) {
  if (candidates.includes(currentEtag)) return;
  throw operatorError(
    HttpStatus.PRECONDITION_FAILED,
    "OPERATOR_ETAG_STALE",
    "This operation changed after it was loaded.",
    { currentEtag },
  );
}
