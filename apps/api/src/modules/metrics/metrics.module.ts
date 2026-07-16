import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { KnowledgeMetricsSnapshotService } from "./knowledge-metrics-snapshot.service.js";
import { KnowledgeDependencyHealthService } from "./knowledge-dependency-health.service.js";
import { MetricsController } from "./metrics.controller.js";

@Module({
  imports: [ConfigModule],
  controllers: [MetricsController],
  providers: [KnowledgeMetricsSnapshotService, KnowledgeDependencyHealthService],
})
export class MetricsModule {}
