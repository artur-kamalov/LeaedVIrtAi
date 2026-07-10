import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const emailOtpLocales = ["en", "es", "fr", "de", "pt", "ru"] as const;
export type EmailOtpLocale = (typeof emailOtpLocales)[number];

export class RequestEmailOtpDto {
  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @IsIn(emailOtpLocales)
  locale?: EmailOtpLocale;
}
