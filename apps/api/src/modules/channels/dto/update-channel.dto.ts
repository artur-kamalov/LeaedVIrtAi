import { IsIn, IsObject, IsOptional, IsString } from "class-validator";

const statuses = ["ACTIVE", "DISABLED", "ERROR", "PENDING", "COMING_SOON"] as const;

export class UpdateChannelDto {
  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
