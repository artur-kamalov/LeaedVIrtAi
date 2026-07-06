import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";

@Module({
  controllers: [BillingController],
  providers: [BillingService, RolesGuard],
  exports: [BillingService]
})
export class BillingModule {}
