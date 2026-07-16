import { IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf } from "class-validator";

export class UpdateAccountSettingsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  @Matches(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/)
  logoDataUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true, require_tld: false })
  website?: string | null;
}
