import { IsString, MaxLength, MinLength } from "class-validator";

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
