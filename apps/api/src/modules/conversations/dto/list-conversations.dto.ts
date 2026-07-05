import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const conversationStatuses = ["OPEN", "WAITING_FOR_CUSTOMER", "WAITING_FOR_HUMAN", "CLOSED"] as const;
const channelTypes = ["WEBSITE", "TELEGRAM", "WHATSAPP", "INSTAGRAM", "VK", "EMAIL", "WEBHOOK", "PHONE", "DEMO"] as const;

export class ListConversationsDto {
  @IsOptional()
  @IsIn(conversationStatuses)
  status?: (typeof conversationStatuses)[number];

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
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}
