import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateLeadEventDto {
  @IsString()
  @MaxLength(80)
  type!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
