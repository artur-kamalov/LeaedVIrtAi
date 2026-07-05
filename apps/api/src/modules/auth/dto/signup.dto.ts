import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class SignupDto {
  @IsString()
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
