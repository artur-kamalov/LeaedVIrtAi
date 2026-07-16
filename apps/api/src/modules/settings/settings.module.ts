import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, RolesGuard],
})
export class SettingsModule {}
