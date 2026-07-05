import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { LeadsController } from "./leads.controller.js";
import { LeadsService } from "./leads.service.js";

@Module({
  imports: [IntegrationsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService]
})
export class LeadsModule {}
