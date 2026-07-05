import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        console.log(
          JSON.stringify({
            module: "http",
            action: `${request.method} ${request.url}`,
            status: "ok",
            latencyMs: Date.now() - startedAt
          }),
        );
      }),
    );
  }
}
