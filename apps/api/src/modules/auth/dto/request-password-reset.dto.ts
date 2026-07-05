import { IsEmail, MaxLength } from "class-validator";

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(180)
  email!: string;
}
