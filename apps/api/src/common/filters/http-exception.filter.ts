import { randomUUID } from "node:crypto";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicMessage(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (messages.length > 0) return messages.join(", ");
  }
  return "Unexpected error";
}

function publicCode(value: unknown) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value) ? value : "HTTP_ERROR";
}

function publicFieldErrors(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const errors = value.slice(0, 50).flatMap((item) => {
    if (!isRecord(item)) return [];
    const field = typeof item.field === "string" ? item.field.slice(0, 160) : "";
    const code = typeof item.code === "string" ? item.code.slice(0, 160) : "";
    const message = typeof item.message === "string" ? item.message.slice(0, 500) : "";
    return field && code && message ? [{ field, code, message }] : [];
  });
  return errors.length > 0 ? errors : undefined;
}

function requestId(request: Request) {
  const value = request.header("x-request-id");
  return value && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : randomUUID();
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const publicRequestId = requestId(request);

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttpException ? exception.getResponse() : "Internal server error";
    const payloadRecord = isRecord(payload) ? payload : undefined;
    const nestedError =
      payloadRecord && isRecord(payloadRecord.error) ? payloadRecord.error : undefined;
    const source = nestedError ?? payloadRecord;
    const publicError: ErrorRecord = {
      code: isHttpException ? publicCode(source?.code) : "INTERNAL_SERVER_ERROR",
      message: publicMessage(typeof payload === "string" ? payload : source?.message),
      requestId: publicRequestId,
    };

    if (typeof source?.retryable === "boolean") publicError.retryable = source.retryable;
    if (typeof source?.field === "string" && source.field.length <= 160)
      publicError.field = source.field;
    if (isRecord(source?.details)) publicError.details = source.details;
    const fieldErrors = publicFieldErrors(source?.fieldErrors);
    if (fieldErrors) publicError.fieldErrors = fieldErrors;
    if (!isHttpException) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.setHeader("X-Request-Id", publicRequestId);
    response.status(status).json({ error: publicError });
  }
}
