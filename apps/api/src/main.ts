import "reflect-metadata";
import { loadEnvFile } from "@leadvirt/config";
import { shutdownOpenTelemetry, startOpenTelemetry } from "@leadvirt/observability";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { RequestLoggingInterceptor } from "./common/interceptors/request-logging.interceptor.js";
import { AppConfigService } from "./config/app-config.service.js";

loadEnvFile();
startOpenTelemetry({
  serviceName: "leadvirt-api",
  environment: process.env.APP_ENV ?? process.env.NODE_ENV
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);

  app.setGlobalPrefix("api", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
      { path: "metrics", method: RequestMethod.GET }
    ]
  });
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  await app.listen(config.port);
  console.log(`LeadVirt.ai API listening on http://localhost:${config.port}/api`);
}

process.on("SIGTERM", () => {
  void shutdownOpenTelemetry().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdownOpenTelemetry().finally(() => process.exit(0));
});

void bootstrap();
