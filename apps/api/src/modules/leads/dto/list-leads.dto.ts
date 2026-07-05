import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"] as const;
const channelTypes = ["WEBSITE", "TELEGRAM", "WHATSAPP", "INSTAGRAM", "VK", "EMAIL", "WEBHOOK", "PHONE", "DEMO"] as const;

export class ListLeadsDto {
  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @IsIn(channelTypes)
  channel?: (typeof channelTypes)[number];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}
