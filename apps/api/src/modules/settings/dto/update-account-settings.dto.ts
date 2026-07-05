import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateAccountSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessType?: string;
}
