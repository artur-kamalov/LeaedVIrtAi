import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import { RuntimeReadinessService } from "./runtime-readiness.service.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(RuntimeReadinessService) private readonly readiness: RuntimeReadinessService,
  ) {}

  @Get()
  health(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    return {
      data: {
        status: "alive",
        service: "LeadVirt.ai API",
        deploymentPreflight: isApiDeploymentPreflight(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.readiness.check();
    response.status(readiness.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    response.setHeader("Cache-Control", "no-store");
    return {
      data: {
        ...readiness,
        service: "LeadVirt.ai API",
        deploymentPreflight: isApiDeploymentPreflight(),
      },
    };
  }
}
