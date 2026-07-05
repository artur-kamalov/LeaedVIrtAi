import { IsString, MaxLength, MinLength } from "class-validator";

export class TwoFactorCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  code!: string;
}
