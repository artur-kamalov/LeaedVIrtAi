import { IsString, Length, Matches } from "class-validator";

export class VerifyEmailOtpDto {
  @IsString()
  @Length(48, 48)
  @Matches(/^[a-f0-9]+$/)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
