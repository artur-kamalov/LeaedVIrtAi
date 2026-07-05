import { IsOptional, IsString } from "class-validator";

export class AssignConversationDto {
  @IsOptional()
  @IsString()
  userId?: string;
}
