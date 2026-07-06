import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { AiAuditController } from "./ai-audit.controller.js";
import { AiAuditService } from "./ai-audit.service.js";

@Module({
  controllers: [AiAuditController],
  providers: [AiAuditService, RolesGuard],
  exports: [AiAuditService]
})
export class AiAuditModule {}
