import { IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export class TelegramAuthDto {
  @IsNumber()
  id!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  last_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photo_url?: string;

  @IsNumber()
  auth_date!: number;

  @IsString()
  @MaxLength(128)
  hash!: string;
}
