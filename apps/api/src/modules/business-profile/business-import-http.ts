import { HttpException, HttpStatus } from "@nestjs/common";
import { canonicalKnowledgeV2Hash, strongKnowledgeV2Etag } from "../knowledge/knowledge-v2-http.js";

export function businessImportError(
  status: number,
  code: `BUSINESS_IMPORT_${string}` | `BUSINESS_INFORMATION_${string}`,
  message: string,
  options: {
    retryable?: boolean;
    field?: string;
    details?: Record<string, unknown>;
  } = {},
) {
  return new HttpException(
    {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.field ? { field: options.field } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
    status,
  );
}

export function businessImportEtag(id: string, etag: number) {
  return strongKnowledgeV2Etag("business-import", id, etag);
}

export function businessImportCandidateEtag(id: string, etag: number) {
  return strongKnowledgeV2Etag("business-import-candidate", id, etag);
}

export function businessInformationEtag(tenantId: string, etag: number) {
  return strongKnowledgeV2Etag("business-information", tenantId, etag);
}

export function assertBusinessImportIfMatch(
  value: string | string[] | undefined,
  current: string,
  details: Record<string, unknown> = {},
) {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header?.trim()) {
    throw businessImportError(
      428,
      "BUSINESS_IMPORT_PRECONDITION_REQUIRED",
      "An If-Match header is required.",
    );
  }
  const candidates = header.split(",").map((candidate) => candidate.trim());
  if (candidates.includes(current)) return;
  throw businessImportError(
    HttpStatus.PRECONDITION_FAILED,
    "BUSINESS_IMPORT_REVISION_CONFLICT",
    "This import changed after it was loaded.",
    { details: { currentEtag: current, ...details } },
  );
}

export function businessImportManifestHash(value: unknown) {
  return canonicalKnowledgeV2Hash({ version: 1, value });
}

export function encodeBusinessImportCursor(input: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ version: 1, createdAt: input.createdAt.toISOString(), id: input.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeBusinessImportCursor(value?: string) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      decoded.version !== 1 ||
      typeof decoded.createdAt !== "string" ||
      !Number.isFinite(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== "string" ||
      !decoded.id ||
      decoded.id.length > 200
    ) throw new Error("invalid cursor");
    return { createdAt: new Date(decoded.createdAt), id: decoded.id };
  } catch {
    throw businessImportError(
      HttpStatus.BAD_REQUEST,
      "BUSINESS_IMPORT_CURSOR_INVALID",
      "The pagination cursor is invalid.",
      { field: "cursor" },
    );
  }
}
