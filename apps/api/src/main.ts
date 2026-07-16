import "reflect-metadata";
import { loadEnvFile } from "@leadvirt/config";
import { shutdownOpenTelemetry, startOpenTelemetry } from "@leadvirt/observability";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { RequestLoggingInterceptor } from "./common/interceptors/request-logging.interceptor.js";
import { AppConfigService } from "./config/app-config.service.js";

loadEnvFile();
startOpenTelemetry({
  serviceName: "leadvirt-api",
  environment: process.env.APP_ENV ?? process.env.NODE_ENV,
});

let application: INestApplication | undefined;
let shuttingDown = false;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  application = app;
  const config = app.get(AppConfigService);

  app.setGlobalPrefix("api", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
      { path: "metrics", method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ["ETag", "X-Request-Id"],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  await app.listen(config.port);
  console.log(`LeadVirt.ai API listening on http://localhost:${config.port}/api`);
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await application?.close();
    await shutdownOpenTelemetry();
  } finally {
    process.exitCode = exitCode;
  }
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void bootstrap().catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
