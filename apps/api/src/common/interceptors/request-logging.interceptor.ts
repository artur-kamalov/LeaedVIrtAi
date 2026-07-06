import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { recordSpanError, runWithSpanContext, setSpanOk, spanIds, SpanKind, startSpan } from "@leadvirt/observability";
import type { Response } from "express";
import { finalize, Observable, tap } from "rxjs";
import { recordHttpRequest } from "../../modules/metrics/metrics.registry.js";

function normalizeRoute(url: string) {
  const path = url.split("?")[0] ?? url;
  return path
    .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .replace(/\/\d{4,}(?=\/|$)/g, "/:id");
}

function statusCodeForError(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : 500;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const route = normalizeRoute(request.url);
    const span = startSpan(`HTTP ${request.method} ${route}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": request.method,
        "url.path": route
      }
    });

    return runWithSpanContext(span, () => next.handle()).pipe(
      tap({
        next: () => {
          const latencyMs = Date.now() - startedAt;
          span.setAttributes({
            "http.response.status_code": response.statusCode,
            "leadvirt.latency_ms": latencyMs
          });
          setSpanOk(span);
          recordHttpRequest({
            method: request.method,
            route,
            statusCode: response.statusCode,
            durationMs: latencyMs
          });
          console.log(
            JSON.stringify({
              module: "http",
              action: `${request.method} ${route}`,
              status: "ok",
              ...spanIds(span),
              latencyMs
            }),
          );
        },
        error: (error) => {
          const latencyMs = Date.now() - startedAt;
          const statusCode = statusCodeForError(error);
          span.setAttributes({
            "http.response.status_code": statusCode,
            "leadvirt.latency_ms": latencyMs
          });
          recordSpanError(span, error);
          recordHttpRequest({
            method: request.method,
            route,
            statusCode,
            durationMs: latencyMs
          });
          console.log(
            JSON.stringify({
              module: "http",
              action: `${request.method} ${route}`,
              status: "error",
              statusCode,
              ...spanIds(span),
              latencyMs
            }),
          );
        }
      }),
      finalize(() => span.end())
    );
  }
}
