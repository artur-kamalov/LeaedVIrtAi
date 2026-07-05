import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      data: {
        status: "ok",
        service: "LeadVirt.ai API",
        timestamp: new Date().toISOString()
      }
    };
  }

  @Get("ready")
  ready() {
    return {
      data: {
        status: "ready",
        dependencies: {
          database: "configured",
          redis: "configured"
        }
      }
    };
  }
}
