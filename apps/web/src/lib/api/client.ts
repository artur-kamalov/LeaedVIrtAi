import type { ApiEnvelope, KnowledgeV2FieldError } from "@leadvirt/types";
import { demoApiRequest, shouldUseDemoApi } from "./demo-runtime";

const defaultApiUrl = "http://localhost:4001/api";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "HTTP_ERROR",
    readonly retryable = false,
    readonly field?: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
    readonly fieldErrors?: KnowledgeV2FieldError[],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL ?? defaultApiUrl).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromPayload(payload: unknown) {
  if (!isRecord(payload)) return { message: "API request failed" };
  const source = isRecord(payload.error) ? payload.error : payload;
  const message = source.message;
  let publicMessage = "API request failed";
  if (Array.isArray(message)) {
    publicMessage = message.filter((item): item is string => typeof item === "string").join(", ");
  } else if (typeof message === "string") publicMessage = message;
  else if (typeof payload.error === "string") publicMessage = payload.error;
  const fieldErrors = Array.isArray(source.fieldErrors)
    ? source.fieldErrors.filter(
        (item): item is KnowledgeV2FieldError =>
          isRecord(item) &&
          typeof item.field === "string" &&
          typeof item.code === "string" &&
          typeof item.message === "string",
      )
    : undefined;
  return {
    message: publicMessage,
    code: typeof source.code === "string" ? source.code : undefined,
    retryable: typeof source.retryable === "boolean" ? source.retryable : undefined,
    field: typeof source.field === "string" ? source.field : undefined,
    details: isRecord(source.details) ? source.details : undefined,
    requestId: typeof source.requestId === "string" ? source.requestId : undefined,
    fieldErrors,
  };
}

function urlFor(path: string) {
  if (path.startsWith("http")) return path;
  return `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function withQuery<TQuery extends object>(path: string, query: TQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      value !== ""
    ) {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export async function apiResponse<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiClientResponse<T>> {
  if (shouldUseDemoApi()) {
    return Promise.resolve({
      data: demoApiRequest<T>(path, init),
      status: 200,
      headers: new Headers(),
    });
  }

  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(urlFor(path), {
    ...init,
    credentials: init.credentials ?? "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorFromPayload(payload);
    throw new ApiClientError(
      error.message,
      response.status,
      error.code,
      error.retryable,
      error.field,
      error.details,
      error.requestId,
      error.fieldErrors,
    );
  }
  return { data: payload as T, status: response.status, headers: response.headers };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await apiResponse<T>(path, init)).data;
}

export async function apiData<T>(path: string, init: RequestInit = {}): Promise<T> {
  const envelope = await apiRequest<ApiEnvelope<T>>(path, init);
  return envelope.data;
}

export async function apiDirectUpload<T>(input: {
  url: string;
  method: "PUT";
  headers: { Authorization: string; "Content-Type": string; "Content-Length": string };
  body: Blob;
  signal?: AbortSignal;
}): Promise<ApiClientResponse<T>> {
  const target = new URL(input.url);
  const api = new URL(apiBaseUrl());
  const expectedPrefix = `${api.pathname.replace(/\/$/u, "")}/knowledge/v2/file-uploads/`;
  if (
    target.origin !== api.origin ||
    !target.pathname.startsWith(expectedPrefix) ||
    !target.pathname.endsWith("/content") ||
    target.search ||
    target.hash
  ) {
    throw new ApiClientError(
      "The upload address returned by the server is invalid.",
      500,
      "KNOWLEDGE_UPLOAD_URL_INVALID",
    );
  }
  if (input.body.size !== Number(input.headers["Content-Length"])) {
    throw new ApiClientError(
      "The selected file no longer matches the upload policy.",
      400,
      "KNOWLEDGE_UPLOAD_POLICY_MISMATCH",
    );
  }
  const response = await fetch(target, {
    method: input.method,
    headers: {
      Authorization: input.headers.Authorization,
      "Content-Type": input.headers["Content-Type"],
    },
    body: input.body,
    credentials: "omit",
    cache: "no-store",
    signal: input.signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorFromPayload(payload);
    throw new ApiClientError(
      error.message,
      response.status,
      error.code,
      error.retryable,
      error.field,
      error.details,
      error.requestId,
      error.fieldErrors,
    );
  }
  return { data: payload as T, status: response.status, headers: response.headers };
}

export async function apiDataResponse<T>(path: string, init: RequestInit = {}) {
  const response = await apiResponse<ApiEnvelope<T>>(path, init);
  return { ...response, data: response.data.data };
}

export function jsonBody(body: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(body) };
}
