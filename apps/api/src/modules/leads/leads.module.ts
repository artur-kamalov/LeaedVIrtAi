import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { LeadsController } from "./leads.controller.js";
import { LeadsService } from "./leads.service.js";

@Module({
  imports: [IntegrationsModule],
  controllers: [LeadsController],
  providers: [LeadsService, RolesGuard],
  exports: [LeadsService]
})
export class LeadsModule {}
