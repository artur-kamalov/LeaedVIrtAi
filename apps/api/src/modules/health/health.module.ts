import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { HealthController } from "./health.controller.js";
import { RuntimeReadinessService } from "./runtime-readiness.service.js";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
  providers: [RuntimeReadinessService],
  exports: [RuntimeReadinessService],
})
export class HealthModule {}
