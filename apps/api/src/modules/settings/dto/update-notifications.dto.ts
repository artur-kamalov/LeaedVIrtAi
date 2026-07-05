import { IsBoolean, IsOptional } from "class-validator";

export class UpdateNotificationsDto {
  @IsOptional()
  @IsBoolean()
  new_lead?: boolean;

  @IsOptional()
  @IsBoolean()
  no_reply?: boolean;

  @IsOptional()
  @IsBoolean()
  booking?: boolean;

  @IsOptional()
  @IsBoolean()
  daily?: boolean;

  @IsOptional()
  @IsBoolean()
  tg_summary?: boolean;
}
