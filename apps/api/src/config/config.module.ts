import { Module } from "@nestjs/common";
import { AppConfigService } from "./app-config.service.js";

@Module({
  providers: [AppConfigService],
  exports: [AppConfigService]
})
export class ConfigModule {}
