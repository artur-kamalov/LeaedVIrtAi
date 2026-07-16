import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { recordSpanError, runWithSpanContext, setSpanOk, spanIds, SpanKind, startSpan } from "@leadvirt/observability";
import type { Response } from "express";
import { finalize, Observable, tap } from "rxjs";
import { recordHttpRequest } from "../../modules/metrics/metrics.registry.js";

interface RouteAwareRequest {
  baseUrl?: string;
  method: string;
  route?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requestMetricRoute(request: Pick<RouteAwareRequest, "baseUrl" | "route">) {
  const path = isRecord(request.route) ? request.route.path : undefined;
  if (typeof path !== "string" || path.length === 0) return "/unmatched";

  const route = `${request.baseUrl ?? ""}/${path}`.replace(/\/{2,}/g, "/");
  return route.startsWith("/") ? route : `/${route}`;
}

function statusCodeForError(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : 500;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RouteAwareRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const route = requestMetricRoute(request);
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
