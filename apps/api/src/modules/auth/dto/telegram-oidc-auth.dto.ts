import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class TelegramOidcAuthDto {
  @IsString()
  @MinLength(20)
  idToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nonce?: string;
}
