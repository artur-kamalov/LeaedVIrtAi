import { Type } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from "class-validator";

export class WidgetCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;
}

export class SendWidgetMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  clientMessageId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetCustomerDto)
  customer?: WidgetCustomerDto;

  @IsOptional()
  @IsString()
  @MaxLength(700)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(700)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;
}
