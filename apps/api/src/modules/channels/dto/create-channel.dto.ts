import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const creatableChannelTypes = ["WEBSITE", "TELEGRAM", "WEBHOOK"] as const;
const statuses = ["ACTIVE", "DISABLED", "PENDING"] as const;

export class CreateChannelDto {
  @IsIn(creatableChannelTypes)
  type!: (typeof creatableChannelTypes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/)
  publicKey?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
