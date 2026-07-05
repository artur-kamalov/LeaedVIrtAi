import { IsString, MaxLength, MinLength } from "class-validator";

export class TwoFactorPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  currentPassword!: string;
}
