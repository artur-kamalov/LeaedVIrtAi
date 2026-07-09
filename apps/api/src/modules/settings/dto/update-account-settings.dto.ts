import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

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

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  @Matches(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/)
  logoDataUrl?: string | null;
}
