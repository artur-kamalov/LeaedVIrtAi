import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  scopes?: string;
}
