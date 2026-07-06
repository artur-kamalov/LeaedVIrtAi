import { Controller, Get, Header } from "@nestjs/common";
import { renderPrometheusMetrics } from "./metrics.registry.js";

@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metrics() {
    return renderPrometheusMetrics();
  }
}
