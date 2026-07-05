import { IsObject } from "class-validator";

export class UpdateIntegrationSettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
