import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttpException ? exception.getResponse() : "Internal server error";
    const message =
      typeof payload === "string"
        ? payload
        : typeof payload === "object" && payload !== null && "message" in payload
          ? payload.message
          : "Unexpected error";

    if (!isHttpException) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      error: {
        code: isHttpException ? "HTTP_ERROR" : "INTERNAL_SERVER_ERROR",
        message
      }
    });
  }
}
